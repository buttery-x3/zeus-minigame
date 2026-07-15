import { describe, expect, it } from "vitest";
import { RuntimePerformanceMonitor } from "./RuntimePerformanceMonitor";

describe("runtime performance monitor", () => {
  it("retains frame spikes that would be hidden by smoothed subsystem averages", () => {
    const monitor = new RuntimePerformanceMonitor();
    for (let index = 0; index < 99; index += 1) {
      monitor.recordFrameStart(16.7, index * 17);
    }
    monitor.recordFrameStart(42, 2000);
    monitor.recordFrameEnd(5.2);

    const pacing = monitor.framePacingDiagnostics();
    expect(pacing.samples).toBe(100);
    expect(pacing.maxDeltaMs).toBe(42);
    expect(pacing.above33Ms).toBe(1);
    expect(pacing.missedVsyncs).toBeGreaterThan(0);
    expect(pacing.lastCpuMs).toBe(5.2);
  });

  it("reports application and renderer resource counters", () => {
    const monitor = new RuntimePerformanceMonitor();
    monitor.recordResources({
      geometries: 8,
      textures: 4,
      programs: 3,
      sceneObjects: 72,
      terrainCells: 1337,
      enemies: 24,
      effects: 2,
    });
    expect(monitor.memoryDiagnostics().resources).toEqual({
      geometries: 8,
      textures: 4,
      programs: 3,
      sceneObjects: 72,
      terrainCells: 1337,
      enemies: 24,
      effects: 2,
    });
  });
});
