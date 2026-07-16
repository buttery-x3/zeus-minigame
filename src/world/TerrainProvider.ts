import type { HexEdgeKind, HexTileSignature, TerrainCell, TerrainStructure, TerrainSurface } from "../types";
import { terrainBlocksMovement, terrainBlocksSight } from "./HexTerrainRules";
import type { GeneratedTerrainSnapshot } from "./TerrainCompositionReport";

export const MAX_TERRAIN_PATCH_REQUEST_RADIUS = 16;

export function requireBoundedPatchRadius(radius: number) {
  if (!Number.isInteger(radius) || radius < 0 || radius > MAX_TERRAIN_PATCH_REQUEST_RADIUS) {
    throw new RangeError(`Terrain patch radius must be an integer from 0 to ${MAX_TERRAIN_PATCH_REQUEST_RADIUS}; received ${radius}`);
  }
  return radius;
}

export type TerrainGenerationStepResult = {
  requested: boolean;
  generatedPatches: number;
  generationVersion: number;
  complete: boolean;
};

export interface TerrainProvider {
  /** Reads provider-owned committed state without generating, caching, or scheduling work. */
  readCommittedCell(q: number, r: number): Readonly<TerrainCell> | null;
  /** Replaces the rolling request. This method must not commit terrain. */
  requestGenerationAround(q: number, r: number, radius?: number): void;
  /** Performs the only bounded rolling terrain commit operation. */
  stepGeneration(maxNewPatches: number): TerrainGenerationStepResult;
  getGenerationVersion(): number;
  getCommittedCellCount(): number;
  /** Captures only the requested bounded patch region from committed state. */
  captureGeneratedTerrainSnapshot(center: { q: number; r: number }, patchRadius: number): GeneratedTerrainSnapshot;
  getDiagnostics(): unknown;
}

export function createTerrainCell(
  q: number,
  r: number,
  structure: TerrainStructure,
  surface: TerrainSurface,
  edges = resolveTerrainEdges(structure),
): TerrainCell {
  return {
    q,
    r,
    structure,
    surface,
    blocked: terrainBlocksMovement(structure),
    opaque: terrainBlocksSight(structure),
    edges,
  };
}

export function createOutOfBoundsTerrainCell(q: number, r: number): TerrainCell {
  return createTerrainCell(q, r, "wall", "stone", resolveTerrainEdges("wall"));
}

export function resolveTerrainEdges(structure: TerrainStructure): HexTileSignature {
  const kind: HexEdgeKind =
    structure === "wall" ? "closed" : structure === "lake" ? "lake" : structure === "river" ? "river" : "open";

  return {
    ne: kind,
    e: kind,
    se: kind,
    sw: kind,
    w: kind,
    nw: kind,
  };
}
