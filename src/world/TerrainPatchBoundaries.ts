import type { TerrainCell } from "../types";
import { HEX_DIRECTIONS, hexCellKey, type HexCoord } from "./hexCoordinates";
import { microToPatchLocal } from "./HexTerrainPatchGeometry";

const UNIQUE_NEIGHBOR_DIRECTIONS = ["ne", "e", "se"] as const;

export type TerrainPatchBoundarySegment = {
  a: HexCoord;
  b: HexCoord;
};

export function collectTerrainPatchBoundarySegments(
  cells: readonly Pick<TerrainCell, "q" | "r">[],
): TerrainPatchBoundarySegment[] {
  const generated = new Map(cells.map((cell) => [hexCellKey(cell.q, cell.r), cell]));
  const patchKeys = new Map<string, string>();
  const patchKeyFor = (cell: HexCoord) => {
    const cellKey = hexCellKey(cell.q, cell.r);
    const cached = patchKeys.get(cellKey);
    if (cached) {
      return cached;
    }
    const patch = microToPatchLocal(cell).patch;
    const patchKey = hexCellKey(patch.q, patch.r);
    patchKeys.set(cellKey, patchKey);
    return patchKey;
  };

  const segments: TerrainPatchBoundarySegment[] = [];
  for (const cell of cells) {
    const patchKey = patchKeyFor(cell);
    for (const direction of UNIQUE_NEIGHBOR_DIRECTIONS) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = generated.get(hexCellKey(cell.q + offset.q, cell.r + offset.r));
      if (!neighbor || patchKeyFor(neighbor) === patchKey) {
        continue;
      }
      segments.push({
        a: { q: cell.q, r: cell.r },
        b: { q: neighbor.q, r: neighbor.r },
      });
    }
  }
  return segments;
}
