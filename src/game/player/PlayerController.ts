import * as THREE from "three";
import { WORLD_HALF } from "../../config";
import { clamp } from "../../lib/math";
import type { GameMaterials } from "../../render/materials";
import type { GameEffects } from "../../render/GameEffects";
import { createCrosshair, createRing } from "../../render/primitives";
import { createPlayerModel } from "../../render/meshes";
import type { GridWorld } from "../../world/GridWorld";

export class PlayerController {
  readonly model: ReturnType<typeof createPlayerModel>;
  readonly object: THREE.Group;
  readonly moveMarker = new THREE.Group();
  readonly moveTarget = new THREE.Vector3(0, 0, 0);

  constructor(
    private readonly gridWorld: GridWorld,
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
      this.setMoveTarget(pointerWorld.x, pointerWorld.z);
    }

    const offset = new THREE.Vector3(this.moveTarget.x - this.object.position.x, 0, this.moveTarget.z - this.object.position.z);
    const distance = offset.length();
    if (distance < 0.18) {
      return;
    }

    const step = Math.min(distance, 18 * dt);
    offset.normalize();
    this.object.position.x += offset.x * step;
    this.object.position.z += offset.z * step;
    this.object.rotation.y = Math.atan2(offset.x, offset.z);
    this.moveMarker.position.set(this.moveTarget.x, 0.08, this.moveTarget.z);
    this.model.aura.rotation.z += dt * 1.6;
  }

  setMoveTarget(x: number, z: number) {
    const target = new THREE.Vector3(clamp(x, -WORLD_HALF + 2, WORLD_HALF - 2), 0, clamp(z, -WORLD_HALF + 2, WORLD_HALF - 2));

    if (this.gridWorld.isBlockedWorld(target.x, target.z)) {
      this.effects.createShockwave(target, 0x879190, 2.4);
      return;
    }

    this.moveTarget.copy(target);
    this.moveMarker.position.set(target.x, 0.08, target.z);
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
    this.materials.player.color.set(0xdfe8ee);
    this.materials.player.emissive.set(0x21526b);
  }
}
