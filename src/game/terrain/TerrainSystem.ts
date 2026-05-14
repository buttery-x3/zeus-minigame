import * as THREE from "three";
import { TILE_SIZE, WORLD_CELLS, WORLD_HALF } from "../../config";
import { disposeObject3D } from "../../render/dispose";
import type { GameMaterials } from "../../render/materials";
import { createChargedGlyph } from "../../render/meshes";
import type { GridWorld } from "../../world/GridWorld";

export class TerrainSystem {
  private terrainWindowKey = "";

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly terrainGroup: THREE.Group,
    private readonly blockerGroup: THREE.Group,
    private readonly materials: GameMaterials,
  ) {}

  update(playerPosition: THREE.Vector3) {
    const center = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const radius = 16;
    const key = `${Math.floor(center.x / 2)},${Math.floor(center.z / 2)}`;

    if (key === this.terrainWindowKey) {
      return;
    }

    this.terrainWindowKey = key;
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
        const material =
          cell.kind === "charged"
            ? this.materials.charged
            : cell.kind === "scarred"
              ? this.materials.scarred
              : this.materials.floor;

        const tile = new THREE.Mesh(tileGeometry, material);
        tile.position.set(world.x, -0.04, world.z);
        tile.receiveShadow = true;
        this.terrainGroup.add(tile);

        if (cell.kind === "charged") {
          this.terrainGroup.add(createChargedGlyph(world.x, world.z));
        }

        if (cell.blocked) {
          const blocker = new THREE.Mesh(blockerGeometry, this.materials.blocker);
          blocker.position.set(world.x, 1.25, world.z);
          blocker.castShadow = true;
          blocker.receiveShadow = true;
          this.blockerGroup.add(blocker);
        }
      }
    }

    const grid = new THREE.GridHelper((radius * 2 + 1) * TILE_SIZE, radius * 2 + 1, 0x263238, 0x263238);
    grid.position.set(
      center.x * TILE_SIZE - WORLD_HALF + TILE_SIZE / 2,
      0.025,
      center.z * TILE_SIZE - WORLD_HALF + TILE_SIZE / 2,
    );
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.62;
    }
    this.terrainGroup.add(grid);
  }
}
