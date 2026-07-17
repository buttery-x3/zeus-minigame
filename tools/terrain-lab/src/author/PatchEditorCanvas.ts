import { hexCellKey } from "../../../../src/world/hexCoordinates";
import type { TerrainPatchDocument } from "../../../../src/world/TerrainPatchDocument";
import type { TerrainPatchPaint } from "../../../../src/world/TerrainPatchEditing";
import { axialPoint, hexPoints } from "../patch/PatchSvg";
import { terrainCellColor } from "../terrainColors";

const SVG_NS = "http://www.w3.org/2000/svg";

export type PatchEditorTool = "brush" | "bucket" | "eyedropper" | "eraser";

export function createPatchEditorCanvas(
  patchDocument: TerrainPatchDocument,
  tool: PatchEditorTool,
  paint: TerrainPatchPaint,
  showLabels: boolean,
  onStroke: (cellKeys: readonly string[], paint: TerrainPatchPaint) => void,
  onFill: (cellKey: string, paint: TerrainPatchPaint) => void,
  onPick: (cellKey: string) => void,
) {
  const frame = document.createElement("div");
  frame.className = "patch-author-canvas-frame";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("patch-author-canvas");
  svg.setAttribute("viewBox", "-150 -138 300 276");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Editable 19-cell terrain patch");
  const selected = new Set<string>();
  let dragging = false;

  for (const cell of patchDocument.cells) {
    const key = hexCellKey(cell.q, cell.r);
    const { x, y } = axialPoint(cell.q, cell.r, 34);
    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.cell = key;
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${key}: ${cell.structure} ${cell.surface}${patchDocument.lockedCells.includes(key) ? ", locked" : ""}`);
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", hexPoints(x, y, 32));
    polygon.setAttribute("fill", terrainCellColor(cell.structure, cell.surface));
    polygon.classList.add("patch-author-cell");
    if (patchDocument.lockedCells.includes(key)) polygon.classList.add("locked");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${key}: ${cell.structure} / ${cell.surface}`;
    polygon.append(title);
    group.append(polygon);
    if (showLabels) {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(y + 4));
      label.setAttribute("text-anchor", "middle");
      label.textContent = key;
      group.append(label);
    }
    group.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (tool === "bucket") return onFill(key, paint);
      if (tool === "eyedropper") return onPick(key);
      dragging = true;
      selected.clear();
      addSelected(group, key, selected);
      svg.setPointerCapture(event.pointerId);
    });
    group.addEventListener("pointerenter", () => { if (dragging) addSelected(group, key, selected); });
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (tool === "bucket") onFill(key, paint);
      else if (tool === "eyedropper") onPick(key);
      else onStroke([key], paint);
    });
    svg.append(group);
  }
  svg.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    const strokePaint: TerrainPatchPaint = tool === "eraser"
      ? { id: "open-grass", label: "Open grass", structure: "open", surface: "grass" }
      : paint;
    onStroke([...selected], strokePaint);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const target = globalThis.document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGGElement>("g[data-cell]");
    const key = target?.dataset.cell;
    if (target && key) addSelected(target, key, selected);
  });
  svg.addEventListener("pointercancel", () => { dragging = false; selected.clear(); });
  frame.append(svg);
  return frame;
}

function addSelected(group: SVGGElement, key: string, selected: Set<string>) {
  selected.add(key);
  group.querySelector("polygon")?.classList.add("pending");
}
