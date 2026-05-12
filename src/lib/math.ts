export function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function distance2D(x1: number, z1: number, x2: number, z2: number) {
  return Math.hypot(x2 - x1, z2 - z1);
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
