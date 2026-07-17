import { createHexPatchTileCatalog } from "../../../../src/world/HexTerrainCatalog";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey } from "../../../../src/world/hexCoordinates";
import type { HexPatchTileVariant } from "../../../../src/world/HexTerrainPatch";
import { patchVariantsCanNeighbor } from "../../../../src/world/HexTerrainRules";
import { collectPatchBoundaryConstraints } from "../../../../src/world/RollingTerrainPatchSelection";
import {
  enumerateReachableConnectionBoundaries,
  scenarioFromCoverageWitness,
  type ReachableBoundaryWitness,
} from "../../../../src/world/TerrainConnectionCoverage";
import {
  auditTerrainDecisionFixture,
  createDecisionFixture,
  terrainDecisionFixtureIsValid,
} from "../../../../src/world/TerrainDecisionFixture";
import {
  resolveTerrainConnectionScenario,
  type TerrainConnectionScenario,
  type TerrainResolutionDecision,
} from "../../../../src/world/TerrainConnectionScenario";
import { synthesizeProceduralPatch } from "../../../../src/world/ProceduralTerrainPatch";
import { createTerrainTopologySignature } from "../../../../src/world/TerrainTopologySignature";
import { clear, element } from "../dom";
import type { ScenarioStore } from "../scenarios/ScenarioStore";

type CoverageRow = {
  witness: ReachableBoundaryWitness;
  authored: number;
  procedural: boolean;
  topologyCount: number;
  decision?: TerrainResolutionDecision;
};

export class CoverageDashboard {
  readonly root = element("div", "coverage-view workspace-view");
  private readonly variants = createHexPatchTileCatalog();
  private rows: CoverageRow[] = [];
  private truncated = false;
  private search = "";
  private filter = "all";

  constructor(
    private readonly store: ScenarioStore,
    private readonly openScenario: (scenario: TerrainConnectionScenario) => void,
  ) {
    store.subscribe(() => this.render());
  }

  mount() {
    this.render();
    return this.root;
  }

  private render() {
    clear(this.root);
    const header = element("header", "coverage-header");
    const identity = element("div");
    identity.append(element("p", "eyebrow", "Canonical local grammar"), element("h2", undefined, "Decision and Coverage Matrix"));
    const controls = element("div", "coverage-actions");
    controls.append(
      button("Generate coverage", () => this.generateCoverage(), "primary"),
      button("Export decisions", () => this.exportDecisions()),
      this.createImportControl(),
    );
    header.append(identity, controls);
    this.root.append(header);
    if (this.rows.length === 0) {
      this.root.append(element("p", "empty-state coverage-empty", "Generate a canonical coverage sample from compatible authored neighbor rings. Saved decisions are included automatically."));
      return;
    }
    this.root.append(this.createSummary(), this.createFilters(), this.createTable());
  }

  private generateCoverage() {
    const enumeration = enumerateReachableConnectionBoundaries(this.variants, 240);
    this.truncated = enumeration.truncated;
    const decisionsByCanonical = this.decisionsByCanonicalKey();
    this.rows = enumeration.witnesses.map((witness) => {
      const scenario = scenarioFromCoverageWitness(witness);
      const { constraints, committed } = constraintsForScenario(scenario, this.variants);
      const authored = this.variants.filter((variant) => matchesNeighbors(variant, committed));
      const procedural = synthesizeProceduralPatch(constraints, scenario.seed, { preferFastTermination: true });
      const topologyKeys = new Set(authored.map((variant) => createTerrainTopologySignature(variant).key));
      if (procedural.ok) topologyKeys.add(createTerrainTopologySignature(procedural.variant).key);
      return {
        witness,
        authored: authored.length,
        procedural: procedural.ok,
        topologyCount: topologyKeys.size,
        decision: decisionsByCanonical.get(witness.canonicalKey),
      };
    });
    this.render();
  }

  private decisionsByCanonicalKey() {
    const decisions = new Map(this.store.getDecisions().map((decision) => [decision.scenarioId, decision]));
    const byCanonical = new Map<string, TerrainResolutionDecision>();
    for (const scenario of this.store.getScenarios()) {
      const decision = decisions.get(scenario.id);
      if (!decision) continue;
      const resolution = resolveTerrainConnectionScenario(scenario, this.variants);
      byCanonical.set(resolution.canonicalBoundaryKey, decision);
    }
    return byCanonical;
  }

  private createSummary() {
    const summary = element("section", "coverage-summary");
    const counts = {
      both: this.rows.filter((row) => row.authored > 0 && row.procedural).length,
      authored: this.rows.filter((row) => row.authored > 0 && !row.procedural).length,
      procedural: this.rows.filter((row) => row.authored === 0 && row.procedural).length,
      unresolved: this.rows.filter((row) => row.authored === 0 && !row.procedural).length,
      conflicting: this.rows.filter((row) => row.topologyCount > 1).length,
      classified: this.rows.filter((row) => row.decision).length,
    };
    for (const [label, value] of Object.entries(counts)) {
      const item = element("div", "coverage-stat");
      item.append(element("strong", undefined, String(value)), element("span", undefined, label));
      summary.append(item);
    }
    if (this.truncated) summary.append(element("p", "warning", "Coverage reached the 240-situation review limit; results are a deterministic canonical sample."));
    return summary;
  }

