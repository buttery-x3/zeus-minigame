import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  hexDistance,
  type HexCoord,
  type HexDirection,
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
  synthesizeProceduralPatch,
  type HexPatchBoundaryConstraints,
} from "./ProceduralTerrainPatch";
import { createMovementTopologyContext, type MovementTopologyContext } from "./TerrainTopologyContext";
import {
  evaluateCellsHydrology,
  evaluateVariantHydrology,
  variantsAreHydrologicallyCompatible,
} from "./TerrainHydrologyPolicy";
import {
  authoredRiverFlowsCanNeighbor,
  createsCommittedAuthoredRiverCycle,
} from "./TerrainRiverFlowPolicy";

export type SelectedPatchNeighbor = HexCoord & { variant: HexPatchTileVariant };

export type AuthoredPatchSelection = {
  variant: HexPatchTileVariant;
  hydrologyPolicy: {
    candidatesSuppressed: number;
    connectionPreferred: boolean;
    selectedSoftNearMissCount: number;
  };
  loopPolicy: {
    suppressedCandidates: Record<LoopFeature, number>;
    forced: boolean;
    selectedLoops: ShortFeatureLoop[];
  };
};

export type AuthoredPatchSelectionResult = {
  selection: AuthoredPatchSelection | null;
  enclosureCandidatesRejected: number;
  hydrologyCandidatesRejected: number;
  coveConnectionCandidatesRejected: number;
  riverFlowCandidatesRejected: number;
  riverCliffCandidatesRejected: number;
};

type AuthoredSelectionOptions = {
  patch: HexCoord;
  variants: readonly HexPatchTileVariant[];
  committedPatches: ReadonlyMap<string, SelectedPatchNeighbor>;
  seed: number;
  safeStartRadius: number;
  requireFirstRiver: boolean;
  topologyContext?: MovementTopologyContext;
};

type EdgeDomainIndex = Record<HexDirection, Map<string, HexPatchTileVariant[]>>;
const EDGE_DOMAIN_INDEX_CACHE = new WeakMap<object, EdgeDomainIndex>();

