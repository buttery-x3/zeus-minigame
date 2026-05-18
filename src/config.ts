import type { EnemyHealthBarVisibilityMode, SpellConfig, SpellId } from "./types";

export const TILE_SIZE = 4;
export const WORLD_CELLS = 181;
export const WORLD_HEX_RADIUS = Math.floor(WORLD_CELLS / 2);
export const WORLD_SIZE = TILE_SIZE * WORLD_HEX_RADIUS * 2;
export const WORLD_HALF = WORLD_SIZE / 2;

export const PLAYER_MAX_HEALTH = 120;
export const PLAYER_MAX_MANA = 100;

export const INITIAL_ENEMY_COUNT = 8;
export const INITIAL_SPAWN_INTERVAL = 1.25;
export const INITIAL_NEXT_WAVE_AT = 12;
export const CAMERA_ZOOM = 44;
export const PLAYER_COLLISION_RADIUS = 0.9;
export const PLAYER_LIGHT_INNER_RADIUS = 28;
export const PLAYER_LIGHT_OUTER_RADIUS = 64;
export const VISIBILITY_LIGHT_EPSILON = 0.001;
export const DISCOVERED_MEMORY_LIGHT = 0.22;
export const ENEMY_COLLISION_RADIUS = 0.85;
export const ENEMY_UNIT_AVOIDANCE_RADIUS = 4.0;
export const ENEMY_UNIT_SEPARATION_RADIUS = 1.8;
export const ENEMY_UNIT_SEPARATION_STRENGTH = 1.15;
export const ENEMY_UNIT_TANGENTIAL_STRENGTH = 0.78;
export const ENEMY_UNIT_MAX_STEERING_FRACTION = 0.9;
export const PATHFINDING_MAX_ITERATIONS = 900;
export const PLAYER_PATHFINDING_BUDGET_MS = 16;
export const PLAYER_PATHFINDING_CANDIDATE_ATTEMPTS = 4;
export const ROLLING_TERRAIN_PATCH_RADIUS = 4;
export const ENEMY_FLOW_FIELD_RADIUS_CELLS = 24;
export const ENEMY_FALLBACK_PATH_BUDGET_MS = 1.8;
export const ENEMY_STALL_FALLBACK_SECONDS = 0.7;
export const DEFAULT_ENEMY_HEALTH_BAR_VISIBILITY_MODE: EnemyHealthBarVisibilityMode = "smart";

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
