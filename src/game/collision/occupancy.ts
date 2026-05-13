import * as THREE from "three";
import { clamp } from "../../lib/math";
import type { GridWorld } from "../../world/GridWorld";

export type CellCoord = {
  x: number;
  z: number;
};

export type CellBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const EPSILON = 0.000001;

export function isCellInBounds(gridWorld: GridWorld, cellX: number, cellZ: number) {
  return cellX >= 0 && cellZ >= 0 && cellX < gridWorld.worldCells && cellZ < gridWorld.worldCells;
}

export function isCellBlocked(gridWorld: GridWorld, cellX: number, cellZ: number) {
  return !isCellInBounds(gridWorld, cellX, cellZ) || gridWorld.getCell(cellX, cellZ).blocked;
}

export function getCellCenter(gridWorld: GridWorld, cellX: number, cellZ: number) {
  const world = gridWorld.cellToWorld(cellX, cellZ);
  return new THREE.Vector3(world.x, 0, world.z);
}

export function getCellBounds(gridWorld: GridWorld, cellX: number, cellZ: number): CellBounds {
  const world = gridWorld.cellToWorld(cellX, cellZ);
  const half = gridWorld.tileSize / 2;

  return {
    minX: world.x - half,
    maxX: world.x + half,
    minZ: world.z - half,
    maxZ: world.z + half,
  };
}

export function clampWorldToRadius(gridWorld: GridWorld, point: THREE.Vector3, radius: number) {
  point.x = clamp(point.x, -gridWorld.half + radius, gridWorld.half - radius);
  point.z = clamp(point.z, -gridWorld.half + radius, gridWorld.half - radius);
  return point;
}

export function canOccupyWorld(gridWorld: GridWorld, worldX: number, worldZ: number, radius: number) {
  if (worldX < -gridWorld.half + radius || worldX > gridWorld.half - radius) {
    return false;
  }
  if (worldZ < -gridWorld.half + radius || worldZ > gridWorld.half - radius) {
    return false;
  }

  if (radius <= 0) {
    const cell = gridWorld.worldToCell(worldX, worldZ);
    return !isCellBlocked(gridWorld, cell.x, cell.z);
  }

  const minCell = gridWorld.worldToCell(worldX - radius, worldZ - radius);
  const maxCell = gridWorld.worldToCell(worldX + radius, worldZ + radius);

  for (let z = minCell.z; z <= maxCell.z; z += 1) {
    for (let x = minCell.x; x <= maxCell.x; x += 1) {
      if (isCellBlocked(gridWorld, x, z) && circleIntersectsBounds(worldX, worldZ, radius, getCellBounds(gridWorld, x, z))) {
        return false;
      }
    }
  }

  return true;
}

function circleIntersectsBounds(centerX: number, centerZ: number, radius: number, bounds: CellBounds) {
  const nearestX = clamp(centerX, bounds.minX, bounds.maxX);
  const nearestZ = clamp(centerZ, bounds.minZ, bounds.maxZ);
  const distanceSq = (centerX - nearestX) ** 2 + (centerZ - nearestZ) ** 2;
  return distanceSq < radius ** 2 - EPSILON;
}