export function selectAuthoredPatchVariant(options: AuthoredSelectionOptions) {
  const topologyContext = options.topologyContext ?? createMovementTopologyContext(options.committedPatches.values());
  const physicallyCompatible = options.variants.filter((variant) => matchesCommittedPhysicalNeighbors(options, options.patch, variant));
  const compatible = physicallyCompatible.filter((variant) => matchesCommittedRiverFlow(options, options.patch, variant));
  let riverFlowCandidatesRejected = physicallyCompatible.length - compatible.length;
  const frontierSafe = compatible.filter((variant) => keepsNeighborDomainsOpen(options, options.patch, variant));
  const safeStart = hexDistance(options.patch, { q: 0, r: 0 }) <= options.safeStartRadius;
  const safeCandidates = safeStart ? frontierSafe.filter((variant) => variant.family === "open") : [];
  const riverCandidates = !safeStart && options.requireFirstRiver
    ? frontierSafe.filter((variant) => variant.riverTerminal === "cliff")
    : [];
  const preferred = safeCandidates.length > 0 ? safeCandidates : riverCandidates.length > 0 ? riverCandidates : frontierSafe;
  const candidates = preferred.filter((variant) =>
    topologyContext.evaluateVariant(options.patch, variant).safe,
  );
  const enclosureCandidatesRejected = preferred.length - candidates.length;
  if (candidates.length === 0) {
    return {
      selection: null,
      enclosureCandidatesRejected,
      hydrologyCandidatesRejected: 0,
      coveConnectionCandidatesRejected: 0,
      riverFlowCandidatesRejected,
      riverCliffCandidatesRejected: 0,
    } satisfies AuthoredPatchSelectionResult;
  }

  const flowSafe = candidates.filter((variant) =>
    !createsCommittedAuthoredRiverCycle(options.patch, variant, options.committedPatches),
  );
  riverFlowCandidatesRejected += candidates.length - flowSafe.length;
  if (flowSafe.length === 0) {
    return {
      selection: null,
      enclosureCandidatesRejected,
      hydrologyCandidatesRejected: 0,
      coveConnectionCandidatesRejected: 0,
      riverFlowCandidatesRejected,
      riverCliffCandidatesRejected: 0,
    } satisfies AuthoredPatchSelectionResult;
  }

  const hydrologyEvaluated = flowSafe.map((variant) => ({
    variant,
    hydrology: evaluateVariantHydrology(options.patch, variant, options.committedPatches),
  }));
  const hydrologySafe = hydrologyEvaluated.filter((entry) => entry.hydrology.hardNearMissCount === 0);
  const hydrologyCandidatesRejected = hydrologyEvaluated.length - hydrologySafe.length;
  const coveConnectionCandidatesRejected = hydrologyEvaluated.filter(
    (entry) => entry.hydrology.coveConnectionCount > 0,
  ).length;
  const riverCliffCandidatesRejected = hydrologyEvaluated.filter(
    (entry) => entry.hydrology.riverCliffHardNearMissCount > 0,
  ).length;
  if (hydrologySafe.length === 0) {
    return {
      selection: null,
      enclosureCandidatesRejected,
      hydrologyCandidatesRejected,
      coveConnectionCandidatesRejected,
      riverFlowCandidatesRejected,
      riverCliffCandidatesRejected,
    } satisfies AuthoredPatchSelectionResult;
  }

  const maximumConnectionGain = Math.max(...hydrologySafe.map((entry) => entry.hydrology.connectionGain));
  const connectionPool = maximumConnectionGain > 0
    ? hydrologySafe.filter((entry) => entry.hydrology.connectionGain === maximumConnectionGain)
    : hydrologySafe;
  const minimumSoftNearMisses = Math.min(...connectionPool.map((entry) => entry.hydrology.softNearMissCount));
  const hydrologyPreferred = connectionPool.filter(
    (entry) => entry.hydrology.softNearMissCount === minimumSoftNearMisses,
  );
  const hydrologyCandidatesSuppressed = hydrologySafe.length - hydrologyPreferred.length;

  const localCommitted = [...options.committedPatches.values()].filter(
    (entry) => hexDistance(entry, options.patch) <= Math.max(...Object.values(SHORT_LOOP_LIMITS)),
  );
  const loopContext = createFeatureLoopContext(localCommitted);
  const evaluated = hydrologyPreferred.map((entry) => ({
    ...entry,
    loops: findShortFeatureLoops(loopContext, options.patch, entry.variant),
  }));
  const loopFree = evaluated.filter((entry) => entry.loops.length === 0);
  const minimumRisk = Math.min(...evaluated.map((entry) => loopRiskScore(entry.loops)));
  const immediatePool = loopFree.length > 0
    ? loopFree
    : evaluated.filter((entry) => loopRiskScore(entry.loops) === minimumRisk);
  let selectedEvaluation = chooseWeightedEntry(options, immediatePool);
  const frontierRejected: typeof evaluated = [];

  if (loopFree.length > 0) {
    const remaining = [...immediatePool];
    while (remaining.length > 0) {
      const selected = chooseWeightedEntry(options, remaining);
      const loops = findFrontierShortFeatureLoops(localCommitted, options.patch, selected.variant);
      const index = remaining.indexOf(selected);
      remaining.splice(index, 1);
      if (loops.length === 0) {
        selectedEvaluation = selected;
        break;
      }
      frontierRejected.push({ ...selected, loops });
      if (remaining.length === 0) {
        const minimumFrontierRisk = Math.min(...frontierRejected.map((entry) => loopRiskScore(entry.loops)));
        selectedEvaluation = chooseWeightedEntry(
          options,
          frontierRejected.filter((entry) => loopRiskScore(entry.loops) === minimumFrontierRisk),
        );
      }
    }
  }

  const suppressedCandidates: Record<LoopFeature, number> = { wall: 0, river: 0 };
  if (loopFree.length > 0) {
    for (const entry of [...evaluated.filter((entry) => entry.loops.length > 0), ...frontierRejected]) {
      for (const feature of new Set(entry.loops.map((loop) => loop.feature))) {
        suppressedCandidates[feature] += 1;
      }
    }
  }
  return {
    selection: {
      variant: selectedEvaluation.variant,
      hydrologyPolicy: {
        candidatesSuppressed: hydrologyCandidatesSuppressed,
        connectionPreferred: maximumConnectionGain > 0,
        selectedSoftNearMissCount: selectedEvaluation.hydrology.softNearMissCount,
      },
      loopPolicy: {
        suppressedCandidates,
        forced: loopFree.length === 0 || frontierRejected.length === immediatePool.length,
        selectedLoops: selectedEvaluation.loops,
      },
    },
    enclosureCandidatesRejected,
    hydrologyCandidatesRejected,
    coveConnectionCandidatesRejected,
    riverFlowCandidatesRejected,
    riverCliffCandidatesRejected,
  } satisfies AuthoredPatchSelectionResult;
}

