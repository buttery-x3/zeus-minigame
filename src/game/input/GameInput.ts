import * as THREE from "three";
import type { SpellId } from "../../types";
import type { GridWorld } from "../../world/GridWorld";

type InputCallbacks = {
  isGameOver: () => boolean;
  getCastMode: () => SpellId | null;
  beginTargeting: (spellId: SpellId) => void;
  cancelTargeting: () => void;
  castAt: (target: THREE.Vector3) => void;
  setMoveTarget: (x: number, z: number) => void;
  restart: () => void;
};

export class GameInput {
  readonly pointerWorld = new THREE.Vector3();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pressedPointerId: number | null = null;
  private inputMoveLocked = false;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly gridWorld: GridWorld,
    private readonly callbacks: InputCallbacks,
  ) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("contextmenu", this.preventContextMenu);
  }

  shouldMoveContinuously() {
    return this.pressedPointerId !== null && !this.callbacks.getCastMode() && !this.inputMoveLocked;
  }

  dispose() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("contextmenu", this.preventContextMenu);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (event.key.toLowerCase() === "q") {
      this.callbacks.beginTargeting("chain");
    } else if (event.key.toLowerCase() === "w") {
      this.callbacks.beginTargeting("bolt");
    } else if (event.key === "Escape") {
      this.callbacks.cancelTargeting();
    } else if (event.key.toLowerCase() === "r" && this.callbacks.isGameOver()) {
      this.callbacks.restart();
    }
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.callbacks.isGameOver()) {
      return;
    }

    this.updatePointerWorld(event);
    this.pressedPointerId = event.pointerId;

    if (this.callbacks.getCastMode()) {
      this.callbacks.castAt(this.pointerWorld);
      this.inputMoveLocked = true;
      return;
    }

    this.callbacks.setMoveTarget(this.pointerWorld.x, this.pointerWorld.z);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.updatePointerWorld(event);
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId === this.pressedPointerId) {
      this.pressedPointerId = null;
      this.inputMoveLocked = false;
    }
  };

  private readonly preventContextMenu = (event: Event) => {
    event.preventDefault();
  };

  private updatePointerWorld(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.pointerWorld);
    this.gridWorld.clampWorld(this.pointerWorld);
  }
}
