import { describe, expect, test } from "vitest";
import type { TerrainStructure } from "../types";
import { createTerrainStructureCounts } from "./HexTerrainRules";
import { patchCoordToWorld } from "./HexTerrainPatch";
import {
  createTerrainCompositionReport,
  type GeneratedTerrainPatchSnapshot,
  type GeneratedTerrainSnapshot,
} from "./TerrainCompositionReport";
import { analyzeTerrainComposition, formatTerrainCompositionFailure } from "./TerrainCompositionRegression";
import { WfcTerrainProvider } from "./WfcTerrainProvider";

describe("terrain composition reporting", () => {
  test("classifies selected families, patch content, and final microcells independently", () => {
    const patches = [
      patch(0, 0, "open", "authored", {}),
      patch(1, 0, "cliff", "authored", { wall: 2 }),
      patch(2, 0, "river", "authored", { river: 3 }),
      patch(3, 0, "lake", "authored", { lake: 4, bank: 1 }),
      patch(4, 0, "transition", "authored", { wall: 2, river: 2 }),
      patch(5, 0, "open", "procedural", { bank: 1 }),
    ];
    const structures: TerrainStructure[] = ["open", "wall", "river", "lake", "bank", "open"];
    const snapshot: GeneratedTerrainSnapshot = {
      seed: 17,
      generationVersion: patches.length,
      patches,
      cells: patches.map((entry, index) => ({ ...patchCoordToWorld(entry), structure: structures[index] })),
    };

    const before = JSON.stringify(snapshot);
    const report = createTerrainCompositionReport(snapshot, { localPatchRadius: 0 });

    expect(report.families.counts).toEqual({ open: 1, cliff: 1, river: 1, lake: 1, transition: 1, procedural: 1 });
    expect(report.contents.counts).toEqual({
      featureless: 1,
      "wall-bearing": 1,
      "river-bearing": 1,
      "lake-bearing": 1,
      mixed: 2,
    });
    expect(report.structures.counts).toEqual({ open: 2, wall: 1, river: 1, lake: 1, bank: 1 });
    expect(report.patchesContaining).toEqual({ wall: 2, river: 2, lake: 1 });
    expect(report.windows).toHaveLength(patches.length);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(createTerrainCompositionReport(snapshot, { localPatchRadius: 0 })).toEqual(report);
  });

  test("does not generate terrain while capturing or inspecting committed state", () => {
    const provider = new WfcTerrainProvider(20260517);
    const before = provider.getDiagnostics().wfc;

    const snapshot = provider.getGeneratedTerrainSnapshot();
    const first = createTerrainCompositionReport(snapshot, { localPatchRadius: 3 });
    const second = createTerrainCompositionReport(snapshot, { localPatchRadius: 3 });
    const diagnostics = formatTerrainCompositionFailure(analyzeTerrainComposition([snapshot], 3), 12.5);
    const after = provider.getDiagnostics().wfc;

    expect(first).toEqual(second);
    expect(first.windows).toHaveLength(1);
    expect(after.generationEnsureCount).toBe(before.generationEnsureCount);
    expect(after.generatedPatchCount).toBe(before.generatedPatchCount);
    expect(after.resolvedCells).toBe(before.resolvedCells);
    expect(provider.getGenerationVersion()).toBe(snapshot.generationVersion);
    expect(diagnostics).toContain("per-seed families.cliff");
    expect(diagnostics).toContain("worst local windows:");
    expect(diagnostics).toContain("percentages=");
  });
});

function patch(
  q: number,
  r: number,
  family: GeneratedTerrainPatchSnapshot["family"],
  provenance: GeneratedTerrainPatchSnapshot["provenance"],
  structures: Partial<Record<TerrainStructure, number>>,
): GeneratedTerrainPatchSnapshot {
  const structureCounts = createTerrainStructureCounts();
  Object.assign(structureCounts, structures);
  structureCounts.open = 19 - Object.values(structures).reduce((sum, value) => sum + (value ?? 0), 0);
  return { q, r, variantId: `test.${q}`, family, provenance, structureCounts };
}
