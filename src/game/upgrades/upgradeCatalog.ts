import type { UpgradeDefinition, UpgradeId } from "./upgradeTypes";

export const UPGRADE_CATALOG: Record<UpgradeId, UpgradeDefinition> = {
  healthRegen: {
    id: "healthRegen",
    label: "Mending Storm",
    description: "Regenerate additional health every second.",
    effectLabel: "+0.2 HP regeneration per second",
    repeatable: true,
  },
  manaRegen: {
    id: "manaRegen",
    label: "Arcane Current",
    description: "Recover Power more quickly.",
    effectLabel: "+0.2 Power regeneration per second",
    repeatable: true,
  },
  maxVitals: {
    id: "maxVitals",
    label: "Titan's Reserve",
    description: "Expand both health and Power capacity.",
    effectLabel: "+10% maximum HP and Power",
    repeatable: true,
  },
  spellCooldown: {
    id: "spellCooldown",
    label: "Rolling Thunder",
    description: "Cast every spell more frequently.",
    effectLabel: "-5% spell cooldown",
    repeatable: true,
  },
  spellCost: {
    id: "spellCost",
    label: "Efficient Conduit",
    description: "Spend less Power on every spell.",
    effectLabel: "-5% spell cost",
    repeatable: true,
  },
  moveSpeed: {
    id: "moveSpeed",
    label: "Tailwind",
    description: "Move through the arena faster.",
    effectLabel: "+5% movement speed",
    repeatable: true,
  },
  shield: {
    id: "shield",
    label: "Aegis of Storms",
    description: "Negate one complete damage event. Recharges during active play.",
    effectLabel: "1-hit shield · 30 second recharge",
    repeatable: false,
  },
  spellDamage: {
    id: "spellDamage",
    label: "Storm's Wrath",
    description: "Increase damage dealt by every spell.",
    effectLabel: "+10% spell damage",
    repeatable: true,
  },
  chainBounce: {
    id: "chainBounce",
    label: "Forked Judgment",
    description: "Chain Lightning can reach one additional enemy.",
    effectLabel: "+1 Chain Lightning bounce",
    repeatable: true,
  },
  boltDamage: {
    id: "boltDamage",
    label: "Heaven's Spear",
    description: "Empower Lightning Bolt's impact and splash.",
    effectLabel: "+25% Lightning Bolt damage",
    repeatable: true,
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADE_CATALOG) as UpgradeId[];
