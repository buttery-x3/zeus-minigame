import type { EnemyHealthBarVisibilityMode } from "../types";
import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";

type PauseMenuCallbacks = {
  resume: () => void;
  toggleDiagnostics: () => void;
  setEnemyHealthBarMode: (mode: EnemyHealthBarVisibilityMode) => void;
};

export class PauseMenu {
  private readonly window: GameWindow;
  private readonly healthModeButtons: HTMLButtonElement[];

  constructor(
    windowManager: WindowManager,
    callbacks: PauseMenuCallbacks,
    enemyHealthBarMode: EnemyHealthBarVisibilityMode,
  ) {
    const content = document.createElement("div");
    content.className = "pause-menu";
    content.innerHTML = `
      <div class="pause-menu__mark"></div>
      <h2>Storm Suspended</h2>
      <div class="pause-menu__setting">
        <span>Enemy HP</span>
        <div class="pause-menu__segmented" role="radiogroup" aria-label="Enemy health bar visibility">
          <button type="button" data-health-mode="smart" role="radio">Smart</button>
          <button type="button" data-health-mode="always" role="radio">Always</button>
        </div>
      </div>
      <div class="pause-menu__actions">
        <button type="button" data-action="resume">Resume</button>
        <button type="button" data-action="diagnostics">Diagnostics</button>
      </div>
    `;

    content.querySelector('[data-action="resume"]')?.addEventListener("click", callbacks.resume);
    content.querySelector('[data-action="diagnostics"]')?.addEventListener("click", callbacks.toggleDiagnostics);
    this.healthModeButtons = [...content.querySelectorAll<HTMLButtonElement>("[data-health-mode]")];
    this.healthModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.healthMode as EnemyHealthBarVisibilityMode;
        this.setEnemyHealthBarMode(mode);
        callbacks.setEnemyHealthBarMode(mode);
      });
    });
    this.setEnemyHealthBarMode(enemyHealthBarMode);

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

  setEnemyHealthBarMode(mode: EnemyHealthBarVisibilityMode) {
    for (const button of this.healthModeButtons) {
      const isActive = button.dataset.healthMode === mode;
      button.classList.toggle("pause-menu__segmented-button--active", isActive);
      button.setAttribute("aria-checked", String(isActive));
    }
  }
}
