import * as THREE from "three";
import { PLAYER_LIGHT_INNER_RADIUS, PLAYER_LIGHT_OUTER_RADIUS, TILE_SIZE, VISIBILITY_LIGHT_EPSILON } from "../config";
import { clamp, distance2D } from "../lib/math";
import type { VisibilitySystem } from "../game/visibility/VisibilitySystem";
import type { GridWorld } from "../world/GridWorld";

const UNDISCOVERED_ALPHA = 0.96;
const BLOCKED_MEMORY_ALPHA = 0.66;
const VISIBLE_MIN_ALPHA = 0.03;
const VISIBLE_MAX_ALPHA = 0.62;
const REVEAL_SPEED = 12;
const HIDE_SPEED = 5.5;
const RESOLUTION_SCALE = 2;
const OVERLAY_RADIUS_CELLS = Math.ceil(PLAYER_LIGHT_OUTER_RADIUS / TILE_SIZE) + 16;
const TEXTURE_CELLS = (OVERLAY_RADIUS_CELLS * 2 + 1) * RESOLUTION_SCALE;
const OVERLAY_WINDOW_SIZE = OVERLAY_RADIUS_CELLS * TILE_SIZE * 2;
const TEXEL_WORLD_SIZE = OVERLAY_WINDOW_SIZE / TEXTURE_CELLS;
const MAX_REMAP_SHIFT_PIXELS = Math.floor(TEXTURE_CELLS * 0.45);

type AlphaHistoryAction = "initial" | "none" | "remap" | "reset";

export class VisibilityOverlay {
  readonly object: THREE.Mesh;

  private readonly data = new Uint8Array(TEXTURE_CELLS * TEXTURE_CELLS * 4);
  private readonly targetAlpha = new Float32Array(TEXTURE_CELLS * TEXTURE_CELLS);
  private readonly displayedAlpha = new Float32Array(TEXTURE_CELLS * TEXTURE_CELLS);
  private readonly alphaScratch = new Float32Array(TEXTURE_CELLS * TEXTURE_CELLS);
  private readonly texture: THREE.DataTexture;
  private settling = true;
  private debugReveal = false;
  private hasHistoryCenter = false;
  private historyCenterX = 0;
  private historyCenterZ = 0;
  private centerWorld = { x: 0, z: 0 };
  private lastAlphaHistoryAction: AlphaHistoryAction = "initial";
  private lastAlphaHistoryShift = { x: 0, z: 0 };

  constructor(private readonly gridWorld: GridWorld) {
    for (let i = 0; i < TEXTURE_CELLS * TEXTURE_CELLS; i += 1) {
      const offset = i * 4;
      this.data[offset] = 0;
      this.data[offset + 1] = 0;
      this.data[offset + 2] = 0;
      this.data[offset + 3] = 255;
      this.targetAlpha[i] = UNDISCOVERED_ALPHA;
      this.displayedAlpha[i] = UNDISCOVERED_ALPHA;
    }

    this.texture = new THREE.DataTexture(this.data, TEXTURE_CELLS, TEXTURE_CELLS, THREE.RGBAFormat);
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

    this.object = new THREE.Mesh(new THREE.PlaneGeometry(OVERLAY_WINDOW_SIZE, OVERLAY_WINDOW_SIZE), material);
    this.object.rotation.x = -Math.PI / 2;
    this.object.position.y = 0.09;
    this.object.renderOrder = 18;
  }

  setDebugReveal(enabled: boolean) {
    this.debugReveal = enabled;
    this.object.visible = !enabled;
  }

