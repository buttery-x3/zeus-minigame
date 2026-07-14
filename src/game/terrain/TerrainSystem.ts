import * as THREE from "three";
import { VISIBILITY_LIGHT_EPSILON } from "../../config";
import { disposeObject3D } from "../../render/dispose";
import type { GameMaterials } from "../../render/materials";
import { SpecialGroundEffects } from "../../render/SpecialGroundEffects";
import type { GridWorld } from "../../world/GridWorld";
import type { TerrainCell, TerrainSurface } from "../../types";
import type { VisibilitySystem } from "../visibility/VisibilitySystem";
import type { GroundEffectSnapshot, GroundEffectSystem } from "./GroundEffectSystem";

type BlockerRecord = {
  q: number;
  r: number;
  mesh: THREE.Mesh;
};

const NORMAL_RENDER_RADIUS = 18;
const DEBUG_RENDER_RADIUS = 56;

export class TerrainSystem {
  private terrainWindowKey = "";
  private readonly blockers: BlockerRecord[] = [];
  private readonly specialEffects: SpecialGroundEffects;
  private visibilityVersion = -1;
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
  ) {
    this.specialEffects = new SpecialGroundEffects(gridWorld, terrainGroup);
  }

  update(
    dt: number,
    playerPosition: THREE.Vector3,
    playerGround: GroundEffectSnapshot,
    visibility: VisibilitySystem,
    revealAll = false,
  ) {
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
    this.specialEffects.update(dt, playerGround);
  }

  getDiagnostics() {
    return {
      blockers: { ...this.blockerVisibility },
      specialGround: this.specialEffects.getDiagnostics(),
    };
  }

  private rebuild(center: { q: number; r: number }, radius: number, useGeneratedOnly: boolean, key: string) {
    this.terrainWindowKey = key;
    this.visibilityVersion = -1;
    this.blockers.length = 0;
    this.specialEffects.resetForRebuild();
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

      this.specialEffects.addCell(cell, world, visual);

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

    this.specialEffects.applyVisibility(visibility, revealAll);
  }
}

function createHexCylinderGeometry(radius: number, height: number) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 6, 1, false);
  //geometry.rotateY(Math.PI / 6); //this was an unnecessary rotation, causes error triangles
  return geometry;
}
