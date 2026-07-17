import { HEX_DIRECTION_ORDER } from "../../../../src/world/hexCoordinates";
import { resolveProceduralBoundaryEdges } from "../../../../src/world/ProceduralTerrainPatch";
import { resolveTerrainConnectionScenario, type TerrainConnectionResolution, type TerrainConnectionScenario } from "../../../../src/world/TerrainConnectionScenario";
import type { HexPatchTileVariant } from "../../../../src/world/HexTerrainPatch";
import { createTerrainTopologySignature } from "../../../../src/world/TerrainTopologySignature";
import {
  createTopologyRecipe,
  runTopologyRecipeExperiment,
  type TerrainRecipeExperiment,
  type TerrainRecipePort,
  type TerrainTopologyRecipe,
} from "../../../../src/world/TerrainTopologyRecipe";
import { clear, element, labeledControl } from "../dom";
import type { ScenarioStore } from "../scenarios/ScenarioStore";

type RecipeAction = "connect" | "separate" | "terminate" | "require-contact" | "forbid-contact";

export class RecipeExperimentPanel {
  private recipe: TerrainTopologyRecipe | null = null;
  private batchSummary = "";

  constructor(private readonly store: ScenarioStore) {}

  render(
    resolution: TerrainConnectionResolution,
    scenario: TerrainConnectionScenario,
    variants: readonly HexPatchTileVariant[],
    onExperiment: (experiment: TerrainRecipeExperiment) => void,
  ) {
    const panel = document.createElement("details");
    panel.className = "recipe-experiment detail-panel";
    panel.open = true;
    panel.append(element("summary", undefined, "Topology recipe experiment"));
    const content = element("div", "recipe-experiment-content");
    const explainer = element("p", "recipe-explainer", "Constrain how visible feature ports connect, then compare the current fallback with recipe-valid procedural layouts. This does not change world generation.");
    const savedRow = this.createSavedRecipeRow(resolution, onExperiment);
    const ports = availablePorts(resolution);
    if (ports.length === 0) {
      content.append(explainer, savedRow, element("p", "empty-state", "This boundary exposes no wall, river, or lake ports to constrain."));
      panel.append(content);
      return panel;
    }
    const controls = element("div", "recipe-controls");
    const name = document.createElement("input");
    name.value = this.recipe?.name ?? `${scenario.name} recipe`;
    name.setAttribute("aria-label", "Recipe name");
    const action = select(["connect", "separate", "terminate", "require-contact", "forbid-contact"], "Recipe action") as HTMLSelectElement;
    const first = portSelect(ports, "First recipe port");
    const second = portSelect(ports, "Second recipe port");
    if (ports.length > 1) second.selectedIndex = 1;
    action.addEventListener("change", () => { second.disabled = action.value === "terminate"; });
    const allowDisconnected = checkbox("Allow disconnected boundary components", this.recipe?.allowDisconnected ?? false);
    const requireOpen = checkbox("Require an open center", this.recipe?.requireOpenCore ?? false);
    const run = button("Run experiment", () => {
      const recipe = buildRecipe(name.value, action.value as RecipeAction, ports[Number(first.value)], ports[Number(second.value)], allowDisconnected.input.checked, requireOpen.input.checked, this.recipe?.id);
      this.recipe = recipe;
      onExperiment(runTopologyRecipeExperiment(resolution, recipe));
    }, "primary");
    const save = button("Save recipe", () => {
      const recipe = buildRecipe(name.value, action.value as RecipeAction, ports[Number(first.value)], ports[Number(second.value)], allowDisconnected.input.checked, requireOpen.input.checked, this.recipe?.id);
      this.recipe = this.store.saveRecipe(recipe);
      save.textContent = "Recipe saved";
    });
    const batch = button("Run saved scenarios", () => {
      const recipe = this.recipe ?? buildRecipe(name.value, action.value as RecipeAction, ports[Number(first.value)], ports[Number(second.value)], allowDisconnected.input.checked, requireOpen.input.checked);
      this.recipe = recipe;
      const reports = this.store.getScenarios().map((savedScenario) => {
        const savedResolution = resolveTerrainConnectionScenario(savedScenario, variants);
        return runTopologyRecipeExperiment(savedResolution, recipe);
      });
      const matching = reports.filter((report) => report.accepted.length > 0).length;
      const changed = reports.filter((report) => report.baseline && report.accepted.length > 0
        && !report.accepted.some((candidate) => candidate.topology.key === createTerrainTopologySignature(report.baseline!).key)).length;
      this.batchSummary = `${reports.length} saved scenarios checked · ${matching} have recipe-valid layouts · ${reports.length - matching} have no matching realization${changed > 0 ? ` · ${changed} differ from baseline` : ""}.`;
      clear(batchResult);
      batchResult.append(element("p", matching === reports.length ? "good" : "warning", this.batchSummary));
    });
    controls.append(
      labeledControl("Recipe", name),
      labeledControl("Behavior", action),
      labeledControl("Port A", first),
      labeledControl("Port B", second),
      allowDisconnected.label,
      requireOpen.label,
      run,
      save,
      batch,
    );
    const hint = element("p", "recipe-hint", "Connect joins same-feature ports into one component. If the selected ports use different features, Connect requires an internal contact instead.");
    const batchResult = element("div", "recipe-batch-result");
    if (this.batchSummary) batchResult.append(element("p", "warning", this.batchSummary));
    content.append(explainer, savedRow, controls, hint, batchResult);
    panel.append(content);
    return panel;
  }

