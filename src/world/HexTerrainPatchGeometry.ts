import { hexCellKey, hexDistance, type HexCoord, type HexDirection } from "./hexCoordinates";

export const HEX_PATCH_RADIUS = 2;
export const HEX_PATCH_EDGE_LENGTH = HEX_PATCH_RADIUS + 1;

export type HexPatchAddress = {
  patch: HexCoord;
  local: HexCoord;
};

const PATCH_E_VECTOR: HexCoord = { q: 5, r: -2 };
const PATCH_SE_VECTOR: HexCoord = { q: 2, r: 3 };

export const HEX_PATCH_LOCAL_CELLS: HexCoord[] = createPatchLocalCells();
export const HEX_PATCH_LOCAL_CELL_KEYS = new Set(HEX_PATCH_LOCAL_CELLS.map((cell) => hexCellKey(cell.q, cell.r)));

export const HEX_PATCH_EDGE_CELLS: Record<HexDirection, HexCoord[]> = {
  ne: [{ q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 }],
  e: [{ q: 2, r: -2 }, { q: 2, r: -1 }, { q: 2, r: 0 }],
  se: [{ q: 2, r: 0 }, { q: 1, r: 1 }, { q: 0, r: 2 }],
  sw: [{ q: 0, r: 2 }, { q: -1, r: 2 }, { q: -2, r: 2 }],
  w: [{ q: -2, r: 2 }, { q: -2, r: 1 }, { q: -2, r: 0 }],
  nw: [{ q: -2, r: 0 }, { q: -1, r: -1 }, { q: 0, r: -2 }],
};

export function patchCoordToWorld(patch: HexCoord): HexCoord {
  return {
    q: patch.q * PATCH_E_VECTOR.q + patch.r * PATCH_SE_VECTOR.q,
    r: patch.q * PATCH_E_VECTOR.r + patch.r * PATCH_SE_VECTOR.r,
  };
}

export function patchLocalToWorld(patch: HexCoord, local: HexCoord): HexCoord {
  const origin = patchCoordToWorld(patch);
  return { q: origin.q + local.q, r: origin.r + local.r };
}

export function microToPatchLocal(cell: HexCoord): HexPatchAddress {
  const estimatedPatch = roundAxial((3 * cell.q - 2 * cell.r) / 19, (2 * cell.q + 5 * cell.r) / 19);
  let best: HexPatchAddress | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let dq = -2; dq <= 2; dq += 1) {
    for (let dr = -2; dr <= 2; dr += 1) {
      const patch = { q: estimatedPatch.q + dq, r: estimatedPatch.r + dr };
      const origin = patchCoordToWorld(patch);
      const local = { q: cell.q - origin.q, r: cell.r - origin.r };
      if (!HEX_PATCH_LOCAL_CELL_KEYS.has(hexCellKey(local.q, local.r))) {
        continue;
      }
      const distance = hexDistance(local, { q: 0, r: 0 });
      if (!best || distance < bestDistance || (distance === bestDistance && (patch.q < best.patch.q || (patch.q === best.patch.q && patch.r < best.patch.r)))) {
        best = { patch, local };
        bestDistance = distance;
      }
    }
  }

  if (best) {
    return best;
  }
  const origin = patchCoordToWorld(estimatedPatch);
  return { patch: estimatedPatch, local: { q: cell.q - origin.q, r: cell.r - origin.r } };
}

export function createHexPatchRegion(radius: number): HexCoord[] {
  const cells: HexCoord[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    const minR = Math.max(-radius, -q - radius);
    const maxR = Math.min(radius, -q + radius);
    for (let r = minR; r <= maxR; r += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
}

function createPatchLocalCells() {
  const cells: HexCoord[] = [];
  for (let q = -HEX_PATCH_RADIUS; q <= HEX_PATCH_RADIUS; q += 1) {
    const minR = Math.max(-HEX_PATCH_RADIUS, -q - HEX_PATCH_RADIUS);
    const maxR = Math.min(HEX_PATCH_RADIUS, -q + HEX_PATCH_RADIUS);
    for (let r = minR; r <= maxR; r += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
}

function roundAxial(q: number, r: number): HexCoord {
  let x = Math.round(q);
  let z = Math.round(r);
  let y = Math.round(-q - r);
  const xDelta = Math.abs(x - q);
  const yDelta = Math.abs(y + q + r);
  const zDelta = Math.abs(z - r);

  if (xDelta > yDelta && xDelta > zDelta) {
    x = -y - z;
  } else if (yDelta > zDelta) {
    y = -x - z;
  } else {
    z = -x - y;
  }
  return { q: x, r: z };
}
