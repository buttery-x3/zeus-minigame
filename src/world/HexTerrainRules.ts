import type { HexTileSignature, TerrainStructure, TerrainSurface } from "../types";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, OPPOSITE_HEX_DIRECTIONS, hexCellKey, type HexCoord, type HexDirection } from "./hexCoordinates";
import type { HexTerrainTileVariant } from "./HexTerrainCatalog";

export type HexTerrainSocketMismatch = {
  cell: HexCoord & { variantId: string; structure: TerrainStructure };
  direction: HexDirection;
  neighbor: HexCoord & { variantId: string; structure: TerrainStructure };
};

export function createTerrainStructureCounts(): Record<TerrainStructure, number> {
  return {
    open: 0,
    wall: 0,
    bank: 0,
    lake: 0,
    river: 0,
  };
}

export function deriveTerrainSurface(
  structure: TerrainStructure,
  neighbors: readonly TerrainStructure[] = [],
  h = 0.5,
): TerrainSurface {
  if (structure === "wall") {
    return "stone";
  }
  if (structure === "river") {
    return "mud";
  }
  if (structure === "lake") {
    return "sand";
  }
  if (structure === "bank") {
    return neighbors.includes("river") ? "mud" : neighbors.includes("lake") ? "sand" : neighbors.includes("wall") ? "stone" : "dirt";
  }
  if (h > 0.978) {
    return "charged";
  }
  if (h < 0.052) {
    return "scarred";
  }
  if (neighbors.includes("river")) {
    return "mud";
  }
  if (neighbors.includes("wall")) {
    return "stone";
  }
  return h > 0.58 ? "dirt" : "grass";
}

export function terrainBlocksMovement(structure: TerrainStructure) {
  return structure === "wall" || structure === "lake" || structure === "river";
}

export function terrainBlocksSight(structure: TerrainStructure) {
  return structure === "wall";
}

export function terrainVariantsCanNeighbor(a: HexTerrainTileVariant, direction: HexDirection, b: HexTerrainTileVariant) {
  return a.edges[direction] === b.edges[OPPOSITE_HEX_DIRECTIONS[direction]];
}

export function findSocketMismatch(
  cells: Iterable<HexCoord & { structure: TerrainStructure; variant: HexTerrainTileVariant }>,
): HexTerrainSocketMismatch | null {
  const byKey = new Map<string, HexCoord & { structure: TerrainStructure; variant: HexTerrainTileVariant }>();
  for (const cell of cells) {
    byKey.set(hexCellKey(cell.q, cell.r), cell);
  }

  for (const cell of byKey.values()) {
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = byKey.get(hexCellKey(cell.q + offset.q, cell.r + offset.r));
      if (!neighbor || terrainVariantsCanNeighbor(cell.variant, direction, neighbor.variant)) {
        continue;
      }

      return {
        cell: { q: cell.q, r: cell.r, variantId: cell.variant.id, structure: cell.structure },
        direction,
        neighbor: { q: neighbor.q, r: neighbor.r, variantId: neighbor.variant.id, structure: neighbor.structure },
      };
    }
  }

  return null;
}
