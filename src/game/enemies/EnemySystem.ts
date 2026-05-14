import * as THREE from "three";
import {
  ENEMY_COLLISION_RADIUS,
  ENEMY_UNIT_SEPARATION_RADIUS,
  INITIAL_ENEMY_COUNT,
  INITIAL_NEXT_WAVE_AT,
  INITIAL_SPAWN_INTERVAL,
  PLAYER_MAX_MANA,
  WORLD_HALF,
} from "../../config";
import { clamp, distance2D, randomBetween } from "../../lib/math";
import type { GameEffects } from "../../render/GameEffects";
import { disposeObject3D } from "../../render/dispose";
import type { GameMaterials } from "../../render/materials";
import { createEnemyModel } from "../../render/meshes";
import type { EnemyHealthBarVisibilityMode, EnemyState, GameRuntimeState } from "../../types";
import type { GridWorld } from "../../world/GridWorld";
import type { CollisionSystem } from "../collision/CollisionSystem";
import type { Profiler } from "../perf/Profiler";
import { EnemyAvoidance } from "./EnemyAvoidance";
import { EnemyHealthBars } from "./EnemyHealthBars";
import { EnemyNavigation } from "./navigation/EnemyNavigation";

type EnemySystemCallbacks = {
  damagePlayer: (amount: number) => void;
};

type EnemyMovePlan = {
  enemy: EnemyState;
  navigationTarget: THREE.Vector3;
  velocity: THREE.Vector3;
};

export class EnemySystem {
  private enemies: EnemyState[] = [];
  private enemyId = 0;
  private worldVisibleCount = 0;
  private readonly navigation: EnemyNavigation;
  private readonly avoidance = new EnemyAvoidance();
  private readonly healthBars: EnemyHealthBars;

  constructor(
    private readonly group: THREE.Group,
    healthBarGroup: THREE.Group,
    private readonly collision: CollisionSystem,
    gridWorld: GridWorld,
    profiler: Profiler,
    private readonly materials: GameMaterials,
    private readonly effects: GameEffects,
    private readonly callbacks: EnemySystemCallbacks,
  ) {
    this.navigation = new EnemyNavigation(gridWorld, collision, profiler);
    this.healthBars = new EnemyHealthBars(healthBarGroup);
  }

  update(dt: number, state: GameRuntimeState, playerPosition: THREE.Vector3) {
    this.navigation.beginFrame(playerPosition);
    this.avoidance.beginFrame(this.enemies);

    const movePlans: EnemyMovePlan[] = [];
    for (const enemy of this.enemies) {
      const navigationTarget = this.navigation.getTarget(enemy, playerPosition);
      const toTarget = new THREE.Vector3(
        navigationTarget.x - enemy.group.position.x,
        0,
        navigationTarget.z - enemy.group.position.z,
      );
      const distance = toTarget.length();
      const desiredVelocity = new THREE.Vector3();

      if (distance > 0.001) {
        toTarget.normalize();
        desiredVelocity.set(toTarget.x * enemy.speed, 0, toTarget.z * enemy.speed);
      }

      movePlans.push({
        enemy,
        navigationTarget,
        velocity: this.avoidance.steer(enemy, desiredVelocity, navigationTarget),
      });
    }

    for (const { enemy, navigationTarget, velocity } of movePlans) {
      let movedDistance = 0;
      let targetProgress = 0;

      if (velocity.lengthSq() > 0.000001) {
        const startX = enemy.group.position.x;
        const startZ = enemy.group.position.z;
        const startDistanceToTarget = distance2D(startX, startZ, navigationTarget.x, navigationTarget.z);
        const nextPosition = this.collision.moveWithCollision(
          enemy.group.position,
          new THREE.Vector3(velocity.x * dt, 0, velocity.z * dt),
          ENEMY_COLLISION_RADIUS,
        );
        const actualX = nextPosition.x - enemy.group.position.x;
        const actualZ = nextPosition.z - enemy.group.position.z;

        movedDistance = distance2D(startX, startZ, nextPosition.x, nextPosition.z);
        targetProgress = startDistanceToTarget - distance2D(nextPosition.x, nextPosition.z, navigationTarget.x, navigationTarget.z);
        if (movedDistance > 0.001) {
          enemy.group.position.x = nextPosition.x;
          enemy.group.position.z = nextPosition.z;
          enemy.group.rotation.y = Math.atan2(actualX, actualZ);
        }
      }

      this.avoidance.recordSpeedRatio(movedDistance / Math.max(enemy.speed * dt, 0.0001));
      this.navigation.recordMovement(enemy, targetProgress, dt, playerPosition);

      enemy.group.position.y = Math.sin(performance.now() * 0.006 + enemy.id) * 0.06;
      enemy.touchCooldown = Math.max(0, enemy.touchCooldown - dt);
      enemy.flashTimer = Math.max(0, enemy.flashTimer - dt);
      enemy.visibilityHintTimer = Math.max(0, enemy.visibilityHintTimer - dt);
      enemy.body.material = enemy.flashTimer > 0 ? this.materials.enemyHit : this.materials.enemy;

      const playerDistance = distance2D(playerPosition.x, playerPosition.z, enemy.group.position.x, enemy.group.position.z);
      if (playerDistance < 2.25 && enemy.touchCooldown <= 0) {
        enemy.touchCooldown = 0.58;
        this.callbacks.damagePlayer(8 + state.wave);
      }
    }
  }

