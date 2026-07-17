import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
import { HEX_PATCH_EDGE_CELLS, type HexPatchTileVariant } from "./HexTerrainPatch";
import { patchVariantsCanNeighbor } from "./HexTerrainRules";
import { collectPatchBoundaryConstraints } from "./RollingTerrainPatchSelection";
import { enumerateProceduralPatches } from "./ProceduralTerrainPatchEnumeration";
import { serializeBoundaryConstraints, synthesizeProceduralPatch, type HexPatchBoundaryConstraints } from "./ProceduralTerrainPatch";
import { evaluateCellsHydrology, evaluateVariantHydrology } from "./TerrainHydrologyPolicy";
import { authoredRiverFlowsCanNeighbor } from "./TerrainRiverFlowPolicy";
import { createMovementTopologyContext } from "./TerrainTopologyContext";
import { createTerrainTopologySignature, type TerrainTopologySignature } from "./TerrainTopologySignature";

export const TERRAIN_SCENARIO_SCHEMA_VERSION = 1;

export type TerrainConnectionScenario = {
  schemaVersion: 1;
  id: string;
  name: string;
  notes: string;
  seed: number;
  neighbors: Partial<Record<HexDirection, string>>;
  createdAt: string;
  updatedAt: string;
};

export type TerrainResolutionDecision = {
  scenarioId: string;
  classification: "accepted" | "rejected" | "needs-recipe" | "intentionally-impossible";
  policy: "authored-required" | "procedural-allowed" | "procedural-rejected" | "either";
  notes: string;
  updatedAt: string;
};

export type TerrainResolutionCandidate = {
  variant: HexPatchTileVariant;
  topology: TerrainTopologySignature;
  policySafe: boolean;
  rejectionReasons: string[];
};

export type TerrainTopologyGroup = {
  key: string;
  topology: TerrainTopologySignature;
  candidates: TerrainResolutionCandidate[];
};

export type TerrainSeamDiagnostic = {
  kind: "center" | "ring";
  direction: HexDirection;
  neighborDirection?: HexDirection;
  state: "match" | "physical-mismatch" | "river-flow-mismatch" | "unconstrained";
};

export type TerrainConnectionResolution = {
  constraints: HexPatchBoundaryConstraints;
  boundaryKey: string;
  canonicalBoundaryKey: string;
  seams: TerrainSeamDiagnostic[];
  authored: TerrainResolutionCandidate[];
  procedural: TerrainResolutionCandidate[];
  proceduralGroups: TerrainTopologyGroup[];
  generatorFallback: HexPatchTileVariant | null;
  attemptedAssignments: number;
  missingVariantIds: string[];
};

export function createTerrainConnectionScenario(name = "Untitled scenario", seed = 20260517): TerrainConnectionScenario {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: cryptoId(), name, notes: "", seed, neighbors: {}, createdAt: now, updatedAt: now };
}

