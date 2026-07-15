import * as THREE from "three";
import {
  ENEMY_ATTACK_INTERVAL,
  ENEMY_COLLISION_RADIUS,
  ENEMY_UNIT_SEPARATION_RADIUS,
  INITIAL_ENEMY_COUNT,
  INITIAL_NEXT_WAVE_AT,
  INITIAL_SPAWN_INTERVAL,
} from "../../config";
import { distance2D, randomBetween } from "../../lib/math";
import type { GameEffects } from "../../render/GameEffects";
import type { GameMaterialPalettes } from "../../render/materials";
import { createEnemyModel } from "../../render/meshes";
import type { EnemyHealthBarVisibilityMode, EnemyState, GameRuntimeState } from "../../types";
import type { GridWorld } from "../../world/GridWorld";
import type { CollisionMoveTrace, CollisionSystem } from "../collision/CollisionSystem";
import type { Profiler } from "../perf/Profiler";
import type { RenderMode } from "../preferences/GamePreferences";
import { NavigationDebugRenderer } from "../../render/NavigationDebugRenderer";
import { EnemyAvoidance } from "./EnemyAvoidance";
import { EnemyCharacter } from "./EnemyCharacter";
import { EnemyHealthBars } from "./EnemyHealthBars";
import { chooseEnemyMove } from "./EnemyMovement";
import { EnemyNavigation } from "./navigation/EnemyNavigation";
import type { NavigationDebugMode } from "./navigation/NavigationDebugTypes";
import type { NavigationWorkSource } from "../navigation/NavigationScheduler";

const ZERO_DELTA = new THREE.Vector3();

type EnemySystemCallbacks = {
  damagePlayer: (amount: number) => void;
  enemyDied: (position: THREE.Vector3) => void;
  waveStarted: (wave: number) => void;
  restoreMana: (amount: number) => void;
};

type EnemyMovePlan = {
  enemy: EnemyState;
  navigationTarget: THREE.Vector3;
  desiredVelocity: THREE.Vector3;
  steeredVelocity: THREE.Vector3;
};

type EnemyCollisionTrace = CollisionMoveTrace & {
  actualDelta: THREE.Vector3;
};

export class EnemySystem {
  private enemies: EnemyState[] = [];
  private enemyId = 0;
  private worldVisibleCount = 0;
  private readonly navigation: EnemyNavigation;
  private readonly avoidance = new EnemyAvoidance();
  private readonly healthBars: EnemyHealthBars;
  private readonly navigationDebug: NavigationDebugRenderer;
  private readonly collisionTraces = new Map<number, EnemyCollisionTrace>();

  constructor(
    private readonly group: THREE.Group,
    healthBarGroup: THREE.Group,
    navigationDebugGroup: THREE.Group,
    private readonly collision: CollisionSystem,
    gridWorld: GridWorld,
    profiler: Profiler,
    private readonly materialPalettes: GameMaterialPalettes,
    private readonly effects: GameEffects,
    private readonly callbacks: EnemySystemCallbacks,
    private renderMode: RenderMode,
  ) {
    this.navigation = new EnemyNavigation(gridWorld, collision, profiler);
    this.healthBars = new EnemyHealthBars(healthBarGroup);
    this.navigationDebug = new NavigationDebugRenderer(gridWorld);
    navigationDebugGroup.add(this.navigationDebug.object);
  }

  update(dt: number, state: GameRuntimeState, playerPosition: THREE.Vector3) {
    this.navigation.beginFrame(playerPosition);
    this.avoidance.beginFrame(this.enemies);
    this.navigationDebug.beginSimulationStep();

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

      const steeredVelocity = this.avoidance.steer(enemy, desiredVelocity, navigationTarget);
      movePlans.push({
        enemy,
        navigationTarget,
        desiredVelocity,
        steeredVelocity,
      });
    }

    for (const { enemy, navigationTarget, desiredVelocity, steeredVelocity } of movePlans) {
      enemy.character.update(dt);
      let movedDistance = 0;
      let targetProgress = 0;
      const hasMovement = steeredVelocity.lengthSq() > 0.000001;
      let attemptedDelta = ZERO_DELTA;
      const trace = this.navigationDebug.isEnabled() ? this.getCollisionTrace(enemy.id) : undefined;
      const actualDelta = trace?.actualDelta ?? null;
      if (trace) {
        trace.resolution = "rejected";
        trace.actualDelta.set(0, 0, 0);
      }

      if (hasMovement) {
        const move = chooseEnemyMove(
          this.collision,
          enemy.group.position,
          navigationTarget,
          desiredVelocity,
          steeredVelocity,
          dt,
          trace,
        );
        const nextPosition = move.nextPosition;
        attemptedDelta = move.attemptedDelta;
        const actualX = nextPosition.x - enemy.group.position.x;
        const actualZ = nextPosition.z - enemy.group.position.z;
        actualDelta?.set(actualX, 0, actualZ);

        movedDistance = move.movedDistance;
        targetProgress = move.targetProgress;
        this.avoidance.recordObstacleFallback(move.avoidanceFallbackAttempted, move.usedPreferredFallback);
        if (movedDistance > 0.001) {
          enemy.group.position.x = nextPosition.x;
          enemy.group.position.z = nextPosition.z;
          enemy.group.rotation.y = Math.atan2(actualX, actualZ);
        }
      }

      this.avoidance.recordSpeedRatio(movedDistance / Math.max(enemy.speed * dt, 0.0001));
      this.navigation.recordMovement(enemy, targetProgress, dt, playerPosition, desiredVelocity.lengthSq() > 0.000001);
      if (trace && actualDelta) {
        this.navigationDebug.record(
          enemy,
          navigationTarget,
          desiredVelocity,
          steeredVelocity,
          attemptedDelta,
          actualDelta,
          trace.resolution,
          targetProgress,
          dt,
        );
      }

      enemy.group.position.y = Math.sin(performance.now() * 0.006 + enemy.id) * 0.06;
      enemy.touchCooldown -= dt;
      enemy.flashTimer = Math.max(0, enemy.flashTimer - dt);
      enemy.visibilityHintTimer = Math.max(0, enemy.visibilityHintTimer - dt);
      enemy.character.setHitFlashing(enemy.flashTimer > 0);

      const playerDistance = distance2D(playerPosition.x, playerPosition.z, enemy.group.position.x, enemy.group.position.z);
      if (playerDistance < 2.25 && enemy.touchCooldown <= 0) {
        enemy.touchCooldown += ENEMY_ATTACK_INTERVAL;
        enemy.character.playAttack();
        this.callbacks.damagePlayer(8 + state.wave);
      } else if (enemy.touchCooldown < 0) {
        enemy.touchCooldown = 0;
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
      this.callbacks.waveStarted(state.wave);
    }

    if (state.spawnTimer <= 0) {
      state.spawnTimer += state.spawnInterval;
      this.spawn(state, playerPosition);
    }
  }