  updateSpawner(dt: number, state: GameRuntimeState, playerPosition: THREE.Vector3) {
    state.spawnTimer -= dt;

    if (state.kills >= state.nextWaveAt) {
      state.wave += 1;
      state.nextWaveAt += 12 + state.wave * 5;
      state.spawnInterval = Math.max(0.46, state.spawnInterval - 0.12);
      this.effects.createShockwave(playerPosition, 0xb184ff, 10);
    }

    if (state.spawnTimer <= 0) {
      state.spawnTimer = state.spawnInterval;
      this.spawn(state, playerPosition);
    }
  }

  spawnInitial(state: GameRuntimeState, playerPosition: THREE.Vector3) {
    let spawned = 0;
    let attempts = 0;

    while (spawned < INITIAL_ENEMY_COUNT && attempts < INITIAL_ENEMY_COUNT * 4) {
      if (this.spawn(state, playerPosition, true)) {
        spawned += 1;
      }
      attempts += 1;
    }
  }

  clear() {
    for (const enemy of this.enemies) {
      this.disposeEnemy(enemy);
      enemy.group.removeFromParent();
    }
    this.enemies = [];
    this.healthBars.clear();
  }

  reset(state: GameRuntimeState, playerPosition: THREE.Vector3) {
    this.clear();
    state.spawnInterval = INITIAL_SPAWN_INTERVAL;
    state.nextWaveAt = INITIAL_NEXT_WAVE_AT;
    state.spawnTimer = 0;
    this.spawnInitial(state, playerPosition);
  }

  damageEnemy(enemy: EnemyState, amount: number, state: GameRuntimeState) {
    enemy.hp = Math.max(0, enemy.hp - amount);
    enemy.flashTimer = 0.09;
    enemy.visibilityHintTimer = 1.8;
    this.healthBars.updateHealth(enemy);

    if (enemy.hp > 0) {
      return;
    }

    const deathPosition = enemy.group.position.clone();
    this.disposeEnemy(enemy);
    enemy.group.removeFromParent();
    this.enemies = this.enemies.filter((candidate) => candidate !== enemy);
    state.kills += 1;
    state.mana = Math.min(PLAYER_MAX_MANA, state.mana + 4);
    this.effects.createShockwave(deathPosition, 0x67e3c0, 3);
  }

  findClosest(
    target: THREE.Vector3,
    maxDistance: number,
    excluded: Set<EnemyState> = new Set(),
    predicate: (enemy: EnemyState) => boolean = () => true,
  ) {
    let closest: EnemyState | null = null;
    let closestDistance = maxDistance;

    for (const enemy of this.enemies) {
      if (excluded.has(enemy) || !predicate(enemy)) {
        continue;
      }

      const distance = distance2D(target.x, target.z, enemy.group.position.x, enemy.group.position.z);
      if (distance < closestDistance) {
        closest = enemy;
        closestDistance = distance;
      }
    }

    return closest;
  }

