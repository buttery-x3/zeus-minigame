import type { TerrainStructure } from "../types";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, type HexCoord, type HexDirection } from "./hexCoordinates";
import {
  HEX_PATCH_EDGE_CELLS,
  createPatchVariant,
  type HexPatchCell,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";
import { analyzeHexPatchVariant, type TerrainPatchAnalysis, type TerrainPatchComponent } from "./HexTerrainPatchAnalysis";
import type { TerrainConnectionResolution, TerrainResolutionCandidate } from "./TerrainConnectionScenario";

export const TERRAIN_TOPOLOGY_RECIPE_SCHEMA_VERSION = 1;

export type TerrainRecipePort = {
  direction: HexDirection;
  index: number;
  structure: Exclude<TerrainStructure, "open" | "bank">;
};

export type TerrainRecipeComponent = {
  id: string;
  structure: Exclude<TerrainStructure, "open" | "bank">;
  ports: TerrainRecipePort[];
  exactBoundaryPorts?: boolean;
};

export type TerrainRecipeContact = {
  a: Exclude<TerrainStructure, "open" | "bank">;
  b: Exclude<TerrainStructure, "open" | "bank">;
};

export type TerrainTopologyRecipe = {
  schemaVersion: 1;
  id: string;
  name: string;
  notes: string;
  components: TerrainRecipeComponent[];
  separate: [TerrainRecipePort, TerrainRecipePort][];
  requiredContacts: TerrainRecipeContact[];
  forbiddenContacts: TerrainRecipeContact[];
  allowDisconnected: boolean;
  requireOpenCore: boolean;
};

export type TerrainRecipeEvaluation = {
  accepted: boolean;
  reasons: string[];
};

export type TerrainRecipeExperiment = {
  recipe: TerrainTopologyRecipe;
  baseline: HexPatchTileVariant | null;
  accepted: TerrainResolutionCandidate[];
  rejectedCount: number;
  rejectionReasonCounts: Record<string, number>;
  summary: string;
};

export function createTopologyRecipe(name = "Untitled topology recipe"): TerrainTopologyRecipe {
  return {
    schemaVersion: 1,
    id: globalThis.crypto?.randomUUID?.() ?? `recipe-${Date.now().toString(36)}`,
    name,
    notes: "",
    components: [],
    separate: [],
    requiredContacts: [],
    forbiddenContacts: [],
    allowDisconnected: false,
    requireOpenCore: false,
  };
}

export function evaluateTopologyRecipe(variant: HexPatchTileVariant, recipe: TerrainTopologyRecipe): TerrainRecipeEvaluation {
  const analysis = analyzeHexPatchVariant(variant);
  const reasons: string[] = [];
  for (const requirement of recipe.components) {
    const matching = matchingComponents(analysis, requirement.ports, requirement.structure);
    if (matching.length === 0) {
      reasons.push(`${requirement.structure} ports ${describePorts(requirement.ports)} are not connected`);
      continue;
    }
    if (requirement.exactBoundaryPorts && !matching.some((component) => samePorts(component, requirement.ports))) {
      reasons.push(`${requirement.structure} component has additional boundary ports`);
    }
  }
  for (const [a, b] of recipe.separate) {
    const componentA = componentForPort(analysis, a);
    const componentB = componentForPort(analysis, b);
    if (componentA && componentA === componentB) reasons.push(`${describePort(a)} must remain separate from ${describePort(b)}`);
  }
  for (const contact of recipe.requiredContacts) {
    if (!hasContact(analysis, contact)) reasons.push(`${contact.a}/${contact.b} contact is required`);
  }
  for (const contact of recipe.forbiddenContacts) {
    if (hasContact(analysis, contact)) reasons.push(`${contact.a}/${contact.b} contact is forbidden`);
  }
  if (!recipe.allowDisconnected) {
    const disconnected = analysis.disconnectedBoundaryStructures.filter((structure) => structure !== "open" && structure !== "bank");
    if (disconnected.length > 0) reasons.push(`disconnected boundary ${disconnected.join(", ")}`);
  }
  if (recipe.requireOpenCore && variant.cells.get("0,0")?.structure !== "open") reasons.push("open center is required");
  return { accepted: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function runTopologyRecipeExperiment(
  resolution: TerrainConnectionResolution,
  recipe: TerrainTopologyRecipe,
): TerrainRecipeExperiment {
  const accepted: TerrainResolutionCandidate[] = [];
  const rejectionReasonCounts: Record<string, number> = {};
  for (const candidate of resolution.procedural) {
    const evaluation = evaluateTopologyRecipe(candidate.variant, recipe);
    if (evaluation.accepted && candidate.policySafe) {
      accepted.push(candidate);
      continue;
    }
    for (const reason of [...evaluation.reasons, ...candidate.rejectionReasons]) {
      rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] ?? 0) + 1;
    }
  }
  const summary = accepted.length > 0
    ? `${accepted.length} procedural layout${accepted.length === 1 ? "" : "s"} satisfy the recipe; ${new Set(accepted.map((candidate) => candidate.topology.key)).size} topology group${new Set(accepted.map((candidate) => candidate.topology.key)).size === 1 ? "" : "s"}.`
    : `No procedural layout satisfies the recipe. ${topReason(rejectionReasonCounts)}`;
  return {
    recipe: structuredClone(recipe),
    baseline: resolution.generatorFallback,
    accepted,
    rejectedCount: resolution.procedural.length - accepted.length,
    rejectionReasonCounts,
    summary,
  };
}

export function createRecipeCandidateVariant(cells: ReadonlyMap<string, HexPatchCell>) {
  return createPatchVariant("recipe-candidate", "transition", "procedural", 0, new Map(cells));
}

export function transformTopologyRecipe(recipe: TerrainTopologyRecipe, rotation: number, mirror = false) {
  const transformPort = (port: TerrainRecipePort): TerrainRecipePort => {
    const direction = transformDirection(port.direction, rotation, mirror);
    const coord = transformCoord(HEX_PATCH_EDGE_CELLS[port.direction][port.index], rotation, mirror);
    const index = HEX_PATCH_EDGE_CELLS[direction].findIndex((candidate) => candidate.q === coord.q && candidate.r === coord.r);
    if (index < 0) throw new Error(`Transformed port ${direction} has no matching edge cell`);
    return { ...port, direction, index };
  };
  return {
    ...structuredClone(recipe),
    components: recipe.components.map((component) => ({ ...component, ports: component.ports.map(transformPort) })),
    separate: recipe.separate.map(([a, b]) => [transformPort(a), transformPort(b)] as [TerrainRecipePort, TerrainRecipePort]),
  };
}

export function canonicalizeTopologyRecipe(recipe: TerrainTopologyRecipe) {
  const candidates: string[] = [];
  for (let rotation = 0; rotation < 6; rotation += 1) {
    candidates.push(serializeRecipe(transformTopologyRecipe(recipe, rotation, false)));
    candidates.push(serializeRecipe(transformTopologyRecipe(recipe, rotation, true)));
  }
  return candidates.sort()[0];
}

function matchingComponents(analysis: TerrainPatchAnalysis, ports: readonly TerrainRecipePort[], structure: TerrainStructure) {
  return analysis.components.filter((component) => component.structure === structure && ports.every((port) => componentHasPort(component, port)));
}

function componentForPort(analysis: TerrainPatchAnalysis, port: TerrainRecipePort) {
  return analysis.components.find((component) => component.structure === port.structure && componentHasPort(component, port));
}

function componentHasPort(component: TerrainPatchComponent, port: TerrainRecipePort) {
  return component.boundaryPorts.some((candidate) => candidate.direction === port.direction && candidate.index === port.index);
}

function samePorts(component: TerrainPatchComponent, ports: readonly TerrainRecipePort[]) {
  const actual = component.boundaryPorts.map((port) => `${port.direction}:${port.index}`).sort();
  const expected = ports.map((port) => `${port.direction}:${port.index}`).sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasContact(analysis: TerrainPatchAnalysis, contact: TerrainRecipeContact) {
  return analysis.contacts.some((candidate) => {
    const structures = [candidate.structureA, candidate.structureB];
    return structures.includes(contact.a) && structures.includes(contact.b);
  });
}

function transformDirection(direction: HexDirection, rotation: number, mirror: boolean) {
  const transformed = transformCoord(HEX_PATCH_EDGE_CELLS[direction][1], rotation, mirror);
  const match = HEX_DIRECTION_ORDER.find((candidate) => {
    const midpoint = HEX_PATCH_EDGE_CELLS[candidate][1];
    return midpoint.q === transformed.q && midpoint.r === transformed.r;
  });
  if (!match) throw new Error(`Unable to transform direction ${direction}`);
  return match;
}

function transformCoord(source: HexCoord, rotation: number, mirror: boolean) {
  let q = source.q;
  let r = source.r;
  if (mirror) r = -q - r;
  for (let index = 0; index < rotation; index += 1) [q, r] = [-r, q + r];
  return { q, r };
}

function serializeRecipe(recipe: TerrainTopologyRecipe) {
  const componentKey = recipe.components.map((component) => `${component.structure}:${component.ports.map(describePort).sort().join(",")}:${Boolean(component.exactBoundaryPorts)}`).sort();
  const separateKey = recipe.separate.map(([a, b]) => [describePort(a), describePort(b)].sort().join("!")).sort();
  const contactKey = (contacts: readonly TerrainRecipeContact[]) => contacts.map((contact) => [contact.a, contact.b].sort().join("/")).sort();
  return JSON.stringify({ componentKey, separateKey, required: contactKey(recipe.requiredContacts), forbidden: contactKey(recipe.forbiddenContacts), allowDisconnected: recipe.allowDisconnected, requireOpenCore: recipe.requireOpenCore });
}

function describePorts(ports: readonly TerrainRecipePort[]) {
  return ports.map(describePort).join(" + ");
}

function describePort(port: TerrainRecipePort) {
  return `${port.structure} ${port.direction.toUpperCase()}-${port.index + 1}`;
}

function topReason(counts: Readonly<Record<string, number>>) {
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? `Most candidates failed because ${top[0]}.` : "No candidate reached recipe evaluation.";
}
