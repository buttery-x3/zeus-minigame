import * as THREE from "three";
import { TILE_SIZE, WORLD_CELLS } from "../../config";
import { disposeObject3D } from "../../render/dispose";
import type { GameMaterials } from "../../render/materials";
import { createChargedGlyph } from "../../render/meshes";
import type { GridWorld } from "../../world/GridWorld";
import type { VisibilitySystem } from "../visibility/VisibilitySystem";

type TerrainVisualRecord = {
  cellX: number;
  cellZ: number;
  tile: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  tileColor: THREE.Color;
  tileEmissive: THREE.Color;
  glyph: THREE.Object3D | null;
  blocker: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | null;
  blockerColor: THREE.Color | null;
};

export class TerrainSystem {
  private terrainWindowKey = "";
  private visibilityVersion = -1;
  private readonly records: TerrainVisualRecord[] = [];

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly terrainGroup: THREE.Group,
    private readonly blockerGroup: THREE.Group,
    private readonly materials: GameMaterials,
  ) {}

  update(playerPosition: THREE.Vector3, visibility: VisibilitySystem) {
    const center = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const radius = 16;
    const key = `${Math.floor(center.x / 2)},${Math.floor(center.z / 2)}`;

    if (key === this.terrainWindowKey && visibility.getVersion() === this.visibilityVersion) {
      return;
    }

    if (key !== this.terrainWindowKey) {
      this.rebuild(center, radius, key);
    }

    this.applyVisibility(visibility);
  }

  private rebuild(center: { x: number; z: number }, radius: number, key: string) {
    this.terrainWindowKey = key;
    this.visibilityVersion = -1;
    this.records.length = 0;
    disposeObject3D(this.terrainGroup, { preserveMaterials: Object.values(this.materials) });
    disposeObject3D(this.blockerGroup, { preserveMaterials: Object.values(this.materials) });
    this.terrainGroup.clear();
    this.blockerGroup.clear();

    const tileGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.98, 0.1, TILE_SIZE * 0.98);
    const blockerGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.88, 2.6, TILE_SIZE * 0.88);

    for (let z = center.z - radius; z <= center.z + radius; z += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        if (x < 0 || z < 0 || x >= WORLD_CELLS || z >= WORLD_CELLS) {
          continue;
        }

        const cell = this.gridWorld.getCell(x, z);
        const world = this.gridWorld.cellToWorld(x, z);
        const sourceMaterial =
          cell.kind === "charged"
            ? this.materials.charged
            : cell.kind === "scarred"
              ? this.materials.scarred
              : this.materials.floor;
        const tileMaterial = sourceMaterial.clone();

        const tile = new THREE.Mesh(tileGeometry, tileMaterial);
        tile.position.set(world.x, -0.04, world.z);
        tile.receiveShadow = true;
        this.terrainGroup.add(tile);

        const glyph = cell.kind === "charged" ? createChargedGlyph(world.x, world.z) : null;
        if (glyph) {
          this.terrainGroup.add(glyph);
        }

        const blockerMaterial = cell.blocked ? this.materials.blocker.clone() : null;
        const blocker = blockerMaterial ? new THREE.Mesh(blockerGeometry, blockerMaterial) : null;
        if (blocker) {
          blocker.position.set(world.x, 1.25, world.z);
          blocker.castShadow = true;
          blocker.receiveShadow = true;
          this.blockerGroup.add(blocker);
        }

        this.records.push({
          cellX: x,
          cellZ: z,
          tile,
          tileColor: tileMaterial.color.clone(),
          tileEmissive: tileMaterial.emissive.clone(),
          glyph,
          blocker,
          blockerColor: blockerMaterial?.color.clone() ?? null,
        });
      }
    }
  }

  private applyVisibility(visibility: VisibilitySystem) {
    for (const record of this.records) {
      const cellVisibility = visibility.getCell(record.cellX, record.cellZ);
      const shouldShowTile = cellVisibility.discovered && (cellVisibility.visible || cellVisibility.memoryLight > 0);
      record.tile.visible = shouldShowTile;

      if (!shouldShowTile) {
        if (record.glyph) {
          record.glyph.visible = false;
        }
        if (record.blocker) {
          record.blocker.visible = false;
        }
        continue;
      }

      const tileLight = cellVisibility.visible ? 0.18 + cellVisibility.light * 0.82 : cellVisibility.memoryLight;
      record.tile.material.color.copy(record.tileColor).multiplyScalar(tileLight);
      record.tile.material.emissive.copy(record.tileEmissive).multiplyScalar(cellVisibility.visible ? cellVisibility.light : 0);

      if (record.glyph) {
        record.glyph.visible = cellVisibility.visible && cellVisibility.light > 0.12;
        setGlyphOpacity(record.glyph, Math.min(0.76, 0.16 + cellVisibility.light * 0.62));
      }

      if (record.blocker && record.blockerColor) {
        record.blocker.visible = shouldShowTile;
        const blockerLight = cellVisibility.visible ? 0.2 + cellVisibility.light * 0.8 : cellVisibility.memoryLight * 0.9;
        record.blocker.material.color.copy(record.blockerColor).multiplyScalar(blockerLight);
      }
    }

    this.visibilityVersion = visibility.getVersion();
  }
}

function setGlyphOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse((child) => {
    const material = (child as THREE.Line).material;
    if (material instanceof THREE.LineBasicMaterial) {
      material.opacity = opacity;
    }
  });
}