  forEach(callback: (enemy: EnemyState) => void) {
    for (const enemy of this.enemies) {
      callback(enemy);
    }
  }

  updateHealthBars(
    dt: number,
    camera: THREE.Camera,
    mode: EnemyHealthBarVisibilityMode,
    playerPosition: THREE.Vector3,
    pointerWorld: THREE.Vector3,
    isWorldVisible: (enemy: EnemyState) => boolean,
  ) {
    this.healthBars.update(this.enemies, { camera, dt, mode, playerPosition, pointerWorld, isWorldVisible });
  }

  updateVisibility(isWorldVisible: (enemy: EnemyState) => boolean) {
    let worldVisibleCount = 0;
    for (const enemy of this.enemies) {
      const visible = isWorldVisible(enemy);
      enemy.group.visible = visible;
      if (visible) {
        worldVisibleCount += 1;
      }
    }
    this.worldVisibleCount = worldVisibleCount;
  }

  getHealthBarDiagnostics() {
    return this.healthBars.diagnostics();
  }

  getVisibilityDiagnostics() {
    return {
      total: this.enemies.length,
      visible: this.worldVisibleCount,
      hidden: Math.max(0, this.enemies.length - this.worldVisibleCount),
    };
  }

  getAvoidanceDiagnostics() {
    return this.avoidance.diagnostics();
  }

  private spawn(state: GameRuntimeState, playerPosition: THREE.Vector3, initial = false) {
    const spawnPoint = this.findSpawnPoint(playerPosition, initial);
    if (!spawnPoint) {
      return false;
    }

    const { group, body } = createEnemyModel(this.materials.enemy);
    group.position.copy(spawnPoint);
    this.group.add(group);

    const enemy: EnemyState = {
      id: this.enemyId,
      group,
      body,
      path: [],
      pathQueued: false,
      hp: 70 + state.wave * 9,
      maxHp: 70 + state.wave * 9,
      speed: randomBetween(5.7, 7.4) + state.wave * 0.16,
      touchCooldown: randomBetween(0.1, 0.5),
      flashTimer: 0,
      visibilityHintTimer: 0,
      stallTimer: 0,
      navigationMode: "direct",
    };

    this.enemies.push(enemy);
    this.healthBars.add(enemy);
    this.enemyId += 1;
    return true;
  }

  private findSpawnPoint(playerPosition: THREE.Vector3, initial: boolean) {
    let fallback: THREE.Vector3 | null = null;

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const point = this.sampleSpawnPoint(playerPosition, initial);
      if (!this.collision.canOccupy(point.x, point.z, ENEMY_COLLISION_RADIUS)) {
        fallback ??= this.collision.findNearestOpenPoint(point, ENEMY_COLLISION_RADIUS, 4);
        continue;
      }
      if (!this.isSpawnClearOfEnemies(point)) {
        continue;
      }

      return point;
    }

    return fallback;
  }

  private sampleSpawnPoint(playerPosition: THREE.Vector3, initial: boolean) {
    const angle = randomBetween(0, Math.PI * 2);
    const distance = initial ? randomBetween(20, 34) : randomBetween(42, 56);
    const x = clamp(playerPosition.x + Math.cos(angle) * distance, -WORLD_HALF + 5, WORLD_HALF - 5);
    const z = clamp(playerPosition.z + Math.sin(angle) * distance, -WORLD_HALF + 5, WORLD_HALF - 5);
    return new THREE.Vector3(x, 0, z);
  }

  private isSpawnClearOfEnemies(point: THREE.Vector3) {
    for (const enemy of this.enemies) {
      if (distance2D(point.x, point.z, enemy.group.position.x, enemy.group.position.z) < ENEMY_UNIT_SEPARATION_RADIUS) {
        return false;
      }
    }
    return true;
  }

  private disposeEnemy(enemy: EnemyState) {
    this.navigation.clearEnemy(enemy);
    this.healthBars.remove(enemy);
    disposeObject3D(enemy.group, { preserveMaterials: Object.values(this.materials) });
  }
}
