import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS, ENEMY_STALL_FALLBACK_SECONDS, TILE_SIZE } from "../../../config";
import { distance2D } from "../../../lib/math";
import type { EnemyNavigationMode, EnemyState } from "../../../types";
import type { GridWorld } from "../../../world/GridWorld";
import type { CollisionSystem } from "../../collision/CollisionSystem";
import type { Profiler } from "../../perf/Profiler";
import { EnemyFlowField } from "./EnemyFlowField";
import { getMeleeChaseIntent } from "./EnemyIntent";
import { EnemyPathQueue } from "./EnemyPathQueue";
import { directionTo, targetFromDirection } from "./EnemySteering";

const STALL_RESET_PROGRESS = 0.02;

export class EnemyNavigation {
  private readonly flowField: EnemyFlowField;
  private readonly pathQueue: EnemyPathQueue;

  constructor(
    gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly profiler: Profiler,
  ) {
    this.flowField = new EnemyFlowField(gridWorld);
    this.pathQueue = new EnemyPathQueue(collision);
  }

  beginFrame(playerPosition: THREE.Vector3) {
    const rebuilt = this.flowField.update(playerPosition);
    const flow = this.flowField.diagnostics();
    if (rebuilt) {
      this.profiler.recordEnemyFlowField(flow.rebuildMs, flow.visited, flow.radius);
    }

    this.pathQueue.update();
    this.profiler.recordEnemyPathQueue(this.pathQueue.diagnostics());
  }

  getTarget(enemy: EnemyState, playerPosition: THREE.Vector3) {
    const intent = getMeleeChaseIntent();
    if (intent.kind !== "meleeChase") {
      return this.wait(enemy, playerPosition);
    }

    if (this.collision.hasLineOfSight(enemy.group.position, playerPosition, ENEMY_COLLISION_RADIUS)) {
      enemy.path = [];
      this.pathQueue.clearEnemy(enemy);
      return this.result(enemy, "direct", playerPosition);
    }

    const fallbackTarget = this.getFallbackWaypoint(enemy);
    if (fallbackTarget) {
      return this.result(enemy, "fallback", fallbackTarget);
    }

    const flow = this.flowField.sample(enemy.group.position);
    if (flow) {
      return this.result(enemy, "flow", targetFromDirection(enemy.group.position, flow.direction, TILE_SIZE));
    }

    const acquisitionTarget = this.flowField.getAcquisitionTarget(enemy.group.position);
    if (acquisitionTarget) {
      return this.result(enemy, "acquire", acquisitionTarget);
    }

    return this.wait(enemy, playerPosition);
  }

  recordMovement(enemy: EnemyState, targetProgress: number, dt: number, playerPosition: THREE.Vector3) {
    if (enemy.navigationMode === "direct" || targetProgress > STALL_RESET_PROGRESS) {
      enemy.stallTimer = 0;
      return;
    }

    enemy.stallTimer += dt;
    if (enemy.stallTimer < ENEMY_STALL_FALLBACK_SECONDS || enemy.pathQueued || enemy.path.length > 0) {
      return;
    }

    const acquisitionTarget = this.flowField.getAcquisitionTarget(enemy.group.position);
    const fallbackGoal = enemy.navigationMode === "flow" ? playerPosition : (acquisitionTarget ?? playerPosition);
    enemy.navigationMode = "waiting";
    enemy.stallTimer = 0;
    this.pathQueue.request(enemy, fallbackGoal);
  }

  clearEnemy(enemy: EnemyState) {
    this.pathQueue.clearEnemy(enemy);
  }

  private getFallbackWaypoint(enemy: EnemyState) {
    while (
      enemy.path[0] &&
      distance2D(enemy.group.position.x, enemy.group.position.z, enemy.path[0].x, enemy.path[0].z) < 0.5
    ) {
      enemy.path.shift();
    }

    return enemy.path[0] ?? null;
  }

  private wait(enemy: EnemyState, playerPosition: THREE.Vector3) {
    const direction = directionTo(enemy.group.position, playerPosition);
    return this.result(enemy, "waiting", targetFromDirection(enemy.group.position, direction, TILE_SIZE));
  }

  private result(enemy: EnemyState, mode: EnemyNavigationMode, target: THREE.Vector3) {
    enemy.navigationMode = mode;
    this.profiler.recordEnemyNavigationMode(mode);
    return target;
  }
}
