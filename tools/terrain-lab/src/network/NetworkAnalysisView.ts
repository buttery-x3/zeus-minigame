import { analyzeTerrainFeatureNetwork, type TerrainFeatureNetwork, type TerrainNetworkIssue } from "../../../../src/world/TerrainFeatureNetwork";
import type { GeneratedTerrainInspectionSnapshot } from "../../../../src/world/TerrainInspectionSnapshot";
import { clear, element } from "../dom";

export class NetworkAnalysisView {
  readonly root = element("div", "network-view workspace-view");
  private snapshot: GeneratedTerrainInspectionSnapshot | null = null;
  private graph: TerrainFeatureNetwork | null = null;
  private severity = "review";
  private kind = "all";
  private search = "";

  constructor(
    private readonly focusWorld: (issue: TerrainNetworkIssue) => void,
    private readonly openConnection: (issue: TerrainNetworkIssue) => void,
    private readonly showOverlay: (issues: readonly TerrainNetworkIssue[]) => void,
  ) {}

  mount() {
    this.render();
    return this.root;
  }

  setSnapshot(snapshot: GeneratedTerrainInspectionSnapshot | null) {
    this.snapshot = snapshot;
    this.graph = null;
    this.showOverlay([]);
    this.render();
  }

  private scan() {
    if (!this.snapshot) return;
    this.graph = analyzeTerrainFeatureNetwork(this.snapshot);
    this.showOverlay(this.graph.issues.filter((issue) => issue.severity !== "info"));
    this.render();
  }

  private render() {
    clear(this.root);
    const header = element("header", "network-header");
    const identity = element("div");
    identity.append(element("p", "eyebrow", "Generated-world component graph"), element("h2", undefined, "Network Analysis"));
    const actions = element("div", "network-actions");
    const scan = button("Scan current region", () => this.scan(), "primary");
    scan.disabled = !this.snapshot;
    actions.append(scan, button("Clear world overlay", () => this.showOverlay([])));
    header.append(identity, actions);
    this.root.append(header);
    if (!this.snapshot) {
      this.root.append(element("p", "empty-state network-empty", "Generate a region in World Explorer, then return here to analyze its river, lake, and cliff component networks."));
      return;
    }
    if (!this.graph) {
      this.root.append(element("p", "empty-state network-empty", `${this.snapshot.patches.length} committed patches are ready to scan. Analysis is read-only and frontier-aware.`));
      return;
    }
    this.root.append(this.createSummary(), this.createNetworkSummaries(), this.createFilters(), this.createIssueList());
  }

  private createSummary() {
    const graph = this.graph!;
    const summary = element("section", "network-summary");
    const stats = [
      ["Feature components", graph.nodes.length],
      ["River networks", graph.riverNetworks.length],
      ["Lake networks", graph.lakeNetworks.length],
      ["Errors", graph.issues.filter((issue) => issue.severity === "error").length],
      ["Warnings", graph.issues.filter((issue) => issue.severity === "warning").length],
      ["Frontier ports", graph.frontierPortCount],
    ] as const;
    for (const [label, count] of stats) {
      const stat = element("div", "network-stat");
      stat.append(element("strong", undefined, String(count)), element("span", undefined, label));
      summary.append(stat);
    }
    return summary;
  }

  private createNetworkSummaries() {
    const section = element("section", "network-rollup detail-panel");
    section.append(element("h3", undefined, "Network rollup"));
    const rows = element("div", "network-rollup-rows");
    this.graph!.riverNetworks.forEach((network) => rows.append(element("p", undefined,
      `${network.id}: ${network.nodeIds.length} components · ${network.sourceCount} sources · ${network.sinkCount} sinks · ${network.terminalCount} terminals · ${network.junctionCount} junctions · ${network.frontierPortCount} frontier ports`,
    )));
    this.graph!.lakeNetworks.forEach((network) => rows.append(element("p", undefined,
      `${network.id}: ${network.nodeIds.length} components · ${network.mouthCount} river mouths`,
    )));
    if (!rows.childElementCount) rows.append(element("p", "empty-state", "No river or lake networks exist in this generated region."));
    section.append(rows);
    return section;
  }

  private createFilters() {
    const filters = element("div", "network-filters");
    const search = document.createElement("input");
    search.type = "search";
    search.value = this.search;
    search.placeholder = "Issue, patch, or component";
    search.setAttribute("aria-label", "Search network issues");
    search.addEventListener("input", () => { this.search = search.value.toLowerCase(); this.render(); });
    const severity = selectControl(["review", "all", "error", "warning", "info"], this.severity, "Network issue severity");
    severity.addEventListener("change", () => { this.severity = severity.value; this.render(); });
    const kinds = ["all", ...new Set(this.graph!.issues.map((issue) => issue.kind))];
    const kind = selectControl(kinds, this.kind, "Network issue type");
    kind.addEventListener("change", () => { this.kind = kind.value; this.render(); });
    filters.append(search, severity, kind);
    return filters;
  }

  private createIssueList() {
    const section = element("section", "network-issues");
    section.append(element("h3", undefined, "Issue queue"));
    const list = element("div", "network-issue-list");
    const filtered = this.filteredIssues();
    for (const issue of filtered) list.append(this.createIssueCard(issue));
    if (!filtered.length) list.append(element("p", "good", "No issues match the current filters."));
    section.append(list);
    return section;
  }

  private createIssueCard(issue: TerrainNetworkIssue) {
    const card = element("article", `network-issue ${issue.severity}`);
    const header = element("div", "network-issue-header");
    header.append(element("span", `severity-badge ${issue.severity}`, issue.severity), element("strong", undefined, issue.kind.replaceAll("-", " ")));
    const patches = element("div", "issue-patches");
    issue.patches.forEach((patch) => patches.append(element("code", undefined, `${patch.q},${patch.r}`)));
    const actions = element("div", "network-issue-actions");
    actions.append(button("Focus in World Explorer", () => this.focusWorld(issue)), button("Open local scenario", () => this.openConnection(issue), "primary"));
    card.append(header, element("p", undefined, issue.message), patches, actions);
    const advanced = document.createElement("details");
    advanced.append(element("summary", undefined, `${issue.nodeIds.length} involved components`), element("code", "network-node-list", issue.nodeIds.join(" · ")));
    card.append(advanced);
    return card;
  }

  private filteredIssues() {
    return this.graph!.issues.filter((issue) => {
      if (this.severity === "review" && issue.severity === "info") return false;
      if (!["review", "all"].includes(this.severity) && issue.severity !== this.severity) return false;
      if (this.kind !== "all" && issue.kind !== this.kind) return false;
      const searchable = `${issue.kind} ${issue.message} ${issue.nodeIds.join(" ")} ${issue.patches.map((patch) => `${patch.q},${patch.r}`).join(" ")}`.toLowerCase();
      return !this.search || searchable.includes(this.search);
    });
  }
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
  values.forEach((value) => select.append(new Option(value.replaceAll("-", " "), value, value === selected, value === selected)));
  return select;
}
