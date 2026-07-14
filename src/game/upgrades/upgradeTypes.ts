export type UpgradeId =
  | "healthRegen"
  | "manaRegen"
  | "maxVitals"
  | "spellCooldown"
  | "spellCost"
  | "moveSpeed"
  | "shield"
  | "spellDamage"
  | "chainBounce"
  | "boltDamage";

export type UpgradeDefinition = {
  id: UpgradeId;
  label: string;
  description: string;
  effectLabel: string;
  repeatable: boolean;
};

export type UpgradeOfferCard = {
  id: UpgradeId;
  cost: 1 | 2 | 3;
};

export type UpgradeOfferSnapshot = {
  cards: UpgradeOfferCard[];
  durationSeconds: number;
  remainingSeconds: number;
  progress: number;
};

export type UpgradeStacks = Record<UpgradeId, number>;

export type DerivedRunStats = {
  maxHealth: number;
  maxMana: number;
  healthRegenPerSecond: number;
  manaRegenPerSecond: number;
  moveSpeed: number;
  spellCooldownMultiplier: number;
  spellCostMultiplier: number;
  spellDamageMultiplier: number;
  chainExtraBounces: number;
  boltDamageMultiplier: number;
};

export type ShieldSnapshot = {
  owned: boolean;
  ready: boolean;
  rechargeRemainingSeconds: number;
  rechargeDurationSeconds: number;
};
