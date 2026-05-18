import type { HexEdgeKind, HexTileSignature, TerrainCell, TerrainStructure, TerrainSurface } from "../types";
import { terrainBlocksMovement, terrainBlocksSight } from "./HexTerrainRules";

export interface TerrainProvider {
  getCell(q: number, r: number): TerrainCell;
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
