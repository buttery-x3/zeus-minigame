import type { HexEdgeKind, HexTileSignature, TerrainStructure, TerrainSurface } from "../types";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  hexDistance,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";

export type TerrainPatternFamily = "open" | "wall" | "bank" | "lake" | "river";

export type HexTerrainPattern = {
  name: string;
  family: TerrainPatternFamily;
  weight: number;
  center: TerrainStructure;
  neighbors: Record<HexDirection, TerrainStructure>;
};

export type HexTerrainTileVariant = {
  id: string;
  patternName: string;
  family: TerrainPatternFamily;
  structure: TerrainStructure;
  surface: TerrainSurface;
  edges: HexTileSignature;
  weight: number;
  neighbors: Record<HexDirection, TerrainStructure>;
};

type CandidateCell = HexCoord & {
  structure: TerrainStructure;
};

export type TerrainGrammarInvalidSample = {
  kind: "wall_water_adjacency" | "isolated_river" | "isolated_lake" | "orphan_bank";
  cell: HexCoord;
  structure: TerrainStructure;
  neighbor?: HexCoord & { structure: TerrainStructure };
};

export type TerrainGrammarDiagnostics = {
  committedCells: number;
  structureCounts: Record<TerrainStructure, number>;
  patternCounts: Record<string, number>;
  fallbackCount: number;
  repairCount: number;
  invalidSample: TerrainGrammarInvalidSample | null;
};

const WATER_STRUCTURES = new Set<TerrainStructure>(["lake", "river"]);
export const HEX_TERRAIN_PATTERNS = createPatternCatalog();
const TILE_VARIANTS = createTileVariantCatalog(HEX_TERRAIN_PATTERNS);

export class HexTerrainGrammar {
  private readonly structures = new Map<string, TerrainStructure>();
  private readonly patternCounts = new Map<string, number>();
  private fallbackCount = 0;
  private repairCount = 0;

  constructor(private readonly worldRadius: number) {}

  getStructure(q: number, r: number): TerrainStructure {
    if (!this.isInBounds(q, r)) {
      return "wall";
    }

    const key = hexCellKey(q, r);
    const existing = this.structures.get(key);
    if (existing) {
      return existing;
    }

    const pattern = this.selectPattern(q, r);
    this.commitPattern(pattern, q, r);
    return this.structures.get(key) ?? pattern.center;
  }

  deriveSurface(q: number, r: number): TerrainSurface {
    const structure = this.getStructure(q, r);
    const neighbors = this.getNeighborStructures(q, r);
    return deriveTerrainSurface(structure, neighbors, this.hash(q + 31, r - 17));
  }

  getTileVariants() {
    return getHexTerrainTileVariants();
  }

  variantsCanNeighbor(a: HexTerrainTileVariant, direction: HexDirection, b: HexTerrainTileVariant) {
    return terrainVariantsCanNeighbor(a, direction, b);
  }

