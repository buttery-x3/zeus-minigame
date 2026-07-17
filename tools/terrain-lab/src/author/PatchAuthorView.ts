import { createHexPatchCatalogEntries } from "../../../../src/world/HexTerrainCatalog";
import { hexCellKey } from "../../../../src/world/hexCoordinates";
import {
  createBlankTerrainPatchDocument,
  validateTerrainPatchDocument,
  type TerrainPatchDocument,
} from "../../../../src/world/TerrainPatchDocument";
import {
  TERRAIN_PATCH_PAINTS,
  TerrainPatchHistory,
  floodFillTerrainPatch,
  mirrorTerrainPatchDocument,
  paintTerrainPatchCells,
  rotateTerrainPatchDocument,
  setTerrainPatchBoundaryLocked,
  terrainPatchPaintAt,
  type TerrainPatchPaint,
} from "../../../../src/world/TerrainPatchEditing";
import { clear, element } from "../dom";
import { PatchDraftStore } from "./PatchDraftStore";
import { downloadJson, terrainVariantShapeKey, uniqueCopyId } from "./PatchAuthorFiles";
import { createPatchEditorCanvas, type PatchEditorTool } from "./PatchEditorCanvas";
import { createPatchMetadataPanel } from "./PatchMetadataPanel";
import { createPatchVariantPreviews } from "./PatchVariantPreviews";

export class PatchAuthorView {
  readonly root = element("div", "patch-author-view workspace-view");
  private readonly store = new PatchDraftStore();
  private readonly catalogEntries = createHexPatchCatalogEntries();
  private readonly installedIds = new Set(this.catalogEntries.map((entry) => entry.definition.id));
  private readonly installedVariants = this.catalogEntries.flatMap((entry) => entry.variants);
  private history = new TerrainPatchHistory(createBlankTerrainPatchDocument());
  private tool: PatchEditorTool = "brush";
  private paint: TerrainPatchPaint = TERRAIN_PATCH_PAINTS[0];
  private showLabels = true;
  private zoom = 1;
  private saveMessage = "Unsaved draft";

  constructor(private readonly returnToConnection: () => void = () => undefined) {}

  mount() {
    this.root.addEventListener("keydown", (event) => this.handleShortcut(event));
    this.render();
    return this.root;
  }

  loadDocument(document: TerrainPatchDocument, save = false) {
    this.history.reset(structuredClone(document));
    if (save) this.store.save(this.history.value);
    this.saveMessage = save ? "Draft created" : "Unsaved draft";
    this.render();
  }

  private render() {
    clear(this.root);
    const draft = this.history.value;
    this.root.append(this.createHeader(draft));
    const workspace = element("div", "patch-author-workspace");
    const toolbox = this.createToolbox(draft);
    const center = element("main", "patch-author-center");
    const canvas = createPatchEditorCanvas(
      draft, this.tool, this.paint, this.showLabels,
      (keys, paint) => this.apply(paintTerrainPatchCells(draft, keys, paint)),
      (key, paint) => this.apply(floodFillTerrainPatch(draft, key, paint)),
      (key) => { this.paint = terrainPatchPaintAt(draft, key); this.tool = "brush"; this.render(); },
    );
    canvas.style.setProperty("--author-zoom", String(this.zoom));
    center.append(canvas, createPatchVariantPreviews(draft));
    const inspector = element("aside", "patch-author-inspector");
    inspector.append(createPatchMetadataPanel(draft, (next) => this.apply(next)), this.createValidation(draft));
    workspace.append(toolbox, center, inspector);
    this.root.append(workspace);
  }

