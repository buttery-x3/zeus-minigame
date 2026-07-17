import { MAX_TERRAIN_PATCH_REQUEST_RADIUS } from "../../../../src/world/TerrainProvider";
import type { GeneratedTerrainPatchInspection } from "../../../../src/world/TerrainInspectionSnapshot";
import { WFC_TERRAIN_SEED, WfcTerrainProvider } from "../../../../src/world/WfcTerrainProvider";
import { clear, element, labeledControl } from "../dom";
import { createPatchDetails } from "../patch/PatchDetails";
import { createPatchSvg } from "../patch/PatchSvg";
import { WorldCanvas } from "./WorldCanvas";

export class WorldExplorer {
  readonly root = element("div", "world-view workspace-view");
  private readonly stage = element("div", "world-stage");
  private readonly details = element("aside", "world-details");
  private readonly status = element("p", "world-status", "No world generated.");
  private readonly canvas = new WorldCanvas((patch) => this.selectPatch(patch));
  private provider: WfcTerrainProvider | null = null;
  private providerKey = "";
  private selected: GeneratedTerrainPatchInspection | null = null;
  private seed = WFC_TERRAIN_SEED;
  private radius = 5;
  private generationToken = 0;

  constructor(private readonly openInCatalog: (id: string) => void) {}

  mount() {
    this.stage.append(this.createControls(), this.status, this.canvas.canvas);
    this.root.append(this.stage, this.details);
    this.renderDetails();
    return this.root;
  }

  private createControls() {
    const controls = element("div", "world-controls");
    const seed = document.createElement("input");
    seed.type = "number";
    seed.value = String(this.seed);
    seed.addEventListener("change", () => { this.seed = Number(seed.value) || 0; this.invalidate(); });
    const radius = document.createElement("input");
    radius.type = "number";
    radius.min = "0";
    radius.max = String(MAX_TERRAIN_PATCH_REQUEST_RADIUS);
    radius.value = String(this.radius);
    radius.addEventListener("change", () => {
      this.radius = Math.max(0, Math.min(MAX_TERRAIN_PATCH_REQUEST_RADIUS, Number(radius.value) || 0));
      radius.value = String(this.radius);
      this.invalidate();
    });
    const random = button("Random seed", () => {
      this.seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
      seed.value = String(this.seed);
      this.invalidate();
    });
    const advance = button("Advance one patch", () => this.advanceOne());
    advance.dataset.action = "step";
    const generate = button("Generate all", () => this.generateAll());
    generate.classList.add("primary");
    generate.dataset.action = "generate";
    controls.append(labeledControl("Seed", seed), random, labeledControl("Patch radius", radius), advance, generate);
    controls.append(this.toggle("Boundaries", true, (value) => this.canvas.setOptions({ boundaries: value })));
    controls.append(this.toggle("Patch IDs", false, (value) => this.canvas.setOptions({ ids: value })));
    controls.append(this.toggle("Provenance", true, (value) => this.canvas.setOptions({ provenance: value })));
    return controls;
  }

  private ensureProvider() {
    const key = `${this.seed}:${this.radius}`;
    if (this.provider && this.providerKey === key) return this.provider;
    this.provider = new WfcTerrainProvider(this.seed);
    this.providerKey = key;
    this.selected = null;
    this.provider.requestGenerationAround(0, 0, this.radius);
    return this.provider;
  }

  private advanceOne() {
    this.generationToken += 1;
    const provider = this.ensureProvider();
    provider.requestGenerationAround(0, 0, this.radius);
    provider.stepGeneration(1);
    this.refresh();
  }

  private async generateAll() {
    const token = ++this.generationToken;
    const provider = this.ensureProvider();
    provider.requestGenerationAround(0, 0, this.radius);
    let complete = false;
    while (!complete && token === this.generationToken) {
      complete = provider.stepGeneration(12).complete;
      this.refresh();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  private invalidate() {
    this.generationToken += 1;
    this.provider = null;
    this.providerKey = "";
    this.selected = null;
    this.status.textContent = "Settings changed. Generate or advance to create a fresh deterministic world.";
    this.canvas.setSnapshot(null, null);
    this.renderDetails();
  }

  private refresh() {
    if (!this.provider) return;
    const snapshot = this.provider.captureTerrainInspectionSnapshot({ q: 0, r: 0 }, this.radius);
    if (this.selected) this.selected = snapshot.patches.find((patch) => patch.q === this.selected?.q && patch.r === this.selected.r) ?? null;
    const diagnostics = this.provider.getDiagnostics().wfc;
    this.status.textContent = `${snapshot.patches.length} patches · ${snapshot.patches.length * 19} cells · ` +
      `${diagnostics.authoredPatchCount} authored · ${diagnostics.proceduralPatchCount} procedural · ` +
      `${diagnostics.pendingGeneration ? "generation pending" : "complete"}`;
    this.canvas.setSnapshot(snapshot, this.selected);
    this.renderDetails();
  }

  private selectPatch(patch: GeneratedTerrainPatchInspection) {
    this.selected = patch;
    if (this.provider) this.canvas.setSnapshot(this.provider.captureTerrainInspectionSnapshot({ q: 0, r: 0 }, this.radius), patch);
    this.renderDetails();
  }

  private renderDetails() {
    clear(this.details);
    if (!this.selected) {
      this.details.append(element("h2", undefined, "Patch inspection"), element("p", "empty-state", "Select a generated patch to inspect its exact committed interior."));
      return;
    }
    const header = element("div", "selected-patch-header");
    header.append(element("div", undefined, `Patch ${this.selected.q},${this.selected.r}`));
    const catalog = button("Open in catalog", () => this.openInCatalog(this.selected!.variant.id));
    catalog.disabled = this.selected.variant.provenance !== "authored";
    header.append(catalog);
    this.details.append(header, createPatchSvg(this.selected.variant, { components: true }), createPatchDetails(this.selected.variant));
  }

  private toggle(label: string, checked: boolean, onChange: (value: boolean) => void) {
    const wrapper = element("label", "check-field compact");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  }
}

function button(label: string, onClick: () => void) {
  const control = element("button", undefined, label);
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}
