import { HEX_DIRECTION_ORDER } from "./hexCoordinates";
import type { HexPatchTileVariant } from "./HexTerrainPatch";
import {
  resolveTerrainConnectionScenario,
  type TerrainConnectionScenario,
  type TerrainResolutionDecision,
} from "./TerrainConnectionScenario";

export function createDecisionFixture(
  scenarios: readonly TerrainConnectionScenario[],
  decisions: readonly TerrainResolutionDecision[],
  variants: readonly HexPatchTileVariant[],
) {
  const decisionsByScenario = new Map(decisions.map((decision) => [decision.scenarioId, decision]));
  return {
    schemaVersion: 1,
    decisions: scenarios
      .filter((scenario) => decisionsByScenario.has(scenario.id))
      .map((scenario) => {
        const resolution = resolveTerrainConnectionScenario(scenario, variants);
        return {
          scenario: { ...scenario, neighbors: orderedNeighbors(scenario.neighbors) },
          canonicalBoundaryKey: resolution.canonicalBoundaryKey,
          boundaryKey: resolution.boundaryKey,
          decision: decisionsByScenario.get(scenario.id)!,
          expectations: {
            authoredVariantIds: resolution.authored.filter((candidate) => candidate.policySafe).map((candidate) => candidate.variant.id).sort(),
            proceduralTopologyKeys: resolution.proceduralGroups.map((group) => group.key).sort(),
          },
        };
      })
      .sort((a, b) => a.canonicalBoundaryKey.localeCompare(b.canonicalBoundaryKey) || a.scenario.id.localeCompare(b.scenario.id)),
  };
}

export type TerrainDecisionFixture = ReturnType<typeof createDecisionFixture>;

export function terrainDecisionFixtureIsValid(value: unknown): value is TerrainDecisionFixture {
  if (!value || typeof value !== "object") return false;
  const fixture = value as { schemaVersion?: unknown; decisions?: unknown };
  if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.decisions)) return false;
  return fixture.decisions.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as { scenario?: TerrainConnectionScenario; decision?: TerrainResolutionDecision };
    return candidate.scenario?.schemaVersion === 1
      && typeof candidate.scenario.id === "string"
      && candidate.decision?.scenarioId === candidate.scenario.id;
  });
}

export function auditTerrainDecisionFixture(
  fixture: TerrainDecisionFixture,
  variants: readonly HexPatchTileVariant[],
) {
  const errors: string[] = [];
  for (const entry of fixture.decisions) {
    const resolution = resolveTerrainConnectionScenario(entry.scenario, variants);
    const label = entry.scenario.name || entry.scenario.id;
    if (resolution.missingVariantIds.length > 0) errors.push(`${label}: missing variants ${resolution.missingVariantIds.join(", ")}`);
    if (resolution.boundaryKey !== entry.boundaryKey) errors.push(`${label}: exact boundary changed`);
    if (resolution.canonicalBoundaryKey !== entry.canonicalBoundaryKey) errors.push(`${label}: canonical boundary changed`);
    const authored = resolution.authored.filter((candidate) => candidate.policySafe).map((candidate) => candidate.variant.id).sort();
    const procedural = resolution.proceduralGroups.map((group) => group.key).sort();
    if (JSON.stringify(authored) !== JSON.stringify(entry.expectations.authoredVariantIds)) errors.push(`${label}: authored expectations changed`);
    if (JSON.stringify(procedural) !== JSON.stringify(entry.expectations.proceduralTopologyKeys)) errors.push(`${label}: procedural topology expectations changed`);
  }
  return { valid: errors.length === 0, errors };
}

function orderedNeighbors(neighbors: TerrainConnectionScenario["neighbors"]) {
  return Object.fromEntries(
    HEX_DIRECTION_ORDER.flatMap((direction) => neighbors[direction] ? [[direction, neighbors[direction]]] : []),
  ) as TerrainConnectionScenario["neighbors"];
}
