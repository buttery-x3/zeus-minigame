import type { HexTileSignature, TerrainStructure, TerrainSurface } from "../types";
import {
  createTerrainStructureCounts,
  findInvalidTerrainSample,
  type HexTerrainGrammar,
  type HexTerrainTileVariant,
  type TerrainGrammarInvalidSample,
} from "./HexTerrainGrammar";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, hexDistance, type HexCoord, type HexDirection } from "./hexCoordinates";

export type HexTerrainWfcCell = HexCoord & {
  structure: TerrainStructure;
  surface: TerrainSurface;
  edges: HexTileSignature;
  variant: HexTerrainTileVariant;
};

export type HexTerrainWfcSocketMismatch = {
  cell: HexCoord & { variantId: string; structure: TerrainStructure };
  direction: HexDirection;
  neighbor: HexCoord & { variantId: string; structure: TerrainStructure };
};

export type HexTerrainWfcDiagnostics = {
  enabled: true;
  regionRadius: number;
  safeRadius: number;
  seed: number;
  attempts: number;
  contradictionCount: number;
  collapsedCells: number;
  propagationSteps: number;
  resolvedCells: number;
  variantCount: number;
  usableVariantCount: number;
  structureCounts: Record<TerrainStructure, number>;
  patternCounts: Record<string, number>;
  variantCounts: Record<string, number>;
  invalidSample: TerrainGrammarInvalidSample | null;
  socketMismatchSample: HexTerrainWfcSocketMismatch | null;
  fellBack: boolean;
};

export type HexTerrainWfcResult = {
  cells: Map<string, HexTerrainWfcCell>;
  diagnostics: HexTerrainWfcDiagnostics;
};

type WfcOptions = {
  radius: number;
  seed: number;
  safeRadius?: number;
  maxAttempts?: number;
};

type SolveCounters = {
  collapsedCells: number;
  propagationSteps: number;
};

const DEFAULT_SAFE_RADIUS = 6;
const DEFAULT_MAX_ATTEMPTS = 1;

export class HexTerrainWfcRegion {
  private readonly result: HexTerrainWfcResult;

  constructor(grammar: HexTerrainGrammar, options: WfcOptions) {
    this.result = new HexTerrainWfcSolver(grammar, options).solve();
  }

  getCell(q: number, r: number) {
    return this.result.cells.get(hexCellKey(q, r)) ?? null;
  }

  getDiagnostics() {
    return this.result.diagnostics;
  }
}

