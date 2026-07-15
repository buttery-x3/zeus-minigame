import { describe, expect, test } from "vitest";
import type { HexEdgeKind } from "../types";
import {
  HEX_PATCH_LOCAL_CELLS,
  createHexPatchTileCatalog,
  summarizeAuthoredPatchFamilies,
  type HexPatchTileVariant,
} from "./HexTerrainCatalog";
import { validateHexPatchVariant } from "./HexTerrainPatchValidation";
import {
  proceduralBoundaryConstraintsAreConsistent,
  synthesizeProceduralPatch,
  type HexPatchBoundaryConstraints,
} from "./ProceduralTerrainPatch";
import { patchVariantsCanNeighbor } from "./HexTerrainRules";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
import { WfcTerrainProvider } from "./WfcTerrainProvider";
import { selectAuthoredPatchVariant } from "./RollingTerrainPatchSelection";
import {
  createFeatureLoopContext,
  findFrontierShortFeatureLoops,
  findShortFeatureLoops,
} from "./TerrainPatchLoopPolicy";

describe("authored terrain patches", () => {
  const variants = createHexPatchTileCatalog();

  test("define valid, unique, weighted layouts for every terrain family", () => {
    const ids = new Set<string>();
    for (const variant of variants) {
      const validation = validateHexPatchVariant(variant);
      expect(validation.errors, variant.id).toEqual([]);
      expect(ids.has(variant.id), variant.id).toBe(false);
      expect(variant.provenance).toBe("authored");
      expect(variant.cells.size).toBe(HEX_PATCH_LOCAL_CELLS.length);
      expect([...variant.cells.values()].some((cell) => cell.structure === "bank"), variant.id).toBe(false);
      ids.add(variant.id);
    }

    const groupWeights = new Map<string, number>();
    for (const variant of variants) {
      const previous = groupWeights.get(variant.selectionGroup);
      expect(previous === undefined || previous === variant.selectionGroupWeight, variant.selectionGroup).toBe(true);
      groupWeights.set(variant.selectionGroup, variant.selectionGroupWeight);
    }
    expect(variants.some((variant) => variant.id.startsWith("patch.cliff.bend.gentle"))).toBe(true);
    expect(variants.some((variant) => variant.id.startsWith("patch.river.bend.gentle"))).toBe(true);
    expect(variants.some((variant) => variant.id.startsWith("patch.cliff.ridge.dogleg"))).toBe(true);
    expect(variants.some((variant) => variant.id.startsWith("patch.river.line.dogleg"))).toBe(true);

    const families = summarizeAuthoredPatchFamilies(variants);
    expect(families.open).toBeGreaterThanOrEqual(3);
    expect(families.cliff).toBeGreaterThanOrEqual(12);
    expect(families.river).toBeGreaterThanOrEqual(12);
    expect(families.lake).toBeGreaterThanOrEqual(6);
    expect(families.transition).toBeGreaterThanOrEqual(6);
  });
});

describe("terrain feature loop policy", () => {
  const variants = createHexPatchTileCatalog();

  test("detects a cliff candidate that closes a three-patch ring", () => {
    const east = findTwoExitVariant(variants, "closed", ["sw", "w"]);
    const southeast = findTwoExitVariant(variants, "closed", ["ne", "nw"]);
    const candidate = findTwoExitVariant(variants, "closed", ["e", "se"]);
    const context = createFeatureLoopContext([
      { q: 1, r: 0, variant: east },
      { q: 0, r: 1, variant: southeast },
    ]);

    expect(findShortFeatureLoops(context, { q: 0, r: 0 }, candidate)).toContainEqual({
      feature: "wall",
      length: 3,
      kind: "closed",
    });
  });

  test("does not classify a one-sided extension as a loop", () => {
    const east = findTwoExitVariant(variants, "closed", ["sw", "w"]);
    const candidate = findTwoExitVariant(variants, "closed", ["e", "se"]);
    const context = createFeatureLoopContext([{ q: 1, r: 0, variant: east }]);

    expect(findShortFeatureLoops(context, { q: 0, r: 0 }, candidate)).toEqual([]);
  });

  test("detects when a candidate would force a short loop into the frontier", () => {
    const southeast = findTwoExitVariant(variants, "closed", ["ne", "nw"]);
    const candidate = findTwoExitVariant(variants, "closed", ["e", "se"]);

    expect(findFrontierShortFeatureLoops(
      [{ q: 0, r: 1, variant: southeast }],
      { q: 0, r: 0 },
      candidate,
    )).toContainEqual({ feature: "wall", length: 3, kind: "frontier" });
  });

  test("rejects a forced short-loop candidate when it encloses movement", () => {
    const east = findTwoExitVariant(variants, "closed", ["sw", "w"]);
    const southeast = findTwoExitVariant(variants, "closed", ["ne", "nw"]);
    const candidate = findTwoExitVariant(variants, "closed", ["e", "se"]);
    const committed = new Map([
      ["1,0", { q: 1, r: 0, variant: east }],
      ["0,1", { q: 0, r: 1, variant: southeast }],
    ]);
    const selection = selectAuthoredPatchVariant({
      patch: { q: 0, r: 0 },
      variants: [candidate],
      committedPatches: committed,
      seed: 41,
      safeStartRadius: -1,
      requireFirstRiver: false,
    });

    expect(selection.selection).toBeNull();
    expect(selection.enclosureCandidatesRejected).toBe(1);
  });
});

