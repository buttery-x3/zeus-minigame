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
};

type PathFrame = ProfilerSnapshot["pathfinding"];
type EnemyNavigationMetrics = {
  flowRebuildMs: number;
  flowVisited: number;
  flowRadius: number;
  queueLength: number;
  queueSolved: number;
  queueBudgetMs: number;
  queueUsedMs: number;
  direct: number;
  flow: number;
  acquire: number;
  fallback: number;
  waiting: number;
};

export class Profiler {
  private readonly metrics = new Map<string, Metric>();
  private frameStart = performance.now();
  private lastFrameTime = performance.now();
  private fps = 0;
  private pathFrame = createPathFrame();
  private enemyNavigationFrame = createEnemyNavigationFrame();
  private lastFlow = { flowRebuildMs: 0, flowVisited: 0, flowRadius: 0 };

  beginFrame(now = performance.now()) {
    const frameDelta = Math.max(0.001, now - this.lastFrameTime);
    this.fps = 1000 / frameDelta;
    this.lastFrameTime = now;
    this.frameStart = now;
    this.pathFrame = createPathFrame();
    this.enemyNavigationFrame = createEnemyNavigationFrame(this.lastFlow);
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
    this.record("frameTotal", now - this.frameStart);
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

  recordEnemyFlowField(ms: number, visited: number, radius: number) {
    this.lastFlow = { flowRebuildMs: ms, flowVisited: visited, flowRadius: radius };
    this.enemyNavigationFrame.flowRebuildMs = ms;
    this.enemyNavigationFrame.flowVisited = visited;
    this.enemyNavigationFrame.flowRadius = radius;
  }

  recordEnemyNavigationMode(mode: "direct" | "flow" | "acquire" | "fallback" | "waiting") {
    this.enemyNavigationFrame[mode] += 1;
  }

  recordEnemyPathQueue(params: { queueLength: number; solved: number; budgetMs: number; usedMs: number }) {
    this.enemyNavigationFrame.queueLength = params.queueLength;
    this.enemyNavigationFrame.queueSolved = params.solved;
    this.enemyNavigationFrame.queueBudgetMs = params.budgetMs;
    this.enemyNavigationFrame.queueUsedMs = params.usedMs;
  }

  snapshot(): ProfilerSnapshot {
    return {
      fps: this.fps,
      metrics: Object.fromEntries(this.metrics),
      pathfinding: { ...this.pathFrame },
      enemyNavigation: { ...this.enemyNavigationFrame },
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

function createEnemyNavigationFrame(lastFlow = { flowRebuildMs: 0, flowVisited: 0, flowRadius: 0 }): EnemyNavigationMetrics {
  return {
    flowRebuildMs: lastFlow.flowRebuildMs,
    flowVisited: lastFlow.flowVisited,
    flowRadius: lastFlow.flowRadius,
    queueLength: 0,
    queueSolved: 0,
    queueBudgetMs: 0,
    queueUsedMs: 0,
    direct: 0,
    flow: 0,
    acquire: 0,
    fallback: 0,
    waiting: 0,
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
