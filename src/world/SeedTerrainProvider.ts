import type { TerrainCell, TerrainStructure, TerrainSurface } from "../types";
import {
  createTerrainStructureCounts,
  createTerrainSurfaceCounts,
  decorateSpecialTerrainSurface,
  deriveTerrainSurface,
} from "./HexTerrainRules";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, hexDistance } from "./hexCoordinates";
import { createHexPatchRegion, HEX_PATCH_LOCAL_CELLS, microToPatchLocal, patchLocalToWorld } from "./HexTerrainPatch";
import {
  createTerrainCell,
  requireBoundedPatchRadius,
  type TerrainGenerationStepResult,
  type TerrainProvider,
} from "./TerrainProvider";
import type { GeneratedTerrainSnapshot } from "./TerrainCompositionReport";

export type SeedTerrainProviderDiagnostics = {
  provider: "seed";
  seed: number;
  generatedCells: number;
  structureCounts: Record<TerrainStructure, number>;
  surfaceCounts: Record<TerrainSurface, number>;
};

export class SeedTerrainProvider implements TerrainProvider {
  private readonly cells = new Map<string, TerrainCell>();
  private readonly committedPatches = new Set<string>();
  private pendingGeneration: { q: number; r: number; radius: number } | null = null;
  private readonly structureCounts = createTerrainStructureCounts();
  private readonly surfaceCounts = createTerrainSurfaceCounts();

  constructor(private readonly seed = 20260517) {}

  readCommittedCell(q: number, r: number) {
    return this.cells.get(hexCellKey(q, r)) ?? null;
  }

  requestGenerationAround(q: number, r: number, radius = 3) {
    requireBoundedPatchRadius(radius);
    this.pendingGeneration = { q, r, radius };
  }

  stepGeneration(maxNewPatches: number): TerrainGenerationStepResult {
    const request = this.pendingGeneration;
    if (!request) {
      return { requested: false, generatedPatches: 0, generationVersion: this.committedPatches.size, complete: true };
    }
    const center = microToPatchLocal(request).patch;
    const patches = createHexPatchRegion(request.radius)
      .map((offset) => ({ q: center.q + offset.q, r: center.r + offset.r }))
      .sort((a, b) => hexDistance(center, a) - hexDistance(center, b) || a.q - b.q || a.r - b.r);
    let generatedPatches = 0;
    for (const patch of patches) {
      if (generatedPatches >= maxNewPatches) break;
      const key = hexCellKey(patch.q, patch.r);
      if (this.committedPatches.has(key)) continue;
      for (const local of HEX_PATCH_LOCAL_CELLS) {
        const cell = patchLocalToWorld(patch, local);
        this.commitCell(cell.q, cell.r);
      }
      this.committedPatches.add(key);
      generatedPatches += 1;
    }
    const complete = patches.every((patch) => this.committedPatches.has(hexCellKey(patch.q, patch.r)));
    if (complete) this.pendingGeneration = null;
    return { requested: true, generatedPatches, generationVersion: this.committedPatches.size, complete };
  }

  getGenerationVersion() {
    return this.committedPatches.size;
  }

  getCommittedCellCount() {
    return this.cells.size;
  }

  captureGeneratedTerrainSnapshot(center: { q: number; r: number }, patchRadius: number): GeneratedTerrainSnapshot {
    requireBoundedPatchRadius(patchRadius);
    const patches = createHexPatchRegion(patchRadius)
      .map((offset) => ({ q: center.q + offset.q, r: center.r + offset.r }))
      .filter((patch) => this.committedPatches.has(hexCellKey(patch.q, patch.r)));
    return {
      seed: this.seed,
      generationVersion: this.committedPatches.size,
      patches: patches.map((patch) => ({
        ...patch,
        variantId: "seed",
        provenance: "procedural" as const,
        family: "open" as const,
        structureCounts: HEX_PATCH_LOCAL_CELLS.reduce((counts, local) => {
          const cell = patchLocalToWorld(patch, local);
          const terrain = this.cells.get(hexCellKey(cell.q, cell.r));
          if (terrain) counts[terrain.structure] += 1;
          return counts;
        }, createTerrainStructureCounts()),
      })),
      cells: patches.flatMap((patch) => HEX_PATCH_LOCAL_CELLS.flatMap((local) => {
        const cell = patchLocalToWorld(patch, local);
        const terrain = this.cells.get(hexCellKey(cell.q, cell.r));
        return terrain ? [{ q: cell.q, r: cell.r, structure: terrain.structure }] : [];
      })),
    };
  }

  private commitCell(q: number, r: number): TerrainCell {
    const key = hexCellKey(q, r);
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }

    const structure = this.structureAt(q, r);
    const neighbors = HEX_DIRECTION_ORDER.map((direction) => {
      const offset = HEX_DIRECTIONS[direction];
      return this.structureAt(q + offset.q, r + offset.r);
    });
    const baseSurface = deriveTerrainSurface(structure, neighbors, this.hash(q + 31, r - 17));
    const surface = decorateSpecialTerrainSurface(structure, baseSurface, q, r, this.seed);
    const cell = createTerrainCell(q, r, structure, surface);
    this.cells.set(key, cell);
    this.structureCounts[structure] += 1;
    this.surfaceCounts[surface] += 1;
    return cell;
  }

  getDiagnostics(): SeedTerrainProviderDiagnostics {
    return {
      provider: "seed",
      seed: this.seed,
      generatedCells: this.cells.size,
      structureCounts: { ...this.structureCounts },
      surfaceCounts: { ...this.surfaceCounts },
    };
  }

  private structureAt(q: number, r: number): TerrainStructure {
    if (hexDistance({ q, r }, { q: 0, r: 0 }) <= 7) {
      return "open";
    }

    const macroQ = Math.floor(q / 6);
    const macroR = Math.floor(r / 6);
    return this.hash(macroQ * 31, macroR * 37) > 0.84 && this.hash(q, r) > 0.47 ? "wall" : "open";
  }

  private hash(q: number, r: number) {
    const n = Math.sin((q + this.seed) * 127.1 + (r - this.seed) * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
}
