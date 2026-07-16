import type { TerrainCell } from "../types";
import type { TerrainProvider } from "./TerrainProvider";

export function createStaticTerrainProvider(
  readCommittedCell: (q: number, r: number) => TerrainCell | null,
): TerrainProvider {
  return {
    readCommittedCell,
    requestGenerationAround() {},
    stepGeneration() {
      return { requested: false, generatedPatches: 0, generationVersion: 0, complete: true };
    },
    getGenerationVersion() {
      return 0;
    },
    getCommittedCellCount() {
      return 0;
    },
    captureGeneratedTerrainSnapshot() {
      return { seed: 0, generationVersion: 0, patches: [], cells: [] };
    },
    getDiagnostics() {
      return {};
    },
  };
}
