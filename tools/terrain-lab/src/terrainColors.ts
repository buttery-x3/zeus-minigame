import type { TerrainStructure, TerrainSurface } from "../../../src/types";

const STRUCTURE_COLORS: Record<TerrainStructure, string> = {
  open: "#789b68",
  wall: "#5c6070",
  bank: "#b9a16c",
  lake: "#397f9e",
  river: "#58a9ca",
};

const OPEN_SURFACE_COLORS: Partial<Record<TerrainSurface, string>> = {
  grass: "#789b68",
  meadow: "#8cab74",
  sand: "#b9a16c",
  mud: "#65705a",
  stone: "#6d7280",
  scarred: "#8c625f",
  charged: "#4aa99e",
  cursed: "#83609b",
};

export function terrainCellColor(structure: TerrainStructure, surface: TerrainSurface) {
  return structure === "open" ? OPEN_SURFACE_COLORS[surface] ?? STRUCTURE_COLORS.open : STRUCTURE_COLORS[structure];
}
