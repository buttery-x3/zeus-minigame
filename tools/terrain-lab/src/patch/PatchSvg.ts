import { hexCellKey } from "../../../../src/world/hexCoordinates";
import type { TerrainVariantInspection } from "../../../../src/world/TerrainInspectionSnapshot";
import { terrainCellColor } from "../terrainColors";

const SVG_NS = "http://www.w3.org/2000/svg";
const COMPONENT_COLORS = ["#f7c948", "#e66f51", "#aa7ee8", "#58d6c7", "#ff8fcf", "#a8d85e"];

export function createPatchSvg(inspection: TerrainVariantInspection, options: { labels?: boolean; components?: boolean } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "-118 -102 236 204");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Patch ${inspection.id}`);
  svg.classList.add("patch-svg");
  const componentByCell = new Map<string, number>();
  inspection.analysis.components.forEach((component, index) => {
    component.cells.forEach((cell) => componentByCell.set(hexCellKey(cell.q, cell.r), index));
  });

  for (const cell of inspection.cells) {
    const { x, y } = axialPoint(cell.q, cell.r, 31);
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", hexPoints(x, y, 29));
    polygon.setAttribute("fill", terrainCellColor(cell.structure, cell.surface));
    polygon.setAttribute("stroke", options.components
      ? COMPONENT_COLORS[(componentByCell.get(hexCellKey(cell.q, cell.r)) ?? 0) % COMPONENT_COLORS.length]
      : "#17202a");
    polygon.setAttribute("stroke-width", options.components ? "3" : "1.5");
    polygon.dataset.cell = `${cell.q},${cell.r}`;
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${cell.q},${cell.r}: ${cell.structure} / ${cell.surface}`;
    polygon.append(title);
    svg.append(polygon);
    if (options.labels !== false) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", String(x));
      text.setAttribute("y", String(y + 3));
      text.setAttribute("text-anchor", "middle");
      text.textContent = `${cell.q},${cell.r}`;
      svg.append(text);
    }
  }
  return svg;
}

export function axialPoint(q: number, r: number, size: number) {
  return { x: Math.sqrt(3) * size * (q + r / 2), y: 1.5 * size * r };
}

export function hexPoints(x: number, y: number, size: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 30);
    return `${x + size * Math.cos(angle)},${y + size * Math.sin(angle)}`;
  }).join(" ");
}
