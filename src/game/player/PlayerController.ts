import * as THREE from "three";
import { PLAYER_COLLISION_RADIUS, WORLD_HALF } from "../../config";
import { clamp, distance2D } from "../../lib/math";
import type { GameMaterials } from "../../render/materials";
import type { GameEffects } from "../../render/GameEffects";
import { createCrosshair, createRing } from "../../render/primitives";
import { createPlayerModel } from "../../render/meshes";
import type { CollisionSystem } from "../collision/CollisionSystem";
import type { GridWorld } from "../../world/GridWorld";

export class PlayerController {
  readonly model: ReturnType<typeof createPlayerModel>;
  readonly object: THREE.Group;
  readonly moveMarker = new THREE.Group();
  readonly moveTarget = new THREE.Vector3(0, 0, 0);

  private path: THREE.Vector3[] = [];
  private lastRequestedCellKey = "";
  private lastRequestedBlocked = false;

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly effects: GameEffects,
    private readonly materials: GameMaterials,
  ) {
    this.model = createPlayerModel(this.materials.player);
    this.object = this.model.group;
    this.object.position.set(0, 0, 0);
    this.moveTarget.copy(this.object.position);

    this.moveMarker.add(createRing(1.15, 0x8bdfff, 0.55));
    this.moveMarker.add(createCrosshair(1.9, 0x8bdfff, 0.65));
    this.moveMarker.position.set(0, 0.08, 0);
  }

  update(dt: number, shouldFollowPointer: boolean, pointerWorld: THREE.Vector3) {
    if (shouldFollowPointer) {
      this.setMoveTarget(pointerWorld.x, pointerWorld.z, false);
    }

    const waypoint = this.currentWaypoint();
    if (!waypoint) {
      this.model.aura.rotation.z += dt * 1.6;
      return;
    }

    const offset = new THREE.Vector3(waypoint.x - this.object.position.x, 0, waypoint.z - this.object.position.z);
    const distance = offset.length();
    if (distance < 0.18) {
      this.path.shift();
      this.model.aura.rotation.z += dt * 1.6;
      return;
    }

    const step = Math.min(distance, 18 * dt);
    offset.normalize();
    const nextPosition = this.collision.moveWithCollision(
      this.object.position,
      new THREE.Vector3(offset.x * step, 0, offset.z * step),
      PLAYER_COLLISION_RADIUS,
    );
    const actualX = nextPosition.x - this.object.position.x;
    const actualZ = nextPosition.z - this.object.position.z;

    if (distance2D(this.object.position.x, this.object.position.z, nextPosition.x, nextPosition.z) < 0.001) {
      this.path = [];
      this.model.aura.rotation.z += dt * 1.6;
      return;
    }

    this.object.position.x = nextPosition.x;
    this.object.position.z = nextPosition.z;
    this.object.rotation.y = Math.atan2(actualX, actualZ);
    this.moveMarker.position.set(this.moveTarget.x, 0.08, this.moveTarget.z);

    if (this.path[0] && distance2D(this.object.position.x, this.object.position.z, this.path[0].x, this.path[0].z) < 0.24) {
      this.path.shift();
    }

    this.model.aura.rotation.z += dt * 1.6;
  }

  setMoveTarget(x: number, z: number, force = true) {
    const requestedTarget = new THREE.Vector3(clamp(x, -WORLD_HALF + 2, WORLD_HALF - 2), 0, clamp(z, -WORLD_HALF + 2, WORLD_HALF - 2));
    const requestedCell = this.gridWorld.worldToCell(requestedTarget.x, requestedTarget.z);
    const requestedCellKey = `${requestedCell.x},${requestedCell.z}`;

    if (!force && requestedCellKey === this.lastRequestedCellKey && this.path.length > 0) {
      return;
    }

    const resolved = this.collision.resolvePathToTarget(this.object.position, requestedTarget, PLAYER_COLLISION_RADIUS);
    this.lastRequestedCellKey = requestedCellKey;
    this.lastRequestedBlocked = this.gridWorld.isBlockedWorld(requestedTarget.x, requestedTarget.z);

    if (!resolved) {
      this.path = [];
      this.effects.createShockwave(requestedTarget, 0x879190, 2.4);
      return;
    }

    this.path = resolved.waypoints;
    this.moveTarget.copy(resolved.destination);
    this.moveMarker.position.set(resolved.destination.x, 0.08, resolved.destination.z);
  }

  flash(color: THREE.ColorRepresentation, shouldReset = () => true) {
    this.materials.player.color.set(color);
    window.setTimeout(() => {
      if (shouldReset()) {
        this.materials.player.color.set(0xdfe8ee);
      }
    }, 95);
  }

  setDefeated() {
    this.materials.player.color.set(0x59676a);
    this.materials.player.emissive.set(0x1b2020);
  }

  reset() {
    this.object.position.set(0, 0, 0);
    this.moveTarget.set(0, 0, 0);
    this.moveMarker.position.set(0, 0.08, 0);
    this.path = [];
    this.lastRequestedCellKey = "";
    this.lastRequestedBlocked = false;
    this.materials.player.color.set(0xdfe8ee);
    this.materials.player.emissive.set(0x21526b);
  }

  getNavigationDiagnostics() {
    return {
      moveTarget: this.moveTarget.toArray(),
      pathLength: this.path.length,
      requestedBlocked: this.lastRequestedBlocked,
    };
  }

  private currentWaypoint() {
    while (this.path[0] && distance2D(this.object.position.x, this.object.position.z, this.path[0].x, this.path[0].z) < 0.18) {
      this.path.shift();
    }

    return this.path[0] ?? null;
  }
}
