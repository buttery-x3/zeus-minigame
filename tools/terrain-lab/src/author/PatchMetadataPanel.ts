import { HEX_DIRECTION_ORDER, type HexDirection } from "../../../../src/world/hexCoordinates";
import {
  TERRAIN_PATCH_DOCUMENT_CATEGORIES,
  TERRAIN_PATCH_DOCUMENT_TOPOLOGIES,
  type TerrainPatchDocument,
} from "../../../../src/world/TerrainPatchDocument";
import { element, labeledControl } from "../dom";

export function createPatchMetadataPanel(draft: TerrainPatchDocument, onChange: (next: TerrainPatchDocument) => void) {
  const panel = element("section", "patch-author-metadata detail-panel");
  panel.append(element("h3", undefined, "Patch identity"));
  const fields = element("div", "patch-author-fields");
  fields.append(
    field("Display name", textInput("Patch display name", draft.displayName, (value) => update(draft, onChange, (next) => { next.displayName = value; }))),
    field("Catalog ID", textInput("Patch catalog ID", draft.id, (value) => update(draft, onChange, (next) => {
      const previous = next.id;
      next.id = value.toLowerCase().replaceAll(" ", "-");
      if (next.selectionGroup === previous) next.selectionGroup = next.id;
    }))),
    field("Category", select(TERRAIN_PATCH_DOCUMENT_CATEGORIES, draft.category, "Patch category", (value) => update(draft, onChange, (next) => {
      const previous = next.id;
      next.category = value as TerrainPatchDocument["category"];
      next.id = next.id.replace(/^patch\.[^.]+\./, `patch.${value}.`);
      if (next.selectionGroup === previous) next.selectionGroup = next.id;
    }))),
    field("Topology", select(TERRAIN_PATCH_DOCUMENT_TOPOLOGIES, draft.topology, "Patch topology", (value) => update(draft, onChange, (next) => { next.topology = value as TerrainPatchDocument["topology"]; }))),
    field("Weight", numberInput("Patch weight", draft.weight, .05, (value) => update(draft, onChange, (next) => { next.weight = value; }))),
    field("Rotations", select(["1", "3", "6"], String(draft.rotations), "Patch rotations", (value) => update(draft, onChange, (next) => { next.rotations = Number(value) as 1 | 3 | 6; }))),
  );
  panel.append(fields, createAdvancedMetadata(draft, onChange));
  return panel;
}

function createAdvancedMetadata(draft: TerrainPatchDocument, onChange: (next: TerrainPatchDocument) => void) {
  const details = document.createElement("details");
  details.className = "patch-author-advanced";
  details.append(element("summary", undefined, "Advanced WFC metadata"));
  const fields = element("div", "patch-author-fields");
  fields.append(
    field("Selection group", textInput("Patch selection group", draft.selectionGroup, (value) => update(draft, onChange, (next) => { next.selectionGroup = value; }))),
    field("Group weight", numberInput("Patch selection group weight", draft.selectionGroupWeight, .05, (value) => update(draft, onChange, (next) => { next.selectionGroupWeight = value; }))),
    field("River terminal", select(["none", "lake", "cliff"], draft.riverTerminal ?? "none", "River terminal", (value) => update(draft, onChange, (next) => {
      next.riverTerminal = value === "none" ? undefined : value as TerrainPatchDocument["riverTerminal"];
    }))),
    field("Lake role", select(["none", "cove", "shore", "core", "mouth"], draft.lakeRole ?? "none", "Lake role", (value) => update(draft, onChange, (next) => {
      next.lakeRole = value === "none" ? undefined : value as TerrainPatchDocument["lakeRole"];
    }))),
  );
  const reversible = element("label", "check-field");
  const reversibleInput = document.createElement("input");
  reversibleInput.type = "checkbox";
  reversibleInput.checked = draft.riverFlow.reversible;
  reversibleInput.addEventListener("change", () => update(draft, onChange, (next) => { next.riverFlow.reversible = reversibleInput.checked; }));
  reversible.append(reversibleInput, document.createTextNode("Generate reversed river flow"));
  const ports = element("div", "river-port-fields");
  for (const direction of HEX_DIRECTION_ORDER) ports.append(field(direction.toUpperCase(), riverPortSelect(draft, direction, onChange)));
  const notes = document.createElement("textarea");
  notes.value = draft.notes;
  notes.placeholder = "Authoring notes";
  notes.setAttribute("aria-label", "Patch authoring notes");
  notes.addEventListener("change", () => update(draft, onChange, (next) => { next.notes = notes.value; }));
  details.append(fields, element("h4", undefined, "River flow by edge"), ports, reversible, notes);
  return details;
}

function riverPortSelect(draft: TerrainPatchDocument, direction: HexDirection, onChange: (next: TerrainPatchDocument) => void) {
  const current = draft.riverFlow.inputs.includes(direction) ? "input" : draft.riverFlow.outputs.includes(direction) ? "output" : "none";
  return select(["none", "input", "output"], current, `${direction.toUpperCase()} river flow`, (value) => update(draft, onChange, (next) => {
    next.riverFlow.inputs = next.riverFlow.inputs.filter((candidate) => candidate !== direction);
    next.riverFlow.outputs = next.riverFlow.outputs.filter((candidate) => candidate !== direction);
    if (value === "input") next.riverFlow.inputs.push(direction);
    if (value === "output") next.riverFlow.outputs.push(direction);
  }));
}

function update(source: TerrainPatchDocument, onChange: (next: TerrainPatchDocument) => void, mutate: (next: TerrainPatchDocument) => void) {
  const next = structuredClone(source);
  mutate(next);
  onChange(next);
}

function field(label: string, control: HTMLElement) { return labeledControl(label, control); }

function textInput(label: string, value: string, onChange: (value: string) => void) {
  const input = document.createElement("input");
  input.value = value;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(input.value.trim()));
  return input;
}

function numberInput(label: string, value: number, step: number, onChange: (value: number) => void) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = ".01";
  input.step = String(step);
  input.value = String(value);
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(Number(input.value)));
  return input;
}

function select(values: readonly string[], selected: string, label: string, onChange: (value: string) => void) {
  const control = document.createElement("select");
  control.setAttribute("aria-label", label);
  values.forEach((value) => control.append(new Option(value.replaceAll("-", " "), value, value === selected, value === selected)));
  control.addEventListener("change", () => onChange(control.value));
  return control;
}