export function resolveTerrainConnectionScenario(
  scenario: TerrainConnectionScenario,
  variants: readonly HexPatchTileVariant[],
): TerrainConnectionResolution {
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const committed = new Map<string, HexCoord & { variant: HexPatchTileVariant }>();
  const missingVariantIds: string[] = [];
  for (const direction of HEX_DIRECTION_ORDER) {
    const id = scenario.neighbors[direction];
    if (!id) continue;
    const variant = byId.get(id);
    if (!variant) {
      missingVariantIds.push(id);
      continue;
    }
    const offset = HEX_DIRECTIONS[direction];
    committed.set(hexCellKey(offset.q, offset.r), { ...offset, variant });
  }
  const center = { q: 0, r: 0 };
  const constraints = collectPatchBoundaryConstraints(center, committed);
  const boundaryKey = serializeBoundaryConstraints(constraints);
  const topologyContext = createMovementTopologyContext(committed.values());
  const authored = variants
    .filter((variant) => variant.provenance === "authored")
    .filter((variant) => matchesPlacedNeighbors(variant, committed))
    .map((variant) => evaluateCandidate(center, variant, committed, topologyContext));
  const enumeration = enumerateProceduralPatches(constraints);
  const procedural = enumeration.ok
    ? enumeration.candidates.map(({ variant }) => evaluateCandidate(center, variant, committed, topologyContext))
    : [];
  const grouped = new Map<string, TerrainTopologyGroup>();
  for (const candidate of procedural) {
    const group = grouped.get(candidate.topology.key) ?? { key: candidate.topology.key, topology: candidate.topology, candidates: [] };
    group.candidates.push(candidate);
    grouped.set(candidate.topology.key, group);
  }
  const generatorResult = synthesizeProceduralPatch(constraints, scenario.seed, {
    preferFastTermination: true,
    acceptsCells: (cells) => topologyContext.evaluateCells(center, cells).safe
      && evaluateCellsHydrology(center, cells, committed).hardNearMissCount === 0,
  });
  return {
    constraints,
    boundaryKey,
    canonicalBoundaryKey: canonicalizeBoundaryConstraints(constraints, true),
    seams: collectSeamDiagnostics(scenario, byId),
    authored,
    procedural,
    proceduralGroups: [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key)),
    generatorFallback: generatorResult.ok ? generatorResult.variant : null,
    attemptedAssignments: enumeration.attemptedAssignments,
    missingVariantIds,
  };
}

export function canonicalizeBoundaryConstraints(constraints: HexPatchBoundaryConstraints, includeMirrors: boolean) {
  const cells = new Map<string, string>();
  for (const direction of HEX_DIRECTION_ORDER) {
    constraints[direction]?.forEach((kind, index) => {
      const coord = HEX_PATCH_EDGE_CELLS[direction][index];
      cells.set(hexCellKey(coord.q, coord.r), kind);
    });
  }
  const candidates: string[] = [];
  for (let rotation = 0; rotation < 6; rotation += 1) {
    candidates.push(serializeTransformedBoundary(cells, rotation, false));
    if (includeMirrors) candidates.push(serializeTransformedBoundary(cells, rotation, true));
  }
  return candidates.sort()[0] ?? "";
}

export function createDecisionFixture(
  scenarios: readonly TerrainConnectionScenario[],
  decisions: readonly TerrainResolutionDecision[],
  variants: readonly HexPatchTileVariant[],
) {
  const decisionsByScenario = new Map(decisions.map((decision) => [decision.scenarioId, decision]));
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    decisions: scenarios
      .filter((scenario) => decisionsByScenario.has(scenario.id))
      .map((scenario) => {
        const resolution = resolveTerrainConnectionScenario(scenario, variants);
        return {
          scenario: { ...scenario, neighbors: orderedNeighbors(scenario.neighbors) },
          canonicalBoundaryKey: resolution.canonicalBoundaryKey,
          boundaryKey: resolution.boundaryKey,
          decision: decisionsByScenario.get(scenario.id),
          expectations: {
            authoredVariantIds: resolution.authored.filter((candidate) => candidate.policySafe).map((candidate) => candidate.variant.id).sort(),
            proceduralTopologyKeys: resolution.proceduralGroups.map((group) => group.key).sort(),
          },
        };
      })
      .sort((a, b) => a.canonicalBoundaryKey.localeCompare(b.canonicalBoundaryKey) || a.scenario.id.localeCompare(b.scenario.id)),
  };
}

