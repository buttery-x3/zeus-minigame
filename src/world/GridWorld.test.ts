import { describe, expect, test } from "vitest";
import type { TerrainCell } from "../types";
import { GridWorld, type TerrainGenerationSample } from "./GridWorld";
import { createTerrainCell, type TerrainProvider } from "./TerrainProvider";

describe("GridWorld terrain generation attribution", () => {
  test("reports budgeted and on-demand patch generation through one callback", () => {
    const provider = new CountingTerrainProvider();
    const samples: TerrainGenerationSample[] = [];
    const world = new GridWorld(provider, (sample) => samples.push(sample));

    world.getCell(2, 3);
    world.getCell(2, 3);
    world.ensureTerrainGeneratedAroundCell(0, 0);

    expect(samples.map((sample) => [sample.source, sample.generatedPatches])).toEqual([
      ["demand", 1],
      ["ensure", 2],
    ]);
  });
});

class CountingTerrainProvider implements TerrainProvider {
  private version = 0;

  getCell(q: number, r: number): TerrainCell {
    this.version += 1;
    return createTerrainCell(q, r, "open", "grass");
  }

  ensureGeneratedAround() {
    this.version += 2;
  }

  getGenerationVersion() {
    return this.version;
  }

  getDiagnostics() {
    return {};
  }
}