describe("procedural patch closure", () => {
  test("keeps an open core when the boundary exposes walkable cells", () => {
    const result = synthesizeProceduralPatch({ ne: ["open", "river", "open"] }, 17);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.variant.procedural?.fillMode).toBe("open-core");
    expect(result.variant.cells.get("0,0")?.structure).toBe("open");
    expect(validateHexPatchVariant(result.variant).valid).toBe(true);
  });

  test("fills a homogeneous enclosure all the way inward", () => {
    const constraints = Object.fromEntries(
      HEX_DIRECTION_ORDER.map((direction) => [direction, ["closed", "closed", "closed"]]),
    ) as HexPatchBoundaryConstraints;
    const result = synthesizeProceduralPatch(constraints, 23);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.variant.procedural?.fillMode).toBe("enclosed");
    expect([...result.variant.cells.values()].every((cell) => cell.structure === "wall")).toBe(true);
  });

  test("grows compatible mixed enclosures inward without inventing grass", () => {
    const constraints: HexPatchBoundaryConstraints = {
      ne: ["closed", "closed", "closed"],
      e: ["closed", "lake", "lake"],
      se: ["lake", "lake", "lake"],
      sw: ["lake", "lake", "lake"],
      w: ["lake", "closed", "closed"],
      nw: ["closed", "closed", "closed"],
    };
    const result = synthesizeProceduralPatch(constraints, 29);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.variant.procedural?.fillMode).toBe("mixed-enclosure");
    expect([...result.variant.cells.values()].some((cell) => cell.structure === "open")).toBe(false);
    expect(new Set([...result.variant.cells.values()].map((cell) => cell.structure))).toEqual(new Set(["wall", "lake"]));
  });

  test("is deterministic for the same boundary and seed", () => {
    const constraints: HexPatchBoundaryConstraints = {
      ne: ["open", "river", "open"],
      e: ["open", "closed", "open"],
      sw: ["open", "lake", "open"],
    };
    const a = synthesizeProceduralPatch(constraints, 31);
    const b = synthesizeProceduralPatch(constraints, 31);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(serializeCells(a.variant)).toBe(serializeCells(b.variant));
  });

  test("searches for an alternate terminating interior when topology rejects the preferred layout", () => {
    const constraints: HexPatchBoundaryConstraints = {
      ne: ["open", "river", "open"],
      sw: ["open", "river", "open"],
    };
    const preferred = synthesizeProceduralPatch(constraints, 43);
    expect(preferred.ok).toBe(true);
    if (!preferred.ok) {
      return;
    }
    const preferredLayout = serializeCells(preferred.variant);
    const alternate = synthesizeProceduralPatch(constraints, 43, {
      acceptsCells: (cells) => serializeCellMap(cells) !== preferredLayout,
    });

    expect(alternate.ok).toBe(true);
    if (alternate.ok) {
      expect(serializeCells(alternate.variant)).not.toBe(preferredLayout);
      expect(alternate.variant.cells.get("0,0")?.structure).toBe("open");
    }
  });

  test("closes every reachable authored-neighbor boundary", { timeout: 60_000 }, () => {
    const variants = createHexPatchTileCatalog();
    const neighborhoods = enumerateReachableCenterBoundaries(variants);
    const rotationClasses = new Map<string, HexPatchBoundaryConstraints>();
    for (const constraints of neighborhoods.values()) {
      const canonicalKey = canonicalRotationKey(constraints);
      if (!rotationClasses.has(canonicalKey)) {
        rotationClasses.set(canonicalKey, constraints);
      }
    }
    let authoredCoverage = 0;
    let proceduralCoverage = 0;

    for (const [key, constraints] of rotationClasses) {
      expect(proceduralBoundaryConstraintsAreConsistent(constraints), key).toBe(true);
      const authored = variants.some((variant) => matchesConstraints(variant, constraints));
      if (authored) {
        authoredCoverage += 1;
        continue;
      }

      const result = synthesizeProceduralPatch(constraints, 20260517);
      expect(result.ok, key).toBe(true);
      if (!result.ok) {
        continue;
      }
      expect(validateHexPatchVariant(result.variant).errors, key).toEqual([]);
      expect(matchesConstraints(result.variant, constraints), key).toBe(true);
      proceduralCoverage += 1;
    }

    expect(authoredCoverage).toBeGreaterThan(0);
    expect(proceduralCoverage).toBeGreaterThan(0);
    expect(authoredCoverage + proceduralCoverage).toBe(rotationClasses.size);
    console.info(
      `terrain closure: ${neighborhoods.size} reachable boundaries in ${rotationClasses.size} rotation classes, ` +
      `${authoredCoverage} authored, ${proceduralCoverage} procedural`,
    );
  });

  test("synthesizes every rotation of a mixed boundary", () => {
    const constraints: HexPatchBoundaryConstraints = {
      ne: ["open", "river", "open"],
      e: ["open", "closed", "open"],
      sw: ["open", "lake", "open"],
    };
    for (let step = 0; step < 6; step += 1) {
      const rotated = rotateConstraints(constraints, step);
      const result = synthesizeProceduralPatch(rotated, 37);
      expect(result.ok, serializeConstraints(rotated)).toBe(true);
      if (result.ok) {
        expect(matchesConstraints(result.variant, rotated)).toBe(true);
      }
    }
  });
});

