import {
  createHexPatchCatalogEntries,
  type HexPatchCatalogEntry,
} from "../../../../src/world/HexTerrainCatalog";
import { inspectTerrainVariant } from "../../../../src/world/TerrainInspectionSnapshot";
import type { HexPatchTileVariant } from "../../../../src/world/HexTerrainPatch";
import { createProceduralComparison } from "../comparison/ProceduralComparison";
import { clear, element, labeledControl } from "../dom";
import { createPatchDetails } from "../patch/PatchDetails";
import { createPatchSvg } from "../patch/PatchSvg";

export class CatalogView {
  readonly root = element("div", "catalog-view workspace-view");
  private readonly entries = createHexPatchCatalogEntries();
  private readonly list = element("div", "catalog-list");
  private readonly inspector = element("main", "catalog-inspector");
  private query = "";
  private family = "all";
  private selectedEntry = this.entries[0];
  private selectedVariant = this.entries[0].variants[0];
  private showLabels = true;
  private showComponents = true;

  mount() {
    this.root.append(this.createSidebar(), this.inspector);
    this.renderList();
    this.renderInspector();
    return this.root;
  }

  selectVariantById(id: string) {
    const entry = this.entries.find((candidate) => candidate.variants.some((variant) => variant.id === id));
    const variant = entry?.variants.find((candidate) => candidate.id === id);
    if (!entry || !variant) return false;
    this.selectedEntry = entry;
    this.selectedVariant = variant;
    this.renderList();
    this.renderInspector();
    return true;
  }

  private createSidebar() {
    const sidebar = element("aside", "catalog-sidebar");
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "ID, topology, signature…";
    search.setAttribute("aria-label", "Search patch catalog");
    search.addEventListener("input", () => { this.query = search.value.toLowerCase(); this.renderList(); });
    const family = document.createElement("select");
    for (const value of ["all", "open", "cliff", "river", "lake", "transition"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "all" ? "All families" : value;
      family.append(option);
    }
    family.addEventListener("change", () => { this.family = family.value; this.renderList(); });
    sidebar.append(element("h2", undefined, "Patch Catalog"), labeledControl("Search", search), labeledControl("Family", family), this.list);
    return sidebar;
  }

  private renderList() {
    clear(this.list);
    const filtered = this.entries.filter((entry) => this.entryMatches(entry));
    this.list.dataset.count = String(filtered.length);
    for (const entry of filtered) {
      const button = element("button", `catalog-entry${entry === this.selectedEntry ? " selected" : ""}`);
      button.type = "button";
      button.append(
        element("strong", undefined, entry.definition.id),
        element("span", undefined, `${entry.definition.family} · ${entry.definition.topology ?? "mixed"}`),
        element("span", "variant-count", `${entry.variants.length} orientation${entry.variants.length === 1 ? "" : "s"}`),
      );
      button.addEventListener("click", () => {
        this.selectedEntry = entry;
        this.selectedVariant = entry.variants[0];
        this.renderList();
        this.renderInspector();
      });
      this.list.append(button);
    }
    if (!filtered.length) this.list.append(element("p", "empty-state", "No definitions match these filters."));
  }

  private entryMatches(entry: HexPatchCatalogEntry) {
    if (this.family !== "all" && entry.definition.family !== this.family) return false;
    if (!this.query) return true;
    return [
      entry.definition.id,
      entry.definition.family,
      entry.definition.topology ?? "mixed",
      entry.definition.selectionGroup ?? "",
      ...entry.variants.flatMap((variant) => [variant.id, ...Object.values(variant.edges).map((edge) => edge.join(""))]),
    ].some((value) => value.toLowerCase().includes(this.query));
  }

  private renderInspector() {
    clear(this.inspector);
    const header = element("div", "inspector-header");
    const title = element("div");
    title.append(element("p", "eyebrow", "Read-only authored definition"), element("h2", undefined, this.selectedEntry.definition.id));
    header.append(title, this.createOrientationSelect());
    const controls = element("div", "overlay-controls");
    controls.append(this.checkbox("Cell coordinates", this.showLabels, (value) => { this.showLabels = value; this.renderInspector(); }));
    controls.append(this.checkbox("Component colors", this.showComponents, (value) => { this.showComponents = value; this.renderInspector(); }));
    const inspection = inspectTerrainVariant(this.selectedVariant);
    const primary = element("div", "inspector-grid");
    const visual = element("section", "patch-stage detail-panel");
    visual.append(createPatchSvg(inspection, { labels: this.showLabels, components: this.showComponents }));
    primary.append(visual, createPatchDetails(inspection));
    this.inspector.append(header, controls, primary, createProceduralComparison(this.selectedVariant, 20260517));
  }

  private createOrientationSelect() {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Patch orientation");
    this.selectedEntry.variants.forEach((variant) => {
      const option = document.createElement("option");
      option.value = variant.id;
      option.textContent = variant.id;
      option.selected = variant === this.selectedVariant;
      select.append(option);
    });
    select.addEventListener("change", () => {
      this.selectedVariant = this.selectedEntry.variants.find((variant) => variant.id === select.value) as HexPatchTileVariant;
      this.renderInspector();
    });
    return labeledControl("Orientation / flow", select);
  }

  private checkbox(label: string, checked: boolean, onChange: (value: boolean) => void) {
    const wrapper = element("label", "check-field");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  }
}
