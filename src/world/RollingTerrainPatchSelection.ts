import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  hexDistance,
  type HexCoord,
} from "./hexCoordinates";
import type { HexPatchTileVariant } from "./HexTerrainPatch";
import { patchVariantsCanNeighbor } from "./HexTerrainRules";
import {
  createFeatureLoopContext,
  findFrontierShortFeatureLoops,
  findShortFeatureLoops,
  SHORT_LOOP_LIMITS,
  type LoopFeature,
  type ShortFeatureLoop,
} from "./TerrainPatchLoopPolicy";
import {
  proceduralBoundaryConstraintsAreConsistent,
  type HexPatchBoundaryConstraints,
} from "./ProceduralTerrainPatch";

export type SelectedPatchNeighbor = HexCoord & { variant: HexPatchTileVariant };

export type AuthoredPatchSelection = {
  variant: HexPatchTileVariant;
  loopPolicy: {
    suppressedCandidates: Record<LoopFeature, number>;
    forced: boolean;
    selectedLoops: ShortFeatureLoop[];
  };
};

type AuthoredSelectionOptions = {
  patch: HexCoord;
  variants: readonly HexPatchTileVariant[];
  committedPatches: ReadonlyMap<string, SelectedPatchNeighbor>;
  seed: number;
  safeStartRadius: number;
  requireFirstRiver: boolean;
};

export function selectAuthoredPatchVariant(options: AuthoredSelectionOptions) {
  const compatible = options.variants.filter((variant) => matchesCommittedNeighbors(options, options.patch, variant));
  const frontierSafe = compatible.filter((variant) => keepsNeighborDomainsOpen(options, options.patch, variant));
  const safeStart = hexDistance(options.patch, { q: 0, r: 0 }) <= options.safeStartRadius;
  const safeCandidates = safeStart ? frontierSafe.filter((variant) => variant.family === "open") : [];
  const riverCandidates = !safeStart && options.requireFirstRiver
    ? frontierSafe.filter((variant) => variant.family === "river")
    : [];
  const candidates = safeCandidates.length > 0 ? safeCandidates : riverCandidates.length > 0 ? riverCandidates : frontierSafe;
  if (candidates.length === 0) {
    return null;
  }

  const loopContext = createFeatureLoopContext(options.committedPatches.values());
  const evaluated = candidates.map((variant) => ({
    variant,
    loops: [
      ...findShortFeatureLoops(loopContext, options.patch, variant),
      ...findFrontierShortFeatureLoops(options.committedPatches.values(), options.patch, variant),
    ],
  }));
  const loopFree = evaluated.filter((entry) => entry.loops.length === 0);
  const minimumRisk = Math.min(...evaluated.map((entry) => loopRiskScore(entry.loops)));
  const pool = loopFree.length > 0
    ? loopFree
    : evaluated.filter((entry) => loopRiskScore(entry.loops) === minimumRisk);
  const selected = chooseWeightedVariant(options.seed, options.patch, pool.map((entry) => entry.variant));
  const selectedEvaluation = pool.find((entry) => entry.variant === selected)!;
  const suppressedCandidates: Record<LoopFeature, number> = { wall: 0, river: 0 };
  if (loopFree.length > 0) {
    for (const entry of evaluated) {
      for (const feature of new Set(entry.loops.map((loop) => loop.feature))) {
        suppressedCandidates[feature] += 1;
      }
    }
  }
  return {
    variant: selected,
    loopPolicy: {
      suppressedCandidates,
      forced: loopFree.length === 0 && evaluated.some((entry) => entry.loops.length > 0),
      selectedLoops: selectedEvaluation.loops,
    },
  } satisfies AuthoredPatchSelection;
}

function loopRiskScore(loops: readonly ShortFeatureLoop[]) {
  return loops.reduce((score, loop) => {
    const remainingBudget = SHORT_LOOP_LIMITS[loop.feature] - loop.length + 1;
    return score + remainingBudget * (loop.kind === "closed" ? 2 : 1);
  }, 0);
}

export function collectPatchBoundaryConstraints(
  patch: HexCoord,
  committedPatches: ReadonlyMap<string, SelectedPatchNeighbor>,
): HexPatchBoundaryConstraints {
  return collectConstraints(patch, committedPatches);
}

