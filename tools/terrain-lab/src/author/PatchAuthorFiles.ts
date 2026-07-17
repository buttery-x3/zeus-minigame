import { HEX_DIRECTION_ORDER, hexCellKey } from "../../../../src/world/hexCoordinates";
import { HEX_PATCH_LOCAL_CELLS, type HexPatchTileVariant } from "../../../../src/world/HexTerrainPatch";

export function uniqueCopyId(source: string, ...collections: readonly string[][]) {
  const ids = new Set(collections.flat());
  let index = 2;
  let candidate = `${source}.copy`;
  while (ids.has(candidate)) candidate = `${source}.copy-${index++}`;
  return candidate;
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function terrainVariantShapeKey(variant: HexPatchTileVariant) {
  const cells = HEX_PATCH_LOCAL_CELLS.map((coord) => {
    const cell = variant.cells.get(hexCellKey(coord.q, coord.r));
    return `${coord.q},${coord.r}:${cell?.structure ?? "open"}:${cell?.surface ?? "grass"}`;
  }).join("|");
  const ports = HEX_DIRECTION_ORDER.map((direction) => {
    const port = variant.riverPorts[direction];
    return `${direction}:${port ?? "-"}`;
  }).join("|");
  return `${cells}|${ports}`;
}
