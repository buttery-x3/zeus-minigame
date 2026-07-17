import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey } from "../../../../src/world/hexCoordinates";
import { HEX_PATCH_LOCAL_CELL_KEYS, patchLocalToWorld } from "../../../../src/world/HexTerrainPatch";
import type { GeneratedTerrainInspectionSnapshot, GeneratedTerrainPatchInspection } from "../../../../src/world/TerrainInspectionSnapshot";
import type { TerrainNetworkIssue } from "../../../../src/world/TerrainFeatureNetwork";
import { axialPoint } from "../patch/PatchSvg";
import { terrainCellColor } from "../terrainColors";

const SIDE_VERTICES = { ne: [5, 0], e: [0, 1], se: [1, 2], sw: [2, 3], w: [3, 4], nw: [4, 5] } as const;
type HitCenter = { patch: GeneratedTerrainPatchInspection; x: number; y: number; radius: number };

export class WorldCanvas {
  readonly canvas = document.createElement("canvas");
  private snapshot: GeneratedTerrainInspectionSnapshot | null = null;
  private selected: GeneratedTerrainPatchInspection | null = null;
  private hitCenters: HitCenter[] = [];
  private options = { boundaries: true, ids: false, provenance: true, network: true };
  private networkIssues: readonly TerrainNetworkIssue[] = [];
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private lastProject: ((q: number, r: number) => { x: number; y: number }) | null = null;
  private lastViewport = { width: 0, height: 0 };
  private drag: { pointerId: number; x: number; y: number; panX: number; panY: number } | null = null;
  private suppressClick = false;

  constructor(
    private readonly onSelect: (patch: GeneratedTerrainPatchInspection) => void,
    private readonly onCameraChange: (zoomPercent: number) => void = () => undefined,
  ) {
    this.canvas.className = "world-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "Generated terrain world");
    this.canvas.setAttribute("aria-keyshortcuts", "+ - 0 F");
    this.canvas.addEventListener("click", (event) => this.handleClick(event));
    this.canvas.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });
    this.canvas.addEventListener("pointerdown", (event) => this.startDrag(event));
    this.canvas.addEventListener("pointermove", (event) => this.moveDrag(event));
    this.canvas.addEventListener("pointerup", (event) => this.endDrag(event));
    this.canvas.addEventListener("pointercancel", (event) => this.endDrag(event));
    this.canvas.addEventListener("keydown", (event) => this.handleKey(event));
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  setSnapshot(snapshot: GeneratedTerrainInspectionSnapshot | null, selected: GeneratedTerrainPatchInspection | null) {
    this.snapshot = snapshot;
    this.selected = selected;
    if (!snapshot) this.fit(); else this.draw();
  }

  setOptions(options: Partial<typeof this.options>) {
    Object.assign(this.options, options);
    this.draw();
  }

  setNetworkIssues(issues: readonly TerrainNetworkIssue[]) {
    this.networkIssues = issues;
    this.draw();
  }

  fit() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.draw();
    this.notifyCamera();
  }

  zoomIn() { this.zoomBy(1.25); }
  zoomOut() { this.zoomBy(0.8); }

  centerSelected() {
    if (!this.selected || !this.lastProject) return;
    const origin = patchLocalToWorld(this.selected, { q: 0, r: 0 });
    const point = this.lastProject(origin.q, origin.r);
    this.pan.x += this.lastViewport.width / 2 - point.x;
    this.pan.y += this.lastViewport.height / 2 - point.y;
    this.draw();
    this.notifyCamera();
  }

  private zoomBy(factor: number, anchor = { x: this.lastViewport.width / 2, y: this.lastViewport.height / 2 }) {
    const previous = this.zoom;
    const next = Math.max(0.25, Math.min(4, previous * factor));
    if (next === previous) return;
    const ratio = next / previous;
    this.pan.x = anchor.x - this.lastViewport.width / 2 - (anchor.x - this.lastViewport.width / 2 - this.pan.x) * ratio;
    this.pan.y = anchor.y - this.lastViewport.height / 2 - (anchor.y - this.lastViewport.height / 2 - this.pan.y) * ratio;
    this.zoom = next;
    this.draw();
    this.notifyCamera();
  }

  private draw() {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(bounds.width || 900));
    const height = Math.max(240, Math.round(bounds.height || 620));
    this.lastViewport = { width, height };
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    const context = this.canvas.getContext("2d")!;
    context.scale(ratio, ratio);
    context.fillStyle = "#111820";
    context.fillRect(0, 0, width, height);
    if (!this.snapshot?.patches.length) {
      context.fillStyle = "#80909f";
      context.font = "16px system-ui";
      context.textAlign = "center";
      context.fillText("Generate or advance a world to inspect committed patches.", width / 2, height / 2);
      this.hitCenters = [];
      return;
    }
    const worldCells = this.snapshot.patches.flatMap((patch) => patch.variant.cells.map((cell) => ({ patch, cell, world: patchLocalToWorld(patch, cell) })));
    const unitPoints = worldCells.map(({ world }) => axialPoint(world.q, world.r, 1));
    const minX = Math.min(...unitPoints.map((point) => point.x));
    const maxX = Math.max(...unitPoints.map((point) => point.x));
    const minY = Math.min(...unitPoints.map((point) => point.y));
    const maxY = Math.max(...unitPoints.map((point) => point.y));
    const fitSize = Math.min((width - 48) / (maxX - minX + 2), (height - 48) / (maxY - minY + 2));
    const size = fitSize * this.zoom;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const project = (q: number, r: number) => {
      const point = axialPoint(q, r, size);
      return { x: point.x - centerX * size + width / 2 + this.pan.x, y: point.y - centerY * size + height / 2 + this.pan.y };
    };
    this.lastProject = project;
    for (const { patch, cell, world } of worldCells) {
      const point = project(world.q, world.r);
      drawHex(context, point.x, point.y, size * 0.96, terrainCellColor(cell.structure, cell.surface));
      if (this.options.provenance && patch.variant.provenance === "procedural") drawHex(context, point.x, point.y, size * 0.74, "rgba(225, 100, 87, .22)");
    }
    this.hitCenters = this.snapshot.patches.map((patch) => {
      const origin = patchLocalToWorld(patch, { q: 0, r: 0 });
      return { patch, ...project(origin.q, origin.r), radius: size * 3.4 };
    });
    if (this.options.boundaries) {
      for (const patch of this.snapshot.patches) drawPatchBoundary(context, patch, project, size, patch === this.selected ? "#ffd36a" : "rgba(232, 238, 244, .72)", patch === this.selected ? 3 : 1.2);
    }
    if (this.options.ids) drawPatchIds(context, this.hitCenters, size);
    if (this.options.provenance) drawProvenance(context, this.hitCenters, size);
    if (this.options.network) drawNetworkIssues(context, this.hitCenters, this.networkIssues, size);
  }

  private handleWheel(event: WheelEvent) {
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    this.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  private startDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    this.canvas.focus();
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.classList.add("dragging");
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y };
    this.suppressClick = false;
  }

  private moveDrag(event: PointerEvent) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > 4) this.suppressClick = true;
    this.pan = { x: this.drag.panX + dx, y: this.drag.panY + dy };
    this.draw();
  }

  private endDrag(event: PointerEvent) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.canvas.classList.remove("dragging");
    this.notifyCamera();
  }

  private handleKey(event: KeyboardEvent) {
    if (["+", "="].includes(event.key)) this.zoomIn();
    else if (event.key === "-") this.zoomOut();
    else if (["0", "f", "F"].includes(event.key)) this.fit();
    else return;
    event.preventDefault();
  }

  private handleClick(event: MouseEvent) {
    if (this.suppressClick) { this.suppressClick = false; return; }
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const hit = this.hitCenters.map((entry) => ({ entry, distance: Math.hypot(x - entry.x, y - entry.y) }))
      .filter(({ entry, distance }) => distance <= entry.radius).sort((a, b) => a.distance - b.distance)[0]?.entry;
    if (hit) this.onSelect(hit.patch);
  }

  private notifyCamera() { this.onCameraChange(Math.round(this.zoom * 100)); }
}

