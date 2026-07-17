import type { TerrainStructure, TerrainSurface } from "../types";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, type HexCoord, type HexDirection } from "./hexCoordinates";
import { HEX_PATCH_EDGE_CELLS, HEX_PATCH_LOCAL_CELL_KEYS } from "./HexTerrainPatch";
import type { TerrainPatchDocument, TerrainPatchDocumentCell } from "./TerrainPatchDocument";

export type TerrainPatchPaint = {
  id: "open-grass" | "open-meadow" | "cliff" | "rock" | "river" | "lake";
  label: string;
  structure: TerrainPatchDocumentCell["structure"];
  surface: TerrainSurface;
};

export const TERRAIN_PATCH_PAINTS: readonly TerrainPatchPaint[] = [
  { id: "open-grass", label: "Open grass", structure: "open", surface: "grass" },
  { id: "open-meadow", label: "Open meadow", structure: "open", surface: "meadow" },
  { id: "cliff", label: "Cliff", structure: "wall", surface: "stone" },
  { id: "rock", label: "Rock", structure: "wall", surface: "stone" },
  { id: "river", label: "River", structure: "river", surface: "mud" },
  { id: "lake", label: "Lake", structure: "lake", surface: "sand" },
];

export function paintTerrainPatchCells(document: TerrainPatchDocument, cellKeys: readonly string[], paint: Pick<TerrainPatchPaint, "structure" | "surface">) {
  const selected = new Set(cellKeys.filter((key) => HEX_PATCH_LOCAL_CELL_KEYS.has(key) && !document.lockedCells.includes(key)));
  if (selected.size === 0) return document;
  const next = structuredClone(document);
  next.cells = next.cells.map((cell) => selected.has(hexCellKey(cell.q, cell.r)) ? { ...cell, structure: paint.structure, surface: paint.surface } : cell);
  return next;
}

export function floodFillTerrainPatch(document: TerrainPatchDocument, startKey: string, paint: Pick<TerrainPatchPaint, "structure" | "surface">) {
  const start = document.cells.find((cell) => hexCellKey(cell.q, cell.r) === startKey);
  if (!start || document.lockedCells.includes(startKey)) return document;
  if (start.structure === paint.structure && start.surface === paint.surface) return document;
  const cellByKey = new Map(document.cells.map((cell) => [hexCellKey(cell.q, cell.r), cell]));
  const fillKeys = new Set([startKey]);
  const queue: HexCoord[] = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index];
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const key = hexCellKey(cell.q + offset.q, cell.r + offset.r);
      const candidate = cellByKey.get(key);
      if (!candidate || fillKeys.has(key) || document.lockedCells.includes(key)) continue;
      if (candidate.structure !== start.structure || candidate.surface !== start.surface) continue;
      fillKeys.add(key);
      queue.push(candidate);
    }
  }
  return paintTerrainPatchCells(document, [...fillKeys], paint);
}

export function rotateTerrainPatchDocument(document: TerrainPatchDocument, steps = 1) {
  return transformTerrainPatchDocument(document, (coord) => rotateCoord(coord, steps), (direction) => transformDirection(direction, (coord) => rotateCoord(coord, steps)));
}

export function mirrorTerrainPatchDocument(document: TerrainPatchDocument) {
  return transformTerrainPatchDocument(document, mirrorCoord, (direction) => transformDirection(direction, mirrorCoord));
}

export function applyTerrainPatchBoundary(
  document: TerrainPatchDocument,
  boundary: Partial<Record<HexDirection, readonly ("open" | "closed" | "river" | "lake")[]>>,
  lock = true,
) {
  let next = structuredClone(document);
  const locked = new Set(next.lockedCells);
  for (const direction of HEX_DIRECTION_ORDER) {
    const edge = boundary[direction];
    if (!edge) continue;
    edge.forEach((kind, index) => {
      const coord = HEX_PATCH_EDGE_CELLS[direction][index];
      const key = hexCellKey(coord.q, coord.r);
      const structure = structureForBoundary(kind);
      const surface = surfaceForStructure(structure);
      next = paintIncludingLocks(next, [key], { structure, surface });
      if (lock) locked.add(key);
    });
  }
  next.lockedCells = [...locked].sort();
  return next;
}

