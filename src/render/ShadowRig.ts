import * as THREE from "three";

const SHADOW_SIZE = 128;
const SHADOW_MAP_SIZE = 2048;
const LIGHT_OFFSET = new THREE.Vector3(-22, 38, 18);

export class ShadowRig {
  readonly light = new THREE.DirectionalLight(0xfff0c8, 2.2);

  private readonly focus = new THREE.Vector3();
  private readonly texelSize = SHADOW_SIZE / SHADOW_MAP_SIZE;

  constructor(private readonly scene: THREE.Scene) {
    this.light.castShadow = true;
    this.light.position.copy(LIGHT_OFFSET);
    this.light.target.position.set(0, 0, 0);
    const camera = this.light.shadow.camera as THREE.OrthographicCamera;
    camera.near = 1;
    camera.far = 120;
    camera.left = -SHADOW_SIZE / 2;
    camera.right = SHADOW_SIZE / 2;
    camera.top = SHADOW_SIZE / 2;
    camera.bottom = -SHADOW_SIZE / 2;
    camera.updateProjectionMatrix();
    this.light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.light.shadow.bias = -0.00015;
    this.light.shadow.normalBias = 0.025;

    scene.add(this.light, this.light.target);
  }

  update(target: THREE.Vector3) {
    if (!this.light.visible) {
      return;
    }
    this.focus.set(this.snap(target.x), 0, this.snap(target.z));
    this.light.target.position.copy(this.focus);
    this.light.position.copy(this.focus).add(LIGHT_OFFSET);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
  }

  setEnabled(enabled: boolean) {
    this.light.visible = enabled;
    this.light.castShadow = enabled;
  }

  diagnostics() {
    const camera = this.light.shadow.camera as THREE.OrthographicCamera;

    return {
      focus: this.focus.toArray(),
      lightPosition: this.light.position.toArray(),
      targetPosition: this.light.target.position.toArray(),
      enabled: this.light.visible,
      shadowSize: SHADOW_SIZE,
      texelSize: this.texelSize,
      camera: {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
        near: camera.near,
        far: camera.far,
      },
    };
  }

  private snap(value: number) {
    return Math.round(value / this.texelSize) * this.texelSize;
  }
}
