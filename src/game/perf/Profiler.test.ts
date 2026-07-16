import { describe, expect, test, vi } from "vitest";
import { Profiler } from "./Profiler";

describe("Profiler terrain generation attribution", () => {
  test("attributes the single rolling generation phase", () => {
    const profiler = new Profiler();
    profiler.beginFrame(100);
    const now = vi.spyOn(performance, "now").mockReturnValueOnce(101).mockReturnValueOnce(106);
    profiler.measureTerrainGeneration(() => ({ generatedPatches: 2 }));
    now.mockRestore();
    profiler.endFrame(110);

    const snapshot = profiler.snapshot();
    expect(snapshot.terrainGeneration).toEqual({
      totalMs: 5,
      calls: 1,
      generatedPatches: 2,
      maxCallMs: 5,
    });
    expect(snapshot.metrics.terrainGeneration.last).toBe(5);
  });
});
