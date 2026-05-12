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
  hp: number;
  maxHp: number;
  speed: number;
  touchCooldown: number;
  flashTimer: number;
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
