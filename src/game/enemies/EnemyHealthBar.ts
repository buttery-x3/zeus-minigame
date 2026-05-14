import * as THREE from "three";
import { clamp } from "../../lib/math";
import { disposeObject3D } from "../../render/dispose";
import type { EnemyHealthBarVisibilityMode, EnemyState } from "../../types";

const BAR_OFFSET_Y = 2.75;
const BAR_WIDTH = 1.85;
const BAR_HEIGHT = 0.18;
const BACK_WIDTH = 2.05;
const BACK_HEIGHT = 0.34;
const SMART_VISIBLE_SECONDS = 2.2;
const RENDER_ORDER = 40;

type EnemyHealthBarUpdate = {
  camera: THREE.Camera;
  dt: number;
  mode: EnemyHealthBarVisibilityMode;
  revealAll: boolean;
};

export class EnemyHealthBar {
  readonly object = new THREE.Group();

  private readonly fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private healthRatio = 1;
  private smartVisibleTimer = 0;

  constructor() {
    const back = createPlane(BACK_WIDTH, BACK_HEIGHT, 0x080d0e, 0.46);
    this.fill = createPlane(BAR_WIDTH, BAR_HEIGHT, 0x55f08a, 0.78);
    this.fill.position.z = 0.01;

    this.object.visible = false;
    this.object.renderOrder = RENDER_ORDER;
    this.object.add(back, this.fill);
  }

  setHealth(hp: number, maxHp: number) {
    this.healthRatio = clamp(maxHp > 0 ? hp / maxHp : 0, 0, 1);
    this.fill.scale.x = Math.max(0.001, this.healthRatio);
    this.fill.position.x = -BAR_WIDTH * (1 - this.healthRatio) * 0.5;
  }

  markDamaged() {
    this.smartVisibleTimer = SMART_VISIBLE_SECONDS;
  }

  update(enemy: EnemyState, params: EnemyHealthBarUpdate) {
    this.smartVisibleTimer = Math.max(0, this.smartVisibleTimer - params.dt);
    this.object.position.set(enemy.group.position.x, enemy.group.position.y + BAR_OFFSET_Y, enemy.group.position.z);
    this.object.quaternion.copy(params.camera.quaternion);

    this.object.visible =
      params.revealAll ||
      params.mode === "always" ||
      (params.mode === "smart" && this.smartVisibleTimer > 0 && this.healthRatio < 1);

    return this.object.visible;
  }

  dispose() {
    disposeObject3D(this.object);
  }
}

function createPlane(width: number, height: number, color: THREE.ColorRepresentation, opacity: number) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      opacity,
      side: THREE.DoubleSide,
      toneMapped: false,
      transparent: true,
    }),
  );
  mesh.renderOrder = RENDER_ORDER;
  return mesh;
}