  setRenderMode(renderMode: RenderMode) {
    if (this.renderMode === renderMode) {
      return;
    }
    this.renderMode = renderMode;
    const materials = this.materialPalettes[renderMode];
    for (const enemy of this.enemies) {
      enemy.character.setLowDetail(renderMode === "potato", materials.enemy, materials.enemyHit);
    }
  }

  setNavigationDebugMode(mode: NavigationDebugMode) {
    this.navigationDebug.setMode(mode);
    if (mode === "off") {
      this.collisionTraces.clear();
    }
  }

  updateNavigationDebug() {
    this.navigationDebug.update();
  }

  getNavigationDebugDiagnostics() {
    return {
      ...this.navigationDebug.diagnostics(),
      fallbacks: this.navigation.getFallbackDiagnostics(),
    };
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
    this.collisionTraces.clear();
  }

  dispose() {
    this.clear();
    this.navigationDebug.dispose();
  }

  reset(state: GameRuntimeState, playerPosition: THREE.Vector3) {
    this.clear();
    this.navigation.reset(playerPosition);
    state.spawnInterval = INITIAL_SPAWN_INTERVAL;
    state.nextWaveAt = INITIAL_NEXT_WAVE_AT;
    state.spawnTimer = 0;
    this.spawnInitial(state, playerPosition);
  }

  getNavigationWorkSources(): NavigationWorkSource[] {
    return this.navigation.getWorkSources();
  }

  getNavigationDiagnostics() {
    return this.navigation.getDiagnostics();
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
    this.callbacks.restoreMana(4);
    this.effects.createShockwave(deathPosition, 0x67e3c0, 3);
    this.callbacks.enemyDied(deathPosition);
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

  getAnimationDiagnostics() {
    const animations = this.enemies.map((enemy) => enemy.character.getDiagnostics());
    const representative = animations.find((animation) => animation.loadState === "ready") ?? animations[0];
    return {
      total: animations.length,
      ready: animations.filter((animation) => animation.loadState === "ready").length,
      loading: animations.filter((animation) => animation.loadState === "loading").length,
      errors: animations.filter((animation) => animation.loadState === "error").length,
      modelSource: representative?.modelSource ?? null,
      modelScale: representative?.modelScale ?? null,
      availableClips: representative?.availableClips ?? [],
      activeClips: [...new Set(animations.flatMap((animation) => (animation.activeClip ? [animation.activeClip] : [])))],
      lowDetail: animations.filter((animation) => animation.lowDetail).length,
      primitiveVisuals: animations.filter((animation) => animation.activeVisual === "primitive").length,
      animatedVisuals: animations.filter((animation) => animation.activeVisual === "animated-model").length,
      walking: animations.filter((animation) => animation.activeState === "walk").length,
      attacking: animations.filter((animation) => animation.activeState === "attack").length,
      attackCount: animations.reduce((total, animation) => total + animation.attackCount, 0),
      loadErrors: animations.flatMap((animation) => (animation.loadError ? [animation.loadError] : [])),
    };
  }

  triggerAttackForVerification() {
    const enemy = this.enemies.find((candidate) => candidate.character.getDiagnostics().loadState === "ready");
    if (!enemy) {
      return false;
    }
    enemy.character.playAttack();
    return true;
  }

  defeatEnemyForVerification(state: GameRuntimeState) {
    const enemy = this.enemies[0];
    if (!enemy) {
      return false;
    }
    this.damageEnemy(enemy, enemy.hp, state);
    return true;
  }

  private spawn(state: GameRuntimeState, playerPosition: THREE.Vector3, initial = false) {
    const spawnPoint = this.findSpawnPoint(playerPosition, initial);
    if (!spawnPoint) {
      return false;
    }

    const materials = this.materialPalettes[this.renderMode];
    const model = createEnemyModel(materials.enemy);
    const { group } = model;
    const character = new EnemyCharacter(model, materials.enemy, materials.enemyHit, this.renderMode === "potato");
    group.position.copy(spawnPoint);
    this.group.add(group);

    const enemy: EnemyState = {
      id: this.enemyId,
      group,
      character,
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
    const x = playerPosition.x + Math.cos(angle) * distance;
    const z = playerPosition.z + Math.sin(angle) * distance;
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
    enemy.character.dispose();
    this.collisionTraces.delete(enemy.id);
  }

  private getCollisionTrace(enemyId: number) {
    let trace = this.collisionTraces.get(enemyId);
    if (!trace) {
      trace = { resolution: "rejected", actualDelta: new THREE.Vector3() };
      this.collisionTraces.set(enemyId, trace);
    }
    return trace;
  }
}
