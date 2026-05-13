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
  private healthFill: HTMLElement;
  private manaFill: HTMLElement;
  private kills: HTMLElement;
  private wave: HTMLElement;
  private cell: HTMLElement;
  private status: HTMLElement;
  private chainButton: HTMLElement;
  private boltButton: HTMLElement;

  constructor(windowManager: WindowManager) {
    const stats = this.createContent(`
      <div class="hud__stats">
        <div class="hud__bar hud__bar--health"><span></span></div>
        <div class="hud__bar hud__bar--mana"><span></span></div>
        <div class="hud__line"><strong data-kills>0</strong><span>Kills</span></div>
        <div class="hud__line"><strong data-wave>1</strong><span>Wave</span></div>
      </div>
    `);
    const status = this.createContent(`<div class="hud__status" data-status></div>`);
    const cell = this.createContent(`<div class="hud__cell"><i></i><span data-cell>Cell 90, 90</span></div>`);
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

    this.windows.push(
      windowManager.createWindow({
        id: "hud-vitals",
        title: "Vitals",
        content: stats,
        placement: { anchor: "top-left", width: 230, offsetX: 18, offsetY: 18, mobile: { anchor: "top-left", width: 178, offsetX: 14, offsetY: 14 } },
        className: "hud-window hud-window--vitals",
        lockable: true,
        locked: true,
      }),
      windowManager.createWindow({
        id: "hud-status",
        title: "Status",
        content: status,
        placement: { anchor: "top-center", width: 360, offsetY: 18, mobile: { anchor: "top-center", width: 360, offsetY: 188 } },
        className: "hud-window hud-window--status",
        lockable: true,
        locked: true,
      }),
      windowManager.createWindow({
        id: "hud-position",
        title: "Position",
        content: cell,
        placement: { anchor: "top-right", width: 170, offsetX: 18, offsetY: 72, mobile: { anchor: "top-right", width: 170, offsetX: 14, offsetY: 72 } },
        className: "hud-window hud-window--position",
        lockable: true,
        locked: true,
      }),
      windowManager.createWindow({
        id: "hud-abilities",
        title: "Abilities",
        content: abilities,
        placement: { anchor: "bottom-center", width: 190, offsetY: 18 },
        className: "hud-window hud-window--abilities",
        lockable: true,
        locked: true,
      }),
    );

    this.healthFill = mustQuery(stats, ".hud__bar--health span");
    this.manaFill = mustQuery(stats, ".hud__bar--mana span");
    this.kills = mustQuery(stats, "[data-kills]");
    this.wave = mustQuery(stats, "[data-wave]");
    this.cell = mustQuery(cell, "[data-cell]");
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
    for (const gameWindow of this.windows) {
      gameWindow.dispose();
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
}
