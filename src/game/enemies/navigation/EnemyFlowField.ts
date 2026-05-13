import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS, ENEMY_FLOW_FIELD_RADIUS_CELLS } from "../../../config";
import { distance2D } from "../../../lib/math";
import { MinHeap } from "../../../lib/MinHeap";
import type { GridWorld } from "../../../world/GridWorld";
import { canOccupyWorld, getCellCenter, isCellInBounds } from "../../collision/occupancy";

type FlowCell = {
  x: number;
  z: number;
  cost: number;
  nextX: number;
  nextZ: number;
};

type OpenCell = {
  x: number;
  z: number;
  cost: number;
};

const NEIGHBORS = [
  { x: -1, z: -1 },
  { x: 0, z: -1 },
  { x: 1, z: -1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: -1, z: 1 },
  { x: 0, z: 1 },
  { x: 1, z: 1 },
];

export class EnemyFlowField {
  private readonly cells = new Map<string, FlowCell>();
  private readonly edgeCells: FlowCell[] = [];
  private readonly walkableCache = new Map<string, boolean>();
  private playerCellKey = "";
  private playerCell = { x: 0, z: 0 };
  private lastRebuildMs = 0;
  private visitedCount = 0;

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly radius = ENEMY_FLOW_FIELD_RADIUS_CELLS,
  ) {}

  update(playerPosition: THREE.Vector3) {
    const playerCell = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const nextKey = cellKey(playerCell.x, playerCell.z);

    if (nextKey !== this.playerCellKey) {
      this.rebuild(playerCell.x, playerCell.z);
      return true;
    }

    return false;
  }

  sample(position: THREE.Vector3) {
    const cell = this.gridWorld.worldToCell(position.x, position.z);
    const flowCell = this.cells.get(cellKey(cell.x, cell.z));
    if (!flowCell) {
      return null;
    }

    const target = getCellCenter(this.gridWorld, flowCell.nextX, flowCell.nextZ);
    const direction = new THREE.Vector3(target.x - position.x, 0, target.z - position.z);
    if (direction.lengthSq() < 0.000001) {
      return null;
    }

    direction.normalize();
    return { target, direction, cost: flowCell.cost };
  }

  getAcquisitionTarget(position: THREE.Vector3) {
    const candidates = this.edgeCells.length > 0 ? this.edgeCells : [...this.cells.values()];
    let closest: FlowCell | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const world = this.gridWorld.cellToWorld(candidate.x, candidate.z);
      const distance = distance2D(position.x, position.z, world.x, world.z);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }

    return closest ? getCellCenter(this.gridWorld, closest.x, closest.z) : null;
  }

  diagnostics() {
    return {
      rebuildMs: this.lastRebuildMs,
      visited: this.visitedCount,
      radius: this.radius,
      playerCell: this.playerCell,
    };
  }

  private rebuild(playerCellX: number, playerCellZ: number) {
    const startedAt = performance.now();
    this.cells.clear();
    this.edgeCells.length = 0;
    this.walkableCache.clear();
    this.playerCell = { x: playerCellX, z: playerCellZ };
    this.playerCellKey = cellKey(playerCellX, playerCellZ);

    if (!isCellInBounds(this.gridWorld, playerCellX, playerCellZ)) {
      this.finishRebuild(startedAt);
      return;
    }

    const open = new MinHeap<OpenCell>((a, b) => a.cost - b.cost);
    const startKey = cellKey(playerCellX, playerCellZ);
    this.cells.set(startKey, { x: playerCellX, z: playerCellZ, cost: 0, nextX: playerCellX, nextZ: playerCellZ });
    open.push({ x: playerCellX, z: playerCellZ, cost: 0 });

    while (open.size() > 0) {
      const current = open.pop();
      if (!current) {
        break;
      }

      const currentCell = this.cells.get(cellKey(current.x, current.z));
      if (!currentCell || current.cost > currentCell.cost) {
        continue;
      }

      const currentPoint = getCellCenter(this.gridWorld, current.x, current.z);
      for (const offset of NEIGHBORS) {
        const neighborX = current.x + offset.x;
        const neighborZ = current.z + offset.z;
        if (!this.isInsideField(neighborX, neighborZ)) {
          continue;
        }

        if (!this.canOccupyCell(neighborX, neighborZ)) {
          continue;
        }
        if (!this.canTraverseAdjacent(current.x, current.z, neighborX, neighborZ)) {
          continue;
        }

        const neighborPoint = getCellCenter(this.gridWorld, neighborX, neighborZ);
        const stepCost = distance2D(currentPoint.x, currentPoint.z, neighborPoint.x, neighborPoint.z);
        const nextCost = currentCell.cost + stepCost;
        const key = cellKey(neighborX, neighborZ);
        const existing = this.cells.get(key);
        if (existing && existing.cost <= nextCost) {
          continue;
        }

        const flowCell = { x: neighborX, z: neighborZ, cost: nextCost, nextX: current.x, nextZ: current.z };
        this.cells.set(key, flowCell);
        if (this.isEdgeCell(neighborX, neighborZ)) {
          this.edgeCells.push(flowCell);
        }
        open.push({ x: neighborX, z: neighborZ, cost: nextCost });
      }
    }

    this.finishRebuild(startedAt);
  }

  private finishRebuild(startedAt: number) {
    this.visitedCount = this.cells.size;
    this.lastRebuildMs = performance.now() - startedAt;
  }

  private isInsideField(cellX: number, cellZ: number) {
    return (
      isCellInBounds(this.gridWorld, cellX, cellZ) &&
      Math.abs(cellX - this.playerCell.x) <= this.radius &&
      Math.abs(cellZ - this.playerCell.z) <= this.radius
    );
  }

  private isEdgeCell(cellX: number, cellZ: number) {
    return Math.max(Math.abs(cellX - this.playerCell.x), Math.abs(cellZ - this.playerCell.z)) >= this.radius - 1;
  }

  private canTraverseAdjacent(fromX: number, fromZ: number, toX: number, toZ: number) {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    if (dx === 0 || dz === 0) {
      return true;
    }

    return this.canOccupyCell(fromX + dx, fromZ) && this.canOccupyCell(fromX, fromZ + dz);
  }

  private canOccupyCell(cellX: number, cellZ: number) {
    const key = cellKey(cellX, cellZ);
    const cached = this.walkableCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const center = getCellCenter(this.gridWorld, cellX, cellZ);
    const canOccupy = canOccupyWorld(this.gridWorld, center.x, center.z, ENEMY_COLLISION_RADIUS);
    this.walkableCache.set(key, canOccupy);
    return canOccupy;
  }
}

function cellKey(cellX: number, cellZ: number) {
  return `${cellX},${cellZ}`;
}
