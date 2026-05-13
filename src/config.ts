import type { SpellConfig, SpellId } from "./types";

export const TILE_SIZE = 4;
export const WORLD_CELLS = 180;
export const WORLD_SIZE = TILE_SIZE * WORLD_CELLS;
export const WORLD_HALF = WORLD_SIZE / 2;

export const PLAYER_MAX_HEALTH = 120;
export const PLAYER_MAX_MANA = 100;

export const INITIAL_ENEMY_COUNT = 8;
export const INITIAL_SPAWN_INTERVAL = 1.25;
export const INITIAL_NEXT_WAVE_AT = 12;
export const CAMERA_ZOOM = 44;
export const PLAYER_COLLISION_RADIUS = 0.9;
export const ENEMY_COLLISION_RADIUS = 0.85;
export const PATHFINDING_MAX_ITERATIONS = 900;

export const SPELLS: Record<SpellId, SpellConfig> = {
  chain: {
    id: "chain",
    key: "Q",
    label: "Chain Lightning",
    manaCost: 22,
    cooldown: 2.8,
    range: 44,
    color: 0x83dfff,
  },
  bolt: {
    id: "bolt",
    key: "W",
    label: "Lightning Bolt",
    manaCost: 34,
    cooldown: 4.1,
    range: 50,
    color: 0xffe27a,
  },
};
