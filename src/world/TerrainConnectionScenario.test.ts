import { describe, expect, it } from "vitest";
import { createHexPatchTileCatalog } from "./HexTerrainCatalog";
import { enumerateProceduralPatches } from "./ProceduralTerrainPatchEnumeration";
import {
  canonicalizeBoundaryConstraints,
  createTerrainConnectionScenario,
  resolveTerrainConnectionScenario,
} from "./TerrainConnectionScenario";

describe("terrain connection scenarios", () => {
  it("resolves authored and procedural alternatives from placed neighbors", () => {
    const variants = createHexPatchTileCatalog();
    const open = variants.find((variant) => variant.id === "patch.open.grass")!;
    const scenario = createTerrainConnectionScenario("open ring", 42);
    scenario.neighbors = { ne: open.id, e: open.id, se: open.id, sw: open.id, w: open.id, nw: open.id };
    const resolution = resolveTerrainConnectionScenario(scenario, variants);
    expect(resolution.missingVariantIds).toEqual([]);
    expect(resolution.authored.some((candidate) => candidate.variant.id === open.id)).toBe(true);
    expect(resolution.procedural.length).toBeGreaterThan(0);
    expect(resolution.proceduralGroups.length).toBeGreaterThan(0);
    expect(resolution.generatorFallback).not.toBeNull();
  });

  it("enumerates more than the selected result for mixed boundaries", () => {
    const result = enumerateProceduralPatches({
      ne: ["closed", "closed", "closed"],
      sw: ["open", "open", "open"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attemptedAssignments).toBeGreaterThan(1);
      expect(result.candidates.length).toBeGreaterThan(0);
    }
  });

  it("collapses rotated and mirrored boundary contracts", () => {
    const a = canonicalizeBoundaryConstraints({
      ne: ["closed", "closed", "closed"],
      e: ["river", "river", "river"],
    }, true);
    const b = canonicalizeBoundaryConstraints({
      e: ["closed", "closed", "closed"],
      se: ["river", "river", "river"],
    }, true);
    expect(a).toBe(b);
  });
});
