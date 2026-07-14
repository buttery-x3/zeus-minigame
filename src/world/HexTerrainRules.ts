import {
  CHARGED_GROUND_CHANCE,
  CURSED_GROUND_CHANCE,
  SPECIAL_GROUND_SAFE_RADIUS,
} from "../config";
import type { TerrainStructure, TerrainSurface } from "../types";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  hexDistance,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
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

export function createTerrainSurfaceCounts(): Record<TerrainSurface, number> {
  return {
    grass: 0,
    dirt: 0,
    sand: 0,
    mud: 0,
    stone: 0,
    scarred: 0,
    charged: 0,
    cursed: 0,
  };
}

export function decorateSpecialTerrainSurface(
  structure: TerrainStructure,
  baseSurface: TerrainSurface,
  q: number,
  r: number,
  seed: number,
): TerrainSurface {
  if (structure !== "open" || hexDistance({ q, r }, { q: 0, r: 0 }) <= SPECIAL_GROUND_SAFE_RADIUS) {
    return baseSurface;
  }

  const roll = seededTerrainUnit(seed, q, r);
  if (roll < CURSED_GROUND_CHANCE) {
    return "cursed";
  }
  if (roll < CURSED_GROUND_CHANCE + CHARGED_GROUND_CHANCE) {
    return "charged";
  }
  return baseSurface;
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

function seededTerrainUnit(seed: number, q: number, r: number) {
  let value = (seed ^ 0x6d2b79f5) >>> 0;
  value ^= Math.imul(q, 0x9e3779b1);
  value ^= Math.imul(r, 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}
