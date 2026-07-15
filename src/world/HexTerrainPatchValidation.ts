import { HEX_DIRECTION_ORDER, hexCellKey } from "./hexCoordinates";
import {
  HEX_PATCH_EDGE_LENGTH,
  HEX_PATCH_LOCAL_CELLS,
  derivePatchEdges,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";

export type HexPatchValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateHexPatchVariant(variant: HexPatchTileVariant): HexPatchValidationResult {
  const errors: string[] = [];
  if (!variant.id) {
    errors.push("missing patch id");
  }
  if (variant.provenance === "authored" && variant.weight <= 0) {
    errors.push("authored patch weight must be positive");
  }
  if (variant.provenance === "procedural" && variant.weight !== 0) {
    errors.push("procedural patch weight must be zero");
  }
  if (variant.cells.size !== HEX_PATCH_LOCAL_CELLS.length) {
    errors.push(`expected ${HEX_PATCH_LOCAL_CELLS.length} cells, received ${variant.cells.size}`);
  }

  for (const coord of HEX_PATCH_LOCAL_CELLS) {
    if (!variant.cells.has(hexCellKey(coord.q, coord.r))) {
      errors.push(`missing cell ${hexCellKey(coord.q, coord.r)}`);
    }
  }

  const derivedEdges = derivePatchEdges(variant.cells);
  for (const direction of HEX_DIRECTION_ORDER) {
    const edge = variant.edges[direction];
    if (edge.length !== HEX_PATCH_EDGE_LENGTH) {
      errors.push(`${direction} edge has length ${edge.length}`);
      continue;
    }
    if (edge.some((kind, index) => kind !== derivedEdges[direction][index])) {
      errors.push(`${direction} edge does not match its boundary cells`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidHexPatchVariant(variant: HexPatchTileVariant) {
  const result = validateHexPatchVariant(variant);
  if (!result.valid) {
    throw new Error(`Invalid patch ${variant.id}: ${result.errors.join("; ")}`);
  }
  return variant;
}
