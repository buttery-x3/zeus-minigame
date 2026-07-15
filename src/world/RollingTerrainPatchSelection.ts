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
  proceduralBoundaryConstraintsAreConsistent,
  type HexPatchBoundaryConstraints,
} from "./ProceduralTerrainPatch";

export type SelectedPatchNeighbor = HexCoord & { variant: HexPatchTileVariant };

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
  return candidates.length > 0 ? chooseWeightedVariant(options.seed, options.patch, candidates) : null;
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
  const totalWeight = candidates.reduce((sum, variant) => sum + variant.weight, 0);
  let roll = seededUnit(seed, patch.q, patch.r) * totalWeight;
  for (const variant of candidates) {
    roll -= variant.weight;
    if (roll <= 0) {
      return variant;
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
