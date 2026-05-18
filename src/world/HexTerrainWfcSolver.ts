import type { TerrainStructure } from "../types";
import { createHexTerrainTileCatalog, type HexTerrainTileVariant } from "./HexTerrainCatalog";
import { createTerrainStructureCounts, findSocketMismatch, terrainVariantsCanNeighbor, type HexTerrainSocketMismatch } from "./HexTerrainRules";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, hexDistance, type HexCoord, type HexDirection } from "./hexCoordinates";

export type HexTerrainWfcCell = HexCoord & {
  structure: TerrainStructure;
  surface: HexTerrainTileVariant["surface"];
  edges: HexTerrainTileVariant["edges"];
  variant: HexTerrainTileVariant;
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
  structureCounts: Record<TerrainStructure, number>;
  variantCounts: Record<string, number>;
  socketMismatchSample: HexTerrainSocketMismatch | null;
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
  variants?: readonly HexTerrainTileVariant[];
};

type SolveCounters = {
  collapsedCells: number;
  propagationSteps: number;
};

const DEFAULT_SAFE_RADIUS = 6;
const DEFAULT_MAX_ATTEMPTS = 6;

export class HexTerrainWfcRegion {
  private readonly result: HexTerrainWfcResult;

  constructor(options: WfcOptions) {
    this.result = new HexTerrainWfcSolver(options).solve();
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
  private readonly cells: HexCoord[];
  private readonly keys = new Set<string>();
  private readonly coordsByKey = new Map<string, HexCoord>();
  private readonly safeRadius: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: WfcOptions) {
    this.variants = options.variants ?? createHexTerrainTileCatalog();
    this.safeRadius = options.safeRadius ?? DEFAULT_SAFE_RADIUS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.cells = createHexRegion(options.radius);

    for (const cell of this.cells) {
      const key = hexCellKey(cell.q, cell.r);
      this.keys.add(key);
      this.coordsByKey.set(key, cell);
    }

    this.compatible = this.createCompatibilityIndex();
  }

  solve(): HexTerrainWfcResult {
    let lastCounters: SolveCounters = { collapsedCells: 0, propagationSteps: 0 };

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const rng = mulberry32(this.options.seed + attempt * 1_000_003);
      const counters: SolveCounters = { collapsedCells: 0, propagationSteps: 0 };
      const domains = this.createInitialDomains();
      const seeded = this.propagate(domains, this.applySafeStart(domains), counters);

      if (seeded && this.collapseAll(domains, rng, counters)) {
        const cells = this.resolveCells(domains);
        return { cells, diagnostics: this.createDiagnostics(cells, attempt + 1, attempt, counters, false) };
      }

      lastCounters = counters;
    }

