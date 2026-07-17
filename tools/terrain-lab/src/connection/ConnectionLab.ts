import { createHexPatchCatalogEntries } from "../../../../src/world/HexTerrainCatalog";
import { HEX_DIRECTION_ORDER, type HexDirection } from "../../../../src/world/hexCoordinates";
import type { HexPatchCatalogEntry, HexPatchTileVariant } from "../../../../src/world/HexTerrainCatalog";
import {
  createTerrainConnectionScenario,
  resolveTerrainConnectionScenario,
  type TerrainConnectionResolution,
  type TerrainConnectionScenario,
  type TerrainResolutionCandidate,
  type TerrainResolutionDecision,
} from "../../../../src/world/TerrainConnectionScenario";
import { inspectTerrainVariant } from "../../../../src/world/TerrainInspectionSnapshot";
import { createTerrainTopologySignature } from "../../../../src/world/TerrainTopologySignature";
import type { TerrainRecipeExperiment } from "../../../../src/world/TerrainTopologyRecipe";
import { createBlankTerrainPatchDocument, terrainPatchDocumentFromVariant, type TerrainPatchDocument } from "../../../../src/world/TerrainPatchDocument";
import { applyTerrainPatchBoundary } from "../../../../src/world/TerrainPatchEditing";
import { clear, element, labeledControl } from "../dom";
import { createPatchSvg } from "../patch/PatchSvg";
import type { ScenarioStore } from "../scenarios/ScenarioStore";
import { RecipeExperimentPanel } from "./RecipeExperimentPanel";

export class ConnectionLab {
  readonly root = element("div", "connection-view workspace-view");
  private readonly entries = createHexPatchCatalogEntries();
  private readonly catalogVariants = this.entries.flatMap((entry) => entry.variants);
  private readonly dynamicVariants = new Map<string, HexPatchTileVariant>();
  private readonly editor = element("section", "connection-editor");
  private readonly results = element("main", "connection-results");
  private readonly recipePanel: RecipeExperimentPanel;
  private scenario = createTerrainConnectionScenario();
  private resolution: TerrainConnectionResolution | null = null;
  private recipeExperiment: TerrainRecipeExperiment | null = null;

  constructor(private readonly store: ScenarioStore, private readonly openAuthor: (document: TerrainPatchDocument) => void = () => undefined) {
    this.recipePanel = new RecipeExperimentPanel(store);
  }

  mount() {
    this.root.append(this.editor, this.results);
    this.render();
    return this.root;
  }

  loadScenario(scenario: TerrainConnectionScenario) {
    this.scenario = structuredClone(scenario);
    this.resolution = null;
    this.recipeExperiment = null;
    this.render();
  }

  loadNeighborRing(neighbors: Partial<Record<HexDirection, HexPatchTileVariant>>, name: string, seed: number) {
    const scenario = createTerrainConnectionScenario(name, seed);
    Object.values(neighbors).forEach((variant) => { if (variant) this.dynamicVariants.set(variant.id, variant); });
    scenario.neighbors = Object.fromEntries(Object.entries(neighbors).map(([direction, variant]) => [direction, variant?.id]));
    this.loadScenario(scenario);
  }

  private render() {
    this.renderEditor();
    this.renderResults();
  }

