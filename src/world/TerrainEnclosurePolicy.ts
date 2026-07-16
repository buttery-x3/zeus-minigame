import { terrainBlocksMovement } from "./HexTerrainRules";
import { patchLocalToWorld, type HexPatchCell, type HexPatchTileVariant } from "./HexTerrainPatch";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  hexCellKey,
  type HexCoord,
} from "./hexCoordinates";

export type TopologyPatch = HexCoord & { variant: HexPatchTileVariant };

export type MovementEnclosure = {
  sample: HexCoord;
  cellCount: number;
};

export type MovementEnclosureResult =
  | { safe: true }
  | { safe: false; enclosure: MovementEnclosure };

/**
 * Treats every movement blocker as one barrier system and finds finite walkable
 * components in the infinite micro-hex plane. The finite blocker bounds plus a
 * one-cell margin provide a known exterior for the flood fill.
 */
export function evaluateMovementEnclosures(patches: Iterable<TopologyPatch>): MovementEnclosureResult {
  const blocked = collectBlockedCells(patches);
  if (blocked.size === 0) {
    return { safe: true };
  }

  if (countBlockedHoles(blocked) === 0) {
    return { safe: true };
  }

  const bounds = blockerBounds(blocked.values());
  const exterior = floodExterior(blocked, bounds);
  const enclosed = new Set<string>();
  let sample: HexCoord | null = null;

  forEachCellInBounds(bounds, (cell) => {
    const key = hexCellKey(cell.q, cell.r);
    if (!blocked.has(key) && !exterior.has(key)) {
      sample ??= cell;
      enclosed.add(key);
    }
  });

  return sample ? { safe: false, enclosure: { sample, cellCount: enclosed.size } } : { safe: true };
}

function countBlockedHoles(blocked: ReadonlyMap<string, BlockedCell>) {
  const faces = blocked.size;
  let sharedEdges = 0;
  const vertices = new Set<string>();

  for (const cell of blocked.values()) {
    for (const direction of ["ne", "e", "se"] as const) {
      const offset = HEX_DIRECTIONS[direction];
      if (blocked.has(hexCellKey(cell.q + offset.q, cell.r + offset.r))) {
        sharedEdges += 1;
      }
    }
    for (let index = 0; index < HEX_DIRECTION_ORDER.length; index += 1) {
      const first = HEX_DIRECTIONS[HEX_DIRECTION_ORDER[index]];
      const second = HEX_DIRECTIONS[HEX_DIRECTION_ORDER[(index + 1) % HEX_DIRECTION_ORDER.length]];
      vertices.add([
        hexCellKey(cell.q, cell.r),
        hexCellKey(cell.q + first.q, cell.r + first.r),
        hexCellKey(cell.q + second.q, cell.r + second.r),
      ].sort().join("|"));
    }
  }

  const edges = faces * 6 - sharedEdges;
  const components = countBlockedComponents(blocked);
  const eulerCharacteristic = vertices.size - edges + faces;
  return components - eulerCharacteristic;
}

function countBlockedComponents(blocked: ReadonlyMap<string, BlockedCell>) {
  const remaining = new Set(blocked.keys());
  let components = 0;
  while (remaining.size > 0) {
    components += 1;
    const first = remaining.values().next().value as string;
    const queue = [blocked.get(first)!];
    remaining.delete(first);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const key = hexCellKey(current.q + offset.q, current.r + offset.r);
        if (remaining.delete(key)) {
          queue.push(blocked.get(key)!);
        }
      }
    }
  }
  return components;
}

export function candidatePreservesMovementTopology(
  committedPatches: Iterable<TopologyPatch>,
  patch: HexCoord,
  variant: HexPatchTileVariant,
) {
  return evaluateMovementEnclosures([...committedPatches, { ...patch, variant }]);
}

export function candidateCellsPreserveMovementTopology(
  committedPatches: Iterable<TopologyPatch>,
  patch: HexCoord,
  cells: ReadonlyMap<string, HexPatchCell>,
) {
  const candidate = { ...patch, variant: { cells } as HexPatchTileVariant };
  return evaluateMovementEnclosures([...committedPatches, candidate]);
}

type BlockedCell = HexCoord;
type HexBounds = {
  minQ: number;
  maxQ: number;
  minR: number;
  maxR: number;
  minS: number;
  maxS: number;
};

function collectBlockedCells(patches: Iterable<TopologyPatch>) {
  const blocked = new Map<string, BlockedCell>();
  for (const patch of patches) {
    for (const local of patch.variant.cells.values()) {
      if (!terrainBlocksMovement(local.structure)) {
        continue;
      }
      const world = patchLocalToWorld(patch, local);
      blocked.set(hexCellKey(world.q, world.r), world);
    }
  }
  return blocked;
}

function blockerBounds(blocked: Iterable<BlockedCell>): HexBounds {
  let minQ = Number.POSITIVE_INFINITY;
  let maxQ = Number.NEGATIVE_INFINITY;
  let minR = Number.POSITIVE_INFINITY;
  let maxR = Number.NEGATIVE_INFINITY;
  let minS = Number.POSITIVE_INFINITY;
  let maxS = Number.NEGATIVE_INFINITY;
  for (const cell of blocked) {
    const s = -cell.q - cell.r;
    minQ = Math.min(minQ, cell.q);
    maxQ = Math.max(maxQ, cell.q);
    minR = Math.min(minR, cell.r);
    maxR = Math.max(maxR, cell.r);
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
  }
  return {
    minQ: minQ - 1,
    maxQ: maxQ + 1,
    minR: minR - 1,
    maxR: maxR + 1,
    minS: minS - 1,
    maxS: maxS + 1,
  };
}

function floodExterior(blocked: ReadonlyMap<string, BlockedCell>, bounds: HexBounds) {
  const visited = new Set<string>();
  const queue: HexCoord[] = [];
  forEachCellInBounds(bounds, (cell) => {
    if (!isBoundsEdge(cell, bounds)) {
      return;
    }
    const key = hexCellKey(cell.q, cell.r);
    if (!blocked.has(key) && !visited.has(key)) {
      visited.add(key);
      queue.push(cell);
    }
  });

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const next = { q: current.q + offset.q, r: current.r + offset.r };
      const key = hexCellKey(next.q, next.r);
      if (isInsideBounds(next, bounds) && !blocked.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(next);
      }
    }
  }
  return visited;
}

function forEachCellInBounds(bounds: HexBounds, visit: (cell: HexCoord) => void) {
  for (let q = bounds.minQ; q <= bounds.maxQ; q += 1) {
    for (let r = bounds.minR; r <= bounds.maxR; r += 1) {
      const cell = { q, r };
      if (isInsideBounds(cell, bounds)) {
        visit(cell);
      }
    }
  }
}

function isInsideBounds(cell: HexCoord, bounds: HexBounds) {
  const s = -cell.q - cell.r;
  return cell.q >= bounds.minQ && cell.q <= bounds.maxQ &&
    cell.r >= bounds.minR && cell.r <= bounds.maxR &&
    s >= bounds.minS && s <= bounds.maxS;
}

function isBoundsEdge(cell: HexCoord, bounds: HexBounds) {
  const s = -cell.q - cell.r;
  return cell.q === bounds.minQ || cell.q === bounds.maxQ ||
    cell.r === bounds.minR || cell.r === bounds.maxR ||
    s === bounds.minS || s === bounds.maxS;
}
