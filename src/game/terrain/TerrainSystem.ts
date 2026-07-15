import * as THREE from "three";
import { VISIBILITY_LIGHT_EPSILON } from "../../config";
import { disposeObject3D } from "../../render/dispose";
import type { GameMaterialPalettes, GameMaterials } from "../../render/materials";
import { SpecialGroundEffects } from "../../render/SpecialGroundEffects";
import type { GridWorld } from "../../world/GridWorld";
import type { TerrainCell, TerrainSurface } from "../../types";
import type { RenderMode } from "../preferences/GamePreferences";
import type { VisibilitySystem } from "../visibility/VisibilitySystem";
import type { GroundEffectSnapshot, GroundEffectSystem } from "./GroundEffectSystem";

type BlockerRecord = {
  q: number;
  r: number;
  index: number;
  matrix: THREE.Matrix4;
};

type InstanceBatch = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
};

const NORMAL_RENDER_RADIUS = 18;
const DEBUG_RENDER_RADIUS = 56;

export class TerrainSystem {
  private terrainWindowKey = "";
  private preparedTerrainWindowKey = "";
  private readonly blockers: BlockerRecord[] = [];
  private readonly specialEffects: SpecialGroundEffects;
  private blockerMesh: THREE.InstancedMesh | null = null;
  private renderMode: RenderMode;
  private instanceBatchCount = 0;
  private terrainInstanceCount = 0;
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
    private readonly materialPalettes: GameMaterialPalettes,
    private readonly groundEffects: GroundEffectSystem,
    renderMode: RenderMode,
  ) {
    this.renderMode = renderMode;
    this.specialEffects = new SpecialGroundEffects(gridWorld, terrainGroup);
  }

  setRenderMode(renderMode: RenderMode) {
    if (this.renderMode === renderMode) {
      return;
    }
    this.renderMode = renderMode;
    this.terrainWindowKey = "";
  }

  prepare(playerPosition: THREE.Vector3, revealAll = false) {
    const center = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const radius = revealAll ? DEBUG_RENDER_RADIUS : NORMAL_RENDER_RADIUS;
    const key = `${Math.floor(center.q / 2)},${Math.floor(center.r / 2)},${radius},${revealAll}`;
    if (key === this.preparedTerrainWindowKey) {
      return;
    }

    this.preparedTerrainWindowKey = key;
    if (revealAll) {
      return;
    }

    this.gridWorld.forEachCellInRange(center, radius, (q, r) => {
      this.gridWorld.getCell(q, r);
    });
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
      instancing: {
        materialMode: this.renderMode,
        batches: this.instanceBatchCount,
        terrainInstances: this.terrainInstanceCount,
        blockerInstances: this.blockers.length,
      },
      specialGround: this.specialEffects.getDiagnostics(),
    };
  }

  private rebuild(center: { q: number; r: number }, radius: number, useGeneratedOnly: boolean, key: string) {
    this.terrainWindowKey = key;
    this.visibilityVersion = -1;
    this.blockers.length = 0;
    this.blockerMesh = null;
    this.instanceBatchCount = 0;
    this.terrainInstanceCount = 0;
    this.specialEffects.resetForRebuild();
    const preservedMaterials = [
      ...Object.values(this.materialPalettes.normal),
      ...Object.values(this.materialPalettes.potato),
    ];
    disposeObject3D(this.terrainGroup, { preserveMaterials: preservedMaterials });
    disposeObject3D(this.blockerGroup, { preserveMaterials: preservedMaterials });
    this.terrainGroup.clear();
    this.blockerGroup.clear();

    const tileGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.98, 0.09);
    const waterGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.94, 0.08);
    const wallGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.82, 2.65);
    const bankGeometry = createHexCylinderGeometry(this.gridWorld.hexSize * 0.96, 0.12);
    const batches = new Map<string, InstanceBatch>();
    const blockerRecords: Array<Omit<BlockerRecord, "index">> = [];

    const addInstance = (key: string, geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4) => {
      let batch = batches.get(key);
      if (!batch) {
        batch = { geometry, material, matrices: [] };
        batches.set(key, batch);
      }
      batch.matrices.push(matrix);
    };

    const renderCell = (cell: TerrainCell) => {
      const world = this.gridWorld.cellToWorld(cell.q, cell.r);
      const visual = this.groundEffects.getCellVisualState(cell);
      const isWater = cell.structure === "lake" || cell.structure === "river";
      const isBank = cell.structure === "bank";
      const geometry = isWater ? waterGeometry : isBank ? bankGeometry : tileGeometry;
      const material = this.materialForCell(cell, visual.displaySurface);
      const batchKey = `${isWater ? "water" : isBank ? "bank" : "tile"}:${isWater ? cell.structure : visual.displaySurface}`;
      addInstance(
        batchKey,
        geometry,
        material,
        new THREE.Matrix4().makeTranslation(world.x, isWater ? -0.06 : -0.04, world.z),
      );

      this.specialEffects.addCell(cell, world, visual);

      if (cell.structure === "wall") {
        blockerRecords.push({
          q: cell.q,
          r: cell.r,
          matrix: new THREE.Matrix4().makeTranslation(world.x, 1.26, world.z),
        });
      }
    };

    if (useGeneratedOnly) {
      for (const cell of this.gridWorld.getGeneratedCellsInRange(center, radius)) {
        renderCell(cell);
      }
    } else {
      this.gridWorld.forEachCellInRange(center, radius, (q, r) => {
        renderCell(this.gridWorld.getCell(q, r));
      });
    }

    const useShadows = this.renderMode === "normal";
    for (const batch of batches.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.receiveShadow = useShadows;
      mesh.computeBoundingSphere();
      this.terrainGroup.add(mesh);
      this.terrainInstanceCount += batch.matrices.length;
    }
    this.instanceBatchCount = batches.size;

    if (blockerRecords.length > 0) {
      this.blockerMesh = new THREE.InstancedMesh(wallGeometry, this.materials.blocker, blockerRecords.length);
      this.blockerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.blockerMesh.castShadow = useShadows;
      this.blockerMesh.receiveShadow = useShadows;
      blockerRecords.forEach((record, index) => {
        this.blockerMesh?.setMatrixAt(index, record.matrix);
        this.blockers.push({ ...record, index });
      });
      this.blockerMesh.computeBoundingSphere();
      this.blockerGroup.add(this.blockerMesh);
    }
  }

  private get materials(): GameMaterials {
    return this.materialPalettes[this.renderMode];
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
      this.blockerMesh?.setMatrixAt(blocker.index, shouldShow ? blocker.matrix : HIDDEN_INSTANCE_MATRIX);

      if (shouldShow) {
        visible += 1;
      } else {
        hidden += 1;
      }
    }
    if (this.blockerMesh) {
      this.blockerMesh.instanceMatrix.needsUpdate = true;
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

const HIDDEN_INSTANCE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

function createHexCylinderGeometry(radius: number, height: number) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 6, 1, false);
  //geometry.rotateY(Math.PI / 6); //this was an unnecessary rotation, causes error triangles
  return geometry;
}
