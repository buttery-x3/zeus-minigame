import type { NavigationSchedulerDiagnostics } from "../navigation/NavigationScheduler";
import {
  RuntimePerformanceMonitor,
  type RuntimeResourceCounters,
} from "./RuntimePerformanceMonitor";

type Metric = {
  last: number;
  avg: number;
  max: number;
};

export type ProfilerSnapshot = {
  fps: number;
  metrics: Record<string, Metric>;
  pathfinding: {
    calls: number;
    success: number;
    failed: number;
    totalMs: number;
    avgMs: number;
    maxMs: number;
    iterations: number;
    maxIterations: number;
  };
  enemyNavigation: EnemyNavigationMetrics;
  navigationScheduler: NavigationSchedulerDiagnostics;
  framePacing: ReturnType<RuntimePerformanceMonitor["framePacingDiagnostics"]>;
  memory: ReturnType<RuntimePerformanceMonitor["memoryDiagnostics"]>;
};

type PathFrame = ProfilerSnapshot["pathfinding"];
type EnemyNavigationMetrics = {
  flowRebuildMs: number;
  flowVisited: number;
  flowRadius: number;
  flowSliceMs: number;
  flowBuilding: boolean;
  flowBuildVisited: number;
  flowRootLag: number;
  flowTerrainLimited: boolean;
  flowCompletedBuilds: number;
  flowCoalescedRequests: number;
  flowWalkableCacheSize: number;
  queueLength: number;
  queueSolved: number;
  queueBudgetMs: number;
  queueUsedMs: number;
  queueFailed: number;
  queueActiveStage: string | null;
  direct: number;
  flow: number;
  acquire: number;
  fallback: number;
  waiting: number;
};

export class Profiler {
  private readonly runtimePerformance = new RuntimePerformanceMonitor();
  private readonly metrics = new Map<string, Metric>();
  private frameStart = performance.now();
  private lastFrameTime = performance.now();
  private fps = 0;
  private pathFrame = createPathFrame();
  private enemyNavigationFrame = createEnemyNavigationFrame();
  private lastFlow = {
    flowRebuildMs: 0,
    flowVisited: 0,
    flowRadius: 0,
    flowSliceMs: 0,
    flowBuilding: false,
    flowBuildVisited: 0,
    flowRootLag: 0,
    flowTerrainLimited: false,
    flowCompletedBuilds: 0,
    flowCoalescedRequests: 0,
    flowWalkableCacheSize: 0,
  };
  private navigationSchedulerFrame = createNavigationSchedulerFrame();

  beginFrame(now = performance.now()) {
    const frameDelta = Math.max(0.001, now - this.lastFrameTime);
    this.runtimePerformance.recordFrameStart(frameDelta, now);
    this.fps = 1000 / frameDelta;
    this.lastFrameTime = now;
    this.frameStart = now;
    this.pathFrame = createPathFrame();
    this.enemyNavigationFrame = createEnemyNavigationFrame(this.lastFlow);
    this.navigationSchedulerFrame = createNavigationSchedulerFrame();
  }

  measure<T>(name: string, callback: () => T): T {
    const start = performance.now();
    try {
      return callback();
    } finally {
      this.record(name, performance.now() - start);
    }
  }

  endFrame(now = performance.now()) {
    const frameTotal = now - this.frameStart;
    this.record("frameTotal", frameTotal);
    this.runtimePerformance.recordFrameEnd(frameTotal);
  }

  recordRuntimeResources(resources: RuntimeResourceCounters) {
    this.runtimePerformance.recordResources(resources);
  }

  recordPathfinding(ms: number, iterations: number, success: boolean) {
    this.pathFrame.calls += 1;
    this.pathFrame.totalMs += ms;
    this.pathFrame.maxMs = Math.max(this.pathFrame.maxMs, ms);
    this.pathFrame.iterations += iterations;
    this.pathFrame.maxIterations = Math.max(this.pathFrame.maxIterations, iterations);
    if (success) {
      this.pathFrame.success += 1;
    } else {
      this.pathFrame.failed += 1;
    }
    this.pathFrame.avgMs = this.pathFrame.calls > 0 ? this.pathFrame.totalMs / this.pathFrame.calls : 0;
  }

