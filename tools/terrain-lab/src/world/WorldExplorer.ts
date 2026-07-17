import { MAX_TERRAIN_PATCH_REQUEST_RADIUS } from "../../../../src/world/TerrainProvider";
import type { GeneratedTerrainPatchInspection } from "../../../../src/world/TerrainInspectionSnapshot";
import { WFC_TERRAIN_SEED, WfcTerrainProvider } from "../../../../src/world/WfcTerrainProvider";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, type HexDirection } from "../../../../src/world/hexCoordinates";
import { createPatchVariant, edgeForStructure, type HexPatchTileVariant } from "../../../../src/world/HexTerrainPatch";
import { clear, element, labeledControl } from "../dom";
import { createPatchDetails } from "../patch/PatchDetails";
import { createPatchSvg } from "../patch/PatchSvg";
import { WorldCanvas } from "./WorldCanvas";

export class WorldExplorer {
  readonly root = element("div", "world-view workspace-view");
  private readonly stage = element("div", "world-stage");
  private readonly details = element("aside", "world-details");
  private readonly status = element("p", "world-status", "No world generated.");
  private readonly zoomOutput = element("output", "zoom-output", "100%");
  private readonly canvas = new WorldCanvas((patch) => this.selectPatch(patch), (zoom) => { this.zoomOutput.textContent = `${zoom}%`; });
  private provider: WfcTerrainProvider | null = null;
  private providerKey = "";
  private selected: GeneratedTerrainPatchInspection | null = null;
  private seed = WFC_TERRAIN_SEED;
  private radius = 5;
  private generationToken = 0;
  private generating = false;
  private advanceButton!: HTMLButtonElement;
  private generateButton!: HTMLButtonElement;
  private centerButton!: HTMLButtonElement;

  constructor(
    private readonly openInCatalog: (id: string) => void,
    private readonly openInConnection: (neighbors: Partial<Record<HexDirection, HexPatchTileVariant>>, name: string, seed: number) => void,
  ) {}

  mount() {
    this.status.setAttribute("aria-live", "polite");
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
    this.advanceButton = button("Advance one patch", () => this.advanceOne());
    this.advanceButton.dataset.action = "step";
    this.generateButton = button("Generate all", () => this.generateAll());
    this.generateButton.classList.add("primary");
    this.generateButton.dataset.action = "generate";
    controls.append(labeledControl("Seed", seed), random, labeledControl("Patch radius", radius), this.advanceButton, this.generateButton);
    controls.append(this.toggle("Boundaries", true, (value) => this.canvas.setOptions({ boundaries: value })));
    controls.append(this.toggle("Patch IDs", false, (value) => this.canvas.setOptions({ ids: value })));
    controls.append(this.toggle("Provenance", true, (value) => this.canvas.setOptions({ provenance: value })));
    const camera = element("div", "camera-controls");
    camera.append(
      iconButton("−", "Zoom out", () => this.canvas.zoomOut()),
      iconButton("Fit", "Fit world", () => this.canvas.fit()),
      this.zoomOutput,
      iconButton("+", "Zoom in", () => this.canvas.zoomIn()),
    );
    this.centerButton = iconButton("◎", "Center selected patch", () => this.canvas.centerSelected());
    this.centerButton.disabled = true;
    camera.append(this.centerButton);
    controls.append(camera);
    return controls;
  }

  private ensureProvider() {
    const key = `${this.seed}:${this.radius}`;
    if (this.provider && this.providerKey === key) return this.provider;
    this.provider = new WfcTerrainProvider(this.seed);
    this.providerKey = key;
    this.selected = null;
    this.canvas.fit();
    this.provider.requestGenerationAround(0, 0, this.radius);
    return this.provider;
  }

  private advanceOne() {
    if (this.generating) return;
    this.generationToken += 1;
    const provider = this.ensureProvider();
    provider.requestGenerationAround(0, 0, this.radius);
    provider.stepGeneration(1);
    this.refresh();
  }