  getDiagnostics(): TerrainGrammarDiagnostics {
    const structureCounts = createTerrainStructureCounts();
    for (const structure of this.structures.values()) {
      structureCounts[structure] += 1;
    }

    return {
      committedCells: this.structures.size,
      structureCounts,
      patternCounts: Object.fromEntries([...this.patternCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      fallbackCount: this.fallbackCount,
      repairCount: this.repairCount,
      invalidSample: this.findInvalidSample(),
    };
  }

  private selectPattern(q: number, r: number) {
    const preferred = this.preferredStructure(q, r);
    let best: { pattern: HexTerrainPattern; score: number } | null = null;

    for (const pattern of HEX_TERRAIN_PATTERNS) {
      if (!this.patternFits(pattern, q, r)) {
        continue;
      }

      const score = this.scorePattern(pattern, q, r, preferred);
      if (!best || score > best.score) {
        best = { pattern, score };
      }
    }

    if (best) {
      if (best.pattern.center !== preferred) {
        this.fallbackCount += 1;
      }
      return best.pattern;
    }

    this.repairCount += 1;
    return this.createRepairPattern(q, r, preferred);
  }

  private scorePattern(pattern: HexTerrainPattern, q: number, r: number, preferred: TerrainStructure) {
    let score = pattern.weight + this.hash(q + pattern.name.length * 13, r - pattern.name.length * 19) * 4;
    if (pattern.center === preferred) {
      score += 100;
    } else if (pattern.center === "bank" && (preferred === "wall" || WATER_STRUCTURES.has(preferred))) {
      score += 24;
    }

    for (const cell of this.patternCells(pattern, q, r)) {
      if (this.structures.has(hexCellKey(cell.q, cell.r))) {
        score += 6;
        continue;
      }

      const localPreferred = this.preferredStructure(cell.q, cell.r);
      score += cell.structure === localPreferred ? 2 : -1.5;
    }

    return score;
  }

  private patternFits(pattern: HexTerrainPattern, q: number, r: number) {
    const cells = this.patternCells(pattern, q, r);
    const candidateMap = new Map<string, TerrainStructure>();

    for (const cell of cells) {
      if (!this.isInBounds(cell.q, cell.r)) {
        continue;
      }

      const key = hexCellKey(cell.q, cell.r);
      const existing = this.structures.get(key);
      if (existing && existing !== cell.structure) {
        return false;
      }
      candidateMap.set(key, cell.structure);
    }

    for (const cell of cells) {
      if (!this.isInBounds(cell.q, cell.r)) {
        continue;
      }

      if (!this.cellHasValidAdjacency(cell, candidateMap)) {
        return false;
      }
    }

    return true;
  }

  private cellHasValidAdjacency(cell: CandidateCell, candidateMap: Map<string, TerrainStructure>) {
    const neighbors = this.neighborCandidates(cell.q, cell.r, candidateMap);

    if (neighbors.some((neighbor) => structuresCannotTouch(cell.structure, neighbor.structure))) {
      return false;
    }
    if (this.hasUncommittedPreferredConflict(cell, candidateMap)) {
      return false;
    }

    if (cell.structure === "bank") {
      return neighbors.some((neighbor) => neighbor.structure === "wall" || WATER_STRUCTURES.has(neighbor.structure));
    }

    if (cell.structure === "river") {
      return neighbors.some((neighbor) => neighbor.structure === "river" || neighbor.structure === "lake");
    }

    if (cell.structure === "lake") {
      return neighbors.some((neighbor) => neighbor.structure === "lake" || neighbor.structure === "river");
    }

    return true;
  }

  private hasUncommittedPreferredConflict(cell: CandidateCell, candidateMap: Map<string, TerrainStructure>) {
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = { q: cell.q + offset.q, r: cell.r + offset.r };
      if (!this.isInBounds(neighbor.q, neighbor.r)) {
        continue;
      }

      const key = hexCellKey(neighbor.q, neighbor.r);
      if (candidateMap.has(key) || this.structures.has(key)) {
        continue;
      }

      if (structuresCannotTouch(cell.structure, this.preferredStructure(neighbor.q, neighbor.r))) {
        return true;
      }
    }

    return false;
  }

  private neighborCandidates(q: number, r: number, candidateMap: Map<string, TerrainStructure>) {
    const neighbors: (HexCoord & { structure: TerrainStructure })[] = [];
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = { q: q + offset.q, r: r + offset.r };
      if (!this.isInBounds(neighbor.q, neighbor.r)) {
        continue;
      }

      const key = hexCellKey(neighbor.q, neighbor.r);
      const structure = candidateMap.get(key) ?? this.structures.get(key);
      if (structure) {
        neighbors.push({ ...neighbor, structure });
      }
    }
    return neighbors;
  }

  private commitPattern(pattern: HexTerrainPattern, q: number, r: number) {
    for (const cell of this.patternCells(pattern, q, r)) {
      if (!this.isInBounds(cell.q, cell.r)) {
        continue;
      }

      const key = hexCellKey(cell.q, cell.r);
      if (!this.structures.has(key)) {
        this.structures.set(key, cell.structure);
      }
    }

    this.patternCounts.set(pattern.name, (this.patternCounts.get(pattern.name) ?? 0) + 1);
  }

