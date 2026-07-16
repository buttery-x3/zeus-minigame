import { describe, expect, test } from "vitest";
import { createHexPatchTileCatalog, type HexPatchTileVariant } from "./HexTerrainCatalog";
import { patchVariantsCanNeighbor } from "./HexTerrainRules";
import { selectAuthoredPatchVariant, type SelectedPatchNeighbor } from "./RollingTerrainPatchSelection";
import { authoredRiverFlowsCanNeighbor } from "./TerrainRiverFlowPolicy";
import {
  evaluateVariantHydrology,
  variantsAreHydrologicallyCompatible,
} from "./TerrainHydrologyPolicy";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";

describe("authored hydrology vocabulary", () => {
  const variants = createHexPatchTileCatalog();
  const mouths = variants.filter((variant) => variant.id.startsWith("patch.transition.river-lake"));

  test("covers every authored mouth profile and approach-angle class", () => {
    const coverage = new Set<string>();
    for (const mouth of mouths) {
      for (let riverIndex = 0; riverIndex < HEX_DIRECTION_ORDER.length; riverIndex += 1) {
        const riverDirection = HEX_DIRECTION_ORDER[riverIndex];
        if (!mouth.edges[riverDirection].includes("river")) {
          continue;
        }
        for (let lakeIndex = 0; lakeIndex < HEX_DIRECTION_ORDER.length; lakeIndex += 1) {
          const lakeDirection = HEX_DIRECTION_ORDER[lakeIndex];
          if (!mouth.edges[lakeDirection].includes("lake")) {
            continue;
          }
          const offset = (lakeIndex - riverIndex + HEX_DIRECTION_ORDER.length) % HEX_DIRECTION_ORDER.length;
          coverage.add(`${offset}:${edgeCode(mouth.edges[lakeDirection])}`);
        }
      }
    }

    expect(coverage).toEqual(new Set([
      "1:OLL", "1:OLO", "1:OOL",
      "2:LOO", "2:OLL", "2:OOL",
      "3:LLL", "3:OLO",
      "4:LLO", "4:LOO", "4:OOL",
      "5:LLO", "5:LOO", "5:OLO",
    ]));
    expect(new Set([...coverage].map((entry) => entry.split(":")[0]))).toEqual(new Set(["1", "2", "3", "4", "5"]));
    expect(new Set([...coverage].map((entry) => entry.split(":")[1]))).toEqual(
      new Set(["LLL", "LLO", "LOO", "OLL", "OLO", "OOL"]),
    );
  });

  test("gives every non-open mouth edge an authored reverse match", () => {
    for (const mouth of mouths) {
      for (const direction of HEX_DIRECTION_ORDER) {
        if (mouth.edges[direction].every((kind) => kind === "open")) {
          continue;
        }
        expect(
          variants.some((candidate) => patchVariantsCanNeighbor(mouth, direction, candidate)),
          `${mouth.id} ${direction} ${mouth.edges[direction].join(",")}`,
        ).toBe(true);
      }
    }
  });
});

