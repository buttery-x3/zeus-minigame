import * as THREE from "three";
import { disposeObject3D } from "../../render/dispose";
import { loadPlayerCharacter } from "../../render/loadPlayerCharacter";
import type { PlayerModel } from "../../render/meshes";
import type { SpellId } from "../../types";
import { PlayerAnimator } from "./PlayerAnimator";

type MaterialColorState = {
  material: THREE.Material;
  color: THREE.Color | null;
  emissive: THREE.Color | null;
};

export class PlayerCharacter {
  private readonly animator = new PlayerAnimator();
  private materialStates: MaterialColorState[] = [];
  private modelSource = "procedural-fallback";
  private modelScale: number | null = null;
  private defeated = false;
  private disposed = false;

  constructor(
    private readonly model: PlayerModel,
    private readonly fallbackMaterial: THREE.Material,
  ) {
    this.setMaterialStates([fallbackMaterial]);
    void this.load();
  }

  update(dt: number) {
    this.animator.update(dt);
  }

  setMoving(moving: boolean) {
    this.animator.setMoving(moving);
  }

  playSpell(spellId: SpellId) {
    this.animator.playSpell(spellId);
  }

  isCasting() {
    return this.animator.isCasting();
  }

  flash(color: THREE.ColorRepresentation, shouldReset: () => boolean) {
    this.applyColor(color);
    window.setTimeout(() => {
      if (shouldReset()) {
        this.restoreAppearance();
      }
    }, 95);
  }

  setDefeated() {
    this.defeated = true;
    this.animator.setDefeated();
    this.applyDefeatedAppearance();
  }

  reset() {
    this.defeated = false;
    this.animator.reset();
    this.restoreAppearance();
  }

  getDiagnostics() {
    const materials = this.materialStates.map((state) => state.material);
    return {
      modelSource: this.modelSource,
      modelScale: this.modelScale,
      materials: {
        count: materials.length,
        transparentCount: materials.filter((material) => material.transparent).length,
        depthWriteCount: materials.filter((material) => material.depthWrite).length,
        fullyOpaqueCount: materials.filter((material) => material.opacity === 1).length,
      },
      ...this.animator.getDiagnostics(),
    };
  }

  dispose() {
    this.disposed = true;
    this.animator.dispose();
  }

  private async load() {
    try {
      const character = await loadPlayerCharacter();
      if (this.disposed) {
        disposeObject3D(character.object);
        return;
      }

      this.animator.attach(character.object, character.animations);
      this.model.visualRoot.remove(this.model.fallback);
      disposeObject3D(this.model.fallback, { preserveMaterials: [this.fallbackMaterial] });
      this.model.visualRoot.add(character.object);
      this.setMaterialStates(character.materials);
      this.modelSource = character.sourceUrl;
      this.modelScale = character.scale;
      this.restoreAppearance();
    } catch (error) {
      this.animator.markLoadFailed(error);
      console.warn("Unable to load animated Zeus model; using procedural fallback.", error);
    }
  }

  private setMaterialStates(materials: THREE.Material[]) {
    this.materialStates = materials.map((material) => {
      const tintable = material as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };
      return {
        material,
        color: tintable.color instanceof THREE.Color ? tintable.color.clone() : null,
        emissive: tintable.emissive instanceof THREE.Color ? tintable.emissive.clone() : null,
      };
    });
  }

  private applyColor(color: THREE.ColorRepresentation) {
    for (const state of this.materialStates) {
      const tintable = state.material as THREE.Material & { color?: THREE.Color };
      tintable.color?.set(color);
    }
  }

  private applyDefeatedAppearance() {
    for (const state of this.materialStates) {
      const tintable = state.material as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };
      tintable.color?.set(0x59676a);
      tintable.emissive?.set(0x1b2020);
    }
  }

  private restoreAppearance() {
    if (this.defeated) {
      this.applyDefeatedAppearance();
      return;
    }

    for (const state of this.materialStates) {
      const tintable = state.material as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };
      if (state.color) {
        tintable.color?.copy(state.color);
      }
      if (state.emissive) {
        tintable.emissive?.copy(state.emissive);
      }
    }
  }
}