  private createFilters() {
    const filters = element("div", "coverage-filters");
    const search = document.createElement("input");
    search.type = "search";
    search.value = this.search;
    search.placeholder = "Boundary key or decision notes";
    search.setAttribute("aria-label", "Search coverage");
    search.addEventListener("input", () => { this.search = search.value.toLowerCase(); this.render(); });
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Coverage filter");
    ["all", "both", "authored-only", "procedural-only", "unresolved", "conflicting", "unclassified"].forEach((value) => select.append(new Option(value, value, value === this.filter, value === this.filter)));
    select.addEventListener("change", () => { this.filter = select.value; this.render(); });
    filters.append(search, select);
    return filters;
  }

  private createTable() {
    const wrapper = element("div", "coverage-table-wrap");
    const table = element("table", "coverage-table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Canonical boundary", "Authored", "Procedural", "Topologies", "Decision", ""].forEach((label) => headRow.append(element("th", undefined, label)));
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const row of this.filteredRows()) {
      const tr = document.createElement("tr");
      const boundary = element("code", "coverage-key", row.witness.canonicalKey);
      const open = button("Open in lab", () => this.openScenario(scenarioFromCoverageWitness(row.witness)));
      [boundary, String(row.authored), row.procedural ? "yes" : "no", String(row.topologyCount), row.decision?.classification ?? "unclassified", open]
        .forEach((value) => {
          const cell = document.createElement("td");
          cell.append(typeof value === "string" ? document.createTextNode(value) : value);
          tr.append(cell);
        });
      if (row.authored === 0 && !row.procedural) tr.classList.add("unresolved");
      if (row.topologyCount > 1) tr.classList.add("conflicting");
      body.append(tr);
    }
    table.append(head, body);
    wrapper.append(table);
    return wrapper;
  }

  private filteredRows() {
    return this.rows.filter((row) => {
      const searchable = `${row.witness.canonicalKey} ${row.decision?.classification ?? ""} ${row.decision?.notes ?? ""}`.toLowerCase();
      if (this.search && !searchable.includes(this.search)) return false;
      if (this.filter === "both") return row.authored > 0 && row.procedural;
      if (this.filter === "authored-only") return row.authored > 0 && !row.procedural;
      if (this.filter === "procedural-only") return row.authored === 0 && row.procedural;
      if (this.filter === "unresolved") return row.authored === 0 && !row.procedural;
      if (this.filter === "conflicting") return row.topologyCount > 1;
      if (this.filter === "unclassified") return !row.decision;
      return true;
    });
  }

  private exportDecisions() {
    const fixture = createDecisionFixture(this.store.getScenarios(), this.store.getDecisions(), this.variants);
    const blob = new Blob([`${JSON.stringify(fixture, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "terrain-decisions.v1.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  private createImportControl() {
    const label = element("label", "import-button", "Import decisions");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const fixture = JSON.parse(await file.text());
        if (!terrainDecisionFixtureIsValid(fixture)) throw new Error("Unsupported fixture schema");
        const audit = auditTerrainDecisionFixture(fixture, this.variants);
        if (!audit.valid) throw new Error(audit.errors.slice(0, 4).join("; "));
        this.store.replaceFromFixture(fixture.decisions);
      } catch (error) {
        alert(`Could not import terrain decisions: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    label.append(input);
    return label;
  }
}

function constraintsForScenario(scenario: TerrainConnectionScenario, variants: readonly HexPatchTileVariant[]) {
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const committed = new Map<string, { q: number; r: number; variant: HexPatchTileVariant }>();
  for (const direction of HEX_DIRECTION_ORDER) {
    const variant = scenario.neighbors[direction] ? byId.get(scenario.neighbors[direction]!) : undefined;
    if (!variant) continue;
    const offset = HEX_DIRECTIONS[direction];
    committed.set(hexCellKey(offset.q, offset.r), { ...offset, variant });
  }
  return { constraints: collectPatchBoundaryConstraints({ q: 0, r: 0 }, committed), committed };
}

function matchesNeighbors(variant: HexPatchTileVariant, committed: ReadonlyMap<string, { q: number; r: number; variant: HexPatchTileVariant }>) {
  return HEX_DIRECTION_ORDER.every((direction) => {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = committed.get(hexCellKey(offset.q, offset.r));
    return !neighbor || patchVariantsCanNeighbor(variant, direction, neighbor.variant);
  });
}

function button(label: string, onClick: () => void, className?: string) {
  const control = element("button", className, label);
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}