  private renderEditor() {
    clear(this.editor);
    const heading = element("div", "connection-heading");
    heading.append(element("p", "eyebrow", "Local six-neighbor scenario"), element("h2", undefined, "Connection Lab"));
    const library = this.createLibraryControls();
    const ring = element("div", "connection-ring");
    ring.append(element("div", "connection-center", "Resolve here"));
    for (const direction of HEX_DIRECTION_ORDER) ring.append(this.createNeighborSlot(direction));
    const scenarioControls = element("div", "connection-scenario-controls");
    const name = document.createElement("input");
    name.value = this.scenario.name;
    name.setAttribute("aria-label", "Scenario name");
    name.addEventListener("input", () => { this.scenario.name = name.value; });
    const seed = document.createElement("input");
    seed.type = "number";
    seed.value = String(this.scenario.seed);
    seed.setAttribute("aria-label", "Connection seed");
    seed.addEventListener("change", () => { this.scenario.seed = Number(seed.value) || 0; this.resolution = null; });
    const resolve = button("Resolve", () => {
      this.resolution = resolveTerrainConnectionScenario(this.scenario, this.allVariants());
      this.recipeExperiment = null;
      this.render();
    }, "primary");
    resolve.dataset.action = "resolve-connection";
    const save = button("Save draft", () => {
      this.scenario = this.store.saveScenario(this.scenario);
      this.renderEditor();
    });
    scenarioControls.append(labeledControl("Scenario", name), labeledControl("Seed", seed), resolve, save);
    const notes = document.createElement("textarea");
    notes.value = this.scenario.notes;
    notes.placeholder = "Scenario notes";
    notes.setAttribute("aria-label", "Scenario notes");
    notes.addEventListener("input", () => { this.scenario.notes = notes.value; });
    this.editor.append(heading, library, scenarioControls, ring, notes);
  }

  private createLibraryControls() {
    const row = element("div", "scenario-library");
    const saved = this.store.getScenarios();
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Saved scenarios");
    select.append(new Option("Saved drafts", ""));
    saved.forEach((scenario) => select.append(new Option(scenario.name, scenario.id)));
    select.addEventListener("change", () => {
      const scenario = saved.find((candidate) => candidate.id === select.value);
      if (scenario) this.loadScenario(scenario);
    });
    row.append(
      select,
      button("New", () => this.loadScenario(createTerrainConnectionScenario())),
      button("Duplicate", () => {
        const copy = createTerrainConnectionScenario(`${this.scenario.name} copy`, this.scenario.seed);
        copy.neighbors = { ...this.scenario.neighbors };
        copy.notes = this.scenario.notes;
        this.loadScenario(copy);
      }),
      button("Delete", () => { this.store.deleteScenario(this.scenario.id); this.loadScenario(createTerrainConnectionScenario()); }),
    );
    return row;
  }

  private createNeighborSlot(direction: HexDirection) {
    const slot = element("div", "neighbor-slot");
    slot.dataset.direction = direction;
    const select = this.createVariantSelect(this.scenario.neighbors[direction] ?? "");
    select.setAttribute("aria-label", `${direction.toUpperCase()} neighbor`);
    select.addEventListener("change", () => {
      if (select.value) this.scenario.neighbors[direction] = select.value;
      else delete this.scenario.neighbors[direction];
      this.resolution = null;
      this.render();
    });
    const actions = element("div", "neighbor-actions");
    actions.append(
      button("Rotate", () => { this.rotateNeighbor(direction); }),
      button("Clear", () => { delete this.scenario.neighbors[direction]; this.resolution = null; this.render(); }),
    );
    slot.append(element("strong", undefined, direction.toUpperCase()), select, actions);
    return slot;
  }

  private createVariantSelect(selected: string) {
    const select = document.createElement("select");
    select.append(new Option("Unconstrained", ""));
    for (const entry of this.entries) {
      const group = document.createElement("optgroup");
      group.label = entry.definition.id;
      for (const variant of entry.variants) {
        const option = new Option(variant.id.replace(`${entry.definition.id}.`, "orientation "), variant.id);
        option.selected = variant.id === selected;
        group.append(option);
      }
      select.append(group);
    }
    if (this.dynamicVariants.size > 0) {
      const group = document.createElement("optgroup");
      group.label = "Generated procedural patches";
      for (const variant of this.dynamicVariants.values()) {
        const option = new Option(variant.id, variant.id);
        option.selected = variant.id === selected;
        group.append(option);
      }
      select.append(group);
    }
    return select;
  }

  private rotateNeighbor(direction: HexDirection) {
    const id = this.scenario.neighbors[direction];
    const entry = this.entries.find((candidate) => candidate.variants.some((variant) => variant.id === id));
    if (!entry) return;
    const index = entry.variants.findIndex((variant) => variant.id === id);
    this.scenario.neighbors[direction] = entry.variants[(index + 1) % entry.variants.length].id;
    this.resolution = null;
    this.render();
  }

