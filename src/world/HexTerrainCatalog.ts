import type { HexCoord } from "./hexCoordinates";
import {
  HEX_PATCH_LOCAL_CELLS,
  createAuthoredPatchVariants,
  type AuthoredPatchDefinition,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";

export * from "./HexTerrainPatch";

const c = (q: number, r: number): HexCoord => ({ q, r });

const RIVER_STRAIGHT_A = [c(1, -2), c(1, -1), c(0, 0), c(-1, 1), c(-1, 2)];
const RIVER_STRAIGHT_B = [c(1, -2), c(0, -1), c(0, 0), c(0, 1), c(-1, 2)];
const BEND = [c(1, -2), c(0, -1), c(0, 0), c(1, 0), c(2, -1)];
const FORK = [...RIVER_STRAIGHT_B, c(1, 0), c(2, -1)];
const CENTER_RING = [c(0, 0), c(1, 0), c(1, -1), c(0, -1), c(-1, 0), c(-1, 1), c(0, 1)];

const AUTHORED_PATCHES: readonly AuthoredPatchDefinition[] = [
  {
    id: "patch.open.grass",
    family: "open",
    weight: 28,
  },
  {
    id: "patch.open.dirt",
    family: "open",
    weight: 9,
    baseSurface: "dirt",
  },
  {
    id: "patch.open.basin",
    family: "open",
    weight: 12,
    openSurfaceCells: {
      dirt: [c(-1, 0), c(0, 0), c(1, 0), c(-1, 1), c(0, 1)],
    },
    rotations: 6,
  },
  {
    id: "patch.rock.island",
    family: "cliff",
    weight: 4,
    cells: { wall: [c(0, 0)] },
  },
  {
    id: "patch.rock.pair",
    family: "cliff",
    weight: 2,
    rotations: 6,
    cells: { wall: [c(0, 0), c(1, -1)] },
  },
  {
    id: "patch.cliff.endpoint",
    family: "cliff",
    weight: 3,
    rotations: 6,
    cells: { wall: [c(1, -2), c(1, -1), c(0, 0)] },
  },
  {
    id: "patch.cliff.ridge",
    family: "cliff",
    weight: 6,
    rotations: 6,
    cells: { wall: RIVER_STRAIGHT_A },
  },
  {
    id: "patch.cliff.ridge.sway",
    family: "cliff",
    weight: 5,
    rotations: 6,
    cells: { wall: RIVER_STRAIGHT_B },
  },
  {
    id: "patch.cliff.bend",
    family: "cliff",
    weight: 4,
    rotations: 6,
    cells: { wall: BEND },
  },
  {
    id: "patch.cliff.junction",
    family: "cliff",
    weight: 1.5,
    rotations: 6,
    cells: { wall: FORK },
  },
  {
    id: "patch.cliff.mass",
    family: "cliff",
    weight: 2,
    cells: { wall: CENTER_RING },
  },
  {
    id: "patch.cliff.core",
    family: "cliff",
    weight: 0.5,
    cells: { wall: HEX_PATCH_LOCAL_CELLS },
  },
  {
    id: "patch.river.source",
    family: "river",
    weight: 4,
    rotations: 6,
    cells: {
      bank: [c(0, -1), c(1, 0), c(-1, 1)],
      river: [c(1, -2), c(1, -1), c(0, 0)],
    },
  },
  {
    id: "patch.river.line",
    family: "river",
    weight: 12,
    rotations: 6,
    cells: {
      bank: [c(0, -1), c(2, -1), c(1, 0), c(-1, 0), c(0, 1), c(-2, 1)],
      river: RIVER_STRAIGHT_A,
    },
  },
  {
    id: "patch.river.line.sway",
    family: "river",
    weight: 10,
    rotations: 6,
    cells: {
      bank: [c(0, -2), c(1, -1), c(-1, -1), c(1, 0), c(-1, 0), c(1, 1), c(-1, 1), c(0, 2)],
      river: RIVER_STRAIGHT_B,
    },
  },
  {
    id: "patch.river.bend",
    family: "river",
    weight: 8,
    rotations: 6,
    cells: {
      bank: [c(0, -2), c(1, -1), c(-1, -1), c(-1, 0), c(0, 1), c(1, 1), c(2, 0)],
      river: BEND,
    },
  },
  {
    id: "patch.river.fork",
    family: "river",
    weight: 2,
    rotations: 6,
    cells: {
      bank: [c(0, -2), c(-1, -1), c(-1, 0), c(0, 1), c(1, 1), c(2, 0)],
      river: FORK,
    },
  },
  {
    id: "patch.lake.cove",
    family: "lake",
    weight: 3,
    rotations: 6,
    cells: {
      bank: [c(0, -2), c(2, -2), c(-1, -1), c(2, -1), c(-1, 0), c(1, 0), c(-1, 1), c(0, 1)],
      lake: [c(1, -2), c(0, -1), c(1, -1), c(0, 0)],
    },
  },
  {
    id: "patch.lake.shore",
    family: "lake",
    weight: 2.5,
    rotations: 6,
    cells: {
      bank: [c(-1, -1), c(0, 0), c(1, 0), c(-1, 0)],
      lake: [c(0, -2), c(1, -2), c(2, -2), c(0, -1), c(1, -1), c(2, -1)],
    },
  },
  {
    id: "patch.lake.basin",
    family: "lake",
    weight: 1.5,
    rotations: 6,
    cells: {
      bank: [c(0, -2), c(2, -2), c(2, 0), c(0, 2), c(-2, 2), c(-2, 0)],
      lake: CENTER_RING,
    },
  },
  {
    id: "patch.lake.core",
    family: "lake",
    weight: 0.35,
    cells: { lake: HEX_PATCH_LOCAL_CELLS },
  },
  {
    id: "patch.transition.river-lake",
    family: "transition",
    weight: 1.5,
    rotations: 6,
    cells: {
      bank: [c(0, -2), c(2, -2), c(-1, -1), c(-1, 0), c(1, 0), c(-1, 1), c(0, 1)],
      river: [c(-1, 1), c(-1, 2)],
      lake: [c(1, -2), c(0, -1), c(1, -1), c(0, 0)],
    },
  },
  {
    id: "patch.transition.cliff-river",
    family: "transition",
    weight: 1,
    rotations: 6,
    cells: {
      bank: [c(0, -1), c(-1, 0), c(-2, 1)],
      wall: [c(1, -2), c(1, -1), c(0, 0), c(-1, 1), c(-1, 2)],
      river: [c(2, -1), c(1, 0), c(0, 1)],
    },
  },
];

export function createHexPatchTileCatalog(): readonly HexPatchTileVariant[] {
  return AUTHORED_PATCHES.flatMap((definition) => createAuthoredPatchVariants(definition));
}

export function summarizeAuthoredPatchFamilies(variants: readonly HexPatchTileVariant[]) {
  return variants.reduce<Record<string, number>>((counts, variant) => {
    counts[variant.family] = (counts[variant.family] ?? 0) + 1;
    return counts;
  }, {});
}
