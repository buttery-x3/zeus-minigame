import * as THREE from "three";
import { disposeObject3D } from "../../render/dispose";
import { loadEnemyCharacter, type LoadedEnemyCharacter } from "../../render/loadEnemyCharacter";
import type { EnemyModel } from "../../render/meshes";
import { EnemyAnimator } from "./EnemyAnimator";

type MaterialColorState = {
  material: THREE.Material;
  color: THREE.Color | null;
  emissive: THREE.Color | null;
  emissiveIntensity: number | null;
};

export class EnemyCharacter {
  private readonly animator = new EnemyAnimator();
  private loadedCharacter: LoadedEnemyCharacter | null = null;
  private materialStates: MaterialColorState[] = [];
  private modelSource = "procedural-fallback";
  private modelScale: number | null = null;
  private hitFlashing = false;
  private disposed = false;

  constructor(
    private readonly model: EnemyModel,
    private readonly fallbackMaterial: THREE.Material,
    private readonly fallbackHitMaterial: THREE.Material,
  ) {
    void this.load();
  }

  update(dt: number) {
    this.animator.update(dt);
  }

  playAttack() {
    this.animator.playAttack();
  }

  setHitFlashing(flashing: boolean) {
    if (this.hitFlashing === flashing) {
      return;
    }

    this.hitFlashing = flashing;
    this.model.body.material = flashing ? this.fallbackHitMaterial : this.fallbackMaterial;
    if (flashing) {
      this.applyHitAppearance();
    } else {
      this.restoreAppearance();
    }
  }

  getDiagnostics() {
    return {
      modelSource: this.modelSource,
      modelScale: this.modelScale,
      ...this.animator.getDiagnostics(),
    };
  }

  dispose() {
    this.disposed = true;
    this.animator.dispose();
    if (this.loadedCharacter) {
      this.disposeLoadedCharacter(this.loadedCharacter);
      this.loadedCharacter = null;
    } else {
      disposeObject3D(this.model.fallback, {
        preserveMaterials: [this.fallbackMaterial, this.fallbackHitMaterial],
      });
    }
  }

  private async load() {
    let character: LoadedEnemyCharacter | null = null;
    try {
      character = await loadEnemyCharacter();
      if (this.disposed) {
        this.disposeLoadedCharacter(character);
        return;
      }

      this.animator.attach(character.object, character.animations);
      this.model.visualRoot.remove(this.model.fallback);
      disposeObject3D(this.model.fallback, {
        preserveMaterials: [this.fallbackMaterial, this.fallbackHitMaterial],
      });
      this.model.visualRoot.add(character.object);
      this.loadedCharacter = character;
      this.setMaterialStates(character.materials);
      this.modelSource = character.sourceUrl;
      this.modelScale = character.scale;
      if (this.hitFlashing) {
        this.applyHitAppearance();
      }
    } catch (error) {
      if (character) {
        this.disposeLoadedCharacter(character);
      }
      this.animator.markLoadFailed(error);
      console.warn("Unable to load animated melee enemy model; using procedural fallback.", error);
    }
  }

  private setMaterialStates(materials: THREE.Material[]) {
    this.materialStates = materials.map((material) => {
      const tintable = material as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
      };
      return {
        material,
        color: tintable.color instanceof THREE.Color ? tintable.color.clone() : null,
        emissive: tintable.emissive instanceof THREE.Color ? tintable.emissive.clone() : null,
        emissiveIntensity: typeof tintable.emissiveIntensity === "number" ? tintable.emissiveIntensity : null,
      };
    });
  }

  private applyHitAppearance() {
    for (const state of this.materialStates) {
      const tintable = state.material as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
      };
      tintable.color?.set(0xffffff);
      tintable.emissive?.set(0xff755e);
      if (typeof tintable.emissiveIntensity === "number") {
        tintable.emissiveIntensity = 0.8;
      }
    }
  }

  private restoreAppearance() {
    for (const state of this.materialStates) {
      const tintable = state.material as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
      };
      if (state.color) {
        tintable.color?.copy(state.color);
      }
      if (state.emissive) {
        tintable.emissive?.copy(state.emissive);
      }
      if (state.emissiveIntensity !== null && typeof tintable.emissiveIntensity === "number") {
        tintable.emissiveIntensity = state.emissiveIntensity;
      }
    }
  }

  private disposeLoadedCharacter(character: LoadedEnemyCharacter) {
    disposeObject3D(character.object, { preserveGeometries: character.sharedGeometries });
  }
}
