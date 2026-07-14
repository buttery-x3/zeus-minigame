import * as THREE from "three";
import { VISIBILITY_LIGHT_EPSILON } from "../../config";
import { disposeObject3D } from "../../render/dispose";
import type { GameMaterials } from "../../render/materials";
import { createChargedGlyph, createCursedGlyph, type GroundGlyphModel } from "../../render/meshes";
import { setLineOpacity } from "../../render/primitives";
import type { GridWorld } from "../../world/GridWorld";
import type { TerrainCell, TerrainSurface } from "../../types";
import type { VisibilitySystem } from "../visibility/VisibilitySystem";
import type { GroundEffectSystem } from "./GroundEffectSystem";

type BlockerRecord = {
  q: number;
  r: number;
  mesh: THREE.Mesh;
};

type SpecialGroundRecord = {
  q: number;
  r: number;
  kind: "charged" | "cursed";
  model: GroundGlyphModel;
};

const NORMAL_RENDER_RADIUS = 18;
const DEBUG_RENDER_RADIUS = 56;

export class TerrainSystem {
  private terrainWindowKey = "";
  private readonly blockers: BlockerRecord[] = [];
  private readonly specialGround: SpecialGroundRecord[] = [];
  private visibilityVersion = -1;
  private elapsed = 0;
  private blockerVisibility = {
    total: 0,
    visible: 0,
    hidden: 0,
  };

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly terrainGroup: THREE.Group,
    private readonly blockerGroup: THREE.Group,
    private readonly materials: GameMaterials,
    private readonly groundEffects: GroundEffectSystem,
  ) {}

  update(dt: number, playerPosition: THREE.Vector3, visibility: VisibilitySystem, revealAll = false) {
    this.elapsed += dt;
    const center = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const radius = revealAll ? DEBUG_RENDER_RADIUS : NORMAL_RENDER_RADIUS;
    const generationVersion = this.gridWorld.getTerrainGenerationVersion();
    const stateVersion = this.groundEffects.getStateVersion();
    const key = `${Math.floor(center.q / 2)},${Math.floor(center.r / 2)},${radius},${revealAll},${generationVersion},${stateVersion}`;

    if (key !== this.terrainWindowKey) {
      this.rebuild(center, radius, revealAll, key);
    }

    if (visibility.getVersion() !== this.visibilityVersion) {
      this.applyVisibility(visibility, revealAll);
    }
    this.animateSpecialGround();
  }

  getDiagnostics() {
    return {
      blockers: { ...this.blockerVisibility },
      specialGround: {
        total: this.specialGround.length,
        visible: this.specialGround.filter((record) => record.model.group.visible).length,
      },
    };
  }

  private rebuild(center: { q: number; r: number }, radius: number, useGeneratedOnly: boolean, key: string) {
    this.terrainWindowKey = key;
    this.visibilityVersion = -1;
    this.blockers.length = 0;
    this.specialGround.length = 0;
    disposeObject3D(this.terrainGroup, { preserveMaterials: Object.values(this.materials) });
    disposeObject3D(this.blockerGroup, { preserveMaterials: Object.values(this.materials) });
    this.terrainGroup.clear();
    this.blockerGroup.clear();

    const tileGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.98, 0.09);
    const waterGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.94, 0.08);
    const wallGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.82, 2.65);
    const bankGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.96, 0.12);

    const renderCell = (cell: TerrainCell) => {
      const world = this.gridWorld.cellToWorld(cell.q, cell.r);
      const visual = this.groundEffects.getCellVisualState(cell);
      const isWater = cell.structure === "lake" || cell.structure === "river";
      const isBank = cell.structure === "bank";
      const tile = new THREE.Mesh(
        isWater ? waterGeometry : isBank ? bankGeometry : tileGeometry,
        this.materialForCell(cell, visual.displaySurface),
      );
      tile.position.set(world.x, isWater ? -0.06 : -0.04, world.z);
      tile.receiveShadow = true;
      this.terrainGroup.add(tile);

      if (visual.phase === "charged" || visual.phase === "depleted") {
        const model = createChargedGlyph(world.x, world.z);
        this.specialGround.push({ q: cell.q, r: cell.r, kind: "charged", model });
        this.terrainGroup.add(model.group);
      } else if (visual.phase === "cursed") {
        const model = createCursedGlyph(world.x, world.z);
        this.specialGround.push({ q: cell.q, r: cell.r, kind: "cursed", model });
        this.terrainGroup.add(model.group);
      }

      if (cell.structure === "wall") {
        const blocker = new THREE.Mesh(wallGeometry, this.materials.blocker);
        blocker.position.set(world.x, 1.26, world.z);
        blocker.castShadow = true;
        blocker.receiveShadow = true;
        this.blockers.push({ q: cell.q, r: cell.r, mesh: blocker });
        this.blockerGroup.add(blocker);
      }
    };

    if (useGeneratedOnly) {
      for (const cell of this.gridWorld.getGeneratedCellsInRange(center, radius)) {
        renderCell(cell);
      }
      return;
    }

    this.gridWorld.forEachCellInRange(center, radius, (q, r) => {
      renderCell(this.gridWorld.getCell(q, r));
    });
  }

  private materialForCell(cell: TerrainCell, surface: TerrainSurface): THREE.Material {
    if (cell.structure === "lake") {
      return this.materials.lake;
    }
    if (cell.structure === "river") {
      return this.materials.river;
    }

    return this.materialForSurface(surface);
  }

  private materialForSurface(surface: TerrainSurface): THREE.Material {
    switch (surface) {
      case "charged":
        return this.materials.charged;
      case "cursed":
        return this.materials.cursed;
      case "scarred":
        return this.materials.scarred;
      case "dirt":
        return this.materials.dirt;
      case "sand":
        return this.materials.sand;
      case "mud":
        return this.materials.mud;
      case "stone":
        return this.materials.stone;
      case "grass":
      default:
        return this.materials.grass;
    }
  }

  private applyVisibility(visibility: VisibilitySystem, revealAll: boolean) {
    let visible = 0;
    let hidden = 0;

    for (const blocker of this.blockers) {
      const shouldShow =
        revealAll ||
        (visibility.isDiscoveredCell(blocker.q, blocker.r) &&
          visibility.getLightReachCell(blocker.q, blocker.r) > VISIBILITY_LIGHT_EPSILON);
      blocker.mesh.visible = shouldShow;

      if (shouldShow) {
        visible += 1;
      } else {
        hidden += 1;
      }
    }

    this.visibilityVersion = visibility.getVersion();
    this.blockerVisibility = {
      total: this.blockers.length,
      visible,
      hidden,
    };

    for (const record of this.specialGround) {
      record.model.group.visible = revealAll || visibility.isVisibleCell(record.q, record.r);
    }
  }

  private animateSpecialGround() {
    const chargedPulse = 0.9 + Math.sin(this.elapsed * 3.6) * 0.1;
    const cursedPulse = 0.92 + Math.sin(this.elapsed * 2.4) * 0.08;
    this.materials.charged.emissiveIntensity = 0.42 + chargedPulse * 0.2;
    this.materials.cursed.emissiveIntensity = 0.46 + cursedPulse * 0.24;

    for (const record of this.specialGround) {
      const cell = this.gridWorld.getCell(record.q, record.r);
      const visual = this.groundEffects.getCellVisualState(cell);
      if (record.kind === "charged") {
        const depleted = visual.phase === "depleted";
        const strength = depleted ? 0.14 : 1 - visual.progress * 0.48;
        record.model.rune.rotation.y = this.elapsed * (depleted ? 0.08 : 0.55);
        record.model.ring.rotation.y = -this.elapsed * (depleted ? 0.05 : 0.38);
        record.model.group.scale.setScalar(depleted ? 0.88 : chargedPulse);
        setLineOpacity(record.model.rune, 0.72 * strength);
        setLineOpacity(record.model.ring, 0.34 * strength);
        this.animateMotes(record.model.motes, strength, depleted ? 0 : 1.25);
      } else {
        const strength = 1 - visual.progress * 0.58;
        record.model.rune.rotation.y = -this.elapsed * 0.34;
        record.model.ring.rotation.y = this.elapsed * 0.22;
        record.model.rune.scale.setScalar(Math.max(0.48, 1 - visual.progress * 0.45));
        record.model.group.scale.setScalar(cursedPulse);
        setLineOpacity(record.model.rune, 0.8 * strength);
        setLineOpacity(record.model.ring, 0.42 * strength);
        this.animateMotes(record.model.motes, strength, 0.76);
      }
    }
  }

  private animateMotes(motes: THREE.Mesh[], strength: number, speed: number) {
    motes.forEach((mote, index) => {
      mote.visible = strength > 0.2 && speed > 0;
      mote.position.y = 0.18 + ((this.elapsed * speed + index * 0.31) % 0.92);
      const material = mote.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = strength * (0.34 + Math.sin(this.elapsed * 4 + index) * 0.14);
      }
    });
  }
}

function createHexCylinderGeometry(radius: number, height: number) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 6, 1, false);
  //geometry.rotateY(Math.PI / 6); //this was an unnecessary rotation, causes error triangles
  return geometry;
}
