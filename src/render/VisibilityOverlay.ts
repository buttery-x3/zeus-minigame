import * as THREE from "three";
import { VISIBILITY_LIGHT_EPSILON, WORLD_CELLS, WORLD_SIZE } from "../config";
import { clamp } from "../lib/math";
import type { VisibilitySystem } from "../game/visibility/VisibilitySystem";

const UNDISCOVERED_ALPHA = 0.96;
const BLOCKED_MEMORY_ALPHA = 0.66;
const VISIBLE_MIN_ALPHA = 0.03;
const VISIBLE_MAX_ALPHA = 0.62;
const REVEAL_SPEED = 12;
const HIDE_SPEED = 5.5;

export class VisibilityOverlay {
  readonly object: THREE.Mesh;

  private readonly data = new Uint8Array(WORLD_CELLS * WORLD_CELLS * 4);
  private readonly targetAlpha = new Float32Array(WORLD_CELLS * WORLD_CELLS);
  private readonly displayedAlpha = new Float32Array(WORLD_CELLS * WORLD_CELLS);
  private readonly texture: THREE.DataTexture;
  private visibilityVersion = -1;
  private settling = true;

  constructor() {
    for (let i = 0; i < WORLD_CELLS * WORLD_CELLS; i += 1) {
      const offset = i * 4;
      this.data[offset] = 0;
      this.data[offset + 1] = 0;
      this.data[offset + 2] = 0;
      this.data[offset + 3] = 255;
      this.targetAlpha[i] = UNDISCOVERED_ALPHA;
      this.displayedAlpha[i] = UNDISCOVERED_ALPHA;
    }

    this.texture = new THREE.DataTexture(this.data, WORLD_CELLS, WORLD_CELLS, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });

    this.object = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE), material);
    this.object.rotation.x = -Math.PI / 2;
    this.object.position.y = 0.09;
    this.object.renderOrder = 18;
  }

  update(visibility: VisibilitySystem, dt: number) {
    if (visibility.getVersion() !== this.visibilityVersion) {
      this.updateTargets(visibility);
      this.visibilityVersion = visibility.getVersion();
      this.settling = true;
    }

    if (!this.settling) {
      return;
    }

    const revealStep = 1 - Math.exp(-REVEAL_SPEED * dt);
    const hideStep = 1 - Math.exp(-HIDE_SPEED * dt);
    let maxDelta = 0;

    for (let i = 0; i < this.displayedAlpha.length; i += 1) {
      const current = this.displayedAlpha[i];
      const target = this.targetAlpha[i];
      const step = target < current ? revealStep : hideStep;
      const next = current + (target - current) * step;
      const delta = Math.abs(next - target);
      this.displayedAlpha[i] = delta < 0.002 ? target : next;
      this.data[i * 4 + 3] = Math.round(clamp(this.displayedAlpha[i], 0, 1) * 255);
      maxDelta = Math.max(maxDelta, delta);
    }

    this.texture.needsUpdate = true;
    this.settling = maxDelta > 0.002;
  }

  dispose() {
    this.object.geometry.dispose();
    const material = this.object.material;
    if (material instanceof THREE.Material) {
      material.dispose();
    }
    this.texture.dispose();
  }

  private updateTargets(visibility: VisibilitySystem) {
    for (let z = 0; z < WORLD_CELLS; z += 1) {
      for (let x = 0; x < WORLD_CELLS; x += 1) {
        const index = (WORLD_CELLS - 1 - z) * WORLD_CELLS + x;
        this.targetAlpha[index] = this.alphaForCell(visibility, x, z);
      }
    }
  }

  private alphaForCell(visibility: VisibilitySystem, x: number, z: number) {
    const lightReach = visibility.getLightReachCell(x, z);
    if (!visibility.isDiscoveredCell(x, z) || lightReach <= VISIBILITY_LIGHT_EPSILON) {
      return UNDISCOVERED_ALPHA;
    }

    if (!visibility.isVisibleCell(x, z)) {
      return clamp(
        BLOCKED_MEMORY_ALPHA + (1 - lightReach) * (UNDISCOVERED_ALPHA - BLOCKED_MEMORY_ALPHA),
        BLOCKED_MEMORY_ALPHA,
        UNDISCOVERED_ALPHA,
      );
    }

    const light = visibility.getLightCell(x, z);
    return clamp(VISIBLE_MIN_ALPHA + (1 - light) * (VISIBLE_MAX_ALPHA - VISIBLE_MIN_ALPHA), VISIBLE_MIN_ALPHA, VISIBLE_MAX_ALPHA);
  }
}
