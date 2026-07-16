import { describe, expect, test } from "vitest";
import type { TerrainStructure } from "../types";
import {
  HEX_PATCH_LOCAL_CELLS,
  createPatchVariant,
  setPatchCell,
  type HexPatchCell,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";
import { createHexPatchTileCatalog } from "./HexTerrainCatalog";
import { evaluateMovementEnclosures } from "./TerrainEnclosurePolicy";
import { createMovementTopologyContext } from "./TerrainTopologyContext";
import { hexCellKey, type HexCoord } from "./hexCoordinates";

describe("movement enclosure policy", () => {
  test("accepts an open U-shaped mixed barrier", () => {
    const barrier = cells([
      [1, 0, "wall"], [1, -1, "river"], [0, -1, "lake"],
      [-1, 0, "wall"], [-1, 1, "river"],
    ]);

    expect(evaluateMovementEnclosures(asPatches(barrier))).toEqual({ safe: true });
    expect(createMovementTopologyContext([]).evaluateVariant({ q: 0, r: 0 }, asVariant(barrier)).safe).toBe(true);
  });

  test("rejects a loop made from different movement blockers", () => {
    const ring = cells([
      [1, 0, "wall"], [1, -1, "river"], [0, -1, "lake"],
      [-1, 0, "wall"], [-1, 1, "river"], [0, 1, "wall"],
    ]);

    expect(evaluateMovementEnclosures(asPatches(ring))).toEqual({
      safe: false,
      enclosure: { sample: { q: 0, r: 0 }, cellCount: 1 },
    });
    expect(createMovementTopologyContext([]).evaluateVariant({ q: 0, r: 0 }, asVariant(ring)).safe).toBe(false);
  });

  test("does not mistake a solid obstacle mass for enclosed walkable ground", () => {
    const mass = cells([
      [0, 0, "wall"], [1, 0, "wall"], [1, -1, "wall"], [0, -1, "wall"],
      [-1, 0, "wall"], [-1, 1, "wall"], [0, 1, "wall"],
    ]);

    expect(evaluateMovementEnclosures(asPatches(mass))).toEqual({ safe: true });
    expect(createMovementTopologyContext([]).evaluateVariant({ q: 0, r: 0 }, asVariant(mass)).safe).toBe(true);
  });

  test("incremental candidate checks agree with the exact committed-world audit", () => {
    const committedVariant = createHexPatchTileCatalog().find((variant) => variant.id.startsWith("patch.cliff.ridge"))!;
    const committed = { q: 0, r: 0, variant: committedVariant };
    const context = createMovementTopologyContext([committed]);
    const candidatePatch = { q: 1, r: 0 };

    for (const variant of createHexPatchTileCatalog()) {
      const exact = evaluateMovementEnclosures([committed, { ...candidatePatch, variant }]).safe;
      expect(context.evaluateVariant(candidatePatch, variant).safe, variant.id).toBe(exact);
    }
  });
});

function cells(entries: readonly [number, number, Exclude<TerrainStructure, "open" | "bank">][]) {
  const result = new Map<string, HexPatchCell>();
  for (const coord of HEX_PATCH_LOCAL_CELLS) {
    result.set(hexCellKey(coord.q, coord.r), {
      ...coord,
      structure: "open",
      surface: "grass",
      edges: { ne: "open", e: "open", se: "open", sw: "open", w: "open", nw: "open" },
    });
  }
  for (const [q, r, structure] of entries) {
    setPatchCell(result, { q, r }, structure);
  }
  return result;
}

function asPatches(cells: Map<string, HexPatchCell>) {
  const patch = asVariant(cells);
  return [{ q: 0, r: 0, variant: patch }] satisfies (HexCoord & { variant: HexPatchTileVariant })[];
}

function asVariant(cells: Map<string, HexPatchCell>) {
  return createPatchVariant("test", "transition", "procedural", 0, cells);
}