class HexTerrainWfcSolver {
  private readonly variants: readonly HexTerrainTileVariant[];
  private readonly compatible = new Map<HexDirection, Map<number, Set<number>>>();
  private readonly usableVariantIndexes: number[];
  private readonly cells: HexCoord[];
  private readonly keys = new Set<string>();
  private readonly coordsByKey = new Map<string, HexCoord>();
  private readonly safeRadius: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly grammar: HexTerrainGrammar,
    private readonly options: WfcOptions,
  ) {
    this.variants = grammar.getTileVariants();
    this.safeRadius = options.safeRadius ?? DEFAULT_SAFE_RADIUS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.cells = createHexRegion(options.radius);

    for (const cell of this.cells) {
      const key = hexCellKey(cell.q, cell.r);
      this.keys.add(key);
      this.coordsByKey.set(key, cell);
    }

    this.compatible = this.createCompatibilityIndex();
    this.usableVariantIndexes = this.variants
      .map((_, index) => index)
      .filter((index) =>
        HEX_DIRECTION_ORDER.every((direction) => (this.compatible.get(direction)?.get(index)?.size ?? 0) > 0),
      );
  }

  solve(): HexTerrainWfcResult {
    let lastCounters: SolveCounters = { collapsedCells: 0, propagationSteps: 0 };

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const rng = mulberry32(this.options.seed + attempt * 1_000_003);
      const counters: SolveCounters = { collapsedCells: 0, propagationSteps: 0 };
      const domains = this.createInitialDomains();
      const entropies = this.createInitialEntropies(domains);
      const initialQueue = this.applySafeStart(domains, entropies);
      const seeded = this.propagate(domains, entropies, initialQueue, counters);

      if (seeded.ok && this.collapseAll(domains, entropies, rng, counters)) {
        const cells = this.resolveCells(domains);
        return {
          cells,
          diagnostics: this.createDiagnostics(cells, attempt + 1, attempt, counters, false),
        };
      }

      lastCounters = counters;
    }

    const fallbackCells = this.createOpenFallbackCells();
    return {
      cells: fallbackCells,
      diagnostics: this.createDiagnostics(fallbackCells, this.maxAttempts, this.maxAttempts, lastCounters, true),
    };
  }

  private collapseAll(
    domains: Map<string, Set<number>>,
    entropies: Map<string, number>,
    rng: () => number,
    counters: SolveCounters,
  ) {
    while (true) {
      const key = this.findLowestEntropyCell(domains, entropies, rng);
      if (!key) {
        return true;
      }

      const domain = domains.get(key);
      if (!domain || domain.size <= 1) {
        continue;
      }

      const cell = this.coordsByKey.get(key);
      if (!cell) {
        return false;
      }

      domains.set(key, new Set([this.chooseWeightedVariant(domain, rng, cell)]));
      entropies.set(key, Number.POSITIVE_INFINITY);
      counters.collapsedCells += 1;

      const propagated = this.propagate(domains, entropies, [key], counters);
      if (!propagated.ok) {
        return false;
      }
    }
  }

  private createInitialDomains() {
    const allVariants = new Set(this.usableVariantIndexes);
    const domains = new Map<string, Set<number>>();

    for (const cell of this.cells) {
      domains.set(hexCellKey(cell.q, cell.r), new Set(allVariants));
    }

    return domains;
  }

  private createInitialEntropies(domains: Map<string, Set<number>>) {
    const entropies = new Map<string, number>();
    for (const cell of this.cells) {
      const key = hexCellKey(cell.q, cell.r);
      const domain = domains.get(key);
      entropies.set(key, domain?.size ?? Number.POSITIVE_INFINITY);
    }
    return entropies;
  }

  private applySafeStart(domains: Map<string, Set<number>>, entropies: Map<string, number>) {
    const safeVariants = this.usableVariantIndexes.filter((index) => isSafeStartVariant(this.variants[index]));
    const queue: string[] = [];

    for (const cell of this.cells) {
      if (hexDistance(cell, { q: 0, r: 0 }) > this.safeRadius) {
        continue;
      }

      const key = hexCellKey(cell.q, cell.r);
      domains.set(key, new Set(safeVariants));
      entropies.set(key, safeVariants.length);
      queue.push(key);
    }

    return queue;
  }

  private propagate(
    domains: Map<string, Set<number>>,
    entropies: Map<string, number>,
    initialQueue: string[],
    counters: SolveCounters,
  ) {
    const queue = [...initialQueue];
    let cursor = 0;

    while (cursor < queue.length) {
      const key = queue[cursor];
      cursor += 1;
      const cell = this.coordsByKey.get(key);
      const sourceDomain = domains.get(key);
      if (!cell || !sourceDomain) {
        continue;
      }

      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const neighbor = { q: cell.q + offset.q, r: cell.r + offset.r };
        const neighborKey = hexCellKey(neighbor.q, neighbor.r);
        if (!this.keys.has(neighborKey)) {
          continue;
        }

        const neighborDomain = domains.get(neighborKey);
        if (!neighborDomain) {
          continue;
        }

        const filtered = this.filterNeighborDomain(sourceDomain, direction, neighborDomain);
        if (filtered.size === neighborDomain.size) {
          continue;
        }
        if (filtered.size === 0) {
          return { ok: false };
        }

        domains.set(neighborKey, filtered);
        entropies.set(neighborKey, filtered.size);
        queue.push(neighborKey);
        counters.propagationSteps += 1;
      }
    }

    return { ok: true };
  }

  private filterNeighborDomain(sourceDomain: Set<number>, direction: HexDirection, neighborDomain: Set<number>) {
    const compatible = this.compatible.get(direction);
    const allowed = new Set<number>();

    for (const sourceIndex of sourceDomain) {
      const targets = compatible?.get(sourceIndex);
      if (!targets) {
        continue;
      }
      for (const targetIndex of targets) {
        allowed.add(targetIndex);
      }
    }

    const filtered = new Set<number>();
    for (const neighborIndex of neighborDomain) {
      if (allowed.has(neighborIndex)) {
        filtered.add(neighborIndex);
      }
    }

    return filtered;
  }

  private findLowestEntropyCell(domains: Map<string, Set<number>>, entropies: Map<string, number>, rng: () => number) {
    let bestEntropy = Number.POSITIVE_INFINITY;
    const bestKeys: string[] = [];

    for (const cell of this.cells) {
      const key = hexCellKey(cell.q, cell.r);
      const domain = domains.get(key);
      if (!domain || domain.size <= 1) {
        continue;
      }
      const entropy = domain.size;
      if (entropy < bestEntropy - 0.000001) {
        bestEntropy = entropy;
        bestKeys.length = 0;
      }
      if (Math.abs(entropy - bestEntropy) <= 0.000001) {
        bestKeys.push(key);
      }
    }

    return bestKeys.length > 0 ? bestKeys[Math.floor(rng() * bestKeys.length)] : null;
  }

  private chooseWeightedVariant(domain: Set<number>, rng: () => number, cell: HexCoord) {
    let total = 0;
    for (const index of domain) {
      total += this.weightVariantAtCell(this.variants[index], cell);
    }

    let roll = rng() * total;
    for (const index of domain) {
      roll -= this.weightVariantAtCell(this.variants[index], cell);
      if (roll <= 0) {
        return index;
      }
    }

    return domain.values().next().value as number;
  }

  private weightVariantAtCell(variant: HexTerrainTileVariant, cell: HexCoord) {
    return variant.weight * this.structureBiasAtCell(variant.structure, cell) * this.socketBiasAtCell(variant, cell);
  }

  private structureBiasAtCell(structure: TerrainStructure, cell: HexCoord) {
    const distanceFromStart = hexDistance(cell, { q: 0, r: 0 });
    if (distanceFromStart <= this.safeRadius + 2 && structure !== "open") {
      return 0.1;
    }

    const wallDistance = Math.min(
      hexDistance(cell, { q: -11, r: 4 }),
      hexDistance(cell, { q: 8, r: 9 }),
    );
    if (wallDistance <= 3) {
      if (structure === "wall") {
        return 30;
      }
      if (structure === "open" || structure === "bank") {
        return 2.4;
      }
      return 0.16;
    }
    if (wallDistance <= 5) {
      if (structure === "wall") {
        return 7;
      }
      if (structure === "bank") {
        return 2.2;
      }
      return WATER_STRUCTURES_FOR_BIAS.has(structure) ? 0.35 : 1.2;
    }

    const lakeDistance = Math.min(
      hexDistance(cell, { q: -23, r: 16 }),
      hexDistance(cell, { q: 24, r: -17 }),
    );
    if (lakeDistance <= 5) {
      if (structure === "lake") {
        return 34;
      }
      if (structure === "bank" || structure === "open") {
        return 3.4;
      }
      return 0.22;
    }
    if (lakeDistance <= 8) {
      if (structure === "bank") {
        return 8;
      }
      if (structure === "lake" || structure === "open") {
        return 2.2;
      }
      return 0.45;
    }

    const riverCenterQ = Math.round(Math.sin(cell.r * 0.2) * 3 + 16);
    const riverDistance = Math.abs(cell.q - riverCenterQ);
    if (cell.r > -30 && cell.r < 30 && riverDistance === 0) {
      if (structure === "river") {
        return 42;
      }
      if (structure === "bank") {
        return 4;
      }
      return structure === "wall" ? 0.18 : 0.7;
    }
    if (cell.r > -32 && cell.r < 32 && riverDistance === 1) {
      if (structure === "bank") {
        return 8;
      }
      if (structure === "river") {
        return 3;
      }
      return structure === "wall" ? 0.35 : 1.4;
    }

    return 1;
  }

  private socketBiasAtCell(variant: HexTerrainTileVariant, cell: HexCoord) {
    const wallDistance = Math.min(
      hexDistance(cell, { q: -11, r: 4 }),
      hexDistance(cell, { q: 8, r: 9 }),
    );
    const hasClosedSocket = HEX_DIRECTION_ORDER.some((direction) => variant.edges[direction] === "closed");
    const lakeDistance = Math.min(
      hexDistance(cell, { q: -23, r: 16 }),
      hexDistance(cell, { q: 24, r: -17 }),
    );
    const hasLakeSocket = HEX_DIRECTION_ORDER.some((direction) => variant.edges[direction] === "lake");
    const hasRiverSocket = HEX_DIRECTION_ORDER.some((direction) => variant.edges[direction] === "river");

    if (wallDistance <= 5) {
      if (hasClosedSocket) {
        return 18;
      }
      if (hasLakeSocket || hasRiverSocket) {
        return 0.08;
      }
      return 0.65;
    }

    if (lakeDistance <= 8) {
      if (hasLakeSocket) {
        return 22;
      }
      if (variant.patternName.includes("wall")) {
        return 0.08;
      }
      return 0.55;
    }

    const riverCenterQ = Math.round(Math.sin(cell.r * 0.2) * 3 + 16);
    const riverDistance = Math.abs(cell.q - riverCenterQ);
    if (cell.r > -32 && cell.r < 32 && riverDistance <= 1) {
      if (hasRiverSocket) {
        return 24;
      }
      if (variant.patternName.includes("wall")) {
        return 0.08;
      }
      return 0.5;
    }

    return hasLakeSocket || hasRiverSocket ? 0.85 : 1;
  }

  private resolveCells(domains: Map<string, Set<number>>) {
    const cells = new Map<string, HexTerrainWfcCell>();

    for (const cell of this.cells) {
      const key = hexCellKey(cell.q, cell.r);
      const domain = domains.get(key);
      const variantIndex = domain?.values().next().value;
      if (typeof variantIndex !== "number") {
        continue;
      }

      const variant = this.variants[variantIndex];
      cells.set(key, {
        q: cell.q,
        r: cell.r,
        structure: variant.structure,
        surface: variant.surface,
        edges: variant.edges,
        variant,
      });
    }

    return cells;
  }

  private createOpenFallbackCells() {
    const cells = new Map<string, HexTerrainWfcCell>();
    for (const cell of this.cells) {
      const structure = this.grammar.getStructure(cell.q, cell.r);
      const surface = this.grammar.deriveSurface(cell.q, cell.r);
      const variant = this.findFallbackVariant(structure, surface);
      cells.set(hexCellKey(cell.q, cell.r), {
        q: cell.q,
        r: cell.r,
        structure,
        surface,
        edges: variant.edges,
        variant,
      });
    }
    return cells;
  }

  private findFallbackVariant(structure: TerrainStructure, surface: TerrainSurface) {
    return (
      this.variants.find((variant) => variant.structure === structure && variant.surface === surface) ??
      this.variants.find((variant) => variant.structure === structure) ??
      this.variants.find((variant) => isSafeStartVariant(variant)) ??
      this.variants[0]
    );
  }

  private createDiagnostics(
    cells: Map<string, HexTerrainWfcCell>,
    attempts: number,
    contradictionCount: number,
    counters: SolveCounters,
    fellBack: boolean,
  ): HexTerrainWfcDiagnostics {
    const structureCounts = createTerrainStructureCounts();
    const patternCounts = new Map<string, number>();
    const variantCounts = new Map<string, number>();

    for (const cell of cells.values()) {
      structureCounts[cell.structure] += 1;
      patternCounts.set(cell.variant.patternName, (patternCounts.get(cell.variant.patternName) ?? 0) + 1);
      variantCounts.set(cell.variant.id, (variantCounts.get(cell.variant.id) ?? 0) + 1);
    }

    return {
      enabled: true,
      regionRadius: this.options.radius,
      safeRadius: this.safeRadius,
      seed: this.options.seed,
      attempts,
      contradictionCount,
      collapsedCells: counters.collapsedCells,
      propagationSteps: counters.propagationSteps,
      resolvedCells: cells.size,
      variantCount: this.variants.length,
      usableVariantCount: this.usableVariantIndexes.length,
      structureCounts,
      patternCounts: Object.fromEntries([...patternCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      variantCounts: Object.fromEntries([...variantCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      invalidSample: findInvalidTerrainSample(cells.values(), { ignoreIncompleteNeighborhoods: true }),
      socketMismatchSample: this.findSocketMismatch(cells),
      fellBack,
    };
  }

  private findSocketMismatch(cells: Map<string, HexTerrainWfcCell>): HexTerrainWfcSocketMismatch | null {
    for (const cell of cells.values()) {
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const neighbor = cells.get(hexCellKey(cell.q + offset.q, cell.r + offset.r));
        if (!neighbor || this.grammar.variantsCanNeighbor(cell.variant, direction, neighbor.variant)) {
          continue;
        }

        return {
          cell: { q: cell.q, r: cell.r, variantId: cell.variant.id, structure: cell.structure },
          direction,
          neighbor: { q: neighbor.q, r: neighbor.r, variantId: neighbor.variant.id, structure: neighbor.structure },
        };
      }
    }

    return null;
  }

  private createCompatibilityIndex() {
    const compatible = new Map<HexDirection, Map<number, Set<number>>>();

    for (const direction of HEX_DIRECTION_ORDER) {
      const bySource = new Map<number, Set<number>>();
      for (let sourceIndex = 0; sourceIndex < this.variants.length; sourceIndex += 1) {
        const targets = new Set<number>();
        for (let targetIndex = 0; targetIndex < this.variants.length; targetIndex += 1) {
          if (this.grammar.variantsCanNeighbor(this.variants[sourceIndex], direction, this.variants[targetIndex])) {
            targets.add(targetIndex);
          }
        }
        bySource.set(sourceIndex, targets);
      }
      compatible.set(direction, bySource);
    }

    return compatible;
  }
}

function createHexRegion(radius: number) {
  const cells: HexCoord[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    const minR = Math.max(-radius, -q - radius);
    const maxR = Math.min(radius, -q + radius);
    for (let r = minR; r <= maxR; r += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
}

function isSafeStartVariant(variant: HexTerrainTileVariant) {
  return (
    variant.structure === "open" &&
    HEX_DIRECTION_ORDER.every((direction) => variant.neighbors[direction] === "open" && variant.edges[direction] === "open")
  );
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WATER_STRUCTURES_FOR_BIAS = new Set<TerrainStructure>(["lake", "river"]);
