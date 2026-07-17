import { CatalogView } from "./catalog/CatalogView";
import { ConnectionLab } from "./connection/ConnectionLab";
import { CoverageDashboard } from "./coverage/CoverageDashboard";
import { clear, element } from "./dom";
import { NetworkAnalysisView } from "./network/NetworkAnalysisView";
import { PatchAuthorView } from "./author/PatchAuthorView";
import { ScenarioStore } from "./scenarios/ScenarioStore";
import { WorldExplorer } from "./world/WorldExplorer";

type ViewName = "catalog" | "author" | "connection" | "coverage" | "network" | "world";

export class TerrainLabApp {
  private readonly content = element("div", "app-content");
  private readonly store = new ScenarioStore();
  private readonly author: PatchAuthorView;
  private readonly catalog: CatalogView;
  private readonly connection: ConnectionLab;
  private readonly coverage: CoverageDashboard;
  private readonly world: WorldExplorer;
  private readonly network: NetworkAnalysisView;
  private readonly views: Record<ViewName, HTMLElement>;
  private readonly tabs = new Map<ViewName, HTMLButtonElement>();

  constructor(private readonly root: HTMLElement) {
    this.author = new PatchAuthorView(() => this.show("connection"));
    this.catalog = new CatalogView((document) => { this.author.loadDocument(document); this.show("author"); });
    this.connection = new ConnectionLab(this.store, (document) => { this.author.loadDocument(document); this.show("author"); });
    this.coverage = new CoverageDashboard(this.store, (scenario) => {
      this.connection.loadScenario(scenario);
      this.show("connection");
    });
    this.world = new WorldExplorer(
      (id) => { if (this.catalog.selectVariantById(id)) this.show("catalog"); },
      (neighbors, name, seed) => { this.connection.loadNeighborRing(neighbors, name, seed); this.show("connection"); },
      (snapshot) => this.network.setSnapshot(snapshot),
    );
    this.network = new NetworkAnalysisView(
      (issue) => { if (this.world.focusPatch(issue.patches[0])) this.show("world"); },
      (issue) => this.world.openConnectionAt(issue.patches[0]),
      (issues) => this.world.setNetworkIssues(issues),
    );
    this.views = {
      catalog: this.catalog.mount(),
      author: this.author.mount(),
      connection: this.connection.mount(),
      coverage: this.coverage.mount(),
      network: this.network.mount(),
      world: this.world.mount(),
    };
  }

  mount() {
    const header = element("header", "app-header");
    const identity = element("div", "identity");
    identity.append(element("p", "eyebrow", "Zeus development tool"), element("h1", undefined, "Terrain Workbench"), element("span", "read-only-badge", "No source writes"));
    const nav = element("nav", "app-nav");
    nav.setAttribute("aria-label", "Workbench areas");
    nav.append(
      this.tab("catalog", "Patch Catalog"),
      this.tab("author", "Patch Author"),
      this.tab("connection", "Connection Lab"),
      this.tab("coverage", "Decisions & Coverage"),
      this.tab("network", "Network Analysis"),
      this.tab("world", "World Explorer"),
    );
    header.append(identity, nav);
    this.root.append(header, this.content);
    this.show("catalog");
  }

  private tab(view: ViewName, label: string) {
    const button = element("button", "nav-tab", label);
    button.type = "button";
    button.addEventListener("click", () => this.show(view));
    this.tabs.set(view, button);
    return button;
  }

  private show(view: ViewName) {
    clear(this.content);
    this.content.append(this.views[view]);
    this.tabs.forEach((button, name) => {
      button.classList.toggle("active", name === view);
      button.setAttribute("aria-selected", String(name === view));
    });
  }
}
