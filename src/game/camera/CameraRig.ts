import * as THREE from "three";
import { CAMERA_ZOOM } from "../../config";

export class CameraRig {
  private readonly followFocus = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3(32, 36, 32);

  constructor(
    private readonly camera: THREE.OrthographicCamera,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly cameraZoom = CAMERA_ZOOM,
  ) {}

  update(dt: number, target: THREE.Vector3) {
    const followAmount = 1 - Math.pow(0.001, dt);
    this.followFocus.lerp(target, followAmount);
    this.camera.position.copy(this.followFocus).add(this.cameraOffset);
    this.camera.lookAt(this.followFocus);
  }

  resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / Math.max(1, height);

    this.camera.left = -this.cameraZoom * aspect;
    this.camera.right = this.cameraZoom * aspect;
    this.camera.top = this.cameraZoom;
    this.camera.bottom = -this.cameraZoom;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };
}
