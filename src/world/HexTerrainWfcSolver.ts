import type { TerrainStructure } from "../types";
import {
  HEX_PATCH_LOCAL_CELLS,
  HEX_PATCH_RADIUS,
  createHexPatchRegion,
  createHexPatchTileCatalog,
  patchLocalToWorld,
  type HexPatchCell,
  type HexPatchTileVariant,
} from "./HexTerrainCatalog";
import { createTerrainStructureCounts, findPatchSocketMismatch, patchVariantsCanNeighbor, type HexPatchSocketMismatch } from "./HexTerrainRules";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, hexDistance, type HexCoord, type HexDirection } from "./hexCoordinates";

export type HexTerrainWfcCell = HexCoord &
  HexPatchCell & {
    patch: HexCoord;
    local: HexCoord;
    variant: HexPatchTileVariant;
  };

export type HexTerrainWfcDiagnostics = {
  enabled: true;
  patchRadius: number;
  patchRegionRadius: number;
  seed: number;
  attempts: number;
  contradictionCount: number;
  collapsedPatchCount: number;
  propagationSteps: number;
  resolvedPatchCount: number;
  resolvedCells: number;
  patchVariantCount: number;
  structureCounts: Record<TerrainStructure, number>;
  patchVariantCounts: Record<string, number>;
  patchSocketMismatchSample: HexPatchSocketMismatch | null;
  fellBack: boolean;
};

export type HexTerrainWfcResult = {
  cells: Map<string, HexTerrainWfcCell>;
  patches: Map<string, HexCoord & { variant: HexPatchTileVariant }>;
  diagnostics: HexTerrainWfcDiagnostics;
};

type WfcOptions = {
  patchRegionRadius: number;
  seed: number;
  safeRadius?: number;
  maxAttempts?: number;
  variants?: readonly HexPatchTileVariant[];
};

type SolveCounters = {
  collapsedPatchCount: number;
  propagationSteps: number;
};

