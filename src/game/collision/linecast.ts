import type { GridWorld } from "../../world/GridWorld";
import { canOccupyWorld, capsuleIntersectsHex, isCellBlocked, isCellOpaque } from "./occupancy";

type GroundPoint = {
  x: number;
  z: number;
};

export function hasLineOfSight(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint, radius = 0) {
  if (!canOccupyWorld(gridWorld, from.x, from.z, radius) || !canOccupyWorld(gridWorld, to.x, to.z, radius)) {
    return false;
  }

  return lineIsClear(gridWorld, from, to, radius, (q, r) => isCellBlocked(gridWorld, q, r));
}

export function hasOpaqueLineOfSight(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint) {
  return lineIsClear(gridWorld, from, to, 0, (q, r) => isCellOpaque(gridWorld, q, r));
}

function lineIsClear(
  gridWorld: GridWorld,
  from: GroundPoint,
  to: GroundPoint,
  radius: number,
  blocks: (q: number, r: number) => boolean,
) {
  const fromCell = gridWorld.worldToCell(from.x, from.z);
  const toCell = gridWorld.worldToCell(to.x, to.z);
  const checked = new Set<string>();
  const neighborRadius = Math.max(1, Math.ceil(radius / gridWorld.tileSize) + 1);

  for (const lineCell of gridWorld.cellsOnLine(fromCell, toCell)) {
    let clear = true;
    gridWorld.forEachCellInRange(lineCell, neighborRadius, (q, r) => {
      if (!clear || (q === fromCell.q && r === fromCell.r) || (q === toCell.q && r === toCell.r)) {
        return;
      }

      const key = gridWorld.cellKey(q, r);
      if (checked.has(key)) {
        return;
      }
      checked.add(key);

      if (blocks(q, r) && capsuleIntersectsHex(gridWorld, from.x, from.z, to.x, to.z, radius, q, r)) {
        clear = false;
      }
    });

    if (!clear) {
      return false;
    }
  }

  return true;
}
