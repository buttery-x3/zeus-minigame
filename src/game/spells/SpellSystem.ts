import * as THREE from "three";
import { SPELLS } from "../../config";
import { distance2D } from "../../lib/math";
import type { GameEffects } from "../../render/GameEffects";
import type { EnemyState, GameRuntimeState, SpellConfig, SpellId } from "../../types";
import type { EnemySystem } from "../enemies/EnemySystem";

type SpellSystemCallbacks = {
  invalidCast: () => void;
  castSucceeded: (spellId: SpellId) => void;
  canCastAt: (target: THREE.Vector3) => boolean;
  canAffectEnemy: (enemy: EnemyState) => boolean;
};

type CastOptions = {
  allowMaxRangeTargetSnap: boolean;
};

export class SpellSystem {
  readonly spells: Record<SpellId, SpellConfig> = SPELLS;
  readonly cooldowns: Record<SpellId, number> = {
    chain: 0,
    bolt: 0,
  };

  castMode: SpellId | null = null;

  constructor(
    private readonly effects: GameEffects,
    private readonly enemySystem: EnemySystem,
    private readonly callbacks: SpellSystemCallbacks,
  ) {}

  update(dt: number, recoveryMultiplier = 1) {
    const recoveredTime = dt * recoveryMultiplier;
    this.cooldowns.chain = Math.max(0, this.cooldowns.chain - recoveredTime);
    this.cooldowns.bolt = Math.max(0, this.cooldowns.bolt - recoveredTime);
  }

  reset() {
    this.castMode = null;
    this.cooldowns.chain = 0;
    this.cooldowns.bolt = 0;
  }

  beginTargeting(spellId: SpellId, state: GameRuntimeState) {
    if (state.gameOver) {
      return;
    }

    const spell = this.spells[spellId];
    if (this.cooldowns[spellId] > 0 || state.mana < spell.manaCost) {
      this.callbacks.invalidCast();
      return;
    }

    this.castMode = spellId;
  }

  cancelTargeting() {
    this.castMode = null;
  }

  castAt(rawTarget: THREE.Vector3, playerPosition: THREE.Vector3, state: GameRuntimeState, options: CastOptions) {
    if (!this.castMode) {
      return;
    }

    const spellId = this.castMode;
    const spell = this.spells[spellId];
    this.castMode = null;

    if (this.cooldowns[spellId] > 0 || state.mana < spell.manaCost) {
      this.callbacks.invalidCast();
      return;
    }

    const rawDistance = distance2D(playerPosition.x, playerPosition.z, rawTarget.x, rawTarget.z);
    const target = options.allowMaxRangeTargetSnap
      ? clampToSpellRange(rawTarget, playerPosition, spell.range)
      : new THREE.Vector3(rawTarget.x, 0, rawTarget.z);
    if ((!options.allowMaxRangeTargetSnap && rawDistance > spell.range) || !this.callbacks.canCastAt(target)) {
      this.callbacks.invalidCast();
      return;
    }

    state.mana -= spell.manaCost;
    this.cooldowns[spellId] = spell.cooldown;
    this.callbacks.castSucceeded(spellId);

    if (spellId === "chain") {
      this.castChainLightning(target, playerPosition, state);
    } else {
      this.castLightningBolt(target, state);
    }
  }

  private castChainLightning(target: THREE.Vector3, playerPosition: THREE.Vector3, state: GameRuntimeState) {
    const firstTarget = this.enemySystem.findClosest(target, 12, new Set(), (enemy) => this.callbacks.canAffectEnemy(enemy));
    if (!firstTarget) {
      this.effects.createShockwave(target, 0x83dfff, 3.5);
      return;
    }

    const struck = new Set<EnemyState>();
    let origin = playerPosition.clone();
    let current: EnemyState | null = firstTarget;
    let damage = 42 + state.wave * 1.5;

    for (let jump = 0; jump < 5 && current; jump += 1) {
      struck.add(current);
      const enemyPosition = current.group.position.clone();
      enemyPosition.y = 1.8;
      this.effects.createLightningArc(origin.clone().setY(2.4), enemyPosition, 0x91e7ff);
      this.enemySystem.damageEnemy(current, damage, state);
      origin = enemyPosition;
      damage *= 0.82;
      current = this.enemySystem.findClosest(origin, 18, struck, (enemy) => this.callbacks.canAffectEnemy(enemy));
    }
  }

  private castLightningBolt(target: THREE.Vector3, state: GameRuntimeState) {
    const primary = this.enemySystem.findClosest(target, 7, new Set(), (enemy) => this.callbacks.canAffectEnemy(enemy));
    const impact = primary ? primary.group.position.clone() : target.clone();
    impact.y = 0;

    this.effects.createVerticalBolt(impact);
    this.effects.createShockwave(impact, 0xffe27a, 7.5);

    if (primary) {
      this.enemySystem.damageEnemy(primary, 94 + state.wave * 2.5, state);
    }

    this.enemySystem.forEach((enemy) => {
      if (enemy === primary) {
        return;
      }
      if (!this.callbacks.canAffectEnemy(enemy)) {
        return;
      }

      const distance = distance2D(impact.x, impact.z, enemy.group.position.x, enemy.group.position.z);
      if (distance <= 7.2) {
        this.enemySystem.damageEnemy(enemy, 28, state);
      }
    });
  }
}

export function clampToSpellRange(rawTarget: THREE.Vector3, origin: THREE.Vector3, range: number) {
  const offset = new THREE.Vector3(rawTarget.x - origin.x, 0, rawTarget.z - origin.z);
  const distance = offset.length();

  if (distance <= range) {
    return new THREE.Vector3(rawTarget.x, 0, rawTarget.z);
  }

  offset.normalize().multiplyScalar(range);
  return new THREE.Vector3(origin.x + offset.x, 0, origin.z + offset.z);
}
