import type { TerrainCell, TerrainStructure } from "../types";
import {
  createTerrainStructureCounts,
  deriveTerrainSurface,
} from "./HexTerrainRules";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, hexDistance } from "./hexCoordinates";
import { createTerrainCell, type TerrainProvider } from "./TerrainProvider";

export type SeedTerrainProviderDiagnostics = {
  provider: "seed";
  seed: number;
  generatedCells: number;
  structureCounts: Record<TerrainStructure, number>;
};

export class SeedTerrainProvider implements TerrainProvider {
  private readonly cells = new Map<string, TerrainCell>();

  constructor(private readonly seed = 20260517) {}

  getCell(q: number, r: number): TerrainCell {
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
    const surface = deriveTerrainSurface(structure, neighbors, this.hash(q + 31, r - 17));
    const cell = createTerrainCell(q, r, structure, surface);
    this.cells.set(key, cell);
    return cell;
  }

  getDiagnostics(): SeedTerrainProviderDiagnostics {
    const structureCounts = createTerrainStructureCounts();
    for (const cell of this.cells.values()) {
      structureCounts[cell.structure] += 1;
    }

    return {
      provider: "seed",
      seed: this.seed,
      generatedCells: this.cells.size,
      structureCounts,
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
