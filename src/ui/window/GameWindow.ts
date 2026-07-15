import type { GameWindowOptions, NormalizedWindowPosition } from "./types";
import type { WindowManager } from "./WindowManager";

const WINDOW_MARGIN = 10;

export class GameWindow {
  readonly element: HTMLElement;
  readonly content: HTMLElement;

  private readonly titlebar: HTMLElement;
  private readonly lockButton: HTMLButtonElement | null;
  private readonly closeButton: HTMLButtonElement | null;
  private x = 0;
  private y = 0;
  private width = 0;
  private height = 0;
  private customPosition: NormalizedWindowPosition | null;
  private locked: boolean;
  private unlockUiEnabled = true;
  private visible: boolean;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(
    private readonly manager: WindowManager,
    private readonly options: GameWindowOptions,
  ) {
    this.locked = options.locked ?? false;
    this.visible = !(options.hidden ?? false);
    this.customPosition = options.position ? { ...options.position } : null;
    this.element = document.createElement("section");
    this.element.className = `game-window ${options.className ?? ""}`;
    this.element.dataset.windowId = options.id;
    this.element.setAttribute("role", options.modal ? "dialog" : "region");
    this.element.setAttribute("aria-label", options.title);
    this.width = options.placement.width;
    this.element.style.width = `${this.width}px`;

    this.titlebar = document.createElement("header");
    this.titlebar.className = "game-window__titlebar";
    this.titlebar.innerHTML = `<span>${options.title}</span>`;
    this.titlebar.addEventListener("pointerdown", this.handleTitlePointerDown);
    this.element.addEventListener("pointerdown", () => this.manager.bringToFront(this));

    const actions = document.createElement("div");
    actions.className = "game-window__actions";
    this.lockButton = options.lockable ? this.createActionButton("lock", "Lock window", this.toggleLocked) : null;
    this.closeButton = options.closable ? this.createActionButton("close", "Close window", this.close) : null;

    if (this.lockButton) {
      actions.append(this.lockButton);
    }
    if (this.closeButton) {
      actions.append(this.closeButton);
    }
    if (actions.childElementCount > 0) {
      this.titlebar.append(actions);
    }

    this.content = document.createElement("div");
    this.content.className = "game-window__content";
    this.content.append(options.content);
    this.element.append(this.titlebar, this.content);

    this.setLocked(this.locked);
    this.setVisible(this.visible);
    this.place();
    this.resizeObserver =
      options.resizeAnchor === "bottom"
        ? new ResizeObserver(() => this.handleResize())
        : null;
    this.resizeObserver?.observe(this.element);
  }

  place() {
    const placement = this.resolvePlacement();
    const width = placement.width;
    const height = placement.height ?? this.element.offsetHeight;
    const offsetX = placement.offsetX ?? (placement.anchor === "viewport" ? 0 : 18);
    const offsetY = placement.offsetY ?? (placement.anchor === "viewport" ? 0 : 18);

    this.width = width;
    this.element.style.width = `${width}px`;

    if (this.customPosition) {
      this.x = this.customPosition.x * window.innerWidth;
      this.y =
        this.customPosition.y * window.innerHeight -
        (this.options.resizeAnchor === "bottom" ? this.element.offsetHeight : 0);
      this.clampToViewport();
      this.height = this.element.offsetHeight;
      return;
    }

    if (placement.anchor === "top-left") {
      this.x = offsetX;
      this.y = offsetY;
    } else if (placement.anchor === "top-right") {
      this.x = window.innerWidth - width - offsetX;
      this.y = offsetY;
    } else if (placement.anchor === "top-center") {
      this.x = (window.innerWidth - width) / 2 + (placement.offsetX ?? 0);
      this.y = offsetY;
    } else if (placement.anchor === "bottom-left") {
      this.x = offsetX;
      this.y = window.innerHeight - height - offsetY;
    } else if (placement.anchor === "bottom-center") {
      this.x = (window.innerWidth - width) / 2 + (placement.offsetX ?? 0);
      this.y = window.innerHeight - height - offsetY;
    } else if (placement.anchor === "viewport") {
      this.x = window.innerWidth * (placement.viewportX ?? 0.5) - width / 2 + offsetX;
      this.y = window.innerHeight * (placement.viewportY ?? 0.5) - height / 2 + offsetY;
    } else {
      this.x = (window.innerWidth - width) / 2 + (placement.offsetX ?? 0);
      this.y = (window.innerHeight - height) / 2 + (placement.offsetY ?? 0);
    }

    this.applyPosition();
    this.height = this.element.offsetHeight;
  }

