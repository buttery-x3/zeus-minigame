import type { HexPatchCell, HexPatchHydrologyEdgeInfluence, HexPatchTileVariant } from "./HexTerrainPatch";
import { patchLocalToWorld } from "./HexTerrainPatch";
import { HEX_PATCH_EDGE_CELLS } from "./HexTerrainPatchGeometry";
import { hexCellKey, hexDistance, type HexCoord, type HexDirection } from "./hexCoordinates";
import type { CoveConnection } from "./TerrainLakePolicy";

export const HYDROLOGY_HARD_NEAR_MISS_DISTANCE = 3;
export const HYDROLOGY_SOFT_NEAR_MISS_DISTANCE = 4;

export type HydrologyNearMiss = {
  patch: HexCoord;
  neighbor: HexCoord;
  direction: HexDirection;
  distance: number;
  candidateFeature: "river" | "lake" | "cliff";
  neighborFeature: "river" | "lake" | "cliff";
};

export type HydrologyCandidateEvaluation = {
  connectionGain: number;
  hardNearMissCount: number;
  softNearMissCount: number;
  hardNearMissSample: HydrologyNearMiss | null;
  coveConnectionCount: number;
  coveConnectionSample: CoveConnection | null;
  riverCliffHardNearMissCount: number;
};

export function createHydrologyEvaluation(): HydrologyCandidateEvaluation {
  return {
    connectionGain: 0,
    hardNearMissCount: 0,
    softNearMissCount: 0,
    hardNearMissSample: null,
    coveConnectionCount: 0,
    coveConnectionSample: null,
    riverCliffHardNearMissCount: 0,
  };
}

export function evaluateHydrologyPair(
  patch: HexCoord,
  edge: readonly string[],
  influence: HexPatchHydrologyEdgeInfluence,
  direction: HexDirection,
  neighborPatch: HexCoord,
  neighborEdge: readonly string[],
  neighborInfluence: HexPatchHydrologyEdgeInfluence,
) {
  const result = createHydrologyEvaluation();
  if (!edge.every((kind) => kind === "open") || !neighborEdge.every((kind) => kind === "open")) {
    return result;
  }
  compareFeatures(result, patch, influence.river, "river", direction, neighborPatch, neighborInfluence.lake, "lake");
  compareFeatures(result, patch, influence.lake, "lake", direction, neighborPatch, neighborInfluence.river, "river");
  compareFeatures(result, patch, influence.river, "river", direction, neighborPatch, neighborInfluence.cliff, "cliff");
  compareFeatures(result, patch, influence.cliff, "cliff", direction, neighborPatch, neighborInfluence.river, "river");
  return result;
}

export function deriveCandidatePhysicalEdges(
  cells: ReadonlyMap<string, Pick<HexPatchCell, "q" | "r" | "structure">>,
) {
  const edges = {} as HexPatchTileVariant["edges"];
  for (const direction of Object.keys(HEX_PATCH_EDGE_CELLS) as HexDirection[]) {
    edges[direction] = HEX_PATCH_EDGE_CELLS[direction].map((coord) => {
      const structure = cells.get(hexCellKey(coord.q, coord.r))?.structure ?? "open";
      return structure === "wall" ? "closed" : structure === "river" ? "river" : structure === "lake" ? "lake" : "open";
    });
  }
  return edges;
}

function compareFeatures(
  result: HydrologyCandidateEvaluation,
  patch: HexCoord,
  featureCells: readonly HexCoord[],
  candidateFeature: "river" | "lake" | "cliff",
  direction: HexDirection,
  neighborPatch: HexCoord,
  neighborCells: readonly HexCoord[],
  neighborFeature: "river" | "lake" | "cliff",
) {
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const local of featureCells) {
    const world = patchLocalToWorld(patch, local);
    for (const neighborLocal of neighborCells) {
      minimumDistance = Math.min(minimumDistance, hexDistance(world, patchLocalToWorld(neighborPatch, neighborLocal)));
    }
  }
  if (minimumDistance > HYDROLOGY_SOFT_NEAR_MISS_DISTANCE) {
    return;
  }
  if (minimumDistance <= HYDROLOGY_HARD_NEAR_MISS_DISTANCE) {
    result.hardNearMissCount += 1;
    if (candidateFeature === "cliff" || neighborFeature === "cliff") {
      result.riverCliffHardNearMissCount += 1;
    }
    result.hardNearMissSample ??= {
      patch: { ...patch },
      neighbor: { q: neighborPatch.q, r: neighborPatch.r },
      direction,
      distance: minimumDistance,
      candidateFeature,
      neighborFeature,
    };
  } else {
    result.softNearMissCount += 1;
  }
}