describe("rolling authored-first generation", () => {
  test("uses procedural patches without socket mismatches or emergency substitution", { timeout: 30_000 }, () => {
    let suppressedShortLoops = 0;
    let gentleBends = 0;
    let enclosureCandidatesRejected = 0;
    for (const seed of [20260517, 20260518, 20260519, 20260520]) {
      const provider = new WfcTerrainProvider(seed);
      provider.ensureGeneratedAround(0, 0, 5);
      const diagnostics = provider.getDiagnostics().wfc;
      expect(diagnostics.emergencyPatchCount, `seed ${seed}`).toBe(0);
      expect(diagnostics.contradictionCount, `seed ${seed}`).toBe(0);
      expect(diagnostics.synthesisFailureCount, `seed ${seed}`).toBe(0);
      expect(diagnostics.patchSocketMismatchSample, `seed ${seed}`).toBeNull();
      expect(diagnostics.authoredPatchCount, `seed ${seed}`).toBeGreaterThan(diagnostics.proceduralPatchCount);
      expect(diagnostics.structureCounts.bank, `seed ${seed}`).toBe(0);
      expect(diagnostics.enclosureViolationSample, `seed ${seed}`).toBeNull();
      suppressedShortLoops += diagnostics.shortLoopCandidatesSuppressed.wall + diagnostics.shortLoopCandidatesSuppressed.river;
      gentleBends += diagnostics.topologySelectionCounts["gentle-bend"] ?? 0;
      enclosureCandidatesRejected += diagnostics.enclosureCandidatesRejected;
    }
    expect(suppressedShortLoops).toBeGreaterThan(0);
    expect(gentleBends).toBeGreaterThan(0);
    expect(enclosureCandidatesRejected).toBeGreaterThan(0);
  });
});

function findTwoExitVariant(
  variants: readonly HexPatchTileVariant[],
  edgeKind: HexEdgeKind,
  directions: readonly HexDirection[],
) {
  const expected = [...directions].sort().join(",");
  const variant = variants.find((candidate) => {
    const exits = HEX_DIRECTION_ORDER.filter((direction) => candidate.edges[direction].includes(edgeKind));
    return exits.length === 2 && [...exits].sort().join(",") === expected;
  });
  if (!variant) {
    throw new Error(`Missing authored ${edgeKind} variant with exits ${expected}`);
  }
  return variant;
}

