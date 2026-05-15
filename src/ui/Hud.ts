import { PLAYER_MAX_HEALTH, PLAYER_MAX_MANA } from "../config";
import { mustQuery } from "../lib/dom";
import { clamp } from "../lib/math";
import type { SpellConfig, SpellId } from "../types";
import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";

type HudState = {
  health: number;
  mana: number;
  kills: number;
  wave: number;
  cellX: number;
  cellZ: number;
  castMode: SpellId | null;
  cooldowns: Record<SpellId, number>;
  spells: Record<SpellId, SpellConfig>;
  gameOver: boolean;
  paused: boolean;
};

export class Hud {
  private readonly windows: GameWindow[] = [];
  private readonly hoverRevealWindows: GameWindow[] = [];
  private unlockUiEnabled = false;
  private healthFill: HTMLElement;
  private manaFill: HTMLElement;
  private kills: HTMLElement;
  private wave: HTMLElement;
  private cell: HTMLElement;
  private status: HTMLElement;
  private chainButton: HTMLElement;
  private boltButton: HTMLElement;

  constructor(private readonly windowManager: WindowManager) {
    const stats = this.createContent(`
      <div class="hud__stats">
        <div class="hud__meter">
          <span class="hud__bar-label">HP</span>
          <div class="hud__bar hud__bar--health"><span data-health-fill></span></div>
        </div>
        <div class="hud__meter">
          <span class="hud__bar-label">Power</span>
          <div class="hud__bar hud__bar--mana"><span data-mana-fill></span></div>
        </div>
      </div>
    `);
    const status = this.createContent(`<div class="hud__status" data-status></div>`);
    const game = this.createContent(`
      <div class="hud__game">
        <div class="hud__cell"><i></i><span data-cell>Cell 90, 90</span></div>
        <div class="hud__line"><strong data-wave>1</strong><span>Wave</span></div>
        <div class="hud__line"><strong data-kills>0</strong><span>Kills</span></div>
      </div>
    `);
    const abilities = this.createContent(`
      <div class="hud__abilities">
        <button class="ability" data-ability="chain" type="button" aria-label="Chain Lightning">
          <b>Q</b><i class="ability__icon ability__icon--chain"></i><span>Chain</span><em></em>
        </button>
        <button class="ability" data-ability="bolt" type="button" aria-label="Lightning Bolt">
          <b>W</b><i class="ability__icon ability__icon--bolt"></i><span>Bolt</span><em></em>
        </button>
      </div>
    `);

    const vitalsWindow = windowManager.createWindow({
      id: "hud-vitals",
      title: "Vitals",
      content: stats,
      placement: {
        anchor: "viewport",
        width: 240,
        viewportX: 0.5,
        viewportY: 0.64,
        mobile: { anchor: "viewport", width: 230, viewportX: 0.5, viewportY: 0.64 },
      },
      className: "hud-window hud-window--vitals hud-window--minimal",
      lockable: true,
      locked: true,
    });
    const statusWindow = windowManager.createWindow({
      id: "hud-status",
      title: "Status",
      content: status,
      placement: { anchor: "top-center", width: 360, offsetY: 18, mobile: { anchor: "top-center", width: 360, offsetY: 188 } },
      className: "hud-window hud-window--status",
      lockable: true,
      locked: true,
    });
    const gameWindow = windowManager.createWindow({
      id: "hud-position",
      title: "Game",
      content: game,
      placement: { anchor: "top-right", width: 180, offsetX: 18, offsetY: 72, mobile: { anchor: "top-right", width: 180, offsetX: 14, offsetY: 72 } },
      className: "hud-window hud-window--game",
      lockable: true,
      locked: true,
    });
    const abilitiesWindow = windowManager.createWindow({
      id: "hud-abilities",
      title: "Abilities",
      content: abilities,
      placement: {
        anchor: "viewport",
        width: 190,
        viewportX: 0.5,
        viewportY: 0.73,
        mobile: { anchor: "viewport", width: 190, viewportX: 0.5, viewportY: 0.73 },
      },
      className: "hud-window hud-window--abilities hud-window--minimal",
      lockable: true,
      locked: true,
    });

    this.windows.push(vitalsWindow, statusWindow, gameWindow, abilitiesWindow);
    this.hoverRevealWindows.push(vitalsWindow, abilitiesWindow);
    window.addEventListener("pointermove", this.handleHoverRevealPointerMove);

    this.healthFill = mustQuery(stats, "[data-health-fill]");
    this.manaFill = mustQuery(stats, "[data-mana-fill]");
    this.kills = mustQuery(game, "[data-kills]");
    this.wave = mustQuery(game, "[data-wave]");
    this.cell = mustQuery(game, "[data-cell]");
    this.status = status;
    this.chainButton = mustQuery(abilities, '[data-ability="chain"]');
    this.boltButton = mustQuery(abilities, '[data-ability="bolt"]');
  }

