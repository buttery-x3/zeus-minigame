import { describe, expect, test } from "vitest";
import type { TerrainCell } from "../types";
import { GridWorld } from "./GridWorld";
import { createTerrainCell, type TerrainProvider } from "./TerrainProvider";

describe("GridWorld explicit terrain generation", () => {
  test("committed reads and requests do not generate; only the bounded step commits", () => {
    const provider = new CountingTerrainProvider();
    const world = new GridWorld(provider);

    expect(world.readCommittedCell(2, 3)).toBeNull();
    expect(world.readCommittedCell(2, 3)).toBeNull();
    const missingWorld = world.cellToWorld(2, 3);
    expect(world.isBlockedWorld(missingWorld.x, missingWorld.z)).toBe(true);
    expect(world.getTerrainGenerationVersion()).toBe(0);

    world.requestTerrainGenerationAroundCell(2, 3);
    expect(world.getTerrainGenerationVersion()).toBe(0);

    const result = world.stepTerrainGeneration(2);
    expect(result).toMatchObject({ requested: true, generatedPatches: 2, generationVersion: 2 });
    expect(world.readCommittedCell(2, 3)?.structure).toBe("open");
    expect(() => world.getCommittedCellsInRange({ q: 0, r: 0 }, 65)).toThrow(RangeError);
  });
});

class CountingTerrainProvider implements TerrainProvider {
  private version = 0;
  private requested: { q: number; r: number } | null = null;
  private readonly cells = new Map<string, TerrainCell>();

  readCommittedCell(q: number, r: number) {
    return this.cells.get(`${q},${r}`) ?? null;
  }

  requestGenerationAround(q: number, r: number) {
    this.requested = { q, r };
  }

  stepGeneration(maxNewPatches: number) {
    if (!this.requested) {
      return { requested: false, generatedPatches: 0, generationVersion: this.version, complete: true };
    }
    const generatedPatches = Math.min(2, maxNewPatches);
    this.version += generatedPatches;
    this.cells.set(`${this.requested.q},${this.requested.r}`, createTerrainCell(this.requested.q, this.requested.r, "open", "grass"));
    this.requested = null;
    return { requested: true, generatedPatches, generationVersion: this.version, complete: true };
  }

  getGenerationVersion() {
    return this.version;
  }

  getCommittedCellCount() {
    return this.cells.size;
  }

  captureGeneratedTerrainSnapshot() {
    return { seed: 0, generationVersion: this.version, patches: [], cells: [] };
  }

  getDiagnostics() {
    return {};
  }
}
