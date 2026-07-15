const FRAME_SAMPLE_CAPACITY = 600;
const FRAME_BUCKET_LIMIT_MS = 200;
const HEAP_SAMPLE_CAPACITY = 60;
const MEBIBYTE = 1024 * 1024;

type ChromiumMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

export type RuntimeResourceCounters = {
  geometries: number;
  textures: number;
  programs: number;
  sceneObjects: number;
  terrainCells: number;
  enemies: number;
  effects: number;
};

export type FramePacingDiagnostics = {
  lastDeltaMs: number;
  lastCpuMs: number;
  maxDeltaMs: number;
  p95DeltaMs: number;
  p99DeltaMs: number;
  above20Ms: number;
  above33Ms: number;
  above50Ms: number;
  missedVsyncs: number;
  samples: number;
};

export type RuntimeMemoryDiagnostics = {
  heapSupported: boolean;
  usedHeapMb: number | null;
  allocatedHeapMb: number | null;
  heapLimitMb: number | null;
  highWaterHeapMb: number | null;
  heapGrowthMbPerMinute: number | null;
  probableGcPauses: number;
  resources: RuntimeResourceCounters;
};

export class RuntimePerformanceMonitor {
  private readonly frameSamples = new Float32Array(FRAME_SAMPLE_CAPACITY);
  private readonly frameBuckets = new Uint16Array(FRAME_BUCKET_LIMIT_MS + 1);
  private readonly heapSamples = new Float64Array(HEAP_SAMPLE_CAPACITY);
  private readonly heapSampleTimes = new Float64Array(HEAP_SAMPLE_CAPACITY);
  private frameCursor = 0;
  private frameCount = 0;
  private heapCursor = 0;
  private heapCount = 0;
  private lastHeapSampleAt = 0;
  private previousHeapUsed = 0;
  private highWaterHeap = 0;
  private probableGcPauses = 0;
  private nextSummaryAt = 0;
  private lastCpuMs = 0;
  private pacing = emptyPacing();
  private resources: RuntimeResourceCounters = emptyResources();

  recordFrameStart(frameDeltaMs: number, now: number) {
    this.frameSamples[this.frameCursor] = frameDeltaMs;
    this.frameCursor = (this.frameCursor + 1) % FRAME_SAMPLE_CAPACITY;
    this.frameCount = Math.min(FRAME_SAMPLE_CAPACITY, this.frameCount + 1);

    const memory = readChromiumMemory();
    if (memory) {
      const dropped = this.previousHeapUsed - memory.usedJSHeapSize;
      if (this.previousHeapUsed > 0 && dropped > Math.max(MEBIBYTE, this.previousHeapUsed * 0.05) && frameDeltaMs > 20) {
        this.probableGcPauses += 1;
      }
      this.previousHeapUsed = memory.usedJSHeapSize;
      this.highWaterHeap = Math.max(this.highWaterHeap, memory.usedJSHeapSize);
      if (now - this.lastHeapSampleAt >= 1000) {
        this.heapSamples[this.heapCursor] = memory.usedJSHeapSize;
        this.heapSampleTimes[this.heapCursor] = now;
        this.heapCursor = (this.heapCursor + 1) % HEAP_SAMPLE_CAPACITY;
        this.heapCount = Math.min(HEAP_SAMPLE_CAPACITY, this.heapCount + 1);
        this.lastHeapSampleAt = now;
      }
    }

    if (now >= this.nextSummaryAt) {
      this.updatePacingSummary();
      this.nextSummaryAt = now + 250;
    }
  }

  recordFrameEnd(cpuMs: number) {
    this.lastCpuMs = cpuMs;
    this.pacing.lastCpuMs = cpuMs;
  }

  recordResources(resources: RuntimeResourceCounters) {
    this.resources = { ...resources };
  }

  framePacingDiagnostics(): FramePacingDiagnostics {
    return { ...this.pacing };
  }

