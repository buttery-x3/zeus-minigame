import type { HexEdgeKind, HexTileSignature, TerrainCell, TerrainStructure, TerrainSurface } from "../types";
import { terrainBlocksMovement, terrainBlocksSight } from "./HexTerrainRules";
import type { GeneratedTerrainSnapshot } from "./TerrainCompositionReport";

export interface TerrainProvider {
  getCell(q: number, r: number): TerrainCell;
  /** Returns a committed cell without expanding rolling terrain. */
  getGeneratedCell?(q: number, r: number): TerrainCell | null;
  ensureGeneratedAround?(q: number, r: number, radius?: number, maxNewPatches?: number): void;
  getGeneratedCellsInRange?(center: { q: number; r: number }, radius: number): TerrainCell[];
  getGenerationVersion?(): number;
  /** Copies committed terrain state without generating or demanding cells. */
  getGeneratedTerrainSnapshot?(): GeneratedTerrainSnapshot;
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
