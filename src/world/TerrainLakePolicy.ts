import type { HexPatchLakeRole, HexPatchTileVariant } from "./HexTerrainPatch";
import {
  HEX_DIRECTIONS,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";

type LakePolicyPatch = HexCoord & { variant: HexPatchTileVariant };

export type CoveConnection = {
  patch: HexCoord & { variantId: string };
  neighbor: HexCoord & { variantId: string };
  direction: HexDirection;
};

export function findCoveConnection(
  patch: HexCoord,
  variantId: string,
  lakeRole: HexPatchLakeRole | undefined,
  edge: readonly string[],
  direction: HexDirection,
  neighborPatch: HexCoord,
  neighborVariantId: string,
  neighborLakeRole: HexPatchLakeRole | undefined,
  neighborEdge: readonly string[],
): CoveConnection | null {
  if (lakeRole !== "cove" || neighborLakeRole !== "cove") {
    return null;
  }
  const meets = edge.some(
    (kind, index) => kind === "lake" && neighborEdge[neighborEdge.length - 1 - index] === "lake",
  );
  return meets
    ? {
        patch: { q: patch.q, r: patch.r, variantId },
        neighbor: { q: neighborPatch.q, r: neighborPatch.r, variantId: neighborVariantId },
        direction,
      }
    : null;
}

export function findCommittedCoveConnection(patches: Iterable<LakePolicyPatch>) {
  const byKey = new Map<string, LakePolicyPatch>();
  for (const patch of patches) {
    byKey.set(hexCellKey(patch.q, patch.r), patch);
  }
  for (const patch of byKey.values()) {
    for (const direction of ["ne", "e", "se"] as const) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = byKey.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
      if (!neighbor) {
        continue;
      }
      const connection = findCoveConnection(
        patch,
        patch.variant.id,
        patch.variant.lakeRole,
        patch.variant.edges[direction],
        direction,
        neighbor,
        neighbor.variant.id,
        neighbor.variant.lakeRole,
        neighbor.variant.edges[OPPOSITE_HEX_DIRECTIONS[direction]],
      );
      if (connection) {
        return connection;
      }
    }
  }
  return null;
}
