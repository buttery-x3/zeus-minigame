export const MAX_SIMULATION_STEP_SECONDS = 0.05;
export const MAX_CATCH_UP_SECONDS = 0.25;

export function getBoundedFrameDelta(rawDeltaSeconds: number, discardForVisibility: boolean) {
  const rawDelta = Number.isFinite(rawDeltaSeconds) ? Math.max(0, rawDeltaSeconds) : 0;
  return discardForVisibility ? 0 : Math.min(rawDelta, MAX_CATCH_UP_SECONDS);
}

export type SimulationTimingSnapshot = {
  rawDeltaSeconds: number;
  presentationDeltaSeconds: number;
  simulatedDeltaSeconds: number;
  substeps: number;
  cappedSeconds: number;
  visibilityDiscardedSeconds: number;
  totalCappedSeconds: number;
  totalVisibilityDiscardedSeconds: number;
  multiStepFrameCount: number;
  lastMultiStepFrame: {
    rawDeltaSeconds: number;
    simulatedDeltaSeconds: number;
    substeps: number;
    cappedSeconds: number;
  } | null;
  paused: boolean;
  maxStepSeconds: number;
  maxCatchUpSeconds: number;
};

export class SimulationStepper {
  private totalCappedSeconds = 0;
  private totalVisibilityDiscardedSeconds = 0;
  private multiStepFrameCount = 0;
  private lastMultiStepFrame: SimulationTimingSnapshot["lastMultiStepFrame"] = null;
  private snapshot: SimulationTimingSnapshot = this.createSnapshot();

  advance(rawDeltaSeconds: number, paused: boolean, discardForVisibility: boolean, update: (dt: number) => void) {
    const rawDelta = Number.isFinite(rawDeltaSeconds) ? Math.max(0, rawDeltaSeconds) : 0;
    const visibilityDiscardedSeconds = discardForVisibility ? rawDelta : 0;
    const cappedSeconds = discardForVisibility ? 0 : Math.max(0, rawDelta - MAX_CATCH_UP_SECONDS);
    const presentationDeltaSeconds = getBoundedFrameDelta(rawDelta, discardForVisibility);
    let simulatedDeltaSeconds = 0;
    let substeps = 0;

    if (!paused) {
      let remaining = presentationDeltaSeconds;
      while (remaining > 0.000001) {
        const dt = Math.min(MAX_SIMULATION_STEP_SECONDS, remaining);
        update(dt);
        simulatedDeltaSeconds += dt;
        remaining -= dt;
        substeps += 1;
      }
    }

    this.totalCappedSeconds += cappedSeconds;
    this.totalVisibilityDiscardedSeconds += visibilityDiscardedSeconds;
    if (substeps > 1) {
      this.multiStepFrameCount += 1;
      this.lastMultiStepFrame = { rawDeltaSeconds: rawDelta, simulatedDeltaSeconds, substeps, cappedSeconds };
    }
    this.snapshot = {
      rawDeltaSeconds: rawDelta,
      presentationDeltaSeconds,
      simulatedDeltaSeconds,
      substeps,
      cappedSeconds,
      visibilityDiscardedSeconds,
      totalCappedSeconds: this.totalCappedSeconds,
      totalVisibilityDiscardedSeconds: this.totalVisibilityDiscardedSeconds,
      multiStepFrameCount: this.multiStepFrameCount,
      lastMultiStepFrame: this.lastMultiStepFrame ? { ...this.lastMultiStepFrame } : null,
      paused,
      maxStepSeconds: MAX_SIMULATION_STEP_SECONDS,
      maxCatchUpSeconds: MAX_CATCH_UP_SECONDS,
    };

    return this.snapshot;
  }

  diagnostics() {
    return { ...this.snapshot };
  }

  private createSnapshot(): SimulationTimingSnapshot {
    return {
      rawDeltaSeconds: 0,
      presentationDeltaSeconds: 0,
      simulatedDeltaSeconds: 0,
      substeps: 0,
      cappedSeconds: 0,
      visibilityDiscardedSeconds: 0,
      totalCappedSeconds: 0,
      totalVisibilityDiscardedSeconds: 0,
      multiStepFrameCount: 0,
      lastMultiStepFrame: null,
      paused: false,
      maxStepSeconds: MAX_SIMULATION_STEP_SECONDS,
      maxCatchUpSeconds: MAX_CATCH_UP_SECONDS,
    };
  }
}
