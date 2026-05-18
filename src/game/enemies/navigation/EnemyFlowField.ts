import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS, ENEMY_FLOW_FIELD_RADIUS_CELLS } from "../../../config";
import { distance2D } from "../../../lib/math";
import { MinHeap } from "../../../lib/MinHeap";
import type { GridWorld } from "../../../world/GridWorld";
import { canOccupyWorld, getCellCenter, isCellInBounds } from "../../collision/occupancy";

type FlowCell = {
  q: number;
  r: number;
  cost: number;
  nextQ: number;
  nextR: number;
};

type OpenCell = {
  q: number;
  r: number;
  cost: number;
};

export class EnemyFlowField {
  private readonly cells = new Map<string, FlowCell>();
  private readonly edgeCells: FlowCell[] = [];
  private readonly walkableCache = new Map<string, boolean>();
  private playerCellKey = "";
  private playerCell = { q: 0, r: 0 };
  private lastRebuildMs = 0;
  private visitedCount = 0;

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly radius = ENEMY_FLOW_FIELD_RADIUS_CELLS,
  ) {}

  update(playerPosition: THREE.Vector3) {
    const playerCell = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const nextKey = this.gridWorld.cellKey(playerCell.q, playerCell.r);

    if (nextKey !== this.playerCellKey) {
      this.rebuild(playerCell.q, playerCell.r);
      return true;
    }

    return false;
  }

  sample(position: THREE.Vector3) {
    const cell = this.gridWorld.worldToCell(position.x, position.z);
    const flowCell = this.cells.get(this.gridWorld.cellKey(cell.q, cell.r));
    if (!flowCell) {
      return null;
    }

    const target = getCellCenter(this.gridWorld, flowCell.nextQ, flowCell.nextR);
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
      const world = this.gridWorld.cellToWorld(candidate.q, candidate.r);
      const distance = distance2D(position.x, position.z, world.x, world.z);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }

    return closest ? getCellCenter(this.gridWorld, closest.q, closest.r) : null;
  }

  diagnostics() {
    return {
      rebuildMs: this.lastRebuildMs,
      visited: this.visitedCount,
      radius: this.radius,
      playerCell: this.playerCell,
    };
  }

  private rebuild(playerQ: number, playerR: number) {
    const startedAt = performance.now();
    this.cells.clear();
    this.edgeCells.length = 0;
    this.walkableCache.clear();
    this.playerCell = { q: playerQ, r: playerR };
    this.playerCellKey = this.gridWorld.cellKey(playerQ, playerR);

    if (!isCellInBounds(this.gridWorld, playerQ, playerR)) {
      this.finishRebuild(startedAt);
      return;
    }

    const open = new MinHeap<OpenCell>((a, b) => a.cost - b.cost);
    const startKey = this.gridWorld.cellKey(playerQ, playerR);
    this.cells.set(startKey, { q: playerQ, r: playerR, cost: 0, nextQ: playerQ, nextR: playerR });
    open.push({ q: playerQ, r: playerR, cost: 0 });

    while (open.size() > 0) {
      const current = open.pop();
      if (!current) {
        break;
      }

      const currentCell = this.cells.get(this.gridWorld.cellKey(current.q, current.r));
      if (!currentCell || current.cost > currentCell.cost) {
        continue;
      }

      const currentPoint = getCellCenter(this.gridWorld, current.q, current.r);
      for (const neighbor of this.gridWorld.getNeighbors(current.q, current.r)) {
        if (!this.isInsideField(neighbor.q, neighbor.r)) {
          continue;
        }

        if (!this.canOccupyCell(neighbor.q, neighbor.r)) {
          continue;
        }

        const neighborPoint = getCellCenter(this.gridWorld, neighbor.q, neighbor.r);
        const stepCost = distance2D(currentPoint.x, currentPoint.z, neighborPoint.x, neighborPoint.z);
        const nextCost = currentCell.cost + stepCost;
        const key = this.gridWorld.cellKey(neighbor.q, neighbor.r);
        const existing = this.cells.get(key);
        if (existing && existing.cost <= nextCost) {
          continue;
        }

        const flowCell = { q: neighbor.q, r: neighbor.r, cost: nextCost, nextQ: current.q, nextR: current.r };
        this.cells.set(key, flowCell);
        if (this.isEdgeCell(neighbor.q, neighbor.r)) {
          this.edgeCells.push(flowCell);
        }
        open.push({ q: neighbor.q, r: neighbor.r, cost: nextCost });
      }
    }

    this.finishRebuild(startedAt);
  }

  private finishRebuild(startedAt: number) {
    this.visitedCount = this.cells.size;
    this.lastRebuildMs = performance.now() - startedAt;
  }

  private isInsideField(cellX: number, cellZ: number) {
    return isCellInBounds(this.gridWorld, cellX, cellZ) && this.gridWorld.hexDistance(this.playerCell, { q: cellX, r: cellZ }) <= this.radius;
  }

  private isEdgeCell(cellX: number, cellZ: number) {
    return this.gridWorld.hexDistance(this.playerCell, { q: cellX, r: cellZ }) >= this.radius - 1;
  }

  private canOccupyCell(cellX: number, cellZ: number) {
    const key = this.gridWorld.cellKey(cellX, cellZ);
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
