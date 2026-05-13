import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS, PATHFINDING_MAX_ITERATIONS, TILE_SIZE, WORLD_HALF } from "../../config";
import { distance2D, randomBetween } from "../../lib/math";
import type { EnemyState } from "../../types";
import type { CollisionSystem } from "../collision/CollisionSystem";

export class EnemyNavigation {
  constructor(private readonly collision: CollisionSystem) {}

  getTarget(enemy: EnemyState, dt: number, playerPosition: THREE.Vector3) {
    enemy.repathTimer = Math.max(0, enemy.repathTimer - dt);

    if (this.collision.hasLineOfSight(enemy.group.position, playerPosition, ENEMY_COLLISION_RADIUS)) {
      enemy.path = [];
      return playerPosition;
    }

    const playerCell = this.cellKey(playerPosition);
    const shouldRepath = enemy.path.length === 0 || enemy.repathTimer <= 0 || enemy.targetCellKey !== playerCell;

    if (shouldRepath) {
      const path = this.collision.findPath(
        enemy.group.position,
        playerPosition,
        ENEMY_COLLISION_RADIUS,
        PATHFINDING_MAX_ITERATIONS,
      );
      if (path) {
        enemy.path = path.waypoints;
        enemy.targetCellKey = playerCell;
      }
      enemy.repathTimer = randomBetween(0.32, 0.7);
    }

    while (
      enemy.path[0] &&
      distance2D(enemy.group.position.x, enemy.group.position.z, enemy.path[0].x, enemy.path[0].z) < 0.5
    ) {
      enemy.path.shift();
    }

    return enemy.path[0] ?? playerPosition;
  }

  private cellKey(point: THREE.Vector3) {
    const cellX = Math.floor((point.x + WORLD_HALF) / TILE_SIZE);
    const cellZ = Math.floor((point.z + WORLD_HALF) / TILE_SIZE);
    return `${cellX},${cellZ}`;
  }
}
