import * as THREE from "three";
import { distance2D } from "../../lib/math";
import { disposeObject3D } from "../../render/dispose";
import { createCrosshair, createRing } from "../../render/primitives";
import type { SpellConfig, SpellId } from "../../types";
import { clampToSpellRange } from "./SpellSystem";

export class TargetingRenderer {
  constructor(private readonly group: THREE.Group) {
    this.group.visible = false;
  }

  update(params: {
    castMode: SpellId | null;
    spells: Record<SpellId, SpellConfig>;
    pointerWorld: THREE.Vector3;
    playerPosition: THREE.Vector3;
    canCastAt: (target: THREE.Vector3) => boolean;
  }) {
    disposeObject3D(this.group);
    this.group.clear();

    if (!params.castMode) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    const spell = params.spells[params.castMode];
    const target = clampToSpellRange(params.pointerWorld, params.playerPosition, spell.range);
    const inRange = distance2D(params.playerPosition.x, params.playerPosition.z, params.pointerWorld.x, params.pointerWorld.z) <= spell.range;
    const color = inRange && params.canCastAt(target) ? spell.color : 0xff5465;

    const spellRadius = params.castMode === "chain" ? 4.4 : 3.3;
    const rangeRing = createRing(spell.range, color, 0.18);
    rangeRing.position.set(params.playerPosition.x, 0.13, params.playerPosition.z);
    this.group.add(rangeRing);

    const reticle = createRing(spellRadius, color, 0.86);
    reticle.position.set(target.x, 0.16, target.z);
    this.group.add(reticle);

    const crosshair = createCrosshair(spellRadius + 1, color, 0.84);
    crosshair.position.copy(reticle.position);
    this.group.add(crosshair);
  }
}