describe("rolling hydrology policy", () => {
  const variants = createHexPatchTileCatalog();

  test("rejects a distance-three river/lake near-miss hidden behind open sockets", () => {
    const river = variant("patch.river.bend.gentle-b.5");
    const lake = variant("patch.lake.shore.5");
    expect(patchVariantsCanNeighbor(river, "w", lake)).toBe(true);
    expect(variantsAreHydrologicallyCompatible({ q: 1, r: 0 }, river, "w", { q: 0, r: 0 }, lake)).toBe(false);
  });

  test("keeps a distance-four river/lake approach valid but marks it as soft", () => {
    const river = variant("patch.river.line.dogleg-b.0");
    const lake = variant("patch.lake.cove.2");
    const riverPatch = { q: 0, r: 0 };
    const lakePatch = { q: 1, r: 0 };
    const committed = new Map([
      [hexCellKey(lakePatch.q, lakePatch.r), { ...lakePatch, variant: lake }],
    ]);
    expect(patchVariantsCanNeighbor(river, "e", lake)).toBe(true);
    expect(variantsAreHydrologicallyCompatible(riverPatch, river, "e", lakePatch, lake)).toBe(true);
    expect(evaluateVariantHydrology(riverPatch, river, committed).softNearMissCount).toBe(1);
  });

  test("rejects a river hidden alongside a nearby cliff behind open sockets", () => {
    const scenario = findRiverCliffNearMiss();
    expect(scenario).toBeDefined();
    if (!scenario) {
      return;
    }

    expect(patchVariantsCanNeighbor(scenario.river, scenario.direction, scenario.cliff)).toBe(true);
    expect(variantsAreHydrologicallyCompatible(
      { q: 0, r: 0 },
      scenario.river,
      scenario.direction,
      HEX_DIRECTIONS[scenario.direction],
      scenario.cliff,
    )).toBe(false);
    const committed = new Map([
      [hexCellKey(HEX_DIRECTIONS[scenario.direction].q, HEX_DIRECTIONS[scenario.direction].r), {
        ...HEX_DIRECTIONS[scenario.direction],
        variant: scenario.cliff,
      }],
    ]);
    expect(evaluateVariantHydrology({ q: 0, r: 0 }, scenario.river, committed).riverCliffHardNearMissCount).toBeGreaterThan(0);
  });

  test("rejects meeting cove ports but permits cove adjacency across open sides", () => {
    const coves = variants.filter((candidate) => candidate.lakeRole === "cove");
    const meeting = findCovePair(coves, true);
    const separate = findCovePair(coves, false);

    expect(meeting).toBeDefined();
    expect(separate).toBeDefined();
    if (meeting) {
      expect(patchVariantsCanNeighbor(meeting.a, meeting.direction, meeting.b)).toBe(true);
      expect(variantsAreHydrologicallyCompatible(
        { q: 0, r: 0 },
        meeting.a,
        meeting.direction,
        HEX_DIRECTIONS[meeting.direction],
        meeting.b,
      )).toBe(false);
    }
    if (separate) {
      expect(variantsAreHydrologicallyCompatible(
        { q: 0, r: 0 },
        separate.a,
        separate.direction,
        HEX_DIRECTIONS[separate.direction],
        separate.b,
      )).toBe(true);
    }
  });

  test("allows coves to meet lake shores and river mouths", () => {
    const cove = variants.find((candidate) => candidate.lakeRole === "cove")!;
    for (const role of ["shore", "mouth"] as const) {
      const connection = findLakeRoleConnection(cove, role);
      expect(connection, role).toBeDefined();
      if (!connection) {
        continue;
      }
      expect(variantsAreHydrologicallyCompatible(
        { q: 0, r: 0 },
        cove,
        connection.direction,
        HEX_DIRECTIONS[connection.direction],
        connection.neighbor,
      ), role).toBe(true);
    }
  });

  test("selects a legal lake continuation over a higher-weight meeting cove", () => {
    const scenario = findCoveContinuationScenario();
    expect(scenario).toBeDefined();
    if (!scenario) {
      return;
    }
    const expensiveCove: HexPatchTileVariant = {
      ...scenario.cove,
      selectionGroup: "test.expensive-cove",
      selectionGroupWeight: 10_000,
      weight: 10_000,
    };
    const committed = new Map<string, SelectedPatchNeighbor>();
    addNeighbor(committed, { q: 0, r: 0 }, scenario.direction, scenario.neighbor);
    const selection = selectAuthoredPatchVariant({
      patch: { q: 0, r: 0 },
      variants: [expensiveCove, scenario.continuation],
      committedPatches: committed,
      seed: 91,
      safeStartRadius: -1,
      requireFirstRiver: false,
    });

    expect(selection.selection?.variant.id).toBe(scenario.continuation.id);
    expect(selection.coveConnectionCandidatesRejected).toBe(1);
  });

  test("prefers a mouth that joins committed river and lake context before weights", () => {
    const mouth = mouths().find((candidate) => {
      const riverDirection = directionContaining(candidate, "river");
      const lakeDirection = directionContaining(candidate, "lake", (edge) => edge.every((kind) => kind === "lake"));
      return Boolean(riverDirection && lakeDirection);
    })!;
    const riverDirection = directionContaining(mouth, "river")!;
    const lakeDirection = directionContaining(mouth, "lake", (edge) => edge.every((kind) => kind === "lake"))!;
    const riverNeighbor = variants.find((candidate) =>
      candidate.family === "river" &&
      patchVariantsCanNeighbor(mouth, riverDirection, candidate) &&
      authoredRiverFlowsCanNeighbor(mouth, riverDirection, candidate),
    )!;
    const lakeNeighbor = variants.find((candidate) =>
      candidate.family === "lake" && patchVariantsCanNeighbor(mouth, lakeDirection, candidate),
    )!;
    const alternative: HexPatchTileVariant = {
      ...mouth,
      id: "test.nonsemantic-mouth",
      riverTerminal: undefined,
      selectionGroup: "test.nonsemantic-mouth",
      selectionGroupWeight: 10_000,
      weight: 10_000,
    };
    const committed = new Map<string, SelectedPatchNeighbor>();
    addNeighbor(committed, { q: 0, r: 0 }, riverDirection, riverNeighbor);
    addNeighbor(committed, { q: 0, r: 0 }, lakeDirection, lakeNeighbor);

    const selection = selectAuthoredPatchVariant({
      patch: { q: 0, r: 0 },
      variants: [alternative, mouth],
      committedPatches: committed,
      seed: 73,
      safeStartRadius: -1,
      requireFirstRiver: false,
    });

    expect(selection.selection?.variant.id).toBe(mouth.id);
    expect(selection.selection?.hydrologyPolicy.connectionPreferred).toBe(true);
    expect(selection.selection?.hydrologyPolicy.candidatesSuppressed).toBe(1);
  });

  function variant(id: string) {
    const found = variants.find((candidate) => candidate.id === id);
    if (!found) {
      throw new Error(`Missing test variant ${id}`);
    }
    return found;
  }

  function mouths() {
    return variants.filter((candidate) => candidate.id.startsWith("patch.transition.river-lake-mouth"));
  }

  function findLakeRoleConnection(cove: HexPatchTileVariant, role: "shore" | "mouth") {
    for (const direction of HEX_DIRECTION_ORDER) {
      for (const neighbor of variants.filter((candidate) => candidate.lakeRole === role)) {
        if (patchVariantsCanNeighbor(cove, direction, neighbor) && sharedEdgeContains(cove, direction, neighbor, "lake")) {
          return { direction, neighbor };
        }
      }
    }
    return undefined;
  }

  function findCoveContinuationScenario() {
    const coves = variants.filter((candidate) => candidate.lakeRole === "cove");
    const continuations = variants.filter((candidate) => candidate.lakeRole === "shore");
    for (const neighbor of coves) {
      for (const direction of HEX_DIRECTION_ORDER) {
        const cove = coves.find((candidate) =>
          patchVariantsCanNeighbor(candidate, direction, neighbor) &&
          sharedEdgeContains(candidate, direction, neighbor, "lake"),
        );
        const continuation = continuations.find((candidate) =>
          patchVariantsCanNeighbor(candidate, direction, neighbor) &&
          variantsAreHydrologicallyCompatible(
            { q: 0, r: 0 }, candidate, direction, HEX_DIRECTIONS[direction], neighbor,
          ),
        );
        if (cove && continuation) {
          return { neighbor, direction, cove, continuation };
        }
      }
    }
    return undefined;
  }

  function findRiverCliffNearMiss() {
    const rivers = variants.filter((candidate) => candidate.family === "river");
    const cliffs = variants.filter((candidate) => candidate.family === "cliff");
    for (const river of rivers) {
      for (const direction of HEX_DIRECTION_ORDER) {
        for (const cliff of cliffs) {
          if (
            patchVariantsCanNeighbor(river, direction, cliff) &&
            !variantsAreHydrologicallyCompatible(
              { q: 0, r: 0 }, river, direction, HEX_DIRECTIONS[direction], cliff,
            )
          ) {
            return { river, direction, cliff };
          }
        }
      }
    }
    return undefined;
  }
});

