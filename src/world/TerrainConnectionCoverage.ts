import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
import type { HexPatchTileVariant } from "./HexTerrainPatch";
import { patchVariantsCanNeighbor } from "./HexTerrainRules";
import { collectPatchBoundaryConstraints } from "./RollingTerrainPatchSelection";
import { canonicalizeBoundaryConstraints, type TerrainConnectionScenario } from "./TerrainConnectionScenario";

export type ReachableBoundaryWitness = {
  canonicalKey: string;
  neighbors: Partial<Record<HexDirection, string>>;
};

export type ReachableBoundaryEnumeration = {
  witnesses: ReachableBoundaryWitness[];
  ringsVisited: number;
  truncated: boolean;
};

export function enumerateReachableConnectionBoundaries(
  variants: readonly HexPatchTileVariant[],
  maxCanonicalSituations = 2_000,
): ReachableBoundaryEnumeration {
  const domains = HEX_DIRECTION_ORDER.map((direction) => collapseNeighborDomain(variants, direction));
  const selected: HexPatchTileVariant[] = [];
  const witnesses = new Map<string, ReachableBoundaryWitness>();
  let ringsVisited = 0;
  let truncated = false;

  const visit = (index: number) => {
    if (truncated) return;
    if (index === HEX_DIRECTION_ORDER.length) {
      if (!ringNeighborsMatch(selected[5], HEX_DIRECTION_ORDER[5], selected[0], HEX_DIRECTION_ORDER[0])) return;
      ringsVisited += 1;
      const committed = new Map<string, HexCoord & { variant: HexPatchTileVariant }>();
      selected.forEach((variant, selectedIndex) => {
        const offset = HEX_DIRECTIONS[HEX_DIRECTION_ORDER[selectedIndex]];
        committed.set(hexCellKey(offset.q, offset.r), { ...offset, variant });
      });
      const constraints = collectPatchBoundaryConstraints({ q: 0, r: 0 }, committed);
      const canonicalKey = canonicalizeBoundaryConstraints(constraints, true);
      if (!witnesses.has(canonicalKey)) {
        witnesses.set(canonicalKey, {
          canonicalKey,
          neighbors: Object.fromEntries(selected.map((variant, selectedIndex) => [HEX_DIRECTION_ORDER[selectedIndex], variant.id])),
        });
      }
      if (witnesses.size >= maxCanonicalSituations) truncated = true;
      return;
    }
    const direction = HEX_DIRECTION_ORDER[index];
    for (const candidate of domains[index]) {
      if (index > 0 && !ringNeighborsMatch(selected[index - 1], HEX_DIRECTION_ORDER[index - 1], candidate, direction)) continue;
      selected.push(candidate);
      visit(index + 1);
      selected.pop();
      if (truncated) return;
    }
  };

  visit(0);
  return { witnesses: [...witnesses.values()].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey)), ringsVisited, truncated };
}

export function scenarioFromCoverageWitness(witness: ReachableBoundaryWitness, seed = 20260517): TerrainConnectionScenario {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `coverage-${hashString(witness.canonicalKey).toString(16)}`,
    name: "Coverage witness",
    notes: "Generated from a compatible authored neighbor ring.",
    seed,
    neighbors: { ...witness.neighbors },
    createdAt: now,
    updatedAt: now,
  };
}

function collapseNeighborDomain(variants: readonly HexPatchTileVariant[], position: HexDirection) {
  const index = HEX_DIRECTION_ORDER.indexOf(position);
  const previous = HEX_DIRECTION_ORDER[(index + HEX_DIRECTION_ORDER.length - 1) % HEX_DIRECTION_ORDER.length];
  const next = HEX_DIRECTION_ORDER[(index + 1) % HEX_DIRECTION_ORDER.length];
  const positionCoord = HEX_DIRECTIONS[position];
  const previousCoord = HEX_DIRECTIONS[previous];
  const nextCoord = HEX_DIRECTIONS[next];
  const towardCenter = directionForOffset({ q: -positionCoord.q, r: -positionCoord.r });
  const towardPrevious = directionForOffset({ q: previousCoord.q - positionCoord.q, r: previousCoord.r - positionCoord.r });
  const towardNext = directionForOffset({ q: nextCoord.q - positionCoord.q, r: nextCoord.r - positionCoord.r });
  const unique = new Map<string, HexPatchTileVariant>();
  for (const variant of variants) {
    const key = [towardCenter, towardPrevious, towardNext]
      .map((direction) => variant.edges[direction].join(","))
      .join("|");
    if (!unique.has(key)) unique.set(key, variant);
  }
  return [...unique.values()];
}

function ringNeighborsMatch(a: HexPatchTileVariant, aPosition: HexDirection, b: HexPatchTileVariant, bPosition: HexDirection) {
  const aCoord = HEX_DIRECTIONS[aPosition];
  const bCoord = HEX_DIRECTIONS[bPosition];
  const direction = directionForOffset({ q: bCoord.q - aCoord.q, r: bCoord.r - aCoord.r });
  return patchVariantsCanNeighbor(a, direction, b);
}

function directionForOffset(offset: HexCoord) {
  const direction = HEX_DIRECTION_ORDER.find((candidate) => {
    const value = HEX_DIRECTIONS[candidate];
    return value.q === offset.q && value.r === offset.r;
  });
  if (!direction) throw new Error(`No direction for ${offset.q},${offset.r}`);
  return direction;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