  memoryDiagnostics(): RuntimeMemoryDiagnostics {
    const memory = readChromiumMemory();
    return {
      heapSupported: memory !== null,
      usedHeapMb: memory ? memory.usedJSHeapSize / MEBIBYTE : null,
      allocatedHeapMb: memory ? memory.totalJSHeapSize / MEBIBYTE : null,
      heapLimitMb: memory ? memory.jsHeapSizeLimit / MEBIBYTE : null,
      highWaterHeapMb: memory ? this.highWaterHeap / MEBIBYTE : null,
      heapGrowthMbPerMinute: memory ? this.heapGrowthPerMinute() : null,
      probableGcPauses: this.probableGcPauses,
      resources: { ...this.resources },
    };
  }

  private updatePacingSummary() {
    this.frameBuckets.fill(0);
    let max = 0;
    let above20 = 0;
    let above33 = 0;
    let above50 = 0;
    let missedVsyncs = 0;

    for (let index = 0; index < this.frameCount; index += 1) {
      const delta = this.frameSamples[index];
      max = Math.max(max, delta);
      above20 += delta > 20 ? 1 : 0;
      above33 += delta > 33.34 ? 1 : 0;
      above50 += delta > 50 ? 1 : 0;
      missedVsyncs += Math.max(0, Math.round(delta / (1000 / 60)) - 1);
      this.frameBuckets[Math.min(FRAME_BUCKET_LIMIT_MS, Math.floor(delta))] += 1;
    }

    const lastIndex = (this.frameCursor - 1 + FRAME_SAMPLE_CAPACITY) % FRAME_SAMPLE_CAPACITY;
    this.pacing = {
      lastDeltaMs: this.frameCount > 0 ? this.frameSamples[lastIndex] : 0,
      lastCpuMs: this.lastCpuMs,
      maxDeltaMs: max,
      p95DeltaMs: this.percentile(0.95),
      p99DeltaMs: this.percentile(0.99),
      above20Ms: above20,
      above33Ms: above33,
      above50Ms: above50,
      missedVsyncs,
      samples: this.frameCount,
    };
  }

  private percentile(percentile: number) {
    if (this.frameCount === 0) {
      return 0;
    }
    const target = Math.ceil(this.frameCount * percentile);
    let seen = 0;
    for (let bucket = 0; bucket < this.frameBuckets.length; bucket += 1) {
      seen += this.frameBuckets[bucket];
      if (seen >= target) {
        return bucket;
      }
    }
    return FRAME_BUCKET_LIMIT_MS;
  }

  private heapGrowthPerMinute() {
    if (this.heapCount < 2) {
      return 0;
    }
    const newestIndex = (this.heapCursor - 1 + HEAP_SAMPLE_CAPACITY) % HEAP_SAMPLE_CAPACITY;
    const oldestIndex = this.heapCount < HEAP_SAMPLE_CAPACITY ? 0 : this.heapCursor;
    const elapsedMinutes = (this.heapSampleTimes[newestIndex] - this.heapSampleTimes[oldestIndex]) / 60000;
    if (elapsedMinutes <= 0) {
      return 0;
    }
    return (this.heapSamples[newestIndex] - this.heapSamples[oldestIndex]) / MEBIBYTE / elapsedMinutes;
  }
}

function readChromiumMemory() {
  const memory = (performance as Performance & { memory?: ChromiumMemory }).memory;
  return memory ?? null;
}

function emptyPacing(): FramePacingDiagnostics {
  return {
    lastDeltaMs: 0,
    lastCpuMs: 0,
    maxDeltaMs: 0,
    p95DeltaMs: 0,
    p99DeltaMs: 0,
    above20Ms: 0,
    above33Ms: 0,
    above50Ms: 0,
    missedVsyncs: 0,
    samples: 0,
  };
}

function emptyResources(): RuntimeResourceCounters {
  return { geometries: 0, textures: 0, programs: 0, sceneObjects: 0, terrainCells: 0, enemies: 0, effects: 0 };
}
