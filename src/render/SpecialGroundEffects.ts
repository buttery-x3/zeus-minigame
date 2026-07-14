import * as THREE from "three";
import type { GroundEffectSystem, GroundCellPhase } from "../game/terrain/GroundEffectSystem";
import type { TerrainCell } from "../types";
import type { GridWorld } from "../world/GridWorld";
import type { VisibilitySystem } from "../game/visibility/VisibilitySystem";
import { disposeObject3D } from "./dispose";
import type { GameMaterials } from "./materials";
import {
  createChargedGlyph,
  createCursedGlyph,
  createGroundActivityParticles,
  type GroundGlyphModel,
  type GroundParticleModel,
} from "./meshes";
import { setLineOpacity } from "./primitives";

type SpecialGroundRecord = {
  q: number;
  r: number;
  kind: "charged" | "cursed";
  model: GroundGlyphModel;
};

const ACTIVE_PARTICLE_COUNT = 7;
const AMBIENT_UPDATE_SECONDS = 0.2;

export class SpecialGroundEffects {
  private readonly records: SpecialGroundRecord[] = [];
  private activeParticles: GroundParticleModel | null = null;
  private activeParticleKey = "";
  private activeParticleKind: "charged" | "cursed" | null = null;
  private elapsed = 0;
  private ambientUpdateIn = 0;

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly terrainGroup: THREE.Group,
    private readonly materials: GameMaterials,
    private readonly groundEffects: GroundEffectSystem,
  ) {}

  resetForRebuild() {
    this.records.length = 0;
    this.activeParticles = null;
    this.activeParticleKey = "";
    this.activeParticleKind = null;
  }

  addCell(cell: TerrainCell, world: { x: number; z: number }, phase: GroundCellPhase) {
    if (phase !== "charged" && phase !== "depleted" && phase !== "cursed") {
      return;
    }

    const kind = phase === "cursed" ? "cursed" : "charged";
    const model = kind === "charged" ? createChargedGlyph(world.x, world.z) : createCursedGlyph(world.x, world.z);
    this.records.push({ q: cell.q, r: cell.r, kind, model });
    this.terrainGroup.add(model.group);
  }

  applyVisibility(visibility: VisibilitySystem, revealAll: boolean) {
    for (const record of this.records) {
      record.model.group.visible = revealAll || visibility.isVisibleCell(record.q, record.r);
    }
  }

  update(dt: number) {
    this.elapsed += dt;
    this.ambientUpdateIn -= dt;
    const refreshAmbient = this.ambientUpdateIn <= 0;
    if (refreshAmbient) {
      this.ambientUpdateIn = AMBIENT_UPDATE_SECONDS;
    }
    const snapshot = this.groundEffects.getSnapshot();
    const activeKind =
      snapshot.phase === "charged" && snapshot.cooldownRecoveryMultiplier > 1
        ? "charged"
        : snapshot.phase === "cursed"
          ? "cursed"
          : null;
    const activeKey = activeKind ? this.gridWorld.cellKey(snapshot.cell.q, snapshot.cell.r) : "";
    const chargedPulse = 1.08 + Math.sin(this.elapsed * 5.2) * 0.12;
    const cursedPulse = 1.06 + Math.sin(this.elapsed * 4.1) * 0.1;

    if (refreshAmbient) {
      this.materials.charged.emissiveIntensity = 0.29 + Math.sin(this.elapsed * 1.4) * 0.035;
      this.materials.cursed.emissiveIntensity = 0.34 + Math.sin(this.elapsed * 1.1) * 0.04;
    }

    for (const record of this.records) {
      const cell = this.gridWorld.getCell(record.q, record.r);
      const visual = this.groundEffects.getCellVisualState(cell);
      const isActive = activeKind === record.kind && activeKey === this.gridWorld.cellKey(record.q, record.r);
      if (!isActive && !refreshAmbient) {
        continue;
      }
      if (record.kind === "charged") {
        this.animateCharged(record.model, visual.progress, visual.phase === "depleted", isActive, chargedPulse);
      } else {
        this.animateCursed(record.model, visual.progress, isActive, cursedPulse);
      }
    }

    this.syncActiveParticles(activeKind, activeKey, snapshot.cell);
  }

  getDiagnostics() {
    return {
      total: this.records.length,
      visible: this.records.filter((record) => record.model.group.visible).length,
      activeParticleSystems: this.activeParticles ? 1 : 0,
      activeParticleCount: this.activeParticles?.count ?? 0,
      activeParticleKind: this.activeParticleKind,
      ambientUpdatesPerSecond: 1 / AMBIENT_UPDATE_SECONDS,
    };
  }

  private animateCharged(model: GroundGlyphModel, progress: number, depleted: boolean, active: boolean, pulse: number) {
    const reserveStrength = 1 - progress * 0.48;
    model.rune.rotation.y = this.elapsed * (active ? 1.15 : depleted ? 0 : 0.06);
    model.ring.rotation.y = -this.elapsed * (active ? 0.82 : depleted ? 0 : 0.04);
    model.group.scale.setScalar(active ? pulse : depleted ? 0.86 : 0.92);
    setLineOpacity(model.rune, depleted ? 0.08 : reserveStrength * (active ? 0.98 : 0.34));
    setLineOpacity(model.ring, depleted ? 0.035 : reserveStrength * (active ? 0.64 : 0.1));
  }

  private animateCursed(model: GroundGlyphModel, progress: number, active: boolean, pulse: number) {
    const strength = 1 - progress * 0.58;
    model.rune.rotation.y = -this.elapsed * (active ? 0.72 : 0.05);
    model.ring.rotation.y = this.elapsed * (active ? 0.5 : 0.035);
    model.rune.scale.setScalar(Math.max(0.48, 1 - progress * 0.45));
    model.group.scale.setScalar(active ? pulse : 0.92);
    setLineOpacity(model.rune, strength * (active ? 0.98 : 0.34));
    setLineOpacity(model.ring, strength * (active ? 0.66 : 0.12));
  }

  private syncActiveParticles(kind: "charged" | "cursed" | null, key: string, cell: { q: number; r: number }) {
    if (!kind) {
      this.removeActiveParticles();
      return;
    }

    if (!this.activeParticles || this.activeParticleKey !== key || this.activeParticleKind !== kind) {
      this.removeActiveParticles();
      this.activeParticles = createGroundActivityParticles(ACTIVE_PARTICLE_COUNT);
      this.activeParticleKey = key;
      this.activeParticleKind = kind;
      const world = this.gridWorld.cellToWorld(cell.q, cell.r);
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
    particles.points.material.size = (kind === "charged" ? 0.28 : 0.31) + Math.sin(this.elapsed * 5) * 0.035;
    particles.points.geometry.attributes.position.needsUpdate = true;
  }

  private removeActiveParticles() {
    if (this.activeParticles) {
      disposeObject3D(this.activeParticles.points);
      this.activeParticles.points.removeFromParent();
    }
    this.activeParticles = null;
    this.activeParticleKey = "";
    this.activeParticleKind = null;
  }
}