  private patternCells(pattern: HexTerrainPattern, q: number, r: number): CandidateCell[] {
    const cells: CandidateCell[] = [{ q, r, structure: pattern.center }];
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      cells.push({
        q: q + offset.q,
        r: r + offset.r,
        structure: pattern.neighbors[direction],
      });
    }
    return cells;
  }

  private createRepairPattern(q: number, r: number, preferred: TerrainStructure): HexTerrainPattern {
    const committedNeighbors = this.neighborCandidates(q, r, new Map());
    const hasWall = committedNeighbors.some((neighbor) => neighbor.structure === "wall");
    const hasWater = committedNeighbors.some((neighbor) => WATER_STRUCTURES.has(neighbor.structure));
    const center = hasWall && hasWater ? "bank" : committedNeighbors.some((neighbor) => structuresCannotTouch(preferred, neighbor.structure)) ? "bank" : preferred;
    const neighbors = allNeighbors("open");

    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const key = hexCellKey(q + offset.q, r + offset.r);
      neighbors[direction] = this.structures.get(key) ?? "open";
      if (structuresCannotTouch(center, neighbors[direction])) {
        neighbors[direction] = "bank";
      }
    }

    return {
      name: `repair.${center}`,
      family: center,
      weight: 0,
      center,
      neighbors,
    };
  }

  private preferredStructure(q: number, r: number): TerrainStructure {
    if (hexDistance({ q, r }, { q: 0, r: 0 }) <= 6) {
      return "open";
    }

    const water = this.waterField(q, r);
    const nearWall = this.hasAdjacentField(q, r, (neighborQ, neighborR) => this.isWallField(neighborQ, neighborR));
    const nearRiver = this.hasAdjacentField(q, r, (neighborQ, neighborR) => this.isRiverField(neighborQ, neighborR));
    const nearLake = this.hasAdjacentField(q, r, (neighborQ, neighborR) => this.isLakeField(neighborQ, neighborR));

    if (water && nearWall) {
      return "bank";
    }
    if (water) {
      return water;
    }
    if (nearRiver) {
      return "bank";
    }
    if (this.isWallField(q, r) && (nearRiver || nearLake)) {
      return "bank";
    }
    if (this.isWallField(q, r)) {
      return "wall";
    }
    if (nearLake && nearWall) {
      return "bank";
    }

    return "open";
  }

  private getNeighborStructures(q: number, r: number) {
    return HEX_DIRECTION_ORDER.map((direction) => {
      const offset = HEX_DIRECTIONS[direction];
      return this.getStructure(q + offset.q, r + offset.r);
    });
  }

  private waterField(q: number, r: number): TerrainStructure | null {
    if (this.isRiverField(q, r)) {
      return "river";
    }
    if (this.isLakeField(q, r)) {
      return "lake";
    }
    return null;
  }

  private hasAdjacentField(q: number, r: number, predicate: (q: number, r: number) => boolean) {
    return HEX_DIRECTION_ORDER.some((direction) => {
      const offset = HEX_DIRECTIONS[direction];
      return predicate(q + offset.q, r + offset.r);
    });
  }

  private isLakeField(q: number, r: number) {
    if (hexDistance({ q, r }, { q: 0, r: 0 }) < 18) {
      return false;
    }

    const fixedA = hexDistance({ q, r }, { q: -34, r: 24 }) <= 6;
    const fixedB = hexDistance({ q, r }, { q: 42, r: -19 }) <= 5;
    if (fixedA || fixedB) {
      return true;
    }

    const macroQ = Math.floor(q / 28);
    const macroR = Math.floor(r / 28);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dq = -1; dq <= 1; dq += 1) {
        const cellQ = macroQ + dq;
        const cellR = macroR + dr;
        if (this.hash(cellQ * 17 + 3, cellR * 19 - 5) < 0.88) {
          continue;
        }

        const centerQ = cellQ * 28 + Math.floor(this.hash(cellQ, cellR) * 13) - 6;
        const centerR = cellR * 28 + Math.floor(this.hash(cellQ + 11, cellR - 7) * 13) - 6;
        const radius = 4 + Math.floor(this.hash(cellQ - 23, cellR + 29) * 3);
        if (hexDistance({ q, r }, { q: centerQ, r: centerR }) <= radius) {
          return true;
        }
      }
    }

    return false;
  }

  private isRiverField(q: number, r: number) {
    if (hexDistance({ q, r }, { q: 0, r: 0 }) < 15 || r <= -70 || r >= 72) {
      return false;
    }

    const main = this.riverChannel(r, 18);
    if (Math.abs(q - main) <= 0) {
      return true;
    }

    if (r > -36 && r < -8) {
      const branch = this.riverChannel(r, 18) - Math.round((r + 36) / 3);
      return Math.abs(q - branch) <= 0;
    }

    if (r > 18 && r < 42) {
      const branch = this.riverChannel(r, 18) + Math.round((r - 18) / 4);
      return Math.abs(q - branch) <= 0;
    }

    return false;
  }

  private riverChannel(r: number, offset: number) {
    return Math.round(Math.sin(r * 0.18) * 4 + Math.sin(r * 0.047) * 7) + offset;
  }

  private isWallField(q: number, r: number) {
    if (hexDistance({ q, r }, { q: 0, r: 0 }) <= 8) {
      return false;
    }

    const macroQ = Math.floor(q / 6);
    const macroR = Math.floor(r / 6);
    return this.hash(macroQ * 31, macroR * 37) > 0.82 && this.hash(q, r) > 0.44;
  }

  private findInvalidSample(): TerrainGrammarInvalidSample | null {
    for (const [key, structure] of this.structures) {
      const [q, r] = key.split(",").map(Number);
      const cell = { q, r };
      const neighbors = this.getCommittedNeighbors(q, r);

      const invalidPair = neighbors.find((neighbor) => structuresCannotTouch(structure, neighbor.structure));
      if (invalidPair) {
        return { kind: "wall_water_adjacency", cell, structure, neighbor: invalidPair };
      }

      if (structure === "river" && !neighbors.some((neighbor) => neighbor.structure === "river" || neighbor.structure === "lake")) {
        return { kind: "isolated_river", cell, structure };
      }

      if (structure === "lake" && !neighbors.some((neighbor) => neighbor.structure === "lake" || neighbor.structure === "river")) {
        return { kind: "isolated_lake", cell, structure };
      }

      if (structure === "bank" && !neighbors.some((neighbor) => neighbor.structure === "wall" || WATER_STRUCTURES.has(neighbor.structure))) {
        return { kind: "orphan_bank", cell, structure };
      }
    }

    return null;
  }

  private getCommittedNeighbors(q: number, r: number) {
    const neighbors: (HexCoord & { structure: TerrainStructure })[] = [];
    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = { q: q + offset.q, r: r + offset.r };
      const structure = this.structures.get(hexCellKey(neighbor.q, neighbor.r));
      if (structure) {
        neighbors.push({ ...neighbor, structure });
      }
    }
    return neighbors;
  }

  private isInBounds(q: number, r: number) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= this.worldRadius;
  }

  private hash(q: number, r: number) {
    const n = Math.sin(q * 127.1 + r * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
}

export function structuresCannotTouch(a: TerrainStructure, b: TerrainStructure) {
  return (a === "wall" && WATER_STRUCTURES.has(b)) || (b === "wall" && WATER_STRUCTURES.has(a));
}

export function createTerrainStructureCounts(): Record<TerrainStructure, number> {
  return {
    open: 0,
    wall: 0,
    bank: 0,
    lake: 0,
    river: 0,
  };
}

export function getHexTerrainTileVariants() {
  return TILE_VARIANTS;
}

export function deriveTerrainSurface(
  structure: TerrainStructure,
  neighbors: readonly TerrainStructure[],
  h = 0.5,
): TerrainSurface {
  const nearLake = neighbors.includes("lake");
  const nearRiver = neighbors.includes("river");
  const nearWall = neighbors.includes("wall");

  if (structure === "wall") {
    return "stone";
  }
  if (structure === "lake") {
    return "sand";
  }
  if (structure === "river") {
    return "mud";
  }
  if (structure === "bank") {
    if (nearRiver) {
      return "mud";
    }
    if (nearLake) {
      return "sand";
    }
    return nearWall ? "stone" : "dirt";
  }

  if (h > 0.978) {
    return "charged";
  }
  if (h < 0.052) {
    return "scarred";
  }
  if (nearLake) {
    return "sand";
  }
  if (nearRiver) {
    return "mud";
  }
  if (nearWall) {
    return "stone";
  }
  return h > 0.58 ? "dirt" : "grass";
}

export function terrainVariantsCanNeighbor(
  a: HexTerrainTileVariant,
  direction: HexDirection,
  b: HexTerrainTileVariant,
) {
  const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
  const edge = a.edges[direction];

  return (
    edge === b.edges[opposite] &&
    a.neighbors[direction] === b.structure &&
    b.neighbors[opposite] === a.structure &&
    !structuresCannotTouch(a.structure, b.structure) &&
    edgeMatchesStructures(edge, a.structure, b.structure)
  );
}

export function findInvalidTerrainSample(
  cells: Iterable<HexCoord & { structure: TerrainStructure }>,
  options: { ignoreIncompleteNeighborhoods?: boolean } = {},
): TerrainGrammarInvalidSample | null {
  const structures = new Map<string, TerrainStructure>();
  for (const cell of cells) {
    structures.set(hexCellKey(cell.q, cell.r), cell.structure);
  }

  for (const [key, structure] of structures) {
    const [q, r] = key.split(",").map(Number);
    const cell = { q, r };
    const neighbors: (HexCoord & { structure: TerrainStructure })[] = [];

    for (const direction of HEX_DIRECTION_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = { q: q + offset.q, r: r + offset.r };
      const neighborStructure = structures.get(hexCellKey(neighbor.q, neighbor.r));
      if (neighborStructure) {
        neighbors.push({ ...neighbor, structure: neighborStructure });
      }
    }

    const invalidPair = neighbors.find((neighbor) => structuresCannotTouch(structure, neighbor.structure));
    if (invalidPair) {
      return { kind: "wall_water_adjacency", cell, structure, neighbor: invalidPair };
    }

    if (options.ignoreIncompleteNeighborhoods && neighbors.length < HEX_DIRECTION_ORDER.length) {
      continue;
    }

    if (structure === "river" && !neighbors.some((neighbor) => neighbor.structure === "river" || neighbor.structure === "lake")) {
      return { kind: "isolated_river", cell, structure };
    }

    if (structure === "lake" && !neighbors.some((neighbor) => neighbor.structure === "lake" || neighbor.structure === "river")) {
      return { kind: "isolated_lake", cell, structure };
    }

    if (structure === "bank" && !neighbors.some((neighbor) => neighbor.structure === "wall" || WATER_STRUCTURES.has(neighbor.structure))) {
      return { kind: "orphan_bank", cell, structure };
    }
  }

  return null;
}

function edgeMatchesStructures(edge: HexEdgeKind, a: TerrainStructure, b: TerrainStructure) {
  if (edge === "closed") {
    return a === "wall" || b === "wall";
  }
  if (edge === "river") {
    return a === "river" || b === "river";
  }
  if (edge === "lake") {
    return a === "lake" || b === "lake";
  }
  return !WATER_STRUCTURES.has(a) && !WATER_STRUCTURES.has(b) && a !== "wall" && b !== "wall";
}

function createTileVariantCatalog(patterns: readonly HexTerrainPattern[]) {
  const variants: HexTerrainTileVariant[] = [];

  for (const pattern of patterns) {
    const edges = createTileSignature(pattern.center, pattern.neighbors);
    for (const surfaceOption of surfaceOptionsForPattern(pattern)) {
      variants.push({
        id: `${pattern.name}.${surfaceOption.surface}`,
        patternName: pattern.name,
        family: pattern.family,
        structure: pattern.center,
        surface: surfaceOption.surface,
        edges,
        weight: surfaceOption.weight,
        neighbors: pattern.neighbors,
      });
    }
  }

  return variants;
}

function surfaceOptionsForPattern(pattern: HexTerrainPattern) {
  const primary = deriveTerrainSurface(pattern.center, Object.values(pattern.neighbors));
  const weight = pattern.weight;

  if (pattern.center === "wall" || pattern.center === "lake" || pattern.center === "river") {
    return [{ surface: primary, weight }] satisfies { surface: TerrainSurface; weight: number }[];
  }

  const options: { surface: TerrainSurface; weight: number }[] = [];
  if (pattern.center === "open" && (primary === "grass" || primary === "dirt")) {
    options.push({ surface: "grass", weight: weight * 0.68 });
    options.push({ surface: "dirt", weight: weight * 0.32 });
  } else {
    options.push({ surface: primary, weight: weight * 0.95 });
  }

  if (pattern.center === "open" || pattern.center === "bank") {
    options.push({ surface: "scarred", weight: Math.max(0.25, weight * 0.035) });
    options.push({ surface: "charged", weight: Math.max(0.2, weight * 0.022) });
  }

  return options;
}

function createTileSignature(
  center: TerrainStructure,
  neighbors: Record<HexDirection, TerrainStructure>,
): HexTileSignature {
  return {
    ne: edgeKindForStructures(center, neighbors.ne),
    e: edgeKindForStructures(center, neighbors.e),
    se: edgeKindForStructures(center, neighbors.se),
    sw: edgeKindForStructures(center, neighbors.sw),
    w: edgeKindForStructures(center, neighbors.w),
    nw: edgeKindForStructures(center, neighbors.nw),
  };
}

function edgeKindForStructures(a: TerrainStructure, b: TerrainStructure): HexEdgeKind {
  if (a === "wall" || b === "wall") {
    return "closed";
  }
  if (a === "river" || b === "river") {
    return "river";
  }
  if (a === "lake" || b === "lake") {
    return "lake";
  }
  return "open";
}

function createPatternCatalog() {
  const patterns: HexTerrainPattern[] = [];

  addPattern(patterns, "open.field", "open", 32, "open", allNeighbors("open"));
  addRotations(patterns, "open.wall-edge", "open", 12, "open", neighborsWith("open", { ne: "wall" }));
  addRotations(patterns, "open.wall-corner", "open", 10, "open", neighborsWith("open", { ne: "wall", e: "wall" }));
  addRotations(patterns, "open.bank-edge", "open", 14, "open", neighborsWith("open", { ne: "bank" }));
  addRotations(patterns, "open.lake-beach", "open", 8, "open", neighborsWith("open", { ne: "lake", e: "lake" }));

  addPattern(patterns, "wall.core", "wall", 12, "wall", allNeighbors("wall"));
  addRotations(patterns, "wall.edge", "wall", 18, "wall", neighborsWith("open", { ne: "wall", e: "wall", nw: "wall" }));
  addRotations(patterns, "wall.ridge", "wall", 14, "wall", neighborsWith("open", { ne: "wall", sw: "wall" }));
  addRotations(patterns, "wall.bank-edge", "wall", 10, "wall", neighborsWith("open", { ne: "wall", e: "wall", sw: "bank" }));

  addRotations(patterns, "bank.river-shore", "bank", 18, "bank", neighborsWith("open", { ne: "river", e: "river", sw: "open" }));
  addRotations(patterns, "bank.lake-shore", "bank", 16, "bank", neighborsWith("open", { ne: "lake", e: "lake" }));
  addRotations(patterns, "bank.wall-lake", "bank", 16, "bank", neighborsWith("open", { ne: "wall", sw: "lake", w: "lake" }));
  addRotations(patterns, "bank.wall-river", "bank", 16, "bank", neighborsWith("open", { ne: "wall", sw: "river", w: "river" }));

  addPattern(patterns, "lake.core", "lake", 20, "lake", allNeighbors("lake"));
  addRotations(patterns, "lake.edge", "lake", 17, "lake", neighborsWith("open", { ne: "lake", e: "lake", se: "lake" }));
  addRotations(patterns, "lake.bank-edge", "lake", 12, "lake", neighborsWith("bank", { ne: "lake", e: "lake", se: "lake" }));
  addRotations(patterns, "lake.mouth", "lake", 10, "lake", neighborsWith("open", { ne: "lake", e: "lake", sw: "river" }));

  addRotations(patterns, "river.line", "river", 24, "river", neighborsWith("bank", { ne: "river", sw: "river" }));
  addRotations(patterns, "river.bend", "river", 20, "river", neighborsWith("bank", { ne: "river", e: "river" }));
  addRotations(patterns, "river.fork", "river", 12, "river", neighborsWith("bank", { ne: "river", e: "river", sw: "river" }));
  addRotations(patterns, "river.source", "river", 8, "river", neighborsWith("bank", { ne: "river" }));
  addRotations(patterns, "river.mouth", "river", 10, "river", neighborsWith("bank", { ne: "river", sw: "lake" }));

  return patterns;
}

function addPattern(
  patterns: HexTerrainPattern[],
  name: string,
  family: TerrainPatternFamily,
  weight: number,
  center: TerrainStructure,
  neighbors: Record<HexDirection, TerrainStructure>,
) {
  patterns.push({ name, family, weight, center, neighbors });
}

function addRotations(
  patterns: HexTerrainPattern[],
  name: string,
  family: TerrainPatternFamily,
  weight: number,
  center: TerrainStructure,
  neighbors: Record<HexDirection, TerrainStructure>,
) {
  for (let step = 0; step < HEX_DIRECTION_ORDER.length; step += 1) {
    addPattern(patterns, `${name}.${step}`, family, weight, center, rotateNeighbors(neighbors, step));
  }
}

function rotateNeighbors(neighbors: Record<HexDirection, TerrainStructure>, step: number) {
  const rotated = allNeighbors("open");
  for (let index = 0; index < HEX_DIRECTION_ORDER.length; index += 1) {
    const from = HEX_DIRECTION_ORDER[index];
    const to = HEX_DIRECTION_ORDER[(index + step) % HEX_DIRECTION_ORDER.length];
    rotated[to] = neighbors[from];
  }
  return rotated;
}

function allNeighbors(structure: TerrainStructure): Record<HexDirection, TerrainStructure> {
  return {
    ne: structure,
    e: structure,
    se: structure,
    sw: structure,
    w: structure,
    nw: structure,
  };
}

function neighborsWith(
  fallback: TerrainStructure,
  overrides: Partial<Record<HexDirection, TerrainStructure>>,
): Record<HexDirection, TerrainStructure> {
  return { ...allNeighbors(fallback), ...overrides };
}
