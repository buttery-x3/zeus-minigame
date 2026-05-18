import * as THREE from "three";
import { CAMERA_ZOOM } from "../../config";

export class CameraRig {
  private readonly followFocus = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3(32, 36, 32);
  private readonly scaledCameraOffset = new THREE.Vector3();
  private zoomMultiplier = 1;

  constructor(
    private readonly camera: THREE.OrthographicCamera,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly cameraZoom = CAMERA_ZOOM,
  ) {}

  update(dt: number, target: THREE.Vector3) {
    const followAmount = 1 - Math.pow(0.001, dt);
    this.followFocus.lerp(target, followAmount);
    this.scaledCameraOffset.set(this.cameraOffset.x, this.cameraOffset.y * this.zoomMultiplier, this.cameraOffset.z);
    this.camera.position.copy(this.followFocus).add(this.scaledCameraOffset);
    this.camera.lookAt(this.followFocus);
  }

  setZoomMultiplier(multiplier: number) {
    this.zoomMultiplier = multiplier;
    this.resize();
  }

  resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / Math.max(1, height);

    const zoom = this.cameraZoom * this.zoomMultiplier;
    this.camera.left = -zoom * aspect;
    this.camera.right = zoom * aspect;
    this.camera.top = zoom;
    this.camera.bottom = -zoom;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };
}