function chooseWeightedEntry<T extends { variant: HexPatchTileVariant }>(
  options: Pick<AuthoredSelectionOptions, "seed" | "patch">,
  candidates: readonly T[],
) {
  const variant = chooseWeightedVariant(options.seed, options.patch, candidates.map((entry) => entry.variant));
  return candidates.find((entry) => entry.variant === variant)!;
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
    const physicalDomain = physicalNeighborDomain(options.variants, variant, direction);
    const neighborHasPhysicalCandidate = physicalDomain.some((neighborVariant) =>
      matchesNeighborsWithHypothetical(options, neighborPatch, neighborVariant, patch, variant, false),
    );
    const neighborHasHydrologyCandidate = physicalDomain.some((neighborVariant) =>
      matchesNeighborsWithHypothetical(options, neighborPatch, neighborVariant, patch, variant, true),
    );
    if (neighborHasHydrologyCandidate) {
      continue;
    }
    if (neighborHasPhysicalCandidate) {
      return false;
    }
    const constraints = collectConstraints(neighborPatch, options.committedPatches, { patch, variant });
    if (!proceduralBoundaryConstraintsAreConsistent(constraints)) {
      return false;
    }
    const committedWithHypothetical = new Map(options.committedPatches);
    committedWithHypothetical.set(hexCellKey(patch.q, patch.r), { ...patch, variant });
    const speculative = synthesizeProceduralPatch(constraints, options.seed, {
      preferFastTermination: true,
      acceptsCells: (cells) =>
        evaluateCellsHydrology(neighborPatch, cells, committedWithHypothetical).hardNearMissCount === 0,
    });
    if (!speculative.ok) {
      return false;
    }
  }
  return true;
}

function matchesCommittedPhysicalNeighbors(options: AuthoredSelectionOptions, patch: HexCoord, variant: HexPatchTileVariant) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = options.committedPatches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
    return !neighbor || patchVariantsCanNeighbor(variant, direction, neighbor.variant);
  });
}

function physicalNeighborDomain(
  variants: readonly HexPatchTileVariant[],
  variant: HexPatchTileVariant,
  direction: keyof typeof OPPOSITE_HEX_DIRECTIONS,
) {
  let index = EDGE_DOMAIN_INDEX_CACHE.get(variants);
  if (!index) {
    index = Object.fromEntries(HEX_DIRECTION_ORDER.map((candidateDirection) => [
      candidateDirection,
      new Map<string, HexPatchTileVariant[]>(),
    ])) as EdgeDomainIndex;
    for (const candidate of variants) {
      for (const candidateDirection of HEX_DIRECTION_ORDER) {
        const key = serializeEdge(candidate.edges[candidateDirection]);
        const domain = index[candidateDirection].get(key) ?? [];
        domain.push(candidate);
        index[candidateDirection].set(key, domain);
      }
    }
    EDGE_DOMAIN_INDEX_CACHE.set(variants, index);
  }

  const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
  return index[opposite].get(serializeEdge([...variant.edges[direction]].reverse())) ?? [];
}

function serializeEdge(edge: readonly string[]) {
  return edge.join("|");
}

function matchesCommittedRiverFlow(options: AuthoredSelectionOptions, patch: HexCoord, variant: HexPatchTileVariant) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = options.committedPatches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
    return !neighbor || authoredRiverFlowsCanNeighbor(variant, direction, neighbor.variant);
  });
}

function matchesNeighborsWithHypothetical(
  options: AuthoredSelectionOptions,
  patch: HexCoord,
  variant: HexPatchTileVariant,
  hypotheticalPatch: HexCoord,
  hypotheticalVariant: HexPatchTileVariant,
  includeHydrology: boolean,
) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighborCoord = { q: patch.q + offset.q, r: patch.r + offset.r };
    const neighborVariant = neighborCoord.q === hypotheticalPatch.q && neighborCoord.r === hypotheticalPatch.r
      ? hypotheticalVariant
      : options.committedPatches.get(hexCellKey(neighborCoord.q, neighborCoord.r))?.variant;
    return !neighborVariant || (
      patchVariantsCanNeighbor(variant, direction, neighborVariant) &&
      (!includeHydrology || (
        authoredRiverFlowsCanNeighbor(variant, direction, neighborVariant) &&
        variantsAreHydrologicallyCompatible(patch, variant, direction, neighborCoord, neighborVariant)
      ))
    );
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
