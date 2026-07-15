import type { TerrainStructure } from "../types";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  hexCellKey,
  hexDistance,
  type HexCoord,
} from "./hexCoordinates";
import { HEX_PATCH_LOCAL_CELLS } from "./HexTerrainPatchGeometry";

type StructuralCell = HexCoord & { structure: TerrainStructure };
type BoundaryCell = { coord: HexCoord; structure: TerrainStructure };
const INTERIOR_CELLS = HEX_PATCH_LOCAL_CELLS.filter((cell) => hexDistance(cell, { q: 0, r: 0 }) < 2);

export function satisfiesProceduralConnectivity(
  cells: ReadonlyMap<string, StructuralCell>,
  boundary: ReadonlyMap<string, BoundaryCell>,
  hasOpenBoundary: boolean,
) {
  if (hasOpenBoundary) {
    const reachable = floodStructure(cells, { q: 0, r: 0 }, "open");
    for (const [key, entry] of boundary) {
      if (entry.structure === "open" && !reachable.has(key)) {
        return false;
      }
    }
  } else if ([...cells.values()].some((cell) => cell.structure === "open" || cell.structure === "bank")) {
    return false;
  }

  for (const structure of ["wall", "river", "lake"] as const) {
    const boundaryKeys = new Set([...boundary].filter(([, entry]) => entry.structure === structure).map(([key]) => key));
    if (boundaryKeys.size === 0) {
      if ([...cells.values()].some((cell) => cell.structure === structure)) {
        return false;
      }
      continue;
    }
    for (const cell of INTERIOR_CELLS) {
      if (cells.get(hexCellKey(cell.q, cell.r))?.structure !== structure) {
        continue;
      }
      const component = floodStructure(cells, cell, structure);
      if (![...component].some((key) => boundaryKeys.has(key))) {
        return false;
      }
    }
  }
  return true;
}

export function scoreProceduralCells(
  cells: ReadonlyMap<string, StructuralCell>,
  boundary: ReadonlyMap<string, BoundaryCell>,
  hasOpenBoundary: boolean,
) {
  let score = 0;
  for (const cell of cells.values()) {
    for (const direction of ["ne", "e", "se"] as const) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = cells.get(hexCellKey(cell.q + offset.q, cell.r + offset.r));
      if (neighbor && neighbor.structure !== cell.structure) {
        score += 2;
      }
    }
    if (hasOpenBoundary && hexDistance(cell, { q: 0, r: 0 }) < 2 && cell.structure !== "open") {
      score += 1;
    }
    if (cell.structure === "river") {
      const riverDegree = neighborsOf(cells, cell).filter((neighbor) => neighbor.structure === "river").length;
      if (riverDegree === 0) {
        score += 12;
      } else if (riverDegree > 2) {
        score += (riverDegree - 2) * 3;
      }
    }
  }

  for (const entry of boundary.values()) {
    if (entry.structure === "open") {
      continue;
    }
    const continuesInward = neighborsOf(cells, entry.coord).some(
      (neighbor) => hexDistance(neighbor, { q: 0, r: 0 }) < 2 && neighbor.structure === entry.structure,
    );
    if (!continuesInward) {
      score += 5;
    }
  }
  return score;
}

function floodStructure(cells: ReadonlyMap<string, StructuralCell>, start: HexCoord, structure: TerrainStructure) {
  const startKey = hexCellKey(start.q, start.r);
  if (cells.get(startKey)?.structure !== structure) {
    return new Set<string>();
  }
  const visited = new Set([startKey]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const next = { q: current.q + offset.q, r: current.r + offset.r };
      const key = hexCellKey(next.q, next.r);
      if (!visited.has(key) && cells.get(key)?.structure === structure) {
        visited.add(key);
        queue.push(next);
      }
    }
  }
  return visited;
}

function neighborsOf<T extends HexCoord>(cells: ReadonlyMap<string, T>, cell: HexCoord) {
  return HEX_DIRECTION_ORDER.flatMap((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = cells.get(hexCellKey(cell.q + offset.q, cell.r + offset.r));
    return neighbor ? [neighbor] : [];
  });
}
