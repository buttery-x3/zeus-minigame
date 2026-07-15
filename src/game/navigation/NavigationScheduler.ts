import { NAVIGATION_FRAME_BUDGET_MS, NAVIGATION_WORK_QUANTUM_MS } from "../../config";

export type NavigationWorkSourceId = "player" | "flow" | "fallback";

export type NavigationWorkSource = {
  id: NavigationWorkSourceId;
  hasWork: () => boolean;
  runSlice: (deadline: number) => void;
};

export type NavigationSchedulerDiagnostics = {
  budgetMs: number;
  usedMs: number;
  maxSliceMs: number;
  overshootMs: number;
  slices: Record<NavigationWorkSourceId, number>;
  timeMs: Record<NavigationWorkSourceId, number>;
};

const SOURCE_ORDER: NavigationWorkSourceId[] = ["player", "flow", "player", "fallback"];

export class NavigationScheduler {
  private snapshot = createDiagnostics(NAVIGATION_FRAME_BUDGET_MS);

  constructor(
    private readonly budgetMs = NAVIGATION_FRAME_BUDGET_MS,
    private readonly quantumMs = NAVIGATION_WORK_QUANTUM_MS,
  ) {}

  run(sources: readonly NavigationWorkSource[]) {
    const startedAt = performance.now();
    const deadline = startedAt + this.budgetMs;
    const byId = new Map(sources.map((source) => [source.id, source]));
    const snapshot = createDiagnostics(this.budgetMs);
    let pass = 0;

    while (performance.now() < deadline && pass < SOURCE_ORDER.length * 3) {
      const id = SOURCE_ORDER[pass % SOURCE_ORDER.length];
      const source = byId.get(id);
      pass += 1;
      if (!source?.hasWork()) {
        continue;
      }

      const sliceStartedAt = performance.now();
      source.runSlice(Math.min(deadline, sliceStartedAt + this.quantumMs));
      const sliceMs = performance.now() - sliceStartedAt;
      snapshot.slices[id] += 1;
      snapshot.timeMs[id] += sliceMs;
      snapshot.maxSliceMs = Math.max(snapshot.maxSliceMs, sliceMs);
    }

    snapshot.usedMs = performance.now() - startedAt;
    snapshot.overshootMs = Math.max(0, snapshot.usedMs - this.budgetMs);
    this.snapshot = snapshot;
    return snapshot;
  }

  diagnostics() {
    return {
      ...this.snapshot,
      slices: { ...this.snapshot.slices },
      timeMs: { ...this.snapshot.timeMs },
    };
  }
}

function createDiagnostics(budgetMs: number): NavigationSchedulerDiagnostics {
  return {
    budgetMs,
    usedMs: 0,
    maxSliceMs: 0,
    overshootMs: 0,
    slices: { player: 0, flow: 0, fallback: 0 },
    timeMs: { player: 0, flow: 0, fallback: 0 },
  };
}
