import type * as THREE from "three";

export type SpellId = "chain" | "bolt";

export type EnemyHealthBarVisibilityMode = "always" | "smart";

export type TerrainStructure = "open" | "wall" | "bank" | "lake" | "river";

export type TerrainSurface = "grass" | "dirt" | "sand" | "mud" | "stone" | "scarred" | "charged" | "cursed";

export type HexEdgeKind = "open" | "closed" | "river" | "lake";

export type HexTileSignature = {
  ne: HexEdgeKind;
  e: HexEdgeKind;
  se: HexEdgeKind;
  sw: HexEdgeKind;
  w: HexEdgeKind;
  nw: HexEdgeKind;
};

export type TerrainCell = {
  q: number;
  r: number;
  structure: TerrainStructure;
  surface: TerrainSurface;
  blocked: boolean;
  opaque: boolean;
  edges: HexTileSignature;
};

export type EnemyState = {
  id: number;
  group: THREE.Group;
  body: THREE.Mesh;
  path: THREE.Vector3[];
  pathQueued: boolean;
  hp: number;
  maxHp: number;
  speed: number;
  touchCooldown: number;
  flashTimer: number;
  visibilityHintTimer: number;
  stallTimer: number;
  navigationMode: EnemyNavigationMode;
};

export type EnemyNavigationMode = "direct" | "flow" | "acquire" | "fallback" | "waiting";

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
  cursedEnergy: number;
  kills: number;
  wave: number;
  spawnTimer: number;
  spawnInterval: number;
  nextWaveAt: number;
  gameOver: boolean;
  paused: boolean;
};