const DEFAULT_SAFE_RADIUS = 1;
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
  private readonly variants: readonly HexPatchTileVariant[];
  private readonly compatible = new Map<HexDirection, Map<number, Set<number>>>();
  private readonly patchCoords: HexCoord[];
  private readonly patchKeys = new Set<string>();
  private readonly coordsByKey = new Map<string, HexCoord>();
  private readonly safeRadius: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: WfcOptions) {
    this.variants = options.variants ?? createHexPatchTileCatalog();
    this.safeRadius = options.safeRadius ?? DEFAULT_SAFE_RADIUS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.patchCoords = createHexPatchRegion(options.patchRegionRadius);

    for (const patch of this.patchCoords) {
      const key = hexCellKey(patch.q, patch.r);
      this.patchKeys.add(key);
      this.coordsByKey.set(key, patch);
    }

    this.compatible = this.createCompatibilityIndex();
  }

  solve(): HexTerrainWfcResult {
    let lastCounters: SolveCounters = { collapsedPatchCount: 0, propagationSteps: 0 };

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const rng = mulberry32(this.options.seed + attempt * 1_000_003);
      const counters: SolveCounters = { collapsedPatchCount: 0, propagationSteps: 0 };
      const domains = this.createInitialDomains();
      const seeded = this.propagate(domains, this.applySafeStart(domains), counters);

      if (seeded && this.collapseAll(domains, rng, counters)) {
        const patches = this.resolvePatches(domains);
        const cells = this.expandPatches(patches);
        return { cells, patches, diagnostics: this.createDiagnostics(cells, patches, attempt + 1, attempt, counters, false) };
      }

      lastCounters = counters;
    }

    const patches = this.createOpenFallbackPatches();
    const cells = this.expandPatches(patches);
    return {
      cells,
      patches,
      diagnostics: this.createDiagnostics(cells, patches, this.maxAttempts, this.maxAttempts, lastCounters, true),
    };
  }

  private collapseAll(domains: Map<string, Set<number>>, rng: () => number, counters: SolveCounters) {
    while (true) {
      const key = this.findLowestEntropyPatch(domains, rng);
      if (!key) {
        return true;
      }

      const domain = domains.get(key);
      if (!domain || domain.size <= 1) {
        continue;
      }

      domains.set(key, new Set([this.chooseWeightedVariant(domain, rng)]));
      counters.collapsedPatchCount += 1;

      if (!this.propagate(domains, [key], counters)) {
        return false;
      }
    }
  }

  private createInitialDomains() {
    const allVariants = new Set(this.variants.map((_, index) => index));
    const domains = new Map<string, Set<number>>();
    for (const patch of this.patchCoords) {
      domains.set(hexCellKey(patch.q, patch.r), new Set(allVariants));
    }
    return domains;
  }

  private applySafeStart(domains: Map<string, Set<number>>) {
    const openIndexes = this.variants
      .map((variant, index) => ({ variant, index }))
      .filter(({ variant }) => variant.diagnostics.kind === "open")
      .map(({ index }) => index);
    const queue: string[] = [];

    for (const patch of this.patchCoords) {
      if (hexDistance(patch, { q: 0, r: 0 }) > this.safeRadius) {
        continue;
      }

      const key = hexCellKey(patch.q, patch.r);
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
      const patch = this.coordsByKey.get(key);
      const sourceDomain = domains.get(key);
      if (!patch || !sourceDomain) {
        continue;
      }

      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const neighborKey = hexCellKey(patch.q + offset.q, patch.r + offset.r);
        if (!this.patchKeys.has(neighborKey)) {
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
      for (const targetIndex of this.compatible.get(direction)?.get(sourceIndex) ?? []) {
        allowed.add(targetIndex);
      }
    }

    return new Set([...neighborDomain].filter((index) => allowed.has(index)));
  }

  private findLowestEntropyPatch(domains: Map<string, Set<number>>, rng: () => number) {
    let bestSize = Number.POSITIVE_INFINITY;
    const bestKeys: string[] = [];
    for (const patch of this.patchCoords) {
      const key = hexCellKey(patch.q, patch.r);
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

  private resolvePatches(domains: Map<string, Set<number>>) {
    const patches = new Map<string, HexCoord & { variant: HexPatchTileVariant }>();
    for (const patch of this.patchCoords) {
      const index = domains.get(hexCellKey(patch.q, patch.r))?.values().next().value;
      if (typeof index !== "number") {
        continue;
      }
      patches.set(hexCellKey(patch.q, patch.r), { ...patch, variant: this.variants[index] });
    }
    return patches;
  }

  private expandPatches(patches: Map<string, HexCoord & { variant: HexPatchTileVariant }>) {
    const cells = new Map<string, HexTerrainWfcCell>();
    for (const patch of patches.values()) {
      for (const local of HEX_PATCH_LOCAL_CELLS) {
        const patchCell = patch.variant.cells.get(hexCellKey(local.q, local.r));
        if (!patchCell) {
          continue;
        }
        const world = patchLocalToWorld(patch, local);
        cells.set(hexCellKey(world.q, world.r), {
          ...world,
          ...patchCell,
          patch: { q: patch.q, r: patch.r },
          local,
          variant: patch.variant,
        });
      }
    }
    return cells;
  }

  private createOpenFallbackPatches() {
    const openVariant = this.variants.find((variant) => variant.diagnostics.kind === "open") ?? this.variants[0];
    const patches = new Map<string, HexCoord & { variant: HexPatchTileVariant }>();
    for (const patch of this.patchCoords) {
      patches.set(hexCellKey(patch.q, patch.r), { ...patch, variant: openVariant });
    }
    return patches;
  }

  private createDiagnostics(
    cells: Map<string, HexTerrainWfcCell>,
    patches: Map<string, HexCoord & { variant: HexPatchTileVariant }>,
    attempts: number,
    contradictionCount: number,
    counters: SolveCounters,
    fellBack: boolean,
  ): HexTerrainWfcDiagnostics {
    const structureCounts = createTerrainStructureCounts();
    const patchVariantCounts = new Map<string, number>();

    for (const cell of cells.values()) {
      structureCounts[cell.structure] += 1;
    }
    for (const patch of patches.values()) {
      patchVariantCounts.set(patch.variant.id, (patchVariantCounts.get(patch.variant.id) ?? 0) + 1);
    }

    return {
      enabled: true,
      patchRadius: HEX_PATCH_RADIUS,
      patchRegionRadius: this.options.patchRegionRadius,
      seed: this.options.seed,
      attempts,
      contradictionCount,
      collapsedPatchCount: counters.collapsedPatchCount,
      propagationSteps: counters.propagationSteps,
      resolvedPatchCount: patches.size,
      resolvedCells: cells.size,
      patchVariantCount: this.variants.length,
      structureCounts,
      patchVariantCounts: Object.fromEntries([...patchVariantCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      patchSocketMismatchSample: findPatchSocketMismatch(patches.values()),
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
          if (patchVariantsCanNeighbor(this.variants[sourceIndex], direction, this.variants[targetIndex])) {
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

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
