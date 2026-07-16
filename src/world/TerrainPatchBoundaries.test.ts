import { describe, expect, test } from "vitest";
import { hexCellKey } from "./hexCoordinates";
import {
  HEX_PATCH_LOCAL_CELLS,
  microToPatchLocal,
  patchLocalToWorld,
} from "./HexTerrainPatchGeometry";
import { collectTerrainPatchBoundarySegments } from "./TerrainPatchBoundaries";

describe("terrain patch boundary extraction", () => {
  test("does not draw boundaries within one authored patch", () => {
    expect(collectTerrainPatchBoundarySegments(patchCells({ q: 0, r: 0 }))).toEqual([]);
  });

  test("draws each shared micro-edge once between neighboring patches", () => {
    const cells = [...patchCells({ q: 0, r: 0 }), ...patchCells({ q: 1, r: 0 })];
    const boundaries = collectTerrainPatchBoundarySegments(cells);
    const keys = boundaries.map(({ a, b }) => [hexCellKey(a.q, a.r), hexCellKey(b.q, b.r)].sort().join("|"));

    expect(boundaries.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(boundaries.length);
    for (const { a, b } of boundaries) {
      expect(microToPatchLocal(a).patch).not.toEqual(microToPatchLocal(b).patch);
    }
  });
});

function patchCells(patch: { q: number; r: number }) {
  return HEX_PATCH_LOCAL_CELLS.map((local) => patchLocalToWorld(patch, local));
}
