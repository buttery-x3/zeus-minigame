import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";

type PauseMenuCallbacks = {
  resume: () => void;
  toggleDiagnostics: () => void;
};

export class PauseMenu {
  private readonly window: GameWindow;

  constructor(windowManager: WindowManager, callbacks: PauseMenuCallbacks) {
    const content = document.createElement("div");
    content.className = "pause-menu";
    content.innerHTML = `
      <div class="pause-menu__mark"></div>
      <h2>Storm Suspended</h2>
      <div class="pause-menu__actions">
        <button type="button" data-action="resume">Resume</button>
        <button type="button" data-action="diagnostics">Diagnostics</button>
      </div>
    `;

    content.querySelector('[data-action="resume"]')?.addEventListener("click", callbacks.resume);
    content.querySelector('[data-action="diagnostics"]')?.addEventListener("click", callbacks.toggleDiagnostics);

    this.window = windowManager.createWindow({
      id: "pause-menu",
      title: "Pause",
      content,
      placement: { anchor: "center", width: 340, offsetY: -20 },
      className: "pause-window",
      movable: false,
      closable: false,
      lockable: false,
      modal: true,
      hidden: true,
    });
  }

  setOpen(open: boolean) {
    this.window.setVisible(open);
  }
}
