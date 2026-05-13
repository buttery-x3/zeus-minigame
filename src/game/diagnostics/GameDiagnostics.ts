import * as THREE from "three";
import { PLAYER_COLLISION_RADIUS } from "../../config";
import type { GameRuntimeState } from "../../types";
import type { GridWorld } from "../../world/GridWorld";
import type { CollisionSystem } from "../collision/CollisionSystem";
import type { Profiler } from "../perf/Profiler";
import type { PlayerController } from "../player/PlayerController";
import type { GameScene } from "../scene/GameScene";

export class GameDiagnostics {
  constructor(
    private readonly scene: GameScene,
    private readonly gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly player: PlayerController,
    private readonly profiler: Profiler,
  ) {}

  get(state: GameRuntimeState) {
    const cameraForward = new THREE.Vector3();
    this.scene.camera.getWorldDirection(cameraForward);

    return {
      camera: {
        position: this.scene.camera.position.toArray(),
        quaternion: this.scene.camera.quaternion.toArray(),
        forward: cameraForward.toArray(),
      },
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
          if (!this.gridWorld.getCell(x, z).blocked) {
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
          };
        }
      }
    }

    return null;
  }
}
