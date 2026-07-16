import { describe, expect, test } from "vitest";
import { Profiler } from "./Profiler";

describe("Profiler terrain generation attribution", () => {
  test("aggregates ensure and demand generation into the frame metric", () => {
    const profiler = new Profiler();
    profiler.beginFrame(100);
    profiler.recordTerrainGeneration({ source: "ensure", durationMs: 3, generatedPatches: 2 });
    profiler.recordTerrainGeneration({ source: "demand", durationMs: 5, generatedPatches: 1 });
    profiler.endFrame(110);

    const snapshot = profiler.snapshot();
    expect(snapshot.terrainGeneration).toEqual({
      totalMs: 8,
      ensureMs: 3,
      demandMs: 5,
      calls: 2,
      generatedPatches: 3,
      maxCallMs: 5,
    });
    expect(snapshot.metrics.terrainGeneration.last).toBe(8);
  });
});