  update(visibility: VisibilitySystem, dt: number, centerPosition: { x: number; z: number }) {
    if (this.debugReveal) {
      this.object.visible = false;
      return;
    }

    this.object.visible = true;
    this.centerWorld = { x: centerPosition.x, z: centerPosition.z };
    this.object.position.x = this.centerWorld.x;
    this.object.position.z = this.centerWorld.z;

    this.updateTargets(visibility, this.centerWorld);
    this.updateAlphaHistoryAnchor();
    this.settling = true;

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

  getDiagnostics() {
    return {
      resolutionScale: RESOLUTION_SCALE,
      textureWidth: TEXTURE_CELLS,
      textureHeight: TEXTURE_CELLS,
      texturePixels: TEXTURE_CELLS * TEXTURE_CELLS,
      texelWorldSize: TEXEL_WORLD_SIZE,
      overlayRadiusCells: OVERLAY_RADIUS_CELLS,
      centerWorld: { ...this.centerWorld },
      alphaHistoryAction: this.lastAlphaHistoryAction,
      alphaHistoryShift: { ...this.lastAlphaHistoryShift },
      debugReveal: this.debugReveal,
      visible: this.object.visible,
      settling: this.settling,
    };
  }

  private updateTargets(visibility: VisibilitySystem, centerWorld: { x: number; z: number }) {
    for (let textureZ = 0; textureZ < TEXTURE_CELLS; textureZ += 1) {
      const worldZ = centerWorld.z + OVERLAY_WINDOW_SIZE / 2 - ((textureZ + 0.5) / TEXTURE_CELLS) * OVERLAY_WINDOW_SIZE;

      for (let textureX = 0; textureX < TEXTURE_CELLS; textureX += 1) {
        const worldX = centerWorld.x + ((textureX + 0.5) / TEXTURE_CELLS) * OVERLAY_WINDOW_SIZE - OVERLAY_WINDOW_SIZE / 2;
        const cell = this.gridWorld.worldToCell(worldX, worldZ);
        this.targetAlpha[textureZ * TEXTURE_CELLS + textureX] = this.alphaForSample(visibility, cell.q, cell.r, worldX, worldZ, centerWorld);
      }
    }
  }

  private alphaForSample(
    visibility: VisibilitySystem,
    q: number,
    r: number,
    worldX: number,
    worldZ: number,
    centerWorld: { x: number; z: number },
  ) {
    const light = this.lightAtDistance(distance2D(centerWorld.x, centerWorld.z, worldX, worldZ));
    if (!visibility.isDiscoveredCell(q, r) || light <= VISIBILITY_LIGHT_EPSILON) {
      return UNDISCOVERED_ALPHA;
    }

    if (!visibility.isVisibleCell(q, r)) {
      return clamp(
        BLOCKED_MEMORY_ALPHA + (1 - light) * (UNDISCOVERED_ALPHA - BLOCKED_MEMORY_ALPHA),
        BLOCKED_MEMORY_ALPHA,
        UNDISCOVERED_ALPHA,
      );
    }

    return clamp(VISIBLE_MIN_ALPHA + (1 - light) * (VISIBLE_MAX_ALPHA - VISIBLE_MIN_ALPHA), VISIBLE_MIN_ALPHA, VISIBLE_MAX_ALPHA);
  }

  private updateAlphaHistoryAnchor() {
    if (!this.hasHistoryCenter) {
      this.displayedAlpha.set(this.targetAlpha);
      this.historyCenterX = this.centerWorld.x;
      this.historyCenterZ = this.centerWorld.z;
      this.hasHistoryCenter = true;
      this.lastAlphaHistoryAction = "initial";
      this.lastAlphaHistoryShift = { x: 0, z: 0 };
      return;
    }

    const shiftX = Math.trunc((this.centerWorld.x - this.historyCenterX) / TEXEL_WORLD_SIZE);
    const shiftZ = Math.trunc((this.centerWorld.z - this.historyCenterZ) / TEXEL_WORLD_SIZE);
    if (shiftX === 0 && shiftZ === 0) {
      this.lastAlphaHistoryAction = "none";
      this.lastAlphaHistoryShift = { x: 0, z: 0 };
      return;
    }

    if (Math.abs(shiftX) > MAX_REMAP_SHIFT_PIXELS || Math.abs(shiftZ) > MAX_REMAP_SHIFT_PIXELS) {
      this.displayedAlpha.set(this.targetAlpha);
      this.historyCenterX = this.centerWorld.x;
      this.historyCenterZ = this.centerWorld.z;
      this.lastAlphaHistoryAction = "reset";
      this.lastAlphaHistoryShift = { x: shiftX, z: shiftZ };
      return;
    }

    this.alphaScratch.set(this.displayedAlpha);
    for (let textureZ = 0; textureZ < TEXTURE_CELLS; textureZ += 1) {
      const sourceZ = textureZ - shiftZ;
      for (let textureX = 0; textureX < TEXTURE_CELLS; textureX += 1) {
        const sourceX = textureX + shiftX;
        const targetIndex = textureZ * TEXTURE_CELLS + textureX;
        this.displayedAlpha[targetIndex] =
          sourceX >= 0 && sourceX < TEXTURE_CELLS && sourceZ >= 0 && sourceZ < TEXTURE_CELLS
            ? this.alphaScratch[sourceZ * TEXTURE_CELLS + sourceX]
            : this.targetAlpha[targetIndex];
      }
    }

    this.historyCenterX += shiftX * TEXEL_WORLD_SIZE;
    this.historyCenterZ += shiftZ * TEXEL_WORLD_SIZE;
    this.lastAlphaHistoryAction = "remap";
    this.lastAlphaHistoryShift = { x: shiftX, z: shiftZ };
  }

  private lightAtDistance(distanceWorld: number) {
    if (distanceWorld <= PLAYER_LIGHT_INNER_RADIUS) {
      return 1;
    }

    const fade = clamp(
      (distanceWorld - PLAYER_LIGHT_INNER_RADIUS) / Math.max(TILE_SIZE, PLAYER_LIGHT_OUTER_RADIUS - PLAYER_LIGHT_INNER_RADIUS),
      0,
      1,
    );
    const smooth = fade * fade * (3 - 2 * fade);
    return 1 - smooth;
  }
}
