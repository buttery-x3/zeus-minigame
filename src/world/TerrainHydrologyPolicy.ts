import type { HexPatchCell, HexPatchHydrologyEdgeInfluence, HexPatchTileVariant } from "./HexTerrainPatch";
import { deriveHydrologyEdgeInfluence } from "./HexTerrainPatch";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
import {
  createHydrologyEvaluation,
  deriveCandidatePhysicalEdges,
  evaluateHydrologyPair,
  type HydrologyCandidateEvaluation,
} from "./TerrainHydrologyClearance";
import { findCoveConnection, type CoveConnection } from "./TerrainLakePolicy";

export {
  HYDROLOGY_HARD_NEAR_MISS_DISTANCE,
  HYDROLOGY_SOFT_NEAR_MISS_DISTANCE,
} from "./TerrainHydrologyClearance";
export type { HydrologyCandidateEvaluation, HydrologyNearMiss } from "./TerrainHydrologyClearance";

type HydrologyPatch = HexCoord & { variant: HexPatchTileVariant };
type CandidateCells = ReadonlyMap<string, Pick<HexPatchCell, "q" | "r" | "structure">>;

export function evaluateVariantHydrology(
  patch: HexCoord,
  variant: HexPatchTileVariant,
  committedPatches: ReadonlyMap<string, HydrologyPatch>,
): HydrologyCandidateEvaluation {
  const evaluation = evaluateInfluenceAgainstNeighbors(
    patch,
    variant.id,
    variant.lakeRole,
    variant.edges,
    variant.hydrologyEdges,
    committedPatches,
  );
  if (variant.riverTerminal !== "lake") {
    return evaluation;
  }

  let contactsRiver = false;
  let contactsLake = false;
  for (const direction of HEX_DIRECTION_ORDER) {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = committedPatches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
    if (!neighbor) {
      continue;
    }
    const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
    contactsRiver ||= variant.edges[direction].includes("river") && neighbor.variant.edges[opposite].includes("river");
    contactsLake ||= variant.edges[direction].includes("lake") && neighbor.variant.edges[opposite].includes("lake");
  }
  return { ...evaluation, connectionGain: contactsRiver && contactsLake ? 1 : 0 };
}

export function evaluateCellsHydrology(
  patch: HexCoord,
  cells: CandidateCells,
  committedPatches: ReadonlyMap<string, HydrologyPatch>,
) {
  return evaluateInfluenceAgainstNeighbors(
    patch,
    "procedural-candidate",
    undefined,
    deriveCandidatePhysicalEdges(cells),
    deriveHydrologyEdgeInfluence(cells),
    committedPatches,
  );
}

export function variantsAreHydrologicallyCompatible(
  patch: HexCoord,
  variant: HexPatchTileVariant,
  direction: HexDirection,
  neighborPatch: HexCoord,
  neighbor: HexPatchTileVariant,
) {
  const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
  const result = evaluateHydrologyPair(
    patch,
    variant.edges[direction],
    variant.hydrologyEdges[direction],
    direction,
    neighborPatch,
    neighbor.edges[opposite],
    neighbor.hydrologyEdges[opposite],
  );
  addCoveConnection(result, patch, variant, direction, neighborPatch, neighbor);
  return result.hardNearMissCount === 0;
}

export function findCommittedHydrologyNearMiss(patches: Iterable<HydrologyPatch>) {
  const byKey = new Map<string, HydrologyPatch>();
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
      const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
      const result = evaluateHydrologyPair(
        patch,
        patch.variant.edges[direction],
        patch.variant.hydrologyEdges[direction],
        direction,
        neighbor,
        neighbor.variant.edges[opposite],
        neighbor.variant.hydrologyEdges[opposite],
      );
      if (result.hardNearMissSample) {
        return result.hardNearMissSample;
      }
    }
  }
  return null;
}

function evaluateInfluenceAgainstNeighbors(
  patch: HexCoord,
  variantId: string,
  lakeRole: HexPatchTileVariant["lakeRole"],
  edges: HexPatchTileVariant["edges"],
  influence: Record<HexDirection, HexPatchHydrologyEdgeInfluence>,
  committedPatches: ReadonlyMap<string, HydrologyPatch>,
) {
  const result = createHydrologyEvaluation();
  for (const direction of HEX_DIRECTION_ORDER) {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = committedPatches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
    if (!neighbor) {
      continue;
    }
    const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
    const pair = evaluateHydrologyPair(
      patch,
      edges[direction],
      influence[direction],
      direction,
      neighbor,
      neighbor.variant.edges[opposite],
      neighbor.variant.hydrologyEdges[opposite],
    );
    result.hardNearMissCount += pair.hardNearMissCount;
    result.softNearMissCount += pair.softNearMissCount;
    result.riverCliffHardNearMissCount += pair.riverCliffHardNearMissCount;
    result.hardNearMissSample ??= pair.hardNearMissSample;
    addCoveConnection(result, patch, { id: variantId, lakeRole, edges }, direction, neighbor, neighbor.variant);
  }
  return result;
}

function addCoveConnection(
  result: HydrologyCandidateEvaluation,
  patch: HexCoord,
  variant: Pick<HexPatchTileVariant, "id" | "lakeRole" | "edges">,
  direction: HexDirection,
  neighborPatch: HexCoord,
  neighbor: Pick<HexPatchTileVariant, "id" | "lakeRole" | "edges">,
) {
  const connection: CoveConnection | null = findCoveConnection(
    patch,
    variant.id,
    variant.lakeRole,
    variant.edges[direction],
    direction,
    neighborPatch,
    neighbor.id,
    neighbor.lakeRole,
    neighbor.edges[OPPOSITE_HEX_DIRECTIONS[direction]],
  );
  if (!connection) {
    return;
  }
  result.hardNearMissCount += 1;
  result.coveConnectionCount += 1;
  result.coveConnectionSample ??= connection;
}