  private createHeader(draft: TerrainPatchDocument) {
    const header = element("header", "patch-author-header");
    const identity = element("div");
    identity.append(element("p", "eyebrow", "19-cell authored WFC definition"), element("h2", undefined, "Patch Author"));
    const actions = element("div", "patch-author-actions");
    const library = document.createElement("select");
    library.setAttribute("aria-label", "Saved patch drafts");
    library.append(new Option("Saved drafts", ""));
    this.store.getAll().forEach((saved) => library.append(new Option(`${saved.displayName} · ${saved.id}`, saved.draftId, false, saved.draftId === draft.draftId)));
    library.addEventListener("change", () => { const selected = this.store.get(library.value); if (selected) this.loadDocument(selected); });
    const importLabel = element("label", "import-button", "Import");
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".json,application/json";
    importInput.setAttribute("aria-label", "Import patch drafts");
    importInput.addEventListener("change", () => this.importDrafts(importInput));
    importLabel.append(importInput);
    actions.append(
      library,
      button("New", () => this.loadDocument(createBlankTerrainPatchDocument())),
      button("Clone", () => this.cloneDraft(draft)),
      button("Save", () => { this.store.save(draft); this.saveMessage = "Saved locally"; this.render(); }, "primary"),
      button("Delete", () => {
        if (!globalThis.confirm(`Delete the local draft “${draft.displayName}”?`)) return;
        this.store.delete(draft.draftId);
        this.loadDocument(createBlankTerrainPatchDocument());
      }),
      button("Export", () => downloadJson(`${draft.id}.json`, this.store.bundle([draft]))),
      button("Export all", () => downloadJson("terrain-patch-drafts.json", this.store.bundle())),
      importLabel,
    );
    if (draft.source?.kind === "scenario") actions.append(button("Return to Connection Lab", this.returnToConnection));
    header.append(identity, element("span", "patch-author-save-state", this.saveMessage), actions);
    return header;
  }

  private createToolbox(draft: TerrainPatchDocument) {
    const aside = element("aside", "patch-author-toolbox");
    aside.append(element("h3", undefined, "Tools"));
    const tools = element("div", "author-tool-buttons");
    for (const [id, label, key] of [["brush", "Brush", "B"], ["bucket", "Bucket", "G"], ["eyedropper", "Eyedropper", "I"], ["eraser", "Reset", "E"]] as const) {
      const control = button(`${label} ${key}`, () => { this.tool = id; this.render(); });
      control.classList.toggle("active", this.tool === id);
      tools.append(control);
    }
    aside.append(tools, element("h3", undefined, "Paint"));
    const paints = element("div", "author-paint-buttons");
    for (const paint of TERRAIN_PATCH_PAINTS) {
      const control = button(paint.label, () => {
        this.paint = paint;
        if (this.tool === "eyedropper" || this.tool === "eraser") this.tool = "brush";
        this.render();
      });
      control.classList.toggle("active", this.paint.id === paint.id && this.tool !== "eraser");
      control.dataset.paint = paint.id;
      paints.append(control);
    }
    const history = element("div", "author-history-buttons");
    const undo = button("Undo", () => { this.history.undo(); this.autosave(); this.render(); });
    const redo = button("Redo", () => { this.history.redo(); this.autosave(); this.render(); });
    undo.disabled = !this.history.canUndo;
    redo.disabled = !this.history.canRedo;
    history.append(undo, redo);
    const transforms = element("div", "author-transform-buttons");
    transforms.append(
      button("Rotate", () => this.apply(rotateTerrainPatchDocument(draft))),
      button("Mirror", () => this.apply(mirrorTerrainPatchDocument(draft))),
      button(draft.lockedCells.length > 0 ? "Unlock boundary" : "Lock boundary", () => this.apply(setTerrainPatchBoundaryLocked(draft, draft.lockedCells.length === 0))),
    );
    const overlays = element("label", "check-field");
    const labels = document.createElement("input");
    labels.type = "checkbox";
    labels.checked = this.showLabels;
    labels.addEventListener("change", () => { this.showLabels = labels.checked; this.render(); });
    overlays.append(labels, document.createTextNode("Cell coordinates"));
    const zoom = element("div", "author-zoom-buttons");
    zoom.append(button("−", () => { this.zoom = Math.max(.65, this.zoom - .15); this.render(); }), button("Fit", () => { this.zoom = 1; this.render(); }), button("+", () => { this.zoom = Math.min(1.75, this.zoom + .15); this.render(); }));
    aside.append(paints, history, transforms, overlays, zoom);
    return aside;
  }

