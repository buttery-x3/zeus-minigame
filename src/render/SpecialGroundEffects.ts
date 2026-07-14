import * as THREE from "three";
import type {
  GroundCellPhase,
  GroundCellVisualState,
  GroundEffectSnapshot,
} from "../game/terrain/GroundEffectSystem";
import type { TerrainCell } from "../types";
import type { GridWorld } from "../world/GridWorld";
import type { VisibilitySystem } from "../game/visibility/VisibilitySystem";
import { disposeObject3D } from "./dispose";
import {
  createChargedGlyph,
  createCursedGlyph,
  createGroundActivityParticles,
  type GroundGlyphModel,
  type GroundParticleModel,
} from "./meshes";
import { setLineColor, setLineOpacity } from "./primitives";

type SpecialGroundKind = "charged" | "cursed";

type SpecialGroundRecord = {
  q: number;
  r: number;
  kind: SpecialGroundKind;
  phase: GroundCellPhase;
  progress: number;
  model: GroundGlyphModel;
};

const ACTIVE_PARTICLE_COUNT = 7;
const ACTIVE_PARTICLE_SIZE_MULTIPLIER = 8;

export class SpecialGroundEffects {
  private readonly records: SpecialGroundRecord[] = [];
  private readonly recordsByKey = new Map<string, SpecialGroundRecord>();
  private activeRecord: SpecialGroundRecord | null = null;
  private activeParticles: GroundParticleModel | null = null;
  private activeParticleKind: SpecialGroundKind | null = null;
  private elapsed = 0;
  private animatedTileCount = 0;

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly terrainGroup: THREE.Group,
  ) {}

  resetForRebuild() {
    this.records.length = 0;
    this.recordsByKey.clear();
    this.activeRecord = null;
    this.activeParticles = null;
    this.activeParticleKind = null;
    this.animatedTileCount = 0;
  }

  addCell(cell: TerrainCell, world: { x: number; z: number }, visual: GroundCellVisualState) {
    if (visual.phase !== "charged" && visual.phase !== "depleted" && visual.phase !== "cursed") {
      return;
    }

    const kind = visual.phase === "cursed" ? "cursed" : "charged";
    const model = kind === "charged" ? createChargedGlyph(world.x, world.z) : createCursedGlyph(world.x, world.z);
    const record: SpecialGroundRecord = {
      q: cell.q,
      r: cell.r,
      kind,
      phase: visual.phase,
      progress: visual.progress,
      model,
    };
    this.applyDormantStyle(record);
    this.records.push(record);
    this.recordsByKey.set(this.gridWorld.cellKey(cell.q, cell.r), record);
    this.terrainGroup.add(model.group);
  }

  applyVisibility(visibility: VisibilitySystem, revealAll: boolean) {
    for (const record of this.records) {
      record.model.group.visible = revealAll || visibility.isVisibleCell(record.q, record.r);
    }
  }

  update(dt: number, playerGround: GroundEffectSnapshot) {
    this.elapsed += dt;
    const kind = this.activeKind(playerGround);
    const key = kind ? this.gridWorld.cellKey(playerGround.cell.q, playerGround.cell.r) : "";
    const nextRecord = kind ? this.recordsByKey.get(key) ?? null : null;

    if (nextRecord !== this.activeRecord) {
      this.deactivateCurrentRecord();
      this.activeRecord = nextRecord;
      this.removeActiveParticles();
    }

    if (!this.activeRecord || !kind) {
      this.animatedTileCount = 0;
      return;
    }

    this.activeRecord.phase = playerGround.phase;
    this.activeRecord.progress = kind === "charged" ? playerGround.chargedProgress : playerGround.curseProgress;
    if (kind === "charged") {
      this.animateCharged(this.activeRecord);
    } else {
      this.animateCursed(this.activeRecord);
    }
    this.animatedTileCount = 1;
    this.syncActiveParticles(kind, this.activeRecord);
  }

  getDiagnostics() {
    return {
      total: this.records.length,
      visible: this.records.filter((record) => record.model.group.visible).length,
      activeParticleSystems: this.activeParticles ? 1 : 0,
      activeParticleCount: this.activeParticles?.count ?? 0,
      activeParticleKind: this.activeParticleKind,
      activationSource: "player-cell",
      ambientUpdatesPerSecond: 0,
      animatedTileCount: this.animatedTileCount,
      particleSizeMultiplier: ACTIVE_PARTICLE_SIZE_MULTIPLIER,
    };
  }

  private activeKind(playerGround: GroundEffectSnapshot): SpecialGroundKind | null {
    if (playerGround.phase === "charged" && playerGround.cooldownRecoveryMultiplier > 1) {
      return "charged";
    }
    return playerGround.phase === "cursed" ? "cursed" : null;
  }

  private deactivateCurrentRecord() {
    if (!this.activeRecord) {
      return;
    }
    if (this.activeRecord.kind === "cursed") {
      this.activeRecord.progress = 0;
    }
    this.applyDormantStyle(this.activeRecord);
    this.activeRecord = null;
  }

  private applyDormantStyle(record: SpecialGroundRecord) {
    const depleted = record.phase === "depleted";
    const strength = record.kind === "charged" ? 1 - record.progress * 0.48 : 1 - record.progress * 0.58;
    record.model.rune.rotation.y = 0;
    record.model.ring.rotation.y = 0;
    record.model.rune.scale.setScalar(record.kind === "cursed" ? Math.max(0.48, 1 - record.progress * 0.45) : 1);
    record.model.group.scale.setScalar(depleted ? 0.86 : 0.92);
    setLineOpacity(record.model.rune, depleted ? 0.08 : strength * 0.34);
    setLineOpacity(record.model.ring, depleted ? 0.035 : strength * (record.kind === "charged" ? 0.1 : 0.12));
    if (record.kind === "charged") {
      setLineColor(record.model.rune, 0x67e3c0);
      setLineColor(record.model.ring, 0x67e3c0);
    }
  }

  private animateCharged(record: SpecialGroundRecord) {
    const pulse = 1.08 + Math.sin(this.elapsed * 5.2) * 0.12;
    const strength = 1 - record.progress * 0.48;
    record.model.rune.rotation.y = this.elapsed * 1.15;
    record.model.ring.rotation.y = -this.elapsed * 0.82;
    record.model.group.scale.setScalar(pulse);
    setLineColor(record.model.rune, 0xc0ffd0);
    setLineColor(record.model.ring, 0x79ff9c);
    setLineOpacity(record.model.rune, strength);
    setLineOpacity(record.model.ring, strength * 0.9);
  }

  private animateCursed(record: SpecialGroundRecord) {
    const pulse = 1.06 + Math.sin(this.elapsed * 4.1) * 0.1;
    const strength = 1 - record.progress * 0.58;
    record.model.rune.rotation.y = -this.elapsed * 0.72;
    record.model.ring.rotation.y = this.elapsed * 0.5;
    record.model.rune.scale.setScalar(Math.max(0.48, 1 - record.progress * 0.45));
    record.model.group.scale.setScalar(pulse);
    setLineOpacity(record.model.rune, strength * 0.98);
    setLineOpacity(record.model.ring, strength * 0.66);
  }

  private syncActiveParticles(kind: SpecialGroundKind, record: SpecialGroundRecord) {
    if (!this.activeParticles) {
      this.activeParticles = createGroundActivityParticles(ACTIVE_PARTICLE_COUNT);
      this.activeParticleKind = kind;
      const world = this.gridWorld.cellToWorld(record.q, record.r);
      this.activeParticles.points.position.set(world.x, 0.16, world.z);
      this.activeParticles.points.material.color.set(kind === "charged" ? 0x8ffff0 : 0xd993ff);
      this.terrainGroup.add(this.activeParticles.points);
    }

    const particles = this.activeParticles;
    const speed = kind === "charged" ? 2.7 : 1.9;
    for (let index = 0; index < particles.count; index += 1) {
      const angle = this.elapsed * speed * 0.72 + (index / particles.count) * Math.PI * 2;
      const radius = 0.55 + (index % 3) * 0.2;
      const offset = index * 3;
      particles.positions[offset] = Math.cos(angle) * radius;
      particles.positions[offset + 1] = 0.08 + ((this.elapsed * speed + index * 0.23) % 1.18);
      particles.positions[offset + 2] = Math.sin(angle) * radius;
    }
    particles.points.material.size =
      ((kind === "charged" ? 0.28 : 0.31) + Math.sin(this.elapsed * 5) * 0.035) * ACTIVE_PARTICLE_SIZE_MULTIPLIER;
    particles.points.geometry.attributes.position.needsUpdate = true;
  }

  private removeActiveParticles() {
    if (this.activeParticles) {
      disposeObject3D(this.activeParticles.points);
      this.activeParticles.points.removeFromParent();
    }
    this.activeParticles = null;
    this.activeParticleKind = null;
  }
}
