import {
  PLAYER_HEALTH_REGEN_PER_SECOND,
  PLAYER_MANA_REGEN_PER_SECOND,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_MANA,
  PLAYER_MOVE_SPEED,
} from "../../config";
import { UPGRADE_CATALOG, UPGRADE_IDS } from "./upgradeCatalog";
import type {
  DerivedRunStats,
  ShieldSnapshot,
  UpgradeId,
  UpgradeOfferCard,
  UpgradeOfferSnapshot,
  UpgradeStacks,
} from "./upgradeTypes";

const OFFER_DURATION_SECONDS = 10;
const SHIELD_RECHARGE_SECONDS = 30;

type ActiveOffer = {
  cards: UpgradeOfferCard[];
  expiresAtMs: number;
};

export class UpgradeSystem {
  private readonly stacks = createEmptyStacks();
  private activeOffer: ActiveOffer | null = null;
  private shieldReady = false;
  private shieldRechargeRemaining = 0;

  constructor(private readonly random: () => number = Math.random) {}

  beginOffer(nowMs = performance.now(), forcedIds?: UpgradeId[]) {
    if (this.activeOffer) {
      return this.getOfferSnapshot(nowMs);
    }

    const ids = forcedIds ?? this.drawUpgradeIds();
    if (ids.length !== 3 || new Set(ids).size !== 3) {
      throw new Error("Upgrade offers require exactly three distinct upgrades.");
    }

    const costs = this.shuffle([1, 2, 3] as const);
    this.activeOffer = {
      cards: ids.map((id, index) => ({ id, cost: costs[index] })),
      expiresAtMs: nowMs + OFFER_DURATION_SECONDS * 1000,
    };
    return this.getOfferSnapshot(nowMs);
  }

  choose(cardId: UpgradeId, cursedEnergy: number) {
    const card = this.activeOffer?.cards.find((candidate) => candidate.id === cardId);
    if (!card || cursedEnergy < card.cost) {
      return null;
    }

    const definition = UPGRADE_CATALOG[card.id];
    if (!definition.repeatable && this.stacks[card.id] > 0) {
      return null;
    }

    this.applyUpgrade(card.id);
    this.activeOffer = null;
    return { id: card.id, cost: card.cost, cursedEnergy: cursedEnergy - card.cost };
  }

  applyUpgradeForVerification(upgradeId: UpgradeId) {
    const definition = UPGRADE_CATALOG[upgradeId];
    if (!definition.repeatable && this.stacks[upgradeId] > 0) {
      return false;
    }
    this.applyUpgrade(upgradeId);
    return true;
  }

  skipOffer() {
    const skipped = this.activeOffer !== null;
    this.activeOffer = null;
    return skipped;
  }

  expireOffer(nowMs = performance.now()) {
    if (!this.activeOffer || nowMs < this.activeOffer.expiresAtMs) {
      return false;
    }
    this.activeOffer = null;
    return true;
  }

  update(dt: number) {
    if (!this.isShieldOwned() || this.shieldReady || this.shieldRechargeRemaining <= 0) {
      return;
    }
    this.shieldRechargeRemaining = Math.max(0, this.shieldRechargeRemaining - dt);
    if (this.shieldRechargeRemaining === 0) {
      this.shieldReady = true;
    }
  }

  absorbDamage() {
    if (!this.shieldReady) {
      return false;
    }
    this.shieldReady = false;
    this.shieldRechargeRemaining = SHIELD_RECHARGE_SECONDS;
    return true;
  }

  hasActiveOffer() {
    return this.activeOffer !== null;
  }

  getOfferSnapshot(nowMs = performance.now()): UpgradeOfferSnapshot | null {
    if (!this.activeOffer) {
      return null;
    }
    const remainingSeconds = Math.max(0, (this.activeOffer.expiresAtMs - nowMs) / 1000);
    return {
      cards: this.activeOffer.cards.map((card) => ({ ...card })),
      durationSeconds: OFFER_DURATION_SECONDS,
      remainingSeconds,
      progress: remainingSeconds / OFFER_DURATION_SECONDS,
    };
  }

  getStats(): DerivedRunStats {
    return {
      maxHealth: PLAYER_MAX_HEALTH * Math.pow(1.1, this.stacks.maxVitals),
      maxMana: PLAYER_MAX_MANA * Math.pow(1.1, this.stacks.maxVitals),
      healthRegenPerSecond: PLAYER_HEALTH_REGEN_PER_SECOND + this.stacks.healthRegen * 0.2,
      manaRegenPerSecond: PLAYER_MANA_REGEN_PER_SECOND + this.stacks.manaRegen * 0.2,
      moveSpeed: PLAYER_MOVE_SPEED * Math.pow(1.05, this.stacks.moveSpeed),
      spellCooldownMultiplier: Math.pow(0.95, this.stacks.spellCooldown),
      spellCostMultiplier: Math.pow(0.95, this.stacks.spellCost),
      spellDamageMultiplier: Math.pow(1.1, this.stacks.spellDamage),
      chainExtraBounces: this.stacks.chainBounce,
      boltDamageMultiplier: Math.pow(1.25, this.stacks.boltDamage),
    };
  }

  getStacks(): UpgradeStacks {
    return { ...this.stacks };
  }

  getShieldSnapshot(): ShieldSnapshot {
    return {
      owned: this.isShieldOwned(),
      ready: this.shieldReady,
      rechargeRemainingSeconds: this.shieldRechargeRemaining,
      rechargeDurationSeconds: SHIELD_RECHARGE_SECONDS,
    };
  }

  getDiagnostics(nowMs = performance.now()) {
    return {
      stacks: this.getStacks(),
      stats: this.getStats(),
      shield: this.getShieldSnapshot(),
      offer: this.getOfferSnapshot(nowMs),
    };
  }

  reset() {
    Object.assign(this.stacks, createEmptyStacks());
    this.activeOffer = null;
    this.shieldReady = false;
    this.shieldRechargeRemaining = 0;
  }

  private isShieldOwned() {
    return this.stacks.shield > 0;
  }

  private applyUpgrade(upgradeId: UpgradeId) {
    this.stacks[upgradeId] += 1;
    if (upgradeId === "shield") {
      this.shieldReady = true;
      this.shieldRechargeRemaining = 0;
    }
  }

  private drawUpgradeIds() {
    const eligible = UPGRADE_IDS.filter((id) => UPGRADE_CATALOG[id].repeatable || this.stacks[id] === 0);
    return this.shuffle(eligible).slice(0, 3);
  }

  private shuffle<T>(values: readonly T[]) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }
}

function createEmptyStacks(): UpgradeStacks {
  return {
    healthRegen: 0,
    manaRegen: 0,
    maxVitals: 0,
    spellCooldown: 0,
    spellCost: 0,
    moveSpeed: 0,
    shield: 0,
    spellDamage: 0,
    chainBounce: 0,
    boltDamage: 0,
  };
}