  reflow() {
    this.place();
  }

  clampToViewport() {
    this.x = Math.min(Math.max(WINDOW_MARGIN, this.x), Math.max(WINDOW_MARGIN, window.innerWidth - this.element.offsetWidth - WINDOW_MARGIN));
    this.y = Math.min(Math.max(WINDOW_MARGIN, this.y), Math.max(WINDOW_MARGIN, window.innerHeight - this.element.offsetHeight - WINDOW_MARGIN));
    this.applyPosition();
  }

  isVisible() {
    return this.visible;
  }

  isLocked() {
    return this.locked;
  }

  isLockable() {
    return this.lockButton !== null;
  }

  setUnlockUiEnabled(enabled: boolean) {
    this.unlockUiEnabled = enabled;
    this.element.classList.toggle("game-window--unlock-ui-disabled", !enabled && this.isLockable());

    if (this.isLockable()) {
      this.setLocked(!enabled);
    }

    if (this.lockButton) {
      this.lockButton.hidden = !enabled;
      this.lockButton.disabled = !enabled;
      this.lockButton.setAttribute("aria-hidden", String(!enabled));
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.element.hidden = !visible;
    if (visible) {
      if (this.resolvePlacement().anchor === "center") {
        this.place();
      }
      this.manager.bringToFront(this);
    }
    this.manager.syncModalState();
  }

  close = () => {
    this.setVisible(false);
    this.options.onClose?.();
  };

  dispose() {
    this.resizeObserver?.disconnect();
    this.element.remove();
  }

  private toggleLocked = () => {
    if (!this.unlockUiEnabled) {
      return;
    }

    this.setLocked(!this.locked);
  };

  setLocked(locked: boolean) {
    this.locked = locked;
    this.element.classList.toggle("game-window--locked", locked);
    this.lockButton?.setAttribute("aria-label", locked ? "Unlock window" : "Lock window");
    this.lockButton?.setAttribute("title", locked ? "Unlock" : "Lock");
  }

  private createActionButton(kind: "lock" | "close", label: string, onClick: () => void) {
    const button = document.createElement("button");
    button.className = `game-window__action game-window__action--${kind}`;
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = `<i></i>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private readonly handleTitlePointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || !this.unlockUiEnabled || this.locked || !(this.options.movable ?? true) || target?.closest("button")) {
      return;
    }

    event.preventDefault();
    this.manager.bringToFront(this);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = this.x;
    const originY = this.y;
    let moved = false;
    this.titlebar.setPointerCapture(event.pointerId);

    const handleMove = (moveEvent: PointerEvent) => {
      this.x = originX + moveEvent.clientX - startX;
      this.y = originY + moveEvent.clientY - startY;
      moved ||= Math.hypot(this.x - originX, this.y - originY) >= 1;
      this.clampToViewport();
    };
    const handleUp = () => {
      this.titlebar.removeEventListener("pointermove", handleMove);
      this.titlebar.removeEventListener("pointerup", handleUp);
      this.titlebar.removeEventListener("pointercancel", handleUp);
      if (moved) {
        this.customPosition = this.readNormalizedPosition();
        this.options.onPositionChanged?.({ ...this.customPosition });
      }
    };

    this.titlebar.addEventListener("pointermove", handleMove);
    this.titlebar.addEventListener("pointerup", handleUp);
    this.titlebar.addEventListener("pointercancel", handleUp);
  };

  private applyPosition() {
    this.element.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
  }

  private handleResize() {
    const nextHeight = this.element.offsetHeight;
    if (this.height > 0 && nextHeight !== this.height) {
      this.y -= nextHeight - this.height;
      this.clampToViewport();
    }
    this.height = nextHeight;
  }

  private readNormalizedPosition(): NormalizedWindowPosition {
    const anchorY = this.options.resizeAnchor === "bottom" ? this.y + this.element.offsetHeight : this.y;
    return {
      x: clamp01(this.x / Math.max(1, window.innerWidth)),
      y: clamp01(anchorY / Math.max(1, window.innerHeight)),
    };
  }

  private resolvePlacement() {
    return window.innerWidth <= 680 && this.options.placement.mobile
      ? { ...this.options.placement, ...this.options.placement.mobile }
      : this.options.placement;
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