  update(state: HudState) {
    this.healthFill.style.transform = `scaleX(${clamp(state.health / PLAYER_MAX_HEALTH, 0, 1)})`;
    this.manaFill.style.transform = `scaleX(${clamp(state.mana / PLAYER_MAX_MANA, 0, 1)})`;
    this.kills.textContent = `${state.kills}`;
    this.wave.textContent = `${state.wave}`;
    this.cell.textContent = `Cell ${state.cellX}, ${state.cellZ}`;

    if (state.gameOver) {
      this.status.textContent = "Storm spent. Press R.";
    } else if (state.paused) {
      this.status.textContent = "Paused";
    } else if (state.castMode) {
      this.status.textContent = state.spells[state.castMode].label;
    } else {
      this.status.textContent = "";
    }

    this.updateAbility(this.chainButton, "chain", state);
    this.updateAbility(this.boltButton, "bolt", state);
  }

  remove() {
    window.removeEventListener("pointermove", this.handleHoverRevealPointerMove);
    for (const gameWindow of this.windows) {
      gameWindow.dispose();
    }
  }

  setUnlockUiEnabled(enabled: boolean) {
    this.unlockUiEnabled = enabled;
    this.windowManager.setUnlockUiEnabled(enabled);

    if (!enabled) {
      this.clearHoverReveal();
    }
  }

  private updateAbility(button: HTMLElement, spellId: SpellId, state: HudState) {
    const spell = state.spells[spellId];
    const cooldown = state.cooldowns[spellId];
    const ready = cooldown <= 0 && state.mana >= spell.manaCost;
    const cooldownLabel = mustQuery(button, "em");

    button.classList.toggle("ability--ready", ready);
    button.classList.toggle("ability--active", state.castMode === spellId);
    cooldownLabel.textContent = cooldown > 0 ? `${Math.ceil(cooldown)}` : "";
  }

  private createContent(html: string) {
    const content = document.createElement("div");
    content.innerHTML = html.trim();
    return content.firstElementChild as HTMLElement;
  }

  private readonly handleHoverRevealPointerMove = (event: PointerEvent) => {
    if (!this.unlockUiEnabled) {
      this.clearHoverReveal();
      return;
    }

    for (const gameWindow of this.hoverRevealWindows) {
      const titlebar = gameWindow.element.querySelector(".game-window__titlebar");
      const hovering =
        gameWindow.isVisible() &&
        (this.rectContainsPoint(gameWindow.content.getBoundingClientRect(), event.clientX, event.clientY, 6) ||
          (titlebar instanceof HTMLElement && this.rectContainsPoint(titlebar.getBoundingClientRect(), event.clientX, event.clientY, 6)));

      gameWindow.element.classList.toggle("hud-window--hovering", hovering);
    }
  };

  private clearHoverReveal() {
    for (const gameWindow of this.hoverRevealWindows) {
      gameWindow.element.classList.remove("hud-window--hovering");
    }
  }

  private rectContainsPoint(rect: DOMRect, x: number, y: number, padding = 0) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left - padding &&
      x <= rect.right + padding &&
      y >= rect.top - padding &&
      y <= rect.bottom + padding
    );
  }
}
