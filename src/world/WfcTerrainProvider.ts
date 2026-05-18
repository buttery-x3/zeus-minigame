import type { TerrainCell } from "../types";
import { HexTerrainGrammar } from "./HexTerrainGrammar";
import { HexTerrainWfcRegion } from "./HexTerrainWfcSolver";
import { createTerrainCell, type TerrainProvider } from "./TerrainProvider";

const WFC_TERRAIN_RADIUS = 36;
const WFC_TERRAIN_SEED = 20260517;

export class WfcTerrainProvider implements TerrainProvider {
  private readonly terrainGrammar: HexTerrainGrammar;
  private readonly terrainWfc: HexTerrainWfcRegion;

  constructor(worldRadius: number) {
    this.terrainGrammar = new HexTerrainGrammar(worldRadius);
    this.terrainWfc = new HexTerrainWfcRegion(this.terrainGrammar, {
      radius: WFC_TERRAIN_RADIUS,
      seed: WFC_TERRAIN_SEED,
    });
  }

  getCell(q: number, r: number): TerrainCell {
    const wfcCell = this.terrainWfc.getCell(q, r);
    const structure = wfcCell?.structure ?? this.terrainGrammar.getStructure(q, r);
    const surface = wfcCell?.surface ?? this.terrainGrammar.deriveSurface(q, r);
    return createTerrainCell(q, r, structure, surface, wfcCell?.edges);
  }

  getDiagnostics() {
    return {
      ...this.terrainGrammar.getDiagnostics(),
      wfc: this.terrainWfc.getDiagnostics(),
    };
  }
}