  private renderResults() {
    clear(this.results);
    if (!this.resolution) {
      this.results.append(
        element("h2", undefined, "Resolution results"),
        element("p", "empty-state", "Place any known neighbors and resolve. Empty slots remain unconstrained for authored candidates; the current procedural fallback fills unspecified directions using its existing boundary rules."),
      );
      return;
    }
    const resolution = this.resolution;
    const summary = element("section", "resolution-summary detail-panel");
    const seamProblems = resolution.seams.filter((seam) => seam.state.includes("mismatch")).length;
    summary.append(
      element("h2", undefined, "Resolution results"),
      element("p", undefined, `${resolution.authored.length} authored candidates · ${resolution.procedural.length} procedural layouts · ${resolution.proceduralGroups.length} topology groups`),
      element("code", "boundary-key", resolution.canonicalBoundaryKey),
      this.createMetricRow("Seam problems", seamProblems, "Policy-safe authored", resolution.authored.filter((candidate) => candidate.policySafe).length, "Assignments searched", resolution.attemptedAssignments),
    );
    this.results.append(summary, this.createDecisionPanel(), this.recipePanel.render(
      resolution,
      this.scenario,
      this.allVariants(),
      (experiment) => { this.recipeExperiment = experiment; this.renderResults(); },
    ));
    this.results.append(this.createAuthorResolutionPanel(resolution));
    if (this.recipeExperiment) this.results.append(this.createRecipeResults(this.recipeExperiment));
    if (resolution.generatorFallback) {
      this.results.append(this.createCandidateSection("Current procedural fallback", [{
        variant: resolution.generatorFallback,
        topology: createTerrainTopologySignature(resolution.generatorFallback),
        policySafe: true,
        rejectionReasons: [],
      }]));
    }
    this.results.append(this.createCandidateSection("Compatible authored candidates", resolution.authored));
    const groups = element("section", "candidate-section");
    groups.append(element("h3", undefined, "Procedural topology groups"));
    const grid = element("div", "candidate-grid");
    for (const group of resolution.proceduralGroups) {
      const representative = group.candidates[0];
      const card = this.createCandidateCard(representative);
      card.prepend(element("span", "candidate-count", `${group.candidates.length} layout${group.candidates.length === 1 ? "" : "s"}`));
      grid.append(card);
    }
    groups.append(grid);
    this.results.append(groups);
  }

  private createDecisionPanel() {
    const panel = element("section", "decision-panel detail-panel");
    panel.append(element("h3", undefined, "Decision"));
    const existing = this.store.getDecisions().find((decision) => decision.scenarioId === this.scenario.id);
    const classification = selectControl(["accepted", "rejected", "needs-recipe", "intentionally-impossible"], existing?.classification ?? "accepted", "Decision classification");
    const policy = selectControl(["either", "authored-required", "procedural-allowed", "procedural-rejected"], existing?.policy ?? "either", "Resolution policy");
    const notes = document.createElement("input");
    notes.value = existing?.notes ?? "";
    notes.placeholder = "Decision notes";
    notes.setAttribute("aria-label", "Decision notes");
    const save = button("Save decision", () => {
      this.scenario = this.store.saveScenario(this.scenario);
      this.store.saveDecision({
        scenarioId: this.scenario.id,
        classification: classification.value as TerrainResolutionDecision["classification"],
        policy: policy.value as TerrainResolutionDecision["policy"],
        notes: notes.value,
        updatedAt: new Date().toISOString(),
      });
      save.textContent = "Decision saved";
    }, "primary");
    panel.append(classification, policy, notes, save);
    return panel;
  }

