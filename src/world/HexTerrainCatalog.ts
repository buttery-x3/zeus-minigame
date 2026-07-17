import { createAuthoredPatchVariants, type AuthoredPatchDefinition, type HexPatchTileVariant } from "./HexTerrainPatch";
import { CLIFF_AUTHORED_PATCHES } from "./HexTerrainCliffPatches";
import { HYDROLOGY_AUTHORED_PATCHES } from "./HexTerrainHydrologyPatches";
import { patchCell as c } from "./HexTerrainLinearShapes";
import { assertValidHexPatchVariant } from "./HexTerrainPatchValidation";
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
    id: "patch.open.meadow",
    family: "open",
    weight: 9,
    topology: "open",
    baseSurface: "meadow",
  },
  {
    id: "patch.open.clearing",
    family: "open",
    weight: 12,
    topology: "open",
    openSurfaceCells: {
      meadow: [c(-1, 0), c(0, 0), c(1, 0), c(-1, 1), c(0, 1)],
    },
    rotations: 6,
  },
];

const AUTHORED_PATCHES = [
  ...REGION_AUTHORED_PATCHES,
  ...HYDROLOGY_AUTHORED_PATCHES,
  ...CLIFF_AUTHORED_PATCHES,
  ...RIVER_AUTHORED_PATCHES,
] as const;

export type HexPatchCatalogEntry = {
  definition: AuthoredPatchDefinition;
  variants: readonly HexPatchTileVariant[];
};

export function createHexPatchCatalogEntries(): readonly HexPatchCatalogEntry[] {
  return AUTHORED_PATCHES.map((definition) => ({
    definition,
    variants: createAuthoredPatchVariants(definition).map(assertValidHexPatchVariant),
  }));
}

export function createHexPatchTileCatalog(): readonly HexPatchTileVariant[] {
  return createHexPatchCatalogEntries().flatMap((entry) => entry.variants);
}

export function summarizeAuthoredPatchFamilies(variants: readonly HexPatchTileVariant[]) {
  return variants.reduce<Record<string, number>>((counts, variant) => {
    counts[variant.family] = (counts[variant.family] ?? 0) + 1;
    return counts;
  }, {});
}