  recordEnemyFlowField(params: {
    rebuildMs: number;
    visited: number;
    radius: number;
    sliceMs: number;
    building: boolean;
    buildVisited: number;
    rootLag: number;
    terrainLimited: boolean;
    completedBuilds: number;
    coalescedRequests: number;
    walkableCacheSize: number;
  }) {
    this.lastFlow = {
      flowRebuildMs: params.rebuildMs,
      flowVisited: params.visited,
      flowRadius: params.radius,
      flowSliceMs: params.sliceMs,
      flowBuilding: params.building,
      flowBuildVisited: params.buildVisited,
      flowRootLag: params.rootLag,
      flowTerrainLimited: params.terrainLimited,
      flowCompletedBuilds: params.completedBuilds,
      flowCoalescedRequests: params.coalescedRequests,
      flowWalkableCacheSize: params.walkableCacheSize,
    };
    Object.assign(this.enemyNavigationFrame, this.lastFlow);
  }

  recordEnemyNavigationMode(mode: "direct" | "flow" | "acquire" | "fallback" | "waiting") {
    this.enemyNavigationFrame[mode] += 1;
  }

  recordEnemyPathQueue(params: { queueLength: number; solved: number; failed?: number; budgetMs: number; usedMs: number; activeStage?: string | null }) {
    this.enemyNavigationFrame.queueLength = params.queueLength;
    this.enemyNavigationFrame.queueSolved = params.solved;
    this.enemyNavigationFrame.queueBudgetMs = params.budgetMs;
    this.enemyNavigationFrame.queueUsedMs = params.usedMs;
    this.enemyNavigationFrame.queueFailed = params.failed ?? 0;
    this.enemyNavigationFrame.queueActiveStage = params.activeStage ?? null;
  }

  recordNavigationScheduler(params: NavigationSchedulerDiagnostics) {
    this.navigationSchedulerFrame = {
      ...params,
      slices: { ...params.slices },
      timeMs: { ...params.timeMs },
    };
  }

  snapshot(): ProfilerSnapshot {
    return {
      fps: this.fps,
      metrics: Object.fromEntries(this.metrics),
      pathfinding: { ...this.pathFrame },
      enemyNavigation: { ...this.enemyNavigationFrame },
      navigationScheduler: {
        ...this.navigationSchedulerFrame,
        slices: { ...this.navigationSchedulerFrame.slices },
        timeMs: { ...this.navigationSchedulerFrame.timeMs },
      },
      framePacing: this.runtimePerformance.framePacingDiagnostics(),
      memory: this.runtimePerformance.memoryDiagnostics(),
    };
  }

  private record(name: string, ms: number) {
    const existing = this.metrics.get(name);
    if (!existing) {
      this.metrics.set(name, { last: ms, avg: ms, max: ms });
      return;
    }

    existing.last = ms;
    existing.avg = existing.avg * 0.92 + ms * 0.08;
    existing.max = Math.max(ms, existing.max * 0.985);
  }
}

function createEnemyNavigationFrame(lastFlow = {
  flowRebuildMs: 0,
  flowVisited: 0,
  flowRadius: 0,
  flowSliceMs: 0,
  flowBuilding: false,
  flowBuildVisited: 0,
  flowRootLag: 0,
  flowTerrainLimited: false,
  flowCompletedBuilds: 0,
  flowCoalescedRequests: 0,
  flowWalkableCacheSize: 0,
}): EnemyNavigationMetrics {
  return {
    flowRebuildMs: lastFlow.flowRebuildMs,
    flowVisited: lastFlow.flowVisited,
    flowRadius: lastFlow.flowRadius,
    flowSliceMs: lastFlow.flowSliceMs,
    flowBuilding: lastFlow.flowBuilding,
    flowBuildVisited: lastFlow.flowBuildVisited,
    flowRootLag: lastFlow.flowRootLag,
    flowTerrainLimited: lastFlow.flowTerrainLimited,
    flowCompletedBuilds: lastFlow.flowCompletedBuilds,
    flowCoalescedRequests: lastFlow.flowCoalescedRequests,
    flowWalkableCacheSize: lastFlow.flowWalkableCacheSize,
    queueLength: 0,
    queueSolved: 0,
    queueBudgetMs: 0,
    queueUsedMs: 0,
    queueFailed: 0,
    queueActiveStage: null,
    direct: 0,
    flow: 0,
    acquire: 0,
    fallback: 0,
    waiting: 0,
  };
}

function createNavigationSchedulerFrame(): NavigationSchedulerDiagnostics {
  return {
    budgetMs: 0,
    usedMs: 0,
    maxSliceMs: 0,
    overshootMs: 0,
    slices: { player: 0, flow: 0, fallback: 0 },
    timeMs: { player: 0, flow: 0, fallback: 0 },
  };
}

function createPathFrame(): PathFrame {
  return {
    calls: 0,
    success: 0,
    failed: 0,
    totalMs: 0,
    avgMs: 0,
    maxMs: 0,
    iterations: 0,
    maxIterations: 0,
  };
}
