import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS, ENEMY_FALLBACK_PATH_BUDGET_MS, PATHFINDING_MAX_ITERATIONS } from "../../../config";
import type { EnemyState } from "../../../types";
import type { CollisionSystem } from "../../collision/CollisionSystem";
import type { PathSearchJob } from "../../collision/pathfinding";

type PathRequest = {
  enemy: EnemyState;
  goal: THREE.Vector3;
};

type ActiveRequest = {
  request: PathRequest;
  job: PathSearchJob;
};

export class EnemyPathQueue {
  private readonly requests: PathRequest[] = [];
  private requestHead = 0;
  private readonly queuedIds = new Set<number>();
  private readonly requestsById = new Map<number, PathRequest>();
  private active: ActiveRequest | null = null;
  private solvedThisFrame = 0;
  private usedMsThisFrame = 0;
  private failedThisFrame = 0;

  constructor(
    private readonly collision: CollisionSystem,
    private readonly budgetMs = ENEMY_FALLBACK_PATH_BUDGET_MS,
  ) {}

  request(enemy: EnemyState, goal: THREE.Vector3) {
    const existing = this.requestsById.get(enemy.id);
    if (existing) {
      if (existing.goal.distanceToSquared(goal) <= 0.0001) {
        return;
      }
      this.clearEnemy(enemy);
    }

    const request = { enemy, goal: goal.clone() };
    enemy.pathQueued = true;
    this.queuedIds.add(enemy.id);
    this.requestsById.set(enemy.id, request);
    this.requests.push(request);
  }

  hasWork() {
    return this.active !== null || this.requestHead < this.requests.length;
  }

  isQueued(enemyId: number) {
    return this.queuedIds.has(enemyId);
  }

  update(deadline = performance.now() + this.budgetMs) {
    const startedAt = performance.now();
    this.solvedThisFrame = 0;
    this.failedThisFrame = 0;
    this.usedMsThisFrame = 0;

    if (!this.active) {
      const request = this.dequeue();
      if (request) {
        this.active = {
          request,
          job: this.collision.createPathSearchJob(
            request.enemy.group.position,
            request.goal,
            ENEMY_COLLISION_RADIUS,
            PATHFINDING_MAX_ITERATIONS,
          ),
        };
      }
    }

    if (this.active && performance.now() < deadline) {
      this.active.job.step(deadline);
      if (this.active.job.isComplete()) {
        this.finishActive();
      }
    }

    this.usedMsThisFrame = performance.now() - startedAt;
    this.compactRequests();
  }

  clearEnemy(enemy: EnemyState) {
    if (!this.queuedIds.has(enemy.id)) {
      enemy.pathQueued = false;
      return;
    }

    if (this.active?.request.enemy === enemy) {
      this.active = null;
    }
    const request = this.requestsById.get(enemy.id);
    if (request) {
      const index = this.requests.findIndex((candidate, requestIndex) => requestIndex >= this.requestHead && candidate === request);
      if (index >= this.requestHead) {
        this.requests.splice(index, 1);
      }
    }
    this.queuedIds.delete(enemy.id);
    this.requestsById.delete(enemy.id);
    enemy.pathQueued = false;
  }

  diagnostics() {
    return {
      queueLength: Math.max(0, this.requests.length - this.requestHead) + (this.active ? 1 : 0),
      solved: this.solvedThisFrame,
      failed: this.failedThisFrame,
      budgetMs: this.budgetMs,
      usedMs: this.usedMsThisFrame,
      activeStage: this.active?.job.diagnostics().stage ?? null,
    };
  }

  clear() {
    if (this.active) {
      this.active.request.enemy.pathQueued = false;
    }
    for (let index = this.requestHead; index < this.requests.length; index += 1) {
      this.requests[index].enemy.pathQueued = false;
    }
    this.requests.length = 0;
    this.requestHead = 0;
    this.active = null;
    this.queuedIds.clear();
    this.requestsById.clear();
    this.solvedThisFrame = 0;
    this.failedThisFrame = 0;
    this.usedMsThisFrame = 0;
  }

  private dequeue() {
    const request = this.requests[this.requestHead] ?? null;
    if (request) {
      this.requestHead += 1;
    }
    return request;
  }

  private finishActive() {
    const active = this.active;
    if (!active) {
      return;
    }
    const path = active.job.getResult();
    const diagnostics = active.job.diagnostics();
    this.collision.recordScheduledPathfinding(diagnostics.accumulatedMs, diagnostics.iterations, path !== null);
    if (path) {
      active.request.enemy.path = path.waypoints;
      this.solvedThisFrame += 1;
    } else {
      this.failedThisFrame += 1;
    }
    active.request.enemy.pathQueued = false;
    this.queuedIds.delete(active.request.enemy.id);
    this.requestsById.delete(active.request.enemy.id);
    this.active = null;
  }

  private compactRequests() {
    if (this.requestHead === 0 || (this.requestHead < 64 && this.requestHead * 2 < this.requests.length)) {
      return;
    }
    this.requests.splice(0, this.requestHead);
    this.requestHead = 0;
  }
}
