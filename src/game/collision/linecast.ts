import type { GridWorld } from "../../world/GridWorld";
import { canOccupyWorld, isCellBlocked, isCellOpaque } from "./occupancy";

type GroundPoint = {
  x: number;
  z: number;
};

export function hasLineOfSight(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint, radius = 0) {
  if (!canOccupyWorld(gridWorld, from.x, from.z, radius) || !canOccupyWorld(gridWorld, to.x, to.z, radius)) {
    return false;
  }

  return lineIsClear(gridWorld, from, to, (q, r) => isCellBlocked(gridWorld, q, r));
}

export function hasOpaqueLineOfSight(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint) {
  return lineIsClear(gridWorld, from, to, (q, r) => isCellOpaque(gridWorld, q, r));
}

function lineIsClear(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint, blocks: (q: number, r: number) => boolean) {
  const fromCell = gridWorld.worldToCell(from.x, from.z);
  const toCell = gridWorld.worldToCell(to.x, to.z);

  for (const cell of gridWorld.cellsOnLine(fromCell, toCell)) {
    if ((cell.q !== fromCell.q || cell.r !== fromCell.r) && (cell.q !== toCell.q || cell.r !== toCell.r) && blocks(cell.q, cell.r)) {
      return false;
    }
  }

  return true;
}
