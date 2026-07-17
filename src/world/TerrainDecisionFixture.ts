import { HEX_DIRECTION_ORDER } from "./hexCoordinates";
import type { HexPatchTileVariant } from "./HexTerrainPatch";
import { canonicalizeTopologyRecipe, type TerrainTopologyRecipe } from "./TerrainTopologyRecipe";
import {
  resolveTerrainConnectionScenario,
  type TerrainConnectionScenario,
  type TerrainResolutionDecision,
} from "./TerrainConnectionScenario";

export function createDecisionFixture(
  scenarios: readonly TerrainConnectionScenario[],
  decisions: readonly TerrainResolutionDecision[],
  variants: readonly HexPatchTileVariant[],
  recipes: readonly TerrainTopologyRecipe[] = [],
) {
  const decisionsByScenario = new Map(decisions.map((decision) => [decision.scenarioId, decision]));
  return {
    schemaVersion: 1,
    recipes: recipes.map((recipe) => ({ ...structuredClone(recipe), canonicalKey: canonicalizeTopologyRecipe(recipe) }))
      .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey) || a.id.localeCompare(b.id)),
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
  const fixture = value as { schemaVersion?: unknown; decisions?: unknown; recipes?: unknown };
  if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.decisions) || (fixture.recipes !== undefined && !Array.isArray(fixture.recipes))) return false;
  const decisionsValid = fixture.decisions.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as { scenario?: TerrainConnectionScenario; decision?: TerrainResolutionDecision };
    return candidate.scenario?.schemaVersion === 1
      && typeof candidate.scenario.id === "string"
      && candidate.decision?.scenarioId === candidate.scenario.id;
  });
  return decisionsValid && (fixture.recipes as unknown[] | undefined)?.every(recipeFixtureIsValid) !== false;
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
  for (const recipe of fixture.recipes ?? []) {
    if (canonicalizeTopologyRecipe(recipe) !== recipe.canonicalKey) errors.push(`${recipe.name || recipe.id}: canonical recipe changed`);
  }
  return { valid: errors.length === 0, errors };
}

function orderedNeighbors(neighbors: TerrainConnectionScenario["neighbors"]) {
  return Object.fromEntries(
    HEX_DIRECTION_ORDER.flatMap((direction) => neighbors[direction] ? [[direction, neighbors[direction]]] : []),
  ) as TerrainConnectionScenario["neighbors"];
}

function recipeFixtureIsValid(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Partial<TerrainTopologyRecipe> & { canonicalKey?: unknown };
  if (recipe.schemaVersion !== 1 || typeof recipe.id !== "string" || typeof recipe.name !== "string"
    || typeof recipe.notes !== "string" || typeof recipe.canonicalKey !== "string"
    || typeof recipe.allowDisconnected !== "boolean" || typeof recipe.requireOpenCore !== "boolean"
    || !Array.isArray(recipe.components) || !Array.isArray(recipe.separate)
    || !Array.isArray(recipe.requiredContacts) || !Array.isArray(recipe.forbiddenContacts)) return false;
  const portIsValid = (port: unknown) => {
    if (!port || typeof port !== "object") return false;
    const candidate = port as { direction?: unknown; index?: unknown; structure?: unknown };
    return HEX_DIRECTION_ORDER.includes(candidate.direction as never)
      && Number.isInteger(candidate.index) && Number(candidate.index) >= 0 && Number(candidate.index) < 3
      && ["wall", "river", "lake"].includes(String(candidate.structure));
  };
  const contactIsValid = (contact: unknown) => {
    if (!contact || typeof contact !== "object") return false;
    const candidate = contact as { a?: unknown; b?: unknown };
    return ["wall", "river", "lake"].includes(String(candidate.a))
      && ["wall", "river", "lake"].includes(String(candidate.b));
  };
  return recipe.components.every((component) => component && typeof component === "object"
      && typeof component.id === "string" && ["wall", "river", "lake"].includes(component.structure)
      && Array.isArray(component.ports) && component.ports.every(portIsValid))
    && recipe.separate.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(portIsValid))
    && recipe.requiredContacts.every(contactIsValid) && recipe.forbiddenContacts.every(contactIsValid);
}
