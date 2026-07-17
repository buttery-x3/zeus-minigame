import { createAuthoredPatchVariants, type AuthoredPatchDefinition, type HexPatchTileVariant } from "./HexTerrainPatch";
import { CLIFF_AUTHORED_PATCHES } from "./HexTerrainCliffPatches";
import { HYDROLOGY_AUTHORED_PATCHES } from "./HexTerrainHydrologyPatches";
import { assertValidHexPatchVariant } from "./HexTerrainPatchValidation";
import { RIVER_AUTHORED_PATCHES } from "./HexTerrainRiverPatches";
import customPatchPack from "./authored-patches/custom-patches.json";
import { compileTerrainPatchPack } from "./TerrainPatchPack";

export * from "./HexTerrainPatch";

const REGION_AUTHORED_PATCHES: readonly AuthoredPatchDefinition[] = [
  {
    id: "patch.open.grass",
    family: "open",
    weight: 28,
    // Preserves grass 28 + meadow 9 + six clearing groups at 12 * 6 orientations each.
    selectionGroupWeight: 28 + 9 + 6 * (12 * 6),
    topology: "open",
  },
];

const BUILT_IN_AUTHORED_PATCHES: readonly AuthoredPatchDefinition[] = [
  ...REGION_AUTHORED_PATCHES,
  ...HYDROLOGY_AUTHORED_PATCHES,
  ...CLIFF_AUTHORED_PATCHES,
  ...RIVER_AUTHORED_PATCHES,
];

const AUTHORED_PATCHES = mergeAuthoredPatchDefinitions(BUILT_IN_AUTHORED_PATCHES, compileTerrainPatchPack(customPatchPack));

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

export function createBuiltInHexPatchDefinitions() { return [...BUILT_IN_AUTHORED_PATCHES]; }

export function createHexPatchTileCatalog(): readonly HexPatchTileVariant[] {
  return createHexPatchCatalogEntries().flatMap((entry) => entry.variants);
}

export function summarizeAuthoredPatchFamilies(variants: readonly HexPatchTileVariant[]) {
  return variants.reduce<Record<string, number>>((counts, variant) => {
    counts[variant.family] = (counts[variant.family] ?? 0) + 1;
    return counts;
  }, {});
}

export function mergeAuthoredPatchDefinitions(builtIn: readonly AuthoredPatchDefinition[], custom: readonly AuthoredPatchDefinition[]) {
  const definitions = new Map(builtIn.map((definition) => [definition.id, definition]));
  custom.forEach((definition) => definitions.set(definition.id, definition));
  return [...definitions.values()];
}
