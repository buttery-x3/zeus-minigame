import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS, ENEMY_FALLBACK_PATH_BUDGET_MS, PATHFINDING_MAX_ITERATIONS } from "../../../config";
import type { EnemyState } from "../../../types";
import type { CollisionSystem } from "../../collision/CollisionSystem";

type PathRequest = {
  enemy: EnemyState;
  goal: THREE.Vector3;
};

export class EnemyPathQueue {
  private readonly requests: PathRequest[] = [];
  private readonly queuedIds = new Set<number>();
  private solvedThisFrame = 0;
  private usedMsThisFrame = 0;

  constructor(
    private readonly collision: CollisionSystem,
    private readonly budgetMs = ENEMY_FALLBACK_PATH_BUDGET_MS,
  ) {}

  request(enemy: EnemyState, goal: THREE.Vector3) {
    if (this.queuedIds.has(enemy.id)) {
      return;
    }

    enemy.pathQueued = true;
    this.queuedIds.add(enemy.id);
    this.requests.push({ enemy, goal: goal.clone() });
  }

  update() {
    const startedAt = performance.now();
    this.solvedThisFrame = 0;
    this.usedMsThisFrame = 0;

    while (this.requests.length > 0 && performance.now() - startedAt < this.budgetMs) {
      const request = this.requests.shift();
      if (!request) {
        break;
      }

      this.queuedIds.delete(request.enemy.id);
      request.enemy.pathQueued = false;

      const path = this.collision.findPath(
        request.enemy.group.position,
        request.goal,
        ENEMY_COLLISION_RADIUS,
        PATHFINDING_MAX_ITERATIONS,
      );
      if (path) {
        request.enemy.path = path.waypoints;
      }
      this.solvedThisFrame += 1;
    }

    this.usedMsThisFrame = performance.now() - startedAt;
  }

  clearEnemy(enemy: EnemyState) {
    if (!this.queuedIds.has(enemy.id)) {
      return;
    }

    this.queuedIds.delete(enemy.id);
    const index = this.requests.findIndex((request) => request.enemy === enemy);
    if (index >= 0) {
      this.requests.splice(index, 1);
    }
    enemy.pathQueued = false;
  }

  diagnostics() {
    return {
      queueLength: this.requests.length,
      solved: this.solvedThisFrame,
      budgetMs: this.budgetMs,
      usedMs: this.usedMsThisFrame,
    };
  }
}