  private createValidation(draft: TerrainPatchDocument) {
    const validation = validateTerrainPatchDocument(draft);
    const panel = element("section", "patch-author-validation detail-panel");
    panel.append(element("h3", undefined, "WFC readiness"));
    const duplicate = this.installedIds.has(draft.id);
    const localDuplicates = this.store.getAll().filter((candidate) => candidate.id === draft.id && candidate.draftId !== draft.draftId).length;
    const installedShapes = new Map(this.installedVariants.map((variant) => [terrainVariantShapeKey(variant), variant.id]));
    const shapeDuplicates = [...new Set(validation.variants.map((variant) => installedShapes.get(terrainVariantShapeKey(variant))).filter((id): id is string => Boolean(id)))];
    const ready = validation.valid && !duplicate && localDuplicates === 0 && shapeDuplicates.length === 0;
    const status = element("p", ready ? "good" : "warning",
      ready ? `Ready · ${validation.variants.length} generated variant${validation.variants.length === 1 ? "" : "s"}`
        : duplicate ? "Catalog ID already exists; rename it or install with explicit replacement."
          : localDuplicates > 0 ? `${localDuplicates} other saved draft${localDuplicates === 1 ? "" : "s"} use this catalog ID.`
            : shapeDuplicates.length > 0 ? "This exact authored shape is already installed." : "Draft is not ready to install.");
    panel.append(status);
    const messages = [
      ...validation.errors,
      ...validation.warnings,
      ...(shapeDuplicates.length > 0 ? [`Exact authored shape already exists as ${shapeDuplicates.join(", ")}. Change its cells or metadata before installing.`] : []),
    ];
    if (messages.length > 0) {
      const list = element("ul", "patch-author-messages");
      messages.forEach((message) => list.append(element("li", undefined, message)));
      panel.append(list);
    }
    if (validation.definition) {
      const facts = element("dl", "metadata-grid");
      facts.append(term("Family", validation.definition.family), term("Category", draft.category), term("Selection group", validation.definition.selectionGroup ?? draft.id), term("Locked cells", String(draft.lockedCells.length)));
      panel.append(facts);
    }
    return panel;
  }

  private apply(next: TerrainPatchDocument) {
    this.history.replace(next);
    this.autosave();
    this.render();
  }

  private autosave() {
    this.store.save(this.history.value);
    this.saveMessage = "Autosaved locally";
  }

  private cloneDraft(source: TerrainPatchDocument) {
    const clone = structuredClone(source);
    clone.draftId = crypto.randomUUID();
    clone.id = uniqueCopyId(source.id, [...this.installedIds], this.store.getAll().map((draft) => draft.id));
    clone.displayName = `${source.displayName} copy`;
    clone.selectionGroup = clone.id;
    clone.source = { kind: "catalog", reference: source.id };
    this.loadDocument(clone, true);
  }

  private async importDrafts(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const count = this.store.import(JSON.parse(await file.text()));
      this.saveMessage = `${count} draft${count === 1 ? "" : "s"} imported`;
      this.render();
    } catch (error) {
      this.saveMessage = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
      this.render();
    }
  }

  private handleShortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      event.shiftKey ? this.history.redo() : this.history.undo();
      this.autosave();
      this.render();
    } else if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault(); this.history.redo(); this.autosave(); this.render();
    } else if (["b", "g", "i", "e"].includes(key)) {
      this.tool = ({ b: "brush", g: "bucket", i: "eyedropper", e: "eraser" } as const)[key as "b" | "g" | "i" | "e"];
      this.render();
    }
  }
}

function term(label: string, value: string) {
  const fragment = document.createDocumentFragment();
  fragment.append(element("dt", undefined, label), element("dd", undefined, value));
  return fragment;
}

function button(label: string, onClick: () => void, className?: string) {
  const control = element("button", className, label);
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}
