import * as THREE from "three";
import type { SpellId } from "../../types";
import type { GridWorld } from "../../world/GridWorld";

type InputCallbacks = {
  isGameOver: () => boolean;
  isPaused: () => boolean;
  isQuickCastEnabled: () => boolean;
  getCastMode: () => SpellId | null;
  beginTargeting: (spellId: SpellId) => void;
  cancelTargeting: () => void;
  castAt: (target: THREE.Vector3) => void;
  setMoveTarget: (x: number, z: number) => void;
  restart: () => void;
  handleEscape: () => void;
  toggleDiagnostics: () => void;
  toggleEnemyHealthBarMode: () => void;
  toggleTerrainDebugMode: () => void;
};

const HELD_MOVE_REFIRE_SECONDS = 0.1;

export class GameInput {
  readonly pointerWorld = new THREE.Vector3();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly pointerClient = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pressedPointerId: number | null = null;
  private inputMoveLocked = false;
  private hasPointerClient = false;
  private heldMoveRefireIn = 0;
  private moveRequestPending = false;
  private quickCastHeldSpell: SpellId | null = null;
  private quickCastHeldCode: string | null = null;
  private quickCastHeldKey: string | null = null;
  private quickCastCanceled = false;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly gridWorld: GridWorld,
    private readonly callbacks: InputCallbacks,
  ) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("contextmenu", this.preventContextMenu);
  }

  update(dt: number) {
    this.refreshPointerWorld();

    if (!this.isHoldingMove()) {
      this.heldMoveRefireIn = 0;
      this.moveRequestPending = false;
      return;
    }

    this.heldMoveRefireIn -= dt;
    if (this.heldMoveRefireIn <= 0) {
      this.moveRequestPending = true;
      do {
        this.heldMoveRefireIn += HELD_MOVE_REFIRE_SECONDS;
      } while (this.heldMoveRefireIn <= 0);
    }
  }

  consumeMoveRequest() {
    const shouldMove = this.isHoldingMove() && this.moveRequestPending;
    this.moveRequestPending = false;
    return shouldMove;
  }

  private isHoldingMove() {
    return (
      this.pressedPointerId !== null &&
      !this.callbacks.isGameOver() &&
      !this.callbacks.isPaused() &&
      (!this.callbacks.getCastMode() || this.callbacks.isQuickCastEnabled()) &&
      !this.inputMoveLocked
    );
  }

  dispose() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("contextmenu", this.preventContextMenu);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (event.key === "Escape") {
      this.quickCastCanceled = this.quickCastCanceled || this.quickCastHeldSpell !== null;
      this.callbacks.handleEscape();
      return;
    }

    if (event.code === "Backquote" || event.key === "F3") {
      this.callbacks.toggleDiagnostics();
      return;
    }

    if (event.key === "F4") {
      this.callbacks.toggleTerrainDebugMode();
      return;
    }

    if (this.callbacks.isPaused()) {
      return;
    }

    const key = event.key.toLowerCase();
    const spellId = spellIdFromKey(key);

    if (key === "v") {
      this.callbacks.toggleEnemyHealthBarMode();
    } else if (spellId) {
      this.handleSpellKeyDown(event, spellId);
    } else if (key === "r" && this.callbacks.isGameOver()) {
      this.callbacks.restart();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (!this.quickCastHeldSpell || (event.code !== this.quickCastHeldCode && key !== this.quickCastHeldKey)) {
      return;
    }

    const spellId = this.quickCastHeldSpell;
    const wasCanceled = this.quickCastCanceled;
    this.clearQuickCastHold();

    if (
      wasCanceled ||
      !this.callbacks.isQuickCastEnabled() ||
      this.callbacks.isGameOver() ||
      this.callbacks.isPaused() ||
      this.callbacks.getCastMode() !== spellId
    ) {
      return;
    }

    this.callbacks.castAt(this.pointerWorld);
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      event.preventDefault();
      if (!this.callbacks.isGameOver() && !this.callbacks.isPaused() && !this.isUiEvent(event) && this.callbacks.getCastMode()) {
        this.cancelTargeting();
      }
      return;
    }

    if (event.button !== 0 || this.callbacks.isGameOver() || this.callbacks.isPaused() || this.isUiEvent(event)) {
      return;
    }

    this.updatePointerWorld(event);
    this.pressedPointerId = event.pointerId;
    this.moveRequestPending = false;
    this.heldMoveRefireIn = HELD_MOVE_REFIRE_SECONDS;

    if (this.callbacks.getCastMode()) {
      if (this.callbacks.isQuickCastEnabled()) {
        this.callbacks.setMoveTarget(this.pointerWorld.x, this.pointerWorld.z);
      } else {
        this.callbacks.castAt(this.pointerWorld);
        this.inputMoveLocked = true;
      }
      return;
    }

    this.callbacks.setMoveTarget(this.pointerWorld.x, this.pointerWorld.z);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (this.isUiEvent(event)) {
      return;
    }
    this.updatePointerWorld(event);

    if (this.isHoldingMove()) {
      this.moveRequestPending = true;
      this.heldMoveRefireIn = HELD_MOVE_REFIRE_SECONDS;
    }
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId === this.pressedPointerId) {
      this.pressedPointerId = null;
      this.inputMoveLocked = false;
      this.moveRequestPending = false;
      this.heldMoveRefireIn = 0;
    }
  };

  private readonly preventContextMenu = (event: Event) => {
    event.preventDefault();
  };

  private handleSpellKeyDown(event: KeyboardEvent, spellId: SpellId) {
    if (!this.callbacks.isQuickCastEnabled()) {
      this.callbacks.beginTargeting(spellId);
      return;
    }

    if (this.quickCastHeldSpell) {
      return;
    }

    this.quickCastHeldSpell = spellId;
    this.quickCastHeldCode = event.code;
    this.quickCastHeldKey = event.key.toLowerCase();
    this.quickCastCanceled = false;
    this.callbacks.beginTargeting(spellId);
  }

  private cancelTargeting() {
    this.quickCastCanceled = this.quickCastCanceled || this.quickCastHeldSpell !== null;
    this.callbacks.cancelTargeting();
  }

  private clearQuickCastHold() {
    this.quickCastHeldSpell = null;
    this.quickCastHeldCode = null;
    this.quickCastHeldKey = null;
    this.quickCastCanceled = false;
  }

  private isUiEvent(event: Event) {
    return event.target instanceof Element && event.target.closest(".ui-layer");
  }

  private updatePointerWorld(event: PointerEvent) {
    this.pointerClient.set(event.clientX, event.clientY);
    this.hasPointerClient = true;
    this.refreshPointerWorld();
  }

  private refreshPointerWorld() {
    if (!this.hasPointerClient) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((this.pointerClient.x - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -(((this.pointerClient.y - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.pointerWorld);
    this.gridWorld.clampWorld(this.pointerWorld);
  }
}

function spellIdFromKey(key: string): SpellId | null {
  if (key === "q") {
    return "chain";
  }
  if (key === "w") {
    return "bolt";
  }
  return null;
}