  private createSavedRecipeRow(resolution: TerrainConnectionResolution, onExperiment: (experiment: TerrainRecipeExperiment) => void) {
    const row = element("div", "saved-recipe-row");
    const recipes = this.store.getRecipes();
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Saved topology recipes");
    select.append(new Option("Saved recipes", ""));
    recipes.forEach((recipe) => select.append(new Option(recipe.name, recipe.id)));
    row.append(
      select,
      button("Load and run", () => {
        const selected = recipes.find((recipe) => recipe.id === select.value);
        if (!selected) return;
        this.recipe = selected;
        onExperiment(runTopologyRecipeExperiment(resolution, selected));
      }),
      button("Delete recipe", () => {
        if (!select.value) return;
        this.store.deleteRecipe(select.value);
        if (this.recipe?.id === select.value) this.recipe = null;
        select.selectedIndex = 0;
      }),
    );
    return row;
  }
}

function availablePorts(resolution: TerrainConnectionResolution) {
  const resolved = resolveProceduralBoundaryEdges(resolution.constraints);
  if (!resolved.ok) return [];
  const ports: TerrainRecipePort[] = [];
  for (const direction of HEX_DIRECTION_ORDER) {
    resolved.edges[direction].forEach((kind, index) => {
      const structure = kind === "closed" ? "wall" : kind === "river" ? "river" : kind === "lake" ? "lake" : null;
      if (structure) ports.push({ direction, index, structure });
    });
  }
  return ports;
}

function buildRecipe(
  name: string,
  action: RecipeAction,
  first: TerrainRecipePort,
  second: TerrainRecipePort,
  allowDisconnected: boolean,
  requireOpenCore: boolean,
  existingId?: string,
) {
  const recipe = createTopologyRecipe(name || "Untitled topology recipe");
  if (existingId) recipe.id = existingId;
  recipe.allowDisconnected = allowDisconnected;
  recipe.requireOpenCore = requireOpenCore;
  if (action === "terminate") {
    recipe.components.push({ id: `${first.structure}-terminal`, structure: first.structure, ports: [first], exactBoundaryPorts: true });
  } else if (action === "separate") {
    recipe.separate.push([first, second]);
  } else if (action === "require-contact" || (action === "connect" && first.structure !== second.structure)) {
    recipe.requiredContacts.push({ a: first.structure, b: second.structure });
  } else if (action === "forbid-contact") {
    recipe.forbiddenContacts.push({ a: first.structure, b: second.structure });
  } else {
    recipe.components.push({ id: `${first.structure}-connection`, structure: first.structure, ports: [first, second] });
  }
  return recipe;
}

function portSelect(ports: readonly TerrainRecipePort[], label: string) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  ports.forEach((port, index) => select.append(new Option(`${port.structure} ${port.direction.toUpperCase()}-${port.index + 1}`, String(index))));
  return select;
}

function select(values: readonly string[], label: string) {
  const control = document.createElement("select");
  control.setAttribute("aria-label", label);
  values.forEach((value) => control.append(new Option(value.replace("-", " "), value)));
  return control;
}

function checkbox(labelText: string, checked: boolean) {
  const label = element("label", "check-field recipe-check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  label.append(input, document.createTextNode(labelText));
  return { label, input };
}

function button(label: string, onClick: () => void, className?: string) {
  const control = element("button", className, label);
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}
