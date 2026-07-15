import type { HexCoord } from "./hexCoordinates";

export const patchCell = (q: number, r: number): HexCoord => ({ q, r });

const c = patchCell;
export const LINE_STRAIGHT = [c(1, -2), c(1, -1), c(0, 0), c(-1, 1), c(-1, 2)];
export const LINE_SWAY = [c(1, -2), c(0, -1), c(0, 0), c(0, 1), c(-1, 2)];
export const LINE_SWAY_MIRROR = [c(1, -2), c(1, -1), c(0, -1), c(0, 0), c(-1, 1), c(-1, 2)];
export const LINE_DOGLEG_A = [c(1, -2), c(1, -1), c(0, 0), c(0, 1), c(-1, 2)];
export const LINE_DOGLEG_B = [c(1, -2), c(0, -1), c(0, 0), c(-1, 1), c(-1, 2)];
export const TIGHT_BEND = [c(1, -2), c(0, -1), c(0, 0), c(1, 0), c(2, -1)];
export const TIGHT_BEND_ALTERNATE = [c(1, -2), c(1, -1), c(0, 0), c(1, 0), c(2, -1)];
export const GENTLE_BEND_A = [c(1, -2), c(1, -1), c(1, 0), c(1, 1)];
export const GENTLE_BEND_B = [c(1, -2), c(0, -1), c(0, 0), c(1, 0), c(1, 1)];
export const LINE_FORK = [...LINE_SWAY, c(1, 0), c(2, -1)];
export const CENTER_RING = [c(0, 0), c(1, 0), c(1, -1), c(0, -1), c(-1, 0), c(-1, 1), c(0, 1)];