function keepsNeighborDomainsOpen(options: AuthoredSelectionOptions, patch: HexCoord, variant: HexPatchTileVariant) {
  for (const direction of HEX_DIRECTION_ORDER) {
    const offset = HEX_DIRECTIONS[direction];
    const neighborPatch = { q: patch.q + offset.q, r: patch.r + offset.r };
    if (options.committedPatches.has(hexCellKey(neighborPatch.q, neighborPatch.r))) {
      continue;
    }
    const neighborHasAuthoredCandidate = options.variants.some((neighborVariant) =>
      matchesNeighborsWithHypothetical(options, neighborPatch, neighborVariant, patch, variant),
    );
    if (neighborHasAuthoredCandidate) {
      continue;
    }
    const constraints = collectConstraints(neighborPatch, options.committedPatches, { patch, variant });
    if (!proceduralBoundaryConstraintsAreConsistent(constraints)) {
      return false;
    }
  }
  return true;
}

function matchesCommittedNeighbors(options: AuthoredSelectionOptions, patch: HexCoord, variant: HexPatchTileVariant) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = options.committedPatches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
    return !neighbor || patchVariantsCanNeighbor(variant, direction, neighbor.variant);
  });
}

function matchesNeighborsWithHypothetical(
  options: AuthoredSelectionOptions,
  patch: HexCoord,
  variant: HexPatchTileVariant,
  hypotheticalPatch: HexCoord,
  hypotheticalVariant: HexPatchTileVariant,
) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighborCoord = { q: patch.q + offset.q, r: patch.r + offset.r };
    const neighborVariant = neighborCoord.q === hypotheticalPatch.q && neighborCoord.r === hypotheticalPatch.r
      ? hypotheticalVariant
      : options.committedPatches.get(hexCellKey(neighborCoord.q, neighborCoord.r))?.variant;
    return !neighborVariant || patchVariantsCanNeighbor(variant, direction, neighborVariant);
  });
}

function collectConstraints(
  patch: HexCoord,
  committedPatches: ReadonlyMap<string, SelectedPatchNeighbor>,
  hypothetical?: { patch: HexCoord; variant: HexPatchTileVariant },
) {
  const constraints: HexPatchBoundaryConstraints = {};
  for (const direction of HEX_DIRECTION_ORDER) {
    const offset = HEX_DIRECTIONS[direction];
    const neighborCoord = { q: patch.q + offset.q, r: patch.r + offset.r };
    const neighborVariant = hypothetical && neighborCoord.q === hypothetical.patch.q && neighborCoord.r === hypothetical.patch.r
      ? hypothetical.variant
      : committedPatches.get(hexCellKey(neighborCoord.q, neighborCoord.r))?.variant;
    if (neighborVariant) {
      constraints[direction] = [...neighborVariant.edges[OPPOSITE_HEX_DIRECTIONS[direction]]].reverse();
    }
  }
  return constraints;
}

function chooseWeightedVariant(seed: number, patch: HexCoord, candidates: readonly HexPatchTileVariant[]) {
  const groups = new Map<string, HexPatchTileVariant[]>();
  for (const variant of candidates) {
    const members = groups.get(variant.selectionGroup) ?? [];
    members.push(variant);
    groups.set(variant.selectionGroup, members);
  }
  const groupedCandidates = [...groups.values()];
  const selectedGroup = chooseWeighted(
    seededUnit(seed ^ 0x51ed270b, patch.q, patch.r),
    groupedCandidates,
    (members) => members[0].selectionGroupWeight,
  );
  return chooseWeighted(
    seededUnit(seed ^ 0x68bc21eb, patch.q, patch.r),
    selectedGroup,
    (variant) => variant.weight,
  );
}

function chooseWeighted<T>(rollUnit: number, candidates: readonly T[], weightOf: (candidate: T) => number) {
  const totalWeight = candidates.reduce((sum, candidate) => sum + weightOf(candidate), 0);
  let roll = rollUnit * totalWeight;
  for (const candidate of candidates) {
    roll -= weightOf(candidate);
    if (roll <= 0) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

function seededUnit(seed: number, q: number, r: number) {
  let value = seed >>> 0;
  value ^= Math.imul(q, 0x9e3779b1);
  value ^= Math.imul(r, 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}
