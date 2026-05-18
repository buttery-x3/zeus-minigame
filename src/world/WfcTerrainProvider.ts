import type { TerrainCell } from "../types";
import { HexTerrainWfcRegion } from "./HexTerrainWfcSolver";
import { createTerrainCell, type TerrainProvider } from "./TerrainProvider";

const WFC_PATCH_REGION_RADIUS = 8;
const WFC_TERRAIN_SEED = 20260517;

export class WfcTerrainProvider implements TerrainProvider {
  private readonly terrainWfc: HexTerrainWfcRegion;

  constructor(_worldRadius: number) {
    this.terrainWfc = new HexTerrainWfcRegion({
      patchRegionRadius: WFC_PATCH_REGION_RADIUS,
      seed: WFC_TERRAIN_SEED,
    });
  }

  getCell(q: number, r: number): TerrainCell {
    const wfcCell = this.terrainWfc.getCell(q, r);
    if (!wfcCell) {
      return createTerrainCell(q, r, "open", "grass");
    }
    return createTerrainCell(q, r, wfcCell.structure, wfcCell.surface, wfcCell.edges);
  }

  getDiagnostics() {
    return {
      wfc: this.terrainWfc.getDiagnostics(),
    };
  }
}
