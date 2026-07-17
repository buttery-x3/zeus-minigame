import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey } from "../../../../src/world/hexCoordinates";
import { HEX_PATCH_LOCAL_CELL_KEYS, patchLocalToWorld } from "../../../../src/world/HexTerrainPatch";
import type { GeneratedTerrainInspectionSnapshot, GeneratedTerrainPatchInspection } from "../../../../src/world/TerrainInspectionSnapshot";
import { axialPoint } from "../patch/PatchSvg";

const COLORS = { open: "#789b68", wall: "#555a67", bank: "#b9a16c", lake: "#337a99", river: "#51a7c9" } as const;
const SIDE_VERTICES = { ne: [5, 0], e: [0, 1], se: [1, 2], sw: [2, 3], w: [3, 4], nw: [4, 5] } as const;

export class WorldCanvas {
  readonly canvas = document.createElement("canvas");
  private snapshot: GeneratedTerrainInspectionSnapshot | null = null;
  private selected: GeneratedTerrainPatchInspection | null = null;
  private hitCenters: { patch: GeneratedTerrainPatchInspection; x: number; y: number; radius: number }[] = [];
  private options = { boundaries: true, ids: false, provenance: true };

  constructor(private readonly onSelect: (patch: GeneratedTerrainPatchInspection) => void) {
    this.canvas.className = "world-canvas";
    this.canvas.setAttribute("aria-label", "Generated terrain world");
    this.canvas.addEventListener("click", (event) => this.handleClick(event));
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  setSnapshot(snapshot: GeneratedTerrainInspectionSnapshot | null, selected: GeneratedTerrainPatchInspection | null) {
    this.snapshot = snapshot;
    this.selected = selected;
    this.draw();
  }

  setOptions(options: Partial<typeof this.options>) {
    Object.assign(this.options, options);
    this.draw();
  }

  private draw() {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(bounds.width || 900));
    const height = Math.max(420, Math.round(bounds.height || 620));
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
      return;
    }
    const worldCells = this.snapshot.patches.flatMap((patch) => patch.variant.cells.map((cell) => ({ patch, cell, world: patchLocalToWorld(patch, cell) })));
    const points = worldCells.map(({ world }) => axialPoint(world.q, world.r, 1));
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const size = Math.min((width - 48) / (maxX - minX + 2), (height - 48) / (maxY - minY + 2));
    const offsetX = width / 2 - (minX + maxX) / 2 * size;
    const offsetY = height / 2 - (minY + maxY) / 2 * size;
    const project = (q: number, r: number) => {
      const point = axialPoint(q, r, size);
      return { x: point.x + offsetX, y: point.y + offsetY };
    };
    for (const { patch, cell, world } of worldCells) {
      const point = project(world.q, world.r);
      drawHex(context, point.x, point.y, size * 0.96, COLORS[cell.structure]);
      if (this.options.provenance && patch.variant.provenance === "procedural") {
        drawHex(context, point.x, point.y, size * 0.74, "rgba(225, 100, 87, .22)");
      }
    }
    this.hitCenters = this.snapshot.patches.map((patch) => {
      const origin = patchLocalToWorld(patch, { q: 0, r: 0 });
      const center = project(origin.q, origin.r);
      return { patch, ...center, radius: size * 3.4 };
    });
    if (this.options.boundaries) {
      for (const patch of this.snapshot.patches) drawPatchBoundary(context, patch, project, size, patch === this.selected ? "#ffd36a" : "rgba(232, 238, 244, .72)", patch === this.selected ? 3 : 1.2);
    }
    if (this.options.ids) {
      context.font = `${Math.max(8, Math.min(12, size * .8))}px ui-monospace, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const hit of this.hitCenters) {
        context.fillStyle = "rgba(10, 15, 20, .8)";
        context.fillText(`${hit.patch.q},${hit.patch.r}`, hit.x, hit.y);
      }
    }
    if (this.options.provenance) {
      for (const hit of this.hitCenters.filter((entry) => entry.patch.variant.provenance === "procedural" || entry.patch.emergency)) {
        context.fillStyle = hit.patch.emergency ? "#ff3b30" : "#e66f51";
        context.beginPath();
        context.arc(hit.x, hit.y, Math.max(2.5, size * .24), 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  private handleClick(event: MouseEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const hit = this.hitCenters
      .map((entry) => ({ entry, distance: Math.hypot(x - entry.x, y - entry.y) }))
      .filter(({ entry, distance }) => distance <= entry.radius)
      .sort((a, b) => a.distance - b.distance)[0]?.entry;
    if (hit) this.onSelect(hit.patch);
  }
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

function drawPatchBoundary(
  context: CanvasRenderingContext2D,
  patch: GeneratedTerrainPatchInspection,
  project: (q: number, r: number) => { x: number; y: number },
  size: number,
  color: string,
  width: number,
) {
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

function hexVertices(x: number, y: number, size: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 30);
    return { x: x + size * Math.cos(angle), y: y + size * Math.sin(angle) };
  });
}