  private async generateAll() {
    if (this.generating) return;
    const token = ++this.generationToken;
    const provider = this.ensureProvider();
    provider.requestGenerationAround(0, 0, this.radius);
    let complete = false;
    this.generating = true;
    this.updateGenerationControls();
    try {
      while (!complete && token === this.generationToken) {
        complete = provider.stepGeneration(12).complete;
        this.refresh();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    } finally {
      this.generating = false;
      this.updateGenerationControls();
      this.refresh();
    }
  }

  private invalidate() {
    this.generationToken += 1;
    this.provider = null;
    this.providerKey = "";
    this.selected = null;
    this.canvas.fit();
    this.status.textContent = "Settings changed. Generate or advance to create a fresh deterministic world.";
    this.canvas.setSnapshot(null, null);
    this.renderDetails();
  }

  private refresh() {
    if (!this.provider) return;
    const snapshot = this.provider.captureTerrainInspectionSnapshot({ q: 0, r: 0 }, this.radius);
    if (this.selected) this.selected = snapshot.patches.find((patch) => patch.q === this.selected?.q && patch.r === this.selected.r) ?? null;
    const diagnostics = this.provider.getDiagnostics().wfc;
    const total = 1 + 3 * this.radius * (this.radius + 1);
    const state = diagnostics.pendingGeneration ? (this.generating ? "generating" : "paused") : "complete";
    this.status.textContent = `${snapshot.patches.length} / ${total} patches · ${snapshot.patches.length * 19} cells · ` +
      `${diagnostics.authoredPatchCount} authored · ${diagnostics.proceduralPatchCount} procedural · ` +
      state;
    this.canvas.setSnapshot(snapshot, this.selected);
    this.renderDetails();
  }

  private selectPatch(patch: GeneratedTerrainPatchInspection) {
    this.selected = patch;
    this.centerButton.disabled = false;
    if (this.provider) this.canvas.setSnapshot(this.provider.captureTerrainInspectionSnapshot({ q: 0, r: 0 }, this.radius), patch);
    this.renderDetails();
  }

  private renderDetails() {
    clear(this.details);
    if (!this.selected) {
      if (this.centerButton) this.centerButton.disabled = true;
      this.details.append(element("h2", undefined, "Patch inspection"), element("p", "empty-state", "Select a generated patch to inspect its exact committed interior."));
      return;
    }
    const header = element("div", "selected-patch-header");
    header.append(element("div", undefined, `Patch ${this.selected.q},${this.selected.r}`));
    const catalog = button("Open in catalog", () => this.openInCatalog(this.selected!.variant.id));
    catalog.disabled = this.selected.variant.provenance !== "authored";
    const connection = button("Open surrounding connection", () => this.openSelectedConnection());
    header.append(catalog, connection);
    this.details.append(header, createPatchSvg(this.selected.variant, { components: true }), createPatchDetails(this.selected.variant));
  }

  private openSelectedConnection() {
    if (!this.provider || !this.selected) return;
    const snapshot = this.provider.captureTerrainInspectionSnapshot({ q: 0, r: 0 }, this.radius);
    const neighbors: Partial<Record<HexDirection, HexPatchTileVariant>> = {};
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = snapshot.patches.find((patch) => patch.q === this.selected!.q + offset.q && patch.r === this.selected!.r + offset.r);
      if (neighbor) neighbors[direction] = inspectionToVariant(neighbor.variant);
    }
    this.openInConnection(neighbors, `World ${this.seed}: patch ${this.selected.q},${this.selected.r}`, this.seed);
  }

  private updateGenerationControls() {
    this.advanceButton.disabled = this.generating;
    this.generateButton.disabled = this.generating;
    this.generateButton.textContent = this.generating ? "Generating…" : "Generate all";
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

function iconButton(label: string, accessibleName: string, onClick: () => void) {
  const control = button(label, onClick);
  control.classList.add("icon-button");
  control.setAttribute("aria-label", accessibleName);
  control.title = accessibleName;
  return control;
}

function inspectionToVariant(inspection: GeneratedTerrainPatchInspection["variant"]): HexPatchTileVariant {
  const cells = new Map(inspection.cells.map((cell) => {
    const edge = edgeForStructure(cell.structure);
    return [`${cell.q},${cell.r}`, { ...cell, edges: { ne: edge, e: edge, se: edge, sw: edge, w: edge, nw: edge } }];
  }));
  const variant = createPatchVariant(
    inspection.id,
    inspection.family,
    inspection.provenance,
    inspection.weight,
    cells,
    inspection.procedural ? { ...inspection.procedural } : undefined,
    {
      selectionGroup: inspection.selectionGroup,
      selectionGroupWeight: inspection.selectionGroupWeight,
      topology: inspection.topology,
      riverTerminal: inspection.riverTerminal,
      lakeRole: inspection.lakeRole,
    },
    { ...inspection.riverPorts },
  );
  variant.selectionGroupWeight = inspection.selectionGroupWeight;
  return variant;
}
