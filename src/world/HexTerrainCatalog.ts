import type { HexTileSignature, TerrainStructure, TerrainSurface } from "../types";
import { HEX_DIRECTION_ORDER, type HexDirection } from "./hexCoordinates";

export type HexTerrainTileVariant = {
  id: string;
  structure: TerrainStructure;
  surface: TerrainSurface;
  edges: HexTileSignature;
  weight: number;
};

export function createHexTerrainTileCatalog(): readonly HexTerrainTileVariant[] {
  const variants: HexTerrainTileVariant[] = [
    variant("open.field", "open", "grass", edges("open"), 24),
    variant("open.dirt", "open", "dirt", edges("open"), 10),
    variant("wall.core", "wall", "stone", edges("closed"), 4),
  ];

  addRotations(variants, "wall.edge", "wall", "stone", withEdges("open", { ne: "closed" }), 3);
  addRotations(variants, "wall.corner", "wall", "stone", withEdges("open", { ne: "closed", e: "closed" }), 2);
  addRotations(variants, "river.line", "river", "mud", withEdges("open", { ne: "river", sw: "river" }), 16);
  addRotations(variants, "river.bend", "river", "mud", withEdges("open", { ne: "river", e: "river" }), 12);
  addRotations(variants, "river.fork", "river", "mud", withEdges("open", { ne: "river", e: "river", sw: "river" }), 5);
  addRotations(variants, "river.source", "river", "mud", withEdges("open", { ne: "river" }), 3);

  return variants;
}

function addRotations(
  variants: HexTerrainTileVariant[],
  id: string,
  structure: TerrainStructure,
  surface: TerrainSurface,
  signature: HexTileSignature,
  weight: number,
) {
  for (let step = 0; step < HEX_DIRECTION_ORDER.length; step += 1) {
    variants.push(variant(`${id}.${step}`, structure, surface, rotateEdges(signature, step), weight));
  }
}

function variant(
  id: string,
  structure: TerrainStructure,
  surface: TerrainSurface,
  signature: HexTileSignature,
  weight: number,
): HexTerrainTileVariant {
  return { id, structure, surface, edges: signature, weight };
}

function edges(kind: HexTileSignature[HexDirection]): HexTileSignature {
  return {
    ne: kind,
    e: kind,
    se: kind,
    sw: kind,
    w: kind,
    nw: kind,
  };
}

function withEdges(kind: HexTileSignature[HexDirection], overrides: Partial<HexTileSignature>): HexTileSignature {
  return { ...edges(kind), ...overrides };
}

function rotateEdges(signature: HexTileSignature, step: number): HexTileSignature {
  const rotated = edges("open");
  for (let index = 0; index < HEX_DIRECTION_ORDER.length; index += 1) {
    const from = HEX_DIRECTION_ORDER[index];
    const to = HEX_DIRECTION_ORDER[(index + step) % HEX_DIRECTION_ORDER.length];
    rotated[to] = signature[from];
  }
  return rotated;
}