  private createAuthorResolutionPanel(resolution: TerrainConnectionResolution) {
    const panel = element("section", "author-resolution-panel detail-panel");
    const copy = element("div");
    copy.append(element("h3", undefined, "Author a resolution"), element("p", undefined, "Open this exact boundary in the 19-cell Patch Author. Required edge cells will be pre-painted and locked."));
    panel.append(copy, button("Author resolution", () => {
      const category = categoryForConstraints(resolution.constraints);
      let draft = createBlankTerrainPatchDocument(category);
      const slug = (this.scenario.name || "connection-resolution").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "") || "connection-resolution";
      draft.id = `patch.${category}.${slug}`;
      draft.displayName = `${this.scenario.name || "Connection"} resolution`;
      draft.selectionGroup = draft.id;
      draft.topology = category === "open" ? "open" : "mixed";
      draft.source = { kind: "scenario", reference: this.scenario.id };
      draft.notes = `Authored from Connection Lab scenario ${this.scenario.name || this.scenario.id}.`;
      draft = applyTerrainPatchBoundary(draft, resolution.constraints, true);
      this.openAuthor(draft);
    }, "primary"));
    return panel;
  }

  private createRecipeResults(experiment: TerrainRecipeExperiment) {
    const section = element("section", "recipe-results candidate-section");
    section.append(element("h3", undefined, "Experimental recipe result"));
    section.append(element("p", experiment.accepted.length > 0 ? "good" : "warning", experiment.summary));
    if (experiment.accepted.length > 0) {
      const grid = element("div", "candidate-grid");
      experiment.accepted.slice(0, 24).forEach((candidate) => grid.append(this.createCandidateCard(candidate)));
      section.append(grid);
    } else {
      const reasons = element("ul", "recipe-reasons");
      Object.entries(experiment.rejectionReasonCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .forEach(([reason, count]) => reasons.append(element("li", undefined, `${reason}: ${count}`)));
      section.append(reasons);
    }
    return section;
  }

  private createCandidateSection(title: string, candidates: readonly TerrainResolutionCandidate[]) {
    const section = element("section", "candidate-section");
    section.append(element("h3", undefined, title));
    const grid = element("div", "candidate-grid");
    candidates.slice(0, 48).forEach((candidate) => grid.append(this.createCandidateCard(candidate)));
    if (candidates.length > 48) grid.append(element("p", "empty-state", `${candidates.length - 48} additional orientations omitted from this overview.`));
    section.append(grid);
    return section;
  }

  private createCandidateCard(candidate: TerrainResolutionCandidate) {
    const card = element("article", `candidate-card${candidate.policySafe ? "" : " rejected"}`);
    const preview = element("div", "candidate-preview");
    preview.append(createPatchSvg(inspectTerrainVariant(candidate.variant), { labels: false, components: true }));
    card.append(
      element("strong", undefined, candidate.variant.id),
      element("span", "candidate-status", candidate.policySafe ? "Policy safe" : `Rejected: ${candidate.rejectionReasons.join(", ")}`),
      preview,
      element("code", "topology-key", candidate.topology.key),
      button("Promote to draft", () => this.openAuthor(terrainPatchDocumentFromVariant(candidate.variant))),
    );
    return card;
  }

  private createMetricRow(...values: (string | number)[]) {
    const row = element("div", "metric-row");
    for (let index = 0; index < values.length; index += 2) {
      const item = element("div", "metric");
      item.append(element("strong", undefined, String(values[index + 1])), element("span", undefined, String(values[index])));
      row.append(item);
    }
    return row;
  }

  private allVariants() {
    const byId = new Map(this.catalogVariants.map((variant) => [variant.id, variant]));
    this.dynamicVariants.forEach((variant, id) => byId.set(id, variant));
    return [...byId.values()];
  }
}

function categoryForConstraints(constraints: TerrainConnectionResolution["constraints"]): TerrainPatchDocument["category"] {
  const kinds = new Set(Object.values(constraints).flat().filter((kind) => kind !== "open"));
  if (kinds.size > 1) return "transition";
  if (kinds.has("river")) return "river";
  if (kinds.has("lake")) return "lake";
  if (kinds.has("closed")) return "cliff";
  return "open";
}

function button(label: string, onClick: () => void, className?: string) {
  const control = element("button", className, label);
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}

function selectControl(values: readonly string[], selected: string, label: string) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  values.forEach((value) => select.append(new Option(value, value, value === selected, value === selected)));
  return select;
}
