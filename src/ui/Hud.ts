import { PLAYER_MAX_HEALTH, PLAYER_MAX_MANA } from "../config";
import { mustQuery } from "../lib/dom";
import { clamp } from "../lib/math";
import type { SpellConfig, SpellId } from "../types";

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
};

export class Hud {
  private root: HTMLElement;
  private healthFill: HTMLElement;
  private manaFill: HTMLElement;
  private kills: HTMLElement;
  private wave: HTMLElement;
  private cell: HTMLElement;
  private status: HTMLElement;
  private chainButton: HTMLElement;
  private boltButton: HTMLElement;

  constructor() {
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
      <section class="hud__stats">
        <div class="hud__bar hud__bar--health"><span></span></div>
        <div class="hud__bar hud__bar--mana"><span></span></div>
        <div class="hud__line"><strong data-kills>0</strong><span>Kills</span></div>
        <div class="hud__line"><strong data-wave>1</strong><span>Wave</span></div>
      </section>
      <div class="hud__status" data-status></div>
      <section class="hud__cell"><i></i><span data-cell>Cell 90, 90</span></section>
      <section class="hud__abilities">
        <button class="ability" data-ability="chain" type="button" aria-label="Chain Lightning">
          <b>Q</b><i class="ability__icon ability__icon--chain"></i><span>Chain</span><em></em>
        </button>
        <button class="ability" data-ability="bolt" type="button" aria-label="Lightning Bolt">
          <b>W</b><i class="ability__icon ability__icon--bolt"></i><span>Bolt</span><em></em>
        </button>
      </section>
    `;

    document.body.append(root);
    this.root = root;
    this.healthFill = mustQuery(root, ".hud__bar--health span");
    this.manaFill = mustQuery(root, ".hud__bar--mana span");
    this.kills = mustQuery(root, "[data-kills]");
    this.wave = mustQuery(root, "[data-wave]");
    this.cell = mustQuery(root, "[data-cell]");
    this.status = mustQuery(root, "[data-status]");
    this.chainButton = mustQuery(root, '[data-ability="chain"]');
    this.boltButton = mustQuery(root, '[data-ability="bolt"]');
  }

  update(state: HudState) {
    this.healthFill.style.transform = `scaleX(${clamp(state.health / PLAYER_MAX_HEALTH, 0, 1)})`;
    this.manaFill.style.transform = `scaleX(${clamp(state.mana / PLAYER_MAX_MANA, 0, 1)})`;
    this.kills.textContent = `${state.kills}`;
    this.wave.textContent = `${state.wave}`;
    this.cell.textContent = `Cell ${state.cellX}, ${state.cellZ}`;

    if (state.gameOver) {
      this.status.textContent = "Storm spent. Press R.";
    } else if (state.castMode) {
      this.status.textContent = state.spells[state.castMode].label;
    } else {
      this.status.textContent = "";
    }

    this.updateAbility(this.chainButton, "chain", state);
    this.updateAbility(this.boltButton, "bolt", state);
  }

  remove() {
    this.root.remove();
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
}
