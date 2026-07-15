import { GameWindow } from "./GameWindow";
import type { GameWindowOptions } from "./types";

export class WindowManager {
  readonly root: HTMLElement;

  private readonly modalBackdrop: HTMLElement;
  private readonly windows = new Map<string, GameWindow>();
  private unlockUiEnabled: boolean;
  private zIndex = 30;

  constructor(unlockUiEnabled = false) {
    this.unlockUiEnabled = unlockUiEnabled;
    this.root = document.createElement("div");
    this.root.className = "ui-layer";
    this.root.classList.toggle("ui-layer--unlock-ui-enabled", unlockUiEnabled);

    this.modalBackdrop = document.createElement("div");
    this.modalBackdrop.className = "ui-modal-backdrop";
    this.modalBackdrop.hidden = true;
    this.root.append(this.modalBackdrop);

    document.body.append(this.root);
    window.addEventListener("resize", this.handleResize);
  }

  createWindow(options: GameWindowOptions) {
    const existing = this.windows.get(options.id);
    if (existing) {
      existing.dispose();
    }

    const gameWindow = new GameWindow(this, options);
    gameWindow.setUnlockUiEnabled(this.unlockUiEnabled);
    this.windows.set(options.id, gameWindow);
    this.root.append(gameWindow.element);
    gameWindow.place();
    this.bringToFront(gameWindow);
    this.syncModalState();
    return gameWindow;
  }

  bringToFront(gameWindow: GameWindow) {
    gameWindow.element.style.zIndex = `${this.zIndex}`;
    this.zIndex += 1;
  }

  setUnlockUiEnabled(enabled: boolean) {
    this.unlockUiEnabled = enabled;
    this.root.classList.toggle("ui-layer--unlock-ui-enabled", enabled);

    for (const gameWindow of this.windows.values()) {
      gameWindow.setUnlockUiEnabled(enabled);
    }
  }

  isUnlockUiEnabled() {
    return this.unlockUiEnabled;
  }

  syncModalState() {
    const modalZ = [...this.windows.values()]
      .filter((gameWindow) => gameWindow.isVisible() && gameWindow.element.getAttribute("role") === "dialog")
      .reduce((highest, gameWindow) => Math.max(highest, Number(gameWindow.element.style.zIndex) || 0), 0);
    const hasModal = modalZ > 0;

    this.modalBackdrop.hidden = !hasModal;
    if (hasModal) {
      this.modalBackdrop.style.zIndex = `${modalZ - 1}`;
    }
  }

  remove() {
    window.removeEventListener("resize", this.handleResize);
    for (const gameWindow of this.windows.values()) {
      gameWindow.dispose();
    }
    this.windows.clear();
    this.root.remove();
  }

  private readonly handleResize = () => {
    for (const gameWindow of this.windows.values()) {
      gameWindow.reflow();
    }
  };
}
