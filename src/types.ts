import type * as THREE from "three";

export type SpellId = "chain" | "bolt";

export type TerrainKind = "floor" | "scarred" | "charged" | "reserved_blocker";

export type TerrainCell = {
  x: number;
  z: number;
  kind: TerrainKind;
  blocked: boolean;
};

export type EnemyState = {
  id: number;
  group: THREE.Group;
  body: THREE.Mesh;
  path: THREE.Vector3[];
  hp: number;
  maxHp: number;
  speed: number;
  touchCooldown: number;
  flashTimer: number;
  repathTimer: number;
  targetCellKey: string;
};

export type SpellConfig = {
  id: SpellId;
  key: "Q" | "W";
  label: string;
  manaCost: number;
  cooldown: number;
  range: number;
  color: THREE.ColorRepresentation;
};

export type EffectState = {
  object: THREE.Object3D;
  ttl: number;
  maxTtl: number;
  update?: (lifeRatio: number) => void;
};

export type GameRuntimeState = {
  health: number;
  mana: number;
  kills: number;
  wave: number;
  spawnTimer: number;
  spawnInterval: number;
  nextWaveAt: number;
  gameOver: boolean;
  paused: boolean;
};