    const fallbackCells = this.createOpenFallbackCells();
    return {
      cells: fallbackCells,
      diagnostics: this.createDiagnostics(fallbackCells, this.maxAttempts, this.maxAttempts, lastCounters, true),
    };
  }

  private collapseAll(domains: Map<string, Set<number>>, rng: () => number, counters: SolveCounters) {
    while (true) {
      const key = this.findLowestEntropyCell(domains, rng);
      if (!key) {
        return true;
      }

      const domain = domains.get(key);
      if (!domain || domain.size <= 1) {
        continue;
      }

      domains.set(key, new Set([this.chooseWeightedVariant(domain, rng)]));
      counters.collapsedCells += 1;

      if (!this.propagate(domains, [key], counters)) {
        return false;
      }
    }
  }

  private createInitialDomains() {
    const allVariants = new Set(this.variants.map((_, index) => index));
    const domains = new Map<string, Set<number>>();
    for (const cell of this.cells) {
      domains.set(hexCellKey(cell.q, cell.r), new Set(allVariants));
    }
    return domains;
  }

  private applySafeStart(domains: Map<string, Set<number>>) {
    const openIndexes = this.variants
      .map((variant, index) => ({ variant, index }))
      .filter(({ variant }) => variant.structure === "open")
      .map(({ index }) => index);
    const queue: string[] = [];

    for (const cell of this.cells) {
      if (hexDistance(cell, { q: 0, r: 0 }) > this.safeRadius) {
        continue;
      }

      const key = hexCellKey(cell.q, cell.r);
      domains.set(key, new Set(openIndexes));
      queue.push(key);
    }

    return queue;
  }

  private propagate(domains: Map<string, Set<number>>, initialQueue: string[], counters: SolveCounters) {
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
        const neighborKey = hexCellKey(cell.q + offset.q, cell.r + offset.r);
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
          return false;
        }

        domains.set(neighborKey, filtered);
        queue.push(neighborKey);
        counters.propagationSteps += 1;
      }
    }

    return true;
  }

  private filterNeighborDomain(sourceDomain: Set<number>, direction: HexDirection, neighborDomain: Set<number>) {
    const allowed = new Set<number>();
    for (const sourceIndex of sourceDomain) {
      const targets = this.compatible.get(direction)?.get(sourceIndex);
      for (const targetIndex of targets ?? []) {
        allowed.add(targetIndex);
      }
    }

    return new Set([...neighborDomain].filter((index) => allowed.has(index)));
  }

  private findLowestEntropyCell(domains: Map<string, Set<number>>, rng: () => number) {
    let bestSize = Number.POSITIVE_INFINITY;
    const bestKeys: string[] = [];
    for (const cell of this.cells) {
      const key = hexCellKey(cell.q, cell.r);
      const size = domains.get(key)?.size ?? 0;
      if (size <= 1) {
        continue;
      }
      if (size < bestSize) {
        bestSize = size;
        bestKeys.length = 0;
      }
      if (size === bestSize) {
        bestKeys.push(key);
      }
    }
    return bestKeys.length > 0 ? bestKeys[Math.floor(rng() * bestKeys.length)] : null;
  }

  private chooseWeightedVariant(domain: Set<number>, rng: () => number) {
    let total = 0;
    for (const index of domain) {
      total += this.variants[index].weight;
    }

    let roll = rng() * total;
    for (const index of domain) {
      roll -= this.variants[index].weight;
      if (roll <= 0) {
        return index;
      }
    }

    return domain.values().next().value as number;
  }

  private resolveCells(domains: Map<string, Set<number>>) {
    const cells = new Map<string, HexTerrainWfcCell>();
    for (const cell of this.cells) {
      const index = domains.get(hexCellKey(cell.q, cell.r))?.values().next().value;
      if (typeof index !== "number") {
        continue;
      }
      const variant = this.variants[index];
      cells.set(hexCellKey(cell.q, cell.r), {
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
    const openVariant = this.variants.find((variant) => variant.structure === "open") ?? this.variants[0];
    const cells = new Map<string, HexTerrainWfcCell>();
    for (const cell of this.cells) {
      cells.set(hexCellKey(cell.q, cell.r), {
        q: cell.q,
        r: cell.r,
        structure: openVariant.structure,
        surface: openVariant.surface,
        edges: openVariant.edges,
        variant: openVariant,
      });
    }
    return cells;
  }

  private createDiagnostics(
    cells: Map<string, HexTerrainWfcCell>,
    attempts: number,
    contradictionCount: number,
    counters: SolveCounters,
    fellBack: boolean,
  ): HexTerrainWfcDiagnostics {
    const structureCounts = createTerrainStructureCounts();
    const variantCounts = new Map<string, number>();

    for (const cell of cells.values()) {
      structureCounts[cell.structure] += 1;
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
      structureCounts,
      variantCounts: Object.fromEntries([...variantCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      socketMismatchSample: findSocketMismatch(cells.values()),
      fellBack,
    };
  }

  private createCompatibilityIndex() {
    const compatible = new Map<HexDirection, Map<number, Set<number>>>();
    for (const direction of HEX_DIRECTION_ORDER) {
      const bySource = new Map<number, Set<number>>();
      for (let sourceIndex = 0; sourceIndex < this.variants.length; sourceIndex += 1) {
        const targets = new Set<number>();
        for (let targetIndex = 0; targetIndex < this.variants.length; targetIndex += 1) {
          if (terrainVariantsCanNeighbor(this.variants[sourceIndex], direction, this.variants[targetIndex])) {
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

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