function evaluateCandidate(
  patch: HexCoord,
  variant: HexPatchTileVariant,
  committed: ReadonlyMap<string, HexCoord & { variant: HexPatchTileVariant }>,
  topologyContext: ReturnType<typeof createMovementTopologyContext>,
): TerrainResolutionCandidate {
  const rejectionReasons: string[] = [];
  if (!topologyContext.evaluateVariant(patch, variant).safe) rejectionReasons.push("movement enclosure");
  if (evaluateVariantHydrology(patch, variant, committed).hardNearMissCount > 0) rejectionReasons.push("hydrology near miss");
  for (const direction of HEX_DIRECTION_ORDER) {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = committed.get(hexCellKey(offset.q, offset.r));
    if (neighbor && !authoredRiverFlowsCanNeighbor(variant, direction, neighbor.variant)) {
      rejectionReasons.push(`river flow ${direction}`);
    }
  }
  return { variant, topology: createTerrainTopologySignature(variant), policySafe: rejectionReasons.length === 0, rejectionReasons };
}

function matchesPlacedNeighbors(variant: HexPatchTileVariant, committed: ReadonlyMap<string, HexCoord & { variant: HexPatchTileVariant }>) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = committed.get(hexCellKey(offset.q, offset.r));
    return !neighbor || patchVariantsCanNeighbor(variant, direction, neighbor.variant);
  });
}

function collectSeamDiagnostics(scenario: TerrainConnectionScenario, byId: ReadonlyMap<string, HexPatchTileVariant>) {
  const diagnostics: TerrainSeamDiagnostic[] = [];
  for (const direction of HEX_DIRECTION_ORDER) {
    diagnostics.push({ kind: "center", direction, state: scenario.neighbors[direction] ? "match" : "unconstrained" });
  }
  for (let index = 0; index < HEX_DIRECTION_ORDER.length; index += 1) {
    const direction = HEX_DIRECTION_ORDER[index];
    const nextDirection = HEX_DIRECTION_ORDER[(index + 1) % HEX_DIRECTION_ORDER.length];
    const current = scenario.neighbors[direction] ? byId.get(scenario.neighbors[direction]!) : undefined;
    const next = scenario.neighbors[nextDirection] ? byId.get(scenario.neighbors[nextDirection]!) : undefined;
    if (!current || !next) {
      diagnostics.push({ kind: "ring", direction, neighborDirection: nextDirection, state: "unconstrained" });
      continue;
    }
    const from = HEX_DIRECTIONS[direction];
    const to = HEX_DIRECTIONS[nextDirection];
    const relative = directionForOffset({ q: to.q - from.q, r: to.r - from.r });
    const physical = patchVariantsCanNeighbor(current, relative, next);
    diagnostics.push({
      kind: "ring",
      direction,
      neighborDirection: nextDirection,
      state: !physical ? "physical-mismatch" : authoredRiverFlowsCanNeighbor(current, relative, next) ? "match" : "river-flow-mismatch",
    });
  }
  return diagnostics;
}

function directionForOffset(offset: HexCoord) {
  const entry = HEX_DIRECTION_ORDER.find((direction) => {
    const candidate = HEX_DIRECTIONS[direction];
    return candidate.q === offset.q && candidate.r === offset.r;
  });
  if (!entry) throw new Error(`No direction for ${offset.q},${offset.r}`);
  return entry;
}

function serializeTransformedBoundary(source: ReadonlyMap<string, string>, rotation: number, mirror: boolean) {
  const transformed = new Map<string, string>();
  for (const [key, kind] of source) {
    const [qValue, rValue] = key.split(",").map(Number);
    let q = qValue;
    let r = rValue;
    if (mirror) r = -q - r;
    for (let index = 0; index < rotation; index += 1) [q, r] = [-r, q + r];
    transformed.set(hexCellKey(q, r), kind);
  }
  return [...transformed].sort(([a], [b]) => a.localeCompare(b)).map(([key, kind]) => `${key}:${kind}`).join("|");
}

function orderedNeighbors(neighbors: TerrainConnectionScenario["neighbors"]) {
  return Object.fromEntries(HEX_DIRECTION_ORDER.flatMap((direction) => neighbors[direction] ? [[direction, neighbors[direction]]] : []));
}

function cryptoId() {
  return globalThis.crypto?.randomUUID?.() ?? `scenario-${Date.now().toString(36)}`;
}
