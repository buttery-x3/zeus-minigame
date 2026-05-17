import * as THREE from "three";
import type { GridWorld } from "../../world/GridWorld";

export type CellCoord = {
  q: number;
  r: number;
};

const EPSILON = 0.000001;

export function isCellInBounds(gridWorld: GridWorld, q: number, r: number) {
  return gridWorld.isInBounds(q, r);
}

export function isCellBlocked(gridWorld: GridWorld, q: number, r: number) {
  return !isCellInBounds(gridWorld, q, r) || gridWorld.getCell(q, r).blocked;
}

export function isCellOpaque(gridWorld: GridWorld, q: number, r: number) {
  return !isCellInBounds(gridWorld, q, r) || gridWorld.getCell(q, r).opaque;
}

export function getCellCenter(gridWorld: GridWorld, q: number, r: number) {
  const world = gridWorld.cellToWorld(q, r);
  return new THREE.Vector3(world.x, 0, world.z);
}

export function clampWorldToRadius(gridWorld: GridWorld, point: THREE.Vector3, radius: number) {
  return gridWorld.clampWorld(point, radius);
}

export function canOccupyWorld(gridWorld: GridWorld, worldX: number, worldZ: number, radius: number) {
  const center = gridWorld.worldToCell(worldX, worldZ);
  if (!gridWorld.isInBounds(center.q, center.r)) {
    return false;
  }

  if (!circleIntersectsHex(gridWorld, worldX, worldZ, Math.max(radius, 0.01), center.q, center.r)) {
    return false;
  }

  if (radius <= 0) {
    return !isCellBlocked(gridWorld, center.q, center.r);
  }

  const checkRadius = Math.max(1, Math.ceil((radius + gridWorld.hexSize) / gridWorld.tileSize));
  let canOccupy = true;
  gridWorld.forEachCellInRange(center, checkRadius, (q, r) => {
    if (!canOccupy || !isCellBlocked(gridWorld, q, r)) {
      return;
    }
    if (circleIntersectsHex(gridWorld, worldX, worldZ, radius, q, r)) {
      canOccupy = false;
    }
  });

  return canOccupy;
}

export function circleIntersectsHex(gridWorld: GridWorld, centerX: number, centerZ: number, radius: number, q: number, r: number) {
  const corners = gridWorld.getHexCorners(q, r);
  if (pointInPolygon(centerX, centerZ, corners)) {
    return true;
  }

  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    if (distancePointToSegmentSq(centerX, centerZ, a.x, a.z, b.x, b.z) < radius ** 2 - EPSILON) {
      return true;
    }
  }

  return false;
}

function pointInPolygon(x: number, z: number, polygon: { x: number; z: number }[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distancePointToSegmentSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= EPSILON) {
    return (px - ax) ** 2 + (pz - az) ** 2;
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  const x = ax + dx * t;
  const z = az + dz * t;
  return (px - x) ** 2 + (pz - z) ** 2;
}