function findCovePair(coves: readonly HexPatchTileVariant[], shouldMeet: boolean) {
  for (const a of coves) {
    for (const direction of HEX_DIRECTION_ORDER) {
      for (const b of coves) {
        if (!patchVariantsCanNeighbor(a, direction, b)) {
          continue;
        }
        const meets = sharedEdgeContains(a, direction, b, "lake");
        if (meets === shouldMeet) {
          return { a, direction, b };
        }
      }
    }
  }
  return undefined;
}

function sharedEdgeContains(
  a: HexPatchTileVariant,
  direction: HexDirection,
  b: HexPatchTileVariant,
  kind: "lake" | "river",
) {
  const oppositeDirections: Record<HexDirection, HexDirection> = {
    ne: "sw", e: "w", se: "nw", sw: "ne", w: "e", nw: "se",
  };
  const neighborEdge = b.edges[oppositeDirections[direction]];
  return a.edges[direction].some(
    (edgeKind, index) => edgeKind === kind && neighborEdge[neighborEdge.length - 1 - index] === kind,
  );
}

function edgeCode(edge: readonly string[]) {
  return edge.map((kind) => ({ open: "O", closed: "C", river: "R", lake: "L" })[kind]).join("");
}

function directionContaining(
  variant: HexPatchTileVariant,
  kind: "river" | "lake",
  accepts: (edge: HexPatchTileVariant["edges"][HexDirection]) => boolean = () => true,
) {
  return HEX_DIRECTION_ORDER.find((direction) => variant.edges[direction].includes(kind) && accepts(variant.edges[direction]));
}

function addNeighbor(
  committed: Map<string, SelectedPatchNeighbor>,
  patch: HexCoord,
  direction: HexDirection,
  variant: HexPatchTileVariant,
) {
  const offset = HEX_DIRECTIONS[direction];
  const neighbor = { q: patch.q + offset.q, r: patch.r + offset.r, variant };
  committed.set(hexCellKey(neighbor.q, neighbor.r), neighbor);
}
