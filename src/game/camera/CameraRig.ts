import * as THREE from "three";
import { CAMERA_ZOOM } from "../../config";

export class CameraRig {
  constructor(
    private readonly camera: THREE.OrthographicCamera,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly cameraZoom = CAMERA_ZOOM,
  ) {}

  update(dt: number, target: THREE.Vector3) {
    const cameraTarget = new THREE.Vector3(target.x + 32, 36, target.z + 32);
    this.camera.position.lerp(cameraTarget, 1 - Math.pow(0.001, dt));
    this.camera.lookAt(target.x, 0, target.z);
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