function enumerateReachableCenterBoundaries(variants: readonly HexPatchTileVariant[]) {
  const ringCoords = HEX_DIRECTION_ORDER.map((direction) => HEX_DIRECTIONS[direction]);
  const profiles = ringCoords.map((coord, index) => createRingProfiles(
    variants,
    coord,
    ringCoords[(index + ringCoords.length - 1) % ringCoords.length],
    ringCoords[(index + 1) % ringCoords.length],
  ));
  const boundaries = new Map<string, HexPatchBoundaryConstraints>();
  const chosen: HexPatchTileVariant[] = [];

  const visit = (index: number) => {
    if (index === profiles.length) {
      if (!patchVariantsCanNeighbor(chosen[chosen.length - 1], profiles[profiles.length - 1].toNext, chosen[0])) {
        return;
      }
      const constraints: HexPatchBoundaryConstraints = {};
      for (let ringIndex = 0; ringIndex < profiles.length; ringIndex += 1) {
        const direction = HEX_DIRECTION_ORDER[ringIndex];
        constraints[direction] = [...chosen[ringIndex].edges[profiles[ringIndex].inward]].reverse();
      }
      boundaries.set(serializeConstraints(constraints), constraints);
      return;
    }

    for (const variant of profiles[index].variants) {
      if (index > 0 && !patchVariantsCanNeighbor(chosen[index - 1], profiles[index - 1].toNext, variant)) {
        continue;
      }
      chosen[index] = variant;
      visit(index + 1);
    }
  };

  visit(0);
  return boundaries;
}

function createRingProfiles(
  variants: readonly HexPatchTileVariant[],
  coord: HexCoord,
  previous: HexCoord,
  next: HexCoord,
) {
  const inward = directionBetween(coord, { q: 0, r: 0 });
  const toPrevious = directionBetween(coord, previous);
  const toNext = directionBetween(coord, next);
  const unique = new Map<string, HexPatchTileVariant>();
  for (const variant of variants) {
    const key = [inward, toPrevious, toNext].map((direction) => variant.edges[direction].join(",")).join("|");
    if (!unique.has(key)) {
      unique.set(key, variant);
    }
  }
  return { inward, toNext, variants: [...unique.values()] };
}

function directionBetween(from: HexCoord, to: HexCoord): HexDirection {
  const direction = HEX_DIRECTION_ORDER.find((candidate) => {
    const offset = HEX_DIRECTIONS[candidate];
    return from.q + offset.q === to.q && from.r + offset.r === to.r;
  });
  if (!direction) {
    throw new Error(`Coordinates ${hexCellKey(from.q, from.r)} and ${hexCellKey(to.q, to.r)} are not neighbors`);
  }
  return direction;
}

function matchesConstraints(variant: HexPatchTileVariant, constraints: HexPatchBoundaryConstraints) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const expected = constraints[direction];
    return !expected || expected.every((kind, index) => variant.edges[direction][index] === kind);
  });
}

function serializeConstraints(constraints: HexPatchBoundaryConstraints) {
  return HEX_DIRECTION_ORDER.map((direction) => `${direction}:${constraints[direction]?.join(",") ?? "*"}`).join("|");
}

function canonicalRotationKey(constraints: HexPatchBoundaryConstraints) {
  return Array.from({ length: 6 }, (_, step) => serializeConstraints(rotateConstraints(constraints, step))).sort()[0];
}

function rotateConstraints(constraints: HexPatchBoundaryConstraints, step: number): HexPatchBoundaryConstraints {
  const rotated: HexPatchBoundaryConstraints = {};
  for (let index = 0; index < HEX_DIRECTION_ORDER.length; index += 1) {
    const source = HEX_DIRECTION_ORDER[index];
    const target = HEX_DIRECTION_ORDER[(index + step) % HEX_DIRECTION_ORDER.length];
    if (constraints[source]) {
      rotated[target] = [...constraints[source]];
    }
  }
  return rotated;
}

function serializeCells(variant: HexPatchTileVariant) {
  return serializeCellMap(variant.cells);
}

function serializeCellMap(cells: ReadonlyMap<string, { structure: string; surface: string }>) {
  return HEX_PATCH_LOCAL_CELLS.map((coord) => {
    const cell = cells.get(hexCellKey(coord.q, coord.r));
    return `${cell?.structure}/${cell?.surface}`;
  }).join("|");
}
