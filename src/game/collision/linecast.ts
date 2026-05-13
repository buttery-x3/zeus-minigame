import type { GridWorld } from "../../world/GridWorld";
import { canOccupyWorld, getCellBounds, isCellBlocked } from "./occupancy";

type GroundPoint = {
  x: number;
  z: number;
};

const EPSILON = 0.000001;

export function hasLineOfSight(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint, radius = 0) {
  if (!canOccupyWorld(gridWorld, from.x, from.z, radius) || !canOccupyWorld(gridWorld, to.x, to.z, radius)) {
    return false;
  }

  const minCell = gridWorld.worldToCell(Math.min(from.x, to.x) - radius, Math.min(from.z, to.z) - radius);
  const maxCell = gridWorld.worldToCell(Math.max(from.x, to.x) + radius, Math.max(from.z, to.z) + radius);

  for (let z = minCell.z; z <= maxCell.z; z += 1) {
    for (let x = minCell.x; x <= maxCell.x; x += 1) {
      if (!isCellBlocked(gridWorld, x, z)) {
        continue;
      }

      const bounds = getCellBounds(gridWorld, x, z);
      if (
        segmentIntersectsBounds(from, to, {
          minX: bounds.minX - radius,
          maxX: bounds.maxX + radius,
          minZ: bounds.minZ - radius,
          maxZ: bounds.maxZ + radius,
        })
      ) {
        return false;
      }
    }
  }

  return true;
}

function segmentIntersectsBounds(
  from: GroundPoint,
  to: GroundPoint,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
) {
  let tMin = 0;
  let tMax = 1;
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;

  const xRange = clipAxis(from.x, deltaX, bounds.minX, bounds.maxX, tMin, tMax);
  if (!xRange) {
    return false;
  }
  tMin = xRange.tMin;
  tMax = xRange.tMax;

  const zRange = clipAxis(from.z, deltaZ, bounds.minZ, bounds.maxZ, tMin, tMax);
  if (!zRange) {
    return false;
  }

  return true;
}

function clipAxis(start: number, delta: number, min: number, max: number, tMin: number, tMax: number) {
  if (Math.abs(delta) < EPSILON) {
    return start >= min && start <= max ? { tMin, tMax } : null;
  }

  const inverse = 1 / delta;
  let near = (min - start) * inverse;
  let far = (max - start) * inverse;

  if (near > far) {
    [near, far] = [far, near];
  }

  tMin = Math.max(tMin, near);
  tMax = Math.min(tMax, far);
  return tMin <= tMax ? { tMin, tMax } : null;
}
