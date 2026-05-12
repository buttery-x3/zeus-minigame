import * as THREE from "three";
import {
  INITIAL_ENEMY_COUNT,
  INITIAL_NEXT_WAVE_AT,
  INITIAL_SPAWN_INTERVAL,
  PLAYER_MAX_MANA,
  WORLD_HALF,
} from "../../config";
import { clamp, distance2D, randomBetween } from "../../lib/math";
import type { GameEffects } from "../../render/GameEffects";
import type { GameMaterials } from "../../render/materials";
import { createEnemyModel } from "../../render/meshes";
import type { EnemyState, GameRuntimeState } from "../../types";

type EnemySystemCallbacks = {
  damagePlayer: (amount: number) => void;
};

export class EnemySystem {
  private enemies: EnemyState[] = [];
  private enemyId = 0;

  constructor(
    private readonly group: THREE.Group,
    private readonly materials: GameMaterials,
    private readonly effects: GameEffects,
    private readonly callbacks: EnemySystemCallbacks,
  ) {}

  update(dt: number, state: GameRuntimeState, playerPosition: THREE.Vector3) {
    for (const enemy of this.enemies) {
      const toPlayer = new THREE.Vector3(playerPosition.x - enemy.group.position.x, 0, playerPosition.z - enemy.group.position.z);
      const distance = toPlayer.length();

      if (distance > 0.001) {
        toPlayer.normalize();
        enemy.group.position.x += toPlayer.x * enemy.speed * dt;
        enemy.group.position.z += toPlayer.z * enemy.speed * dt;
        enemy.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      }

      enemy.group.position.y = Math.sin(performance.now() * 0.006 + enemy.id) * 0.06;
      enemy.touchCooldown = Math.max(0, enemy.touchCooldown - dt);
      enemy.flashTimer = Math.max(0, enemy.flashTimer - dt);
      enemy.body.material = enemy.flashTimer > 0 ? this.materials.enemyHit : this.materials.enemy;

      if (distance < 2.25 && enemy.touchCooldown <= 0) {
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
    for (let i = 0; i < INITIAL_ENEMY_COUNT; i += 1) {
      this.spawn(state, playerPosition, true);
    }
  }

  clear() {
    for (const enemy of this.enemies) {
      enemy.group.removeFromParent();
    }
    this.enemies = [];
  }

  reset(state: GameRuntimeState, playerPosition: THREE.Vector3) {
    this.clear();
    state.spawnInterval = INITIAL_SPAWN_INTERVAL;
    state.nextWaveAt = INITIAL_NEXT_WAVE_AT;
    state.spawnTimer = 0;
    this.spawnInitial(state, playerPosition);
  }

  damageEnemy(enemy: EnemyState, amount: number, state: GameRuntimeState) {
    enemy.hp -= amount;
    enemy.flashTimer = 0.09;

    if (enemy.hp > 0) {
      return;
    }

    const deathPosition = enemy.group.position.clone();
    enemy.group.removeFromParent();
    this.enemies = this.enemies.filter((candidate) => candidate !== enemy);
    state.kills += 1;
    state.mana = Math.min(PLAYER_MAX_MANA, state.mana + 4);
    this.effects.createShockwave(deathPosition, 0x67e3c0, 3);
  }

  findClosest(target: THREE.Vector3, maxDistance: number, excluded: Set<EnemyState> = new Set()) {
    let closest: EnemyState | null = null;
    let closestDistance = maxDistance;

    for (const enemy of this.enemies) {
      if (excluded.has(enemy)) {
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

  private spawn(state: GameRuntimeState, playerPosition: THREE.Vector3, initial = false) {
    const angle = randomBetween(0, Math.PI * 2);
    const distance = initial ? randomBetween(20, 34) : randomBetween(42, 56);
    const x = clamp(playerPosition.x + Math.cos(angle) * distance, -WORLD_HALF + 5, WORLD_HALF - 5);
    const z = clamp(playerPosition.z + Math.sin(angle) * distance, -WORLD_HALF + 5, WORLD_HALF - 5);
    const { group, body } = createEnemyModel(this.materials.enemy);
    group.position.set(x, 0, z);
    this.group.add(group);

    this.enemies.push({
      id: this.enemyId,
      group,
      body,
      hp: 70 + state.wave * 9,
      maxHp: 70 + state.wave * 9,
      speed: randomBetween(5.7, 7.4) + state.wave * 0.16,
      touchCooldown: randomBetween(0.1, 0.5),
      flashTimer: 0,
    });
    this.enemyId += 1;
  }
}
