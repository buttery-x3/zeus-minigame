import type { TerrainStructure, TerrainSurface } from "../types";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, OPPOSITE_HEX_DIRECTIONS, hexCellKey, type HexCoord, type HexDirection } from "./hexCoordinates";
import type { HexPatchTileVariant } from "./HexTerrainCatalog";

export type HexPatchSocketMismatch = {
  patch: HexCoord & { variantId: string };
  direction: HexDirection;
  neighbor: HexCoord & { variantId: string };
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

export function patchVariantsCanNeighbor(a: HexPatchTileVariant, direction: HexDirection, b: HexPatchTileVariant) {
  const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
  const reversedNeighborEdge = [...b.edges[opposite]].reverse();
  return edgeSignaturesMatch(a.edges[direction], reversedNeighborEdge);
}

export function findPatchSocketMismatch(
  patches: Iterable<HexCoord & { variant: HexPatchTileVariant }>,
): HexPatchSocketMismatch | null {
  const byKey = new Map<string, HexCoord & { variant: HexPatchTileVariant }>();
  for (const patch of patches) {
    byKey.set(hexCellKey(patch.q, patch.r), patch);
  }

  for (const patch of byKey.values()) {
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = byKey.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
      if (!neighbor || patchVariantsCanNeighbor(patch.variant, direction, neighbor.variant)) {
        continue;
      }

      return {
        patch: { q: patch.q, r: patch.r, variantId: patch.variant.id },
        direction,
        neighbor: { q: neighbor.q, r: neighbor.r, variantId: neighbor.variant.id },
      };
    }
  }

  return null;
}

function edgeSignaturesMatch(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