export function setTerrainPatchBoundaryLocked(document: TerrainPatchDocument, locked: boolean) {
  const next = structuredClone(document);
  next.lockedCells = locked ? [...new Set(HEX_PATCH_EDGE_CELLS.ne.concat(
    HEX_PATCH_EDGE_CELLS.e, HEX_PATCH_EDGE_CELLS.se, HEX_PATCH_EDGE_CELLS.sw, HEX_PATCH_EDGE_CELLS.w, HEX_PATCH_EDGE_CELLS.nw,
  ).map((cell) => hexCellKey(cell.q, cell.r)))].sort() : [];
  return next;
}

export function terrainPatchPaintAt(document: TerrainPatchDocument, cellKey: string): TerrainPatchPaint {
  const cell = document.cells.find((candidate) => hexCellKey(candidate.q, candidate.r) === cellKey);
  const found = cell && TERRAIN_PATCH_PAINTS.find((paint) => paint.structure === cell.structure && paint.surface === cell.surface);
  return found ?? TERRAIN_PATCH_PAINTS[0];
}

export class TerrainPatchHistory {
  private past: TerrainPatchDocument[] = [];
  private future: TerrainPatchDocument[] = [];

  constructor(private current: TerrainPatchDocument, private readonly limit = 100) {}

  get value() { return structuredClone(this.current); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  replace(document: TerrainPatchDocument, record = true) {
    if (sameDocument(this.current, document)) return this.value;
    if (record) {
      this.past.push(structuredClone(this.current));
      if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
      this.future = [];
    }
    this.current = structuredClone(document);
    return this.value;
  }

  undo() {
    const previous = this.past.pop();
    if (!previous) return this.value;
    this.future.push(structuredClone(this.current));
    this.current = previous;
    return this.value;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return this.value;
    this.past.push(structuredClone(this.current));
    this.current = next;
    return this.value;
  }

  reset(document: TerrainPatchDocument) {
    this.current = structuredClone(document);
    this.past = [];
    this.future = [];
    return this.value;
  }
}

function transformTerrainPatchDocument(
  document: TerrainPatchDocument,
  transformCoord: (coord: HexCoord) => HexCoord,
  transformDirection: (direction: HexDirection) => HexDirection,
) {
  const next = structuredClone(document);
  next.cells = next.cells.map((cell) => ({ ...cell, ...transformCoord(cell) })).sort(cellOrder);
  next.lockedCells = next.lockedCells.map((key) => {
    const [q, r] = key.split(",").map(Number);
    const coord = transformCoord({ q, r });
    return hexCellKey(coord.q, coord.r);
  }).sort();
  next.riverFlow.inputs = next.riverFlow.inputs.map(transformDirection);
  next.riverFlow.outputs = next.riverFlow.outputs.map(transformDirection);
  return next;
}

function transformDirection(direction: HexDirection, transform: (coord: HexCoord) => HexCoord) {
  const transformed = transform(HEX_PATCH_EDGE_CELLS[direction][1]);
  const match = HEX_DIRECTION_ORDER.find((candidate) => {
    const center = HEX_PATCH_EDGE_CELLS[candidate][1];
    return center.q === transformed.q && center.r === transformed.r;
  });
  if (!match) throw new Error(`Unable to transform ${direction}`);
  return match;
}

function rotateCoord(coord: HexCoord, steps: number) {
  let { q, r } = coord;
  for (let index = 0; index < (steps % 6 + 6) % 6; index += 1) [q, r] = [-r, q + r];
  return { q, r };
}

function mirrorCoord({ q, r }: HexCoord) { return { q, r: -q - r }; }

function paintIncludingLocks(document: TerrainPatchDocument, keys: readonly string[], paint: { structure: TerrainPatchDocumentCell["structure"]; surface: TerrainSurface }) {
  const next = structuredClone(document);
  const selected = new Set(keys);
  next.cells = next.cells.map((cell) => selected.has(hexCellKey(cell.q, cell.r)) ? { ...cell, ...paint } : cell);
  return next;
}

function structureForBoundary(kind: "open" | "closed" | "river" | "lake"): TerrainPatchDocumentCell["structure"] {
  return kind === "closed" ? "wall" : kind;
}

function surfaceForStructure(structure: TerrainStructure): TerrainSurface {
  return structure === "wall" ? "stone" : structure === "river" ? "mud" : structure === "lake" ? "sand" : "grass";
}

function cellOrder(a: HexCoord, b: HexCoord) { return a.q - b.q || a.r - b.r; }
function sameDocument(a: TerrainPatchDocument, b: TerrainPatchDocument) { return JSON.stringify(a) === JSON.stringify(b); }
