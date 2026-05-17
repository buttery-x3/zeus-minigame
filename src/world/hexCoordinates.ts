import type { HexTileSignature } from "../types";

export type HexCoord = {
  q: number;
  r: number;
};

export type HexDirection = keyof HexTileSignature;

export const HEX_DIRECTIONS: Record<HexDirection, HexCoord> = {
  ne: { q: 1, r: -1 },
  e: { q: 1, r: 0 },
  se: { q: 0, r: 1 },
  sw: { q: -1, r: 1 },
  w: { q: -1, r: 0 },
  nw: { q: 0, r: -1 },
};

export const HEX_DIRECTION_ORDER: HexDirection[] = ["ne", "e", "se", "sw", "w", "nw"];
export const HEX_RING_ORDER: HexDirection[] = ["e", "ne", "nw", "w", "sw", "se"];

export function hexCellKey(q: number, r: number) {
  return `${q},${r}`;
}

export function hexDistance(a: HexCoord, b: HexCoord) {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(-a.q - a.r + b.q + b.r));
}
