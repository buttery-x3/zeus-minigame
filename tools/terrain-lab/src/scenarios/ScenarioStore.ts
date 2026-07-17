import type {
  TerrainConnectionScenario,
  TerrainResolutionDecision,
} from "../../../../src/world/TerrainConnectionScenario";
import type { TerrainTopologyRecipe } from "../../../../src/world/TerrainTopologyRecipe";

const SCENARIO_KEY = "zeus.terrain-lab.scenarios.v1";
const DECISION_KEY = "zeus.terrain-lab.decisions.v1";
const RECIPE_KEY = "zeus.terrain-lab.recipes.v1";

export class ScenarioStore {
  private scenarios = readArray<TerrainConnectionScenario>(SCENARIO_KEY);
  private decisions = readArray<TerrainResolutionDecision>(DECISION_KEY);
  private recipes = readArray<TerrainTopologyRecipe>(RECIPE_KEY);
  private readonly listeners = new Set<() => void>();

  getScenarios() {
    return structuredClone(this.scenarios).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getDecisions() {
    return structuredClone(this.decisions);
  }

  getRecipes() {
    return structuredClone(this.recipes).sort((a, b) => a.name.localeCompare(b.name));
  }

  saveScenario(scenario: TerrainConnectionScenario) {
    const saved = { ...scenario, neighbors: { ...scenario.neighbors }, updatedAt: new Date().toISOString() };
    const index = this.scenarios.findIndex((candidate) => candidate.id === saved.id);
    if (index >= 0) this.scenarios[index] = saved;
    else this.scenarios.push(saved);
    this.persist();
    return structuredClone(saved);
  }

  deleteScenario(id: string) {
    this.scenarios = this.scenarios.filter((scenario) => scenario.id !== id);
    this.decisions = this.decisions.filter((decision) => decision.scenarioId !== id);
    this.persist();
  }

  saveDecision(decision: TerrainResolutionDecision) {
    const saved = { ...decision, updatedAt: new Date().toISOString() };
    const index = this.decisions.findIndex((candidate) => candidate.scenarioId === saved.scenarioId);
    if (index >= 0) this.decisions[index] = saved;
    else this.decisions.push(saved);
    this.persist();
    return structuredClone(saved);
  }

  saveRecipe(recipe: TerrainTopologyRecipe) {
    const saved = structuredClone(recipe);
    const index = this.recipes.findIndex((candidate) => candidate.id === saved.id);
    if (index >= 0) this.recipes[index] = saved;
    else this.recipes.push(saved);
    this.persist();
    return structuredClone(saved);
  }

  deleteRecipe(id: string) {
    this.recipes = this.recipes.filter((recipe) => recipe.id !== id);
    this.persist();
  }

  replaceFromFixture(
    entries: readonly { scenario: TerrainConnectionScenario; decision: TerrainResolutionDecision }[],
    recipes: readonly TerrainTopologyRecipe[] = [],
  ) {
    for (const entry of entries) {
      if (entry.scenario.schemaVersion !== 1 || !entry.scenario.id || !entry.decision?.classification) continue;
      const scenarioIndex = this.scenarios.findIndex((candidate) => candidate.id === entry.scenario.id);
      if (scenarioIndex >= 0) this.scenarios[scenarioIndex] = structuredClone(entry.scenario);
      else this.scenarios.push(structuredClone(entry.scenario));
      const decisionIndex = this.decisions.findIndex((candidate) => candidate.scenarioId === entry.scenario.id);
      if (decisionIndex >= 0) this.decisions[decisionIndex] = structuredClone(entry.decision);
      else this.decisions.push(structuredClone(entry.decision));
    }
    for (const recipe of recipes) {
      const index = this.recipes.findIndex((candidate) => candidate.id === recipe.id);
      if (index >= 0) this.recipes[index] = structuredClone(recipe);
      else this.recipes.push(structuredClone(recipe));
    }
    this.persist();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist() {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(this.scenarios));
    localStorage.setItem(DECISION_KEY, JSON.stringify(this.decisions));
    localStorage.setItem(RECIPE_KEY, JSON.stringify(this.recipes));
    this.listeners.forEach((listener) => listener());
  }
}

function readArray<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
