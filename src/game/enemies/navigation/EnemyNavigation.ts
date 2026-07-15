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
import type { NavigationWorkSource } from "../../navigation/NavigationScheduler";

const STALL_RESET_PROGRESS = 0.02;

export class EnemyNavigation {
  private readonly flowField: EnemyFlowField;
  private readonly pathQueue: EnemyPathQueue;
  private readonly forcedFallbacks = new Set<number>();
  private readonly flowWorkSource: NavigationWorkSource = {
    id: "flow",
    hasWork: () => this.flowField.hasWork(),
    runSlice: (deadline) => {
      this.flowField.step(deadline);
      const flow = this.flowField.diagnostics();
      this.profiler.recordEnemyFlowField({
        rebuildMs: flow.rebuildMs,
        visited: flow.visited,
        radius: flow.radius,
        sliceMs: flow.sliceMs,
        building: flow.building,
        buildVisited: flow.buildVisited,
        rootLag: flow.rootLag,
        terrainLimited: flow.terrainLimited,
        completedBuilds: flow.completedBuilds,
        coalescedRequests: flow.coalescedRequests,
        walkableCacheSize: flow.walkableCacheSize,
      });
    },
  };
  private readonly fallbackWorkSource: NavigationWorkSource = {
    id: "fallback",
    hasWork: () => this.pathQueue.hasWork(),
    runSlice: (deadline) => {
      this.pathQueue.update(deadline);
      this.profiler.recordEnemyPathQueue(this.pathQueue.diagnostics());
    },
  };

  constructor(
    gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly profiler: Profiler,
  ) {
    this.flowField = new EnemyFlowField(gridWorld);
    this.pathQueue = new EnemyPathQueue(collision);
  }

  beginFrame(playerPosition: THREE.Vector3) {
    this.flowField.request(playerPosition);
  }

  getWorkSources() {
    return [this.flowWorkSource, this.fallbackWorkSource];
  }

  getDiagnostics() {
    return {
      flow: this.flowField.diagnostics(),
      queue: this.pathQueue.diagnostics(),
    };
  }

  reset(playerPosition: THREE.Vector3) {
    this.pathQueue.clear();
    this.forcedFallbacks.clear();
    this.flowField.clear();
    this.flowField.request(playerPosition);
  }

  getTarget(enemy: EnemyState, playerPosition: THREE.Vector3) {
    const intent = getMeleeChaseIntent();
    if (intent.kind !== "meleeChase") {
      return this.wait(enemy, playerPosition);
    }

    const forcedFallback = this.getForcedFallbackTarget(enemy);
    if (forcedFallback) {
      return forcedFallback;
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

  recordMovement(
    enemy: EnemyState,
    targetProgress: number,
    dt: number,
    playerPosition: THREE.Vector3,
    intendedMovement: boolean,
  ) {
    if (!intendedMovement || targetProgress > STALL_RESET_PROGRESS) {
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
    this.forcedFallbacks.add(enemy.id);
    this.pathQueue.request(enemy, fallbackGoal);
  }

  clearEnemy(enemy: EnemyState) {
    this.pathQueue.clearEnemy(enemy);
    this.forcedFallbacks.delete(enemy.id);
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

  private getForcedFallbackTarget(enemy: EnemyState) {
    if (!this.forcedFallbacks.has(enemy.id)) {
      return null;
    }
    const waypoint = this.getFallbackWaypoint(enemy);
    if (waypoint) {
      return this.result(enemy, "fallback", waypoint);
    }
    if (enemy.pathQueued) {
      return this.result(enemy, "waiting", enemy.group.position);
    }
    this.forcedFallbacks.delete(enemy.id);
    return null;
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
