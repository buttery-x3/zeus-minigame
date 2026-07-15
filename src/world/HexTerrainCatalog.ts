import {
  HEX_PATCH_LOCAL_CELLS,
  createAuthoredPatchVariants,
  type AuthoredPatchDefinition,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";
import { CLIFF_AUTHORED_PATCHES } from "./HexTerrainCliffPatches";
import { CENTER_RING, LINE_STRAIGHT, patchCell as c } from "./HexTerrainLinearShapes";
import { RIVER_AUTHORED_PATCHES } from "./HexTerrainRiverPatches";

export * from "./HexTerrainPatch";

const REGION_AUTHORED_PATCHES: readonly AuthoredPatchDefinition[] = [
  {
    id: "patch.open.grass",
    family: "open",
    weight: 28,
    topology: "open",
  },
  {
    id: "patch.open.dirt",
    family: "open",
    weight: 9,
    topology: "open",
    baseSurface: "dirt",
  },
  {
    id: "patch.open.basin",
    family: "open",
    weight: 12,
    topology: "open",
    openSurfaceCells: {
      dirt: [c(-1, 0), c(0, 0), c(1, 0), c(-1, 1), c(0, 1)],
    },
    rotations: 6,
  },
  {
    id: "patch.lake.cove",
    family: "lake",
    weight: 3,
    topology: "endpoint",
    rotations: 6,
    cells: { lake: [c(1, -2), c(0, -1), c(1, -1), c(0, 0)] },
  },
  {
    id: "patch.lake.shore",
    family: "lake",
    weight: 2.5,
    topology: "mixed",
    rotations: 6,
    cells: { lake: [c(0, -2), c(1, -2), c(2, -2), c(0, -1), c(1, -1), c(2, -1)] },
  },
  {
    id: "patch.lake.basin",
    family: "lake",
    weight: 1.5,
    topology: "isolated",
    rotations: 6,
    cells: { lake: CENTER_RING },
  },
  {
    id: "patch.lake.core",
    family: "lake",
    weight: 0.35,
    topology: "mixed",
    cells: { lake: HEX_PATCH_LOCAL_CELLS },
  },
  {
    id: "patch.transition.river-lake",
    family: "transition",
    weight: 1.5,
    topology: "mixed",
    rotations: 6,
    cells: {
      river: [c(-1, 1), c(-1, 2)],
      lake: [c(1, -2), c(0, -1), c(1, -1), c(0, 0)],
    },
  },
  {
    id: "patch.transition.cliff-river",
    family: "transition",
    weight: 1,
    topology: "mixed",
    rotations: 6,
    cells: {
      wall: LINE_STRAIGHT,
      river: [c(2, -1), c(1, 0), c(0, 1)],
    },
  },
];

const AUTHORED_PATCHES = [
  ...REGION_AUTHORED_PATCHES,
  ...CLIFF_AUTHORED_PATCHES,
  ...RIVER_AUTHORED_PATCHES,
] as const;

export function createHexPatchTileCatalog(): readonly HexPatchTileVariant[] {
  return AUTHORED_PATCHES.flatMap((definition) => createAuthoredPatchVariants(definition));
}

export function summarizeAuthoredPatchFamilies(variants: readonly HexPatchTileVariant[]) {
  return variants.reduce<Record<string, number>>((counts, variant) => {
    counts[variant.family] = (counts[variant.family] ?? 0) + 1;
    return counts;
  }, {});
}
