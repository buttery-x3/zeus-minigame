import { describe, expect, test } from "vitest";
import type { TerrainStructure } from "../types";
import {
  HEX_PATCH_LOCAL_CELLS,
  createPatchVariant,
  setPatchCell,
  type HexPatchCell,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";
import { evaluateMovementEnclosures } from "./TerrainEnclosurePolicy";
import { hexCellKey, type HexCoord } from "./hexCoordinates";

describe("movement enclosure policy", () => {
  test("accepts an open U-shaped mixed barrier", () => {
    const barrier = cells([
      [1, 0, "wall"], [1, -1, "river"], [0, -1, "lake"],
      [-1, 0, "wall"], [-1, 1, "river"],
    ]);

    expect(evaluateMovementEnclosures(asPatches(barrier))).toEqual({ safe: true });
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
  });

  test("does not mistake a solid obstacle mass for enclosed walkable ground", () => {
    const mass = cells([
      [0, 0, "wall"], [1, 0, "wall"], [1, -1, "wall"], [0, -1, "wall"],
      [-1, 0, "wall"], [-1, 1, "wall"], [0, 1, "wall"],
    ]);

    expect(evaluateMovementEnclosures(asPatches(mass))).toEqual({ safe: true });
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
  const patch = createPatchVariant("test", "transition", "procedural", 0, cells);
  return [{ q: 0, r: 0, variant: patch }] satisfies (HexCoord & { variant: HexPatchTileVariant })[];
}
