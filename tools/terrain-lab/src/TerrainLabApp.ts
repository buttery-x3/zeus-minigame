import { CatalogView } from "./catalog/CatalogView";
import { clear, element } from "./dom";
import { WorldExplorer } from "./world/WorldExplorer";

type ViewName = "catalog" | "world";

export class TerrainLabApp {
  private readonly content = element("div", "app-content");
  private readonly catalog = new CatalogView();
  private readonly world = new WorldExplorer((id) => {
    if (this.catalog.selectVariantById(id)) this.show("catalog");
  });
  private readonly views: Record<ViewName, HTMLElement>;
  private readonly tabs = new Map<ViewName, HTMLButtonElement>();

  constructor(private readonly root: HTMLElement) {
    this.views = { catalog: this.catalog.mount(), world: this.world.mount() };
  }

  mount() {
    const header = element("header", "app-header");
    const identity = element("div", "identity");
    identity.append(element("p", "eyebrow", "Zeus development tool"), element("h1", undefined, "Terrain Workbench"), element("span", "read-only-badge", "Read only"));
    const nav = element("nav", "app-nav");
    nav.setAttribute("aria-label", "Workbench areas");
    nav.append(this.tab("catalog", "Patch Catalog"), this.tab("world", "World Explorer"));
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
