import type { HexEdgeKind, TerrainStructure, TerrainSurface } from "../types";
import type { HexCoord, HexDirection } from "./hexCoordinates";
import { HEX_DIRECTION_ORDER } from "./hexCoordinates";
import { analyzeHexPatchVariant, type TerrainPatchAnalysis } from "./HexTerrainPatchAnalysis";
import type {
  HexPatchFamily,
  HexPatchLakeRole,
  HexPatchProvenance,
  HexPatchRiverPorts,
  HexPatchRiverTerminal,
  HexPatchTileVariant,
  HexPatchTopology,
} from "./HexTerrainPatch";

export type TerrainVariantInspection = {
  id: string;
  family: HexPatchFamily;
  provenance: HexPatchProvenance;
  weight: number;
  selectionGroup: string;
  selectionGroupWeight: number;
  topology: HexPatchTopology;
  riverTerminal?: HexPatchRiverTerminal;
  riverPorts: HexPatchRiverPorts;
  lakeRole?: HexPatchLakeRole;
  cells: readonly (HexCoord & { structure: TerrainStructure; surface: TerrainSurface })[];
  edges: Record<HexDirection, readonly HexEdgeKind[]>;
  procedural?: { boundaryKey: string; fillMode: "open-core" | "enclosed" | "mixed-enclosure" };
  analysis: TerrainPatchAnalysis;
};

export type GeneratedTerrainPatchInspection = HexCoord & {
  emergency: boolean;
  variant: TerrainVariantInspection;
};

export type GeneratedTerrainInspectionSnapshot = {
  seed: number;
  generationVersion: number;
  patches: readonly GeneratedTerrainPatchInspection[];
};

export function inspectTerrainVariant(variant: HexPatchTileVariant): TerrainVariantInspection {
  const edges = {} as TerrainVariantInspection["edges"];
  for (const direction of HEX_DIRECTION_ORDER) edges[direction] = [...variant.edges[direction]];
  return {
    id: variant.id,
    family: variant.family,
    provenance: variant.provenance,
    weight: variant.weight,
    selectionGroup: variant.selectionGroup,
    selectionGroupWeight: variant.selectionGroupWeight,
    topology: variant.topology,
    riverTerminal: variant.riverTerminal,
    riverPorts: { ...variant.riverPorts },
    lakeRole: variant.lakeRole,
    cells: [...variant.cells.values()].map((cell) => ({
      q: cell.q,
      r: cell.r,
      structure: cell.structure,
      surface: cell.surface,
    })),
    edges,
    procedural: variant.procedural ? { ...variant.procedural } : undefined,
    analysis: structuredClone(analyzeHexPatchVariant(variant)),
  };
}