function drawHex(context: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string) {
  const vertices = hexVertices(x, y, size);
  context.beginPath();
  vertices.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = "rgba(15, 25, 30, .22)";
  context.lineWidth = .5;
  context.stroke();
}

function drawPatchBoundary(context: CanvasRenderingContext2D, patch: GeneratedTerrainPatchInspection, project: (q: number, r: number) => { x: number; y: number }, size: number, color: string, width: number) {
  context.beginPath();
  for (const local of patch.variant.cells) {
    const world = patchLocalToWorld(patch, local);
    const center = project(world.q, world.r);
    const vertices = hexVertices(center.x, center.y, size);
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      if (HEX_PATCH_LOCAL_CELL_KEYS.has(hexCellKey(local.q + offset.q, local.r + offset.r))) continue;
      const [a, b] = SIDE_VERTICES[direction];
      context.moveTo(vertices[a].x, vertices[a].y);
      context.lineTo(vertices[b].x, vertices[b].y);
    }
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function drawPatchIds(context: CanvasRenderingContext2D, hits: readonly HitCenter[], size: number) {
  context.font = `${Math.max(8, Math.min(12, size * .8))}px ui-monospace, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const hit of hits) {
    context.fillStyle = "rgba(10, 15, 20, .8)";
    context.fillText(`${hit.patch.q},${hit.patch.r}`, hit.x, hit.y);
  }
}

function drawProvenance(context: CanvasRenderingContext2D, hits: readonly HitCenter[], size: number) {
  for (const hit of hits.filter((entry) => entry.patch.variant.provenance === "procedural" || entry.patch.emergency)) {
    context.fillStyle = hit.patch.emergency ? "#ff3b30" : "#e66f51";
    context.beginPath();
    context.arc(hit.x, hit.y, Math.max(2.5, size * .24), 0, Math.PI * 2);
    context.fill();
  }
}

function drawNetworkIssues(context: CanvasRenderingContext2D, hits: readonly HitCenter[], issues: readonly TerrainNetworkIssue[], size: number) {
  const severityByPatch = new Map<string, TerrainNetworkIssue["severity"]>();
  const rank = { error: 3, warning: 2, info: 1 };
  for (const issue of issues) {
    for (const patch of issue.patches) {
      const key = hexCellKey(patch.q, patch.r);
      const existing = severityByPatch.get(key);
      if (!existing || rank[issue.severity] > rank[existing]) severityByPatch.set(key, issue.severity);
    }
  }
  for (const hit of hits) {
    const severity = severityByPatch.get(hexCellKey(hit.patch.q, hit.patch.r));
    if (!severity) continue;
    context.beginPath();
    context.arc(hit.x, hit.y, Math.max(7, size * 2.35), 0, Math.PI * 2);
    context.strokeStyle = severity === "error" ? "#ff665a" : severity === "warning" ? "#f2b84b" : "#66b9d8";
    context.lineWidth = Math.max(2, size * .16);
    context.stroke();
  }
}

function hexVertices(x: number, y: number, size: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 30);
    return { x: x + size * Math.cos(angle), y: y + size * Math.sin(angle) };
  });
}
