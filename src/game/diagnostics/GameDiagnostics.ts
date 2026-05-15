import * as THREE from "three";
import { PLAYER_COLLISION_RADIUS, VISIBILITY_LIGHT_EPSILON } from "../../config";
import type { GameRuntimeState } from "../../types";
import type { GridWorld } from "../../world/GridWorld";
import type { CollisionSystem } from "../collision/CollisionSystem";
import type { Profiler } from "../perf/Profiler";
import type { PlayerController } from "../player/PlayerController";
import type { GameScene } from "../scene/GameScene";
import type { VisibilitySystem } from "../visibility/VisibilitySystem";

export class GameDiagnostics {
  constructor(
    private readonly scene: GameScene,
    private readonly gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly player: PlayerController,
    private readonly visibility: VisibilitySystem,
    private readonly profiler: Profiler,
  ) {}

  get(state: GameRuntimeState) {
    const cameraForward = new THREE.Vector3();
    this.scene.camera.getWorldDirection(cameraForward);
    const visibilityDiagnostics = this.visibility.getDiagnostics();

    return {
      camera: {
        position: this.scene.camera.position.toArray(),
        quaternion: this.scene.camera.quaternion.toArray(),
        forward: cameraForward.toArray(),
      },
      lighting: this.scene.getLightingDiagnostics(),
      player: {
        position: this.player.object.position.toArray(),
        rotationY: this.player.object.rotation.y,
        navigation: {
          ...this.player.getNavigationDiagnostics(),
          destinationBlocked: !this.collision.canOccupy(this.player.moveTarget.x, this.player.moveTarget.z, PLAYER_COLLISION_RADIUS),
          occupiesBlocked: !this.collision.canOccupy(
            this.player.object.position.x,
            this.player.object.position.z,
            PLAYER_COLLISION_RADIUS,
          ),
        },
      },
      nearestBlockedCell: this.findNearestBlockedCell(this.player.object.position, 18),
      visibility: visibilityDiagnostics,
      visibilitySamples: {
        shadowedCell: visibilityDiagnostics.shadowSample
          ? this.visibilitySampleToScreen(visibilityDiagnostics.shadowSample.shadow)
          : null,
        visibleMoveCell: this.findNearestVisibilityCell(
          this.player.object.position,
          12,
          (x, z) => this.isDirectVisibleMoveCell(x, z),
          5,
        ),
        visibleEastCell: this.findDirectionalVisibilityCell(this.player.object.position, 1, 0),
        visibleWestCell: this.findDirectionalVisibilityCell(this.player.object.position, -1, 0),
        nearestUndiscoveredCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (x, z) => !this.visibility.isDiscoveredCell(x, z),
        ),
        farUndiscoveredCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (x, z) => !this.visibility.isDiscoveredCell(x, z),
          this.visibility.outerRadiusCells + 2,
        ),
        nearestDiscoveredHiddenCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (x, z) => this.visibility.isDiscoveredCell(x, z) && !this.visibility.isVisibleCell(x, z),
        ),
        blockedMemoryCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (x, z) =>
            this.visibility.isDiscoveredCell(x, z) &&
            !this.visibility.isVisibleCell(x, z) &&
            this.visibility.getLightReachCell(x, z) > VISIBILITY_LIGHT_EPSILON,
        ),
        discoveredUnlitCell: this.findNearestVisibilityCell(
          this.player.object.position,
          36,
          (x, z) => this.visibility.isDiscoveredCell(x, z) && this.visibility.getLightReachCell(x, z) <= VISIBILITY_LIGHT_EPSILON,
        ),
      },
      paused: state.paused,
      profiler: this.profiler.snapshot(),
    };
  }

  private projectGroundToScreen(x: number, z: number) {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    const projected = new THREE.Vector3(x, 0, z).project(this.scene.camera);

    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
      visible: projected.z >= -1 && projected.z <= 1 && projected.x >= -1 && projected.x <= 1 && projected.y >= -1 && projected.y <= 1,
    };
  }

  private findNearestBlockedCell(position: THREE.Vector3, maxRadius: number) {
    const center = this.gridWorld.worldToCell(position.x, position.z);

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      for (let z = center.z - radius; z <= center.z + radius; z += 1) {
        for (let x = center.x - radius; x <= center.x + radius; x += 1) {
          if (x !== center.x - radius && x !== center.x + radius && z !== center.z - radius && z !== center.z + radius) {
            continue;
          }
          if (x < 0 || z < 0 || x >= this.gridWorld.worldCells || z >= this.gridWorld.worldCells) {
            continue;
          }
          if (!this.gridWorld.getCell(x, z).blocked || !this.visibility.isVisibleCell(x, z)) {
            continue;
          }

          const world = this.gridWorld.cellToWorld(x, z);
          const screen = this.projectGroundToScreen(world.x, world.z);
          if (!screen.visible) {
            continue;
          }

          return {
            cell: { x, z },
            world: [world.x, 0, world.z],
            screen,
            visibility: this.visibility.getCell(x, z),
          };
        }
      }
    }

    return null;
  }

  private findDirectionalVisibilityCell(position: THREE.Vector3, dirX: number, dirZ: number) {
    const center = this.gridWorld.worldToCell(position.x, position.z);

    for (let radius = 8; radius >= 5; radius -= 1) {
      for (let lateral = 0; lateral <= 2; lateral += 1) {
        for (const side of lateral === 0 ? [0] : [-lateral, lateral]) {
          const x = center.x + dirX * radius + (dirZ === 0 ? 0 : side);
          const z = center.z + dirZ * radius + (dirX === 0 ? 0 : side);
          if (x < 0 || z < 0 || x >= this.gridWorld.worldCells || z >= this.gridWorld.worldCells) {
            continue;
          }
          if (!this.isDirectVisibleMoveCell(x, z)) {
            continue;
          }

          const world = this.gridWorld.cellToWorld(x, z);
          const screen = this.projectGroundToScreen(world.x, world.z);
          if (!screen.visible) {
            continue;
          }

          return {
            cell: { x, z },
            world: [world.x, 0, world.z],
            screen,
            visibility: this.visibility.getCell(x, z),
          };
        }
      }
    }

    return null;
  }

  private isDirectVisibleMoveCell(cellX: number, cellZ: number) {
    if (!this.visibility.isVisibleCell(cellX, cellZ) || this.gridWorld.getCell(cellX, cellZ).blocked) {
      return false;
    }

    const world = this.gridWorld.cellToWorld(cellX, cellZ);
    return (
      this.collision.canOccupy(world.x, world.z, PLAYER_COLLISION_RADIUS) &&
      this.collision.hasLineOfSight(this.player.object.position, new THREE.Vector3(world.x, 0, world.z), PLAYER_COLLISION_RADIUS)
    );
  }

  private visibilitySampleToScreen(cell: { x: number; z: number }) {
    const world = this.gridWorld.cellToWorld(cell.x, cell.z);
    const screen = this.projectGroundToScreen(world.x, world.z);
    return {
      cell,
      world: [world.x, 0, world.z],
      screen,
      visibility: this.visibility.getCell(cell.x, cell.z),
    };
  }

  private findNearestVisibilityCell(
    position: THREE.Vector3,
    maxRadius: number,
    predicate: (x: number, z: number) => boolean,
    minRadius = 1,
  ) {
    const center = this.gridWorld.worldToCell(position.x, position.z);

    for (let radius = minRadius; radius <= maxRadius; radius += 1) {
      for (let z = center.z - radius; z <= center.z + radius; z += 1) {
        for (let x = center.x - radius; x <= center.x + radius; x += 1) {
          if (x !== center.x - radius && x !== center.x + radius && z !== center.z - radius && z !== center.z + radius) {
            continue;
          }
          if (x < 0 || z < 0 || x >= this.gridWorld.worldCells || z >= this.gridWorld.worldCells || !predicate(x, z)) {
            continue;
          }

          const world = this.gridWorld.cellToWorld(x, z);
          const screen = this.projectGroundToScreen(world.x, world.z);
          if (!screen.visible) {
            continue;
          }

          return {
            cell: { x, z },
            world: [world.x, 0, world.z],
            screen,
            visibility: this.visibility.getCell(x, z),
          };
        }
      }
    }

    return null;
  }
}
