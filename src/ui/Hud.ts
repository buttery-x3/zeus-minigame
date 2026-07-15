import { mustQuery } from "../lib/dom";
import { clamp } from "../lib/math";
import type { SpellConfig, SpellId } from "../types";
import type { GroundCellPhase } from "../game/terrain/GroundEffectSystem";
import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";
import { UPGRADE_CATALOG } from "../game/upgrades/upgradeCatalog";
import type { ShieldSnapshot, UpgradeStacks } from "../game/upgrades/upgradeTypes";

type HudState = {
  health: number;
  mana: number;
  maxHealth: number;
  maxMana: number;
  kills: number;
  wave: number;
  cellQ: number;
  cellR: number;
  castMode: SpellId | null;
  cooldowns: Record<SpellId, number>;
  spells: Record<SpellId, SpellConfig>;
  cursedEnergy: number;
  groundPhase: GroundCellPhase;
  cooldownRecoveryMultiplier: number;
  energyRecoveryMultiplier: number;
  chargedRemainingSeconds: number;
  curseProgress: number;
  rewardFeedbackVisible: boolean;
  gameOver: boolean;
  paused: boolean;
  upgradeStacks: UpgradeStacks;
  shield: ShieldSnapshot;
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
  private cursedEnergy: HTMLElement;
  private cursedCurrencyRow: HTMLElement;
  private upgradeSummary: HTMLElement;
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
        <div class="hud__cell"><i></i><span data-cell>Hex 0, 0</span></div>
        <div class="hud__line"><strong data-wave>1</strong><span>Wave</span></div>
        <div class="hud__line"><strong data-kills>0</strong><span>Kills</span></div>
      </div>
    `);
    const abilities = this.createContent(`
      <div class="hud__abilities">
        <button class="ability" data-ability="chain" type="button" aria-label="Chain Lightning">
          <i class="ability__cooldown-fill" aria-hidden="true"></i>
          <i class="ability__cooldown-hand" aria-hidden="true"></i>
          <b class="ability__key">Q</b>
          <i class="ability__icon ability__icon--chain"></i>
          <span class="ability__name">Chain</span>
          <em class="ability__cooldown"></em>
        </button>
        <button class="ability" data-ability="bolt" type="button" aria-label="Lightning Bolt">
          <i class="ability__cooldown-fill" aria-hidden="true"></i>
          <i class="ability__cooldown-hand" aria-hidden="true"></i>
          <b class="ability__key">W</b>
          <i class="ability__icon ability__icon--bolt"></i>
          <span class="ability__name">Bolt</span>
          <em class="ability__cooldown"></em>
        </button>
      </div>
    `);
    const currencies = this.createContent(`
      <div class="hud__currencies">
        <div class="hud__upgrade-summary" data-upgrade-summary hidden></div>
        <div class="hud__currency hud__currency--cursed" data-currency="cursed" aria-label="Cursed Energy">
          <i class="hud__currency-icon" aria-hidden="true"></i>
          <span>Cursed Energy</span>
          <strong data-cursed-energy>0</strong>
        </div>
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
        viewportY: 0.84,
        mobile: { anchor: "viewport", width: 230, viewportX: 0.5, viewportY: 0.84 },
      },
      className: "hud-window hud-window--vitals hud-window--minimal",
      lockable: true,
      locked: true,
    });
    const statusWindow = windowManager.createWindow({
      id: "hud-status",
      title: "Status",
      content: status,
      placement: { anchor: "top-center", width: 360, offsetY: 52, mobile: { anchor: "top-center", width: 360, offsetY: 188 } },
      className: "hud-window hud-window--status hud-window--minimal",
      lockable: true,
      locked: true,
    });
    const gameWindow = windowManager.createWindow({
      id: "hud-position",
      title: "Game",
      content: game,
      placement: { anchor: "top-right", width: 180, offsetX: 18, offsetY: 72, mobile: { anchor: "top-right", width: 180, offsetX: 14, offsetY: 72 } },
      className: "hud-window hud-window--game hud-window--minimal",
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
    const currenciesWindow = windowManager.createWindow({
      id: "hud-currencies",
      title: "Currencies",
      content: currencies,
      placement: {
        anchor: "bottom-left",
        width: 190,
        offsetX: 18,
        offsetY: 18,
        mobile: { anchor: "bottom-left", width: 180, offsetX: 14, offsetY: 14 },
      },
      className: "hud-window hud-window--currencies hud-window--minimal",
      lockable: true,
      locked: true,
      resizeAnchor: "bottom",
    });

    this.windows.push(vitalsWindow, statusWindow, gameWindow, abilitiesWindow, currenciesWindow);
    this.hoverRevealWindows.push(vitalsWindow, statusWindow, gameWindow, abilitiesWindow, currenciesWindow);
    window.addEventListener("pointermove", this.handleHoverRevealPointerMove);

    this.healthFill = mustQuery(stats, "[data-health-fill]");
    this.manaFill = mustQuery(stats, "[data-mana-fill]");
    this.kills = mustQuery(game, "[data-kills]");
    this.wave = mustQuery(game, "[data-wave]");
    this.cell = mustQuery(game, "[data-cell]");
    this.status = status;
    this.cursedEnergy = mustQuery(currencies, "[data-cursed-energy]");
    this.cursedCurrencyRow = mustQuery(currencies, '[data-currency="cursed"]');
    this.upgradeSummary = mustQuery(currencies, "[data-upgrade-summary]");
    this.chainButton = mustQuery(abilities, '[data-ability="chain"]');
    this.boltButton = mustQuery(abilities, '[data-ability="bolt"]');
  }

  update(state: HudState) {
    this.healthFill.style.transform = `scaleX(${clamp(state.health / state.maxHealth, 0, 1)})`;
    this.manaFill.style.transform = `scaleX(${clamp(state.mana / state.maxMana, 0, 1)})`;
    this.kills.textContent = `${state.kills}`;
    this.wave.textContent = `${state.wave}`;
    this.cell.textContent = `Hex ${state.cellQ}, ${state.cellR}`;
    this.cursedEnergy.textContent = `${state.cursedEnergy}`;
    this.cursedCurrencyRow.classList.toggle("hud__currency--gained", state.rewardFeedbackVisible);
    this.updateUpgradeSummary(state.upgradeStacks, state.shield);

    if (state.gameOver) {
      this.status.textContent = "Storm spent. Press R.";
    } else if (state.paused) {
      this.status.textContent = "Paused";
    } else if (state.castMode) {
      this.status.textContent = state.spells[state.castMode].label;
    } else if (state.rewardFeedbackVisible) {
      this.status.textContent = "+1 Cursed Energy";
    } else if (state.groundPhase === "cursed") {
      this.status.textContent = `Cleansing Curse · ${Math.round(state.curseProgress * 100)}%`;
    } else if (state.groundPhase === "charged" && state.cooldownRecoveryMultiplier > 1) {
      this.status.textContent = `Charged Ground · Cooldowns + Power ×${state.cooldownRecoveryMultiplier.toFixed(2)} · ${state.chargedRemainingSeconds.toFixed(1)}s`;
    } else {
      this.status.textContent = "";
    }

    this.updateAbility(this.chainButton, "chain", state);
    this.updateAbility(this.boltButton, "bolt", state);
    this.chainButton.classList.toggle("ability--accelerated", state.cooldownRecoveryMultiplier > 1);
    this.boltButton.classList.toggle("ability--accelerated", state.cooldownRecoveryMultiplier > 1);
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
    const cooldownRatio = clamp(cooldown / spell.cooldown, 0, 1);
    const cooldownLabel = mustQuery(button, ".ability__cooldown");

    button.style.setProperty("--cooldown-angle", `${cooldownRatio * 360}deg`);
    button.style.setProperty("--cooldown-progress", `${cooldownRatio}`);
    button.classList.toggle("ability--ready", ready);
    button.classList.toggle("ability--active", state.castMode === spellId);
    button.classList.toggle("ability--cooling", cooldown > 0);
    cooldownLabel.textContent = cooldown > 0 ? `${Math.ceil(cooldown)}` : "";
  }

  private updateUpgradeSummary(stacks: UpgradeStacks, shield: ShieldSnapshot) {
    const active = Object.entries(stacks).filter(([, count]) => count > 0) as [keyof UpgradeStacks, number][];
    this.upgradeSummary.hidden = active.length === 0;
    this.upgradeSummary.replaceChildren();
    for (const [id, count] of active) {
      const item = document.createElement("span");
      item.textContent = `${UPGRADE_CATALOG[id].label}${count > 1 ? ` ×${count}` : ""}`;
      item.title = UPGRADE_CATALOG[id].effectLabel;
      this.upgradeSummary.append(item);
    }
    if (shield.owned) {
      const shieldStatus = document.createElement("strong");
      shieldStatus.dataset.shieldStatus = "";
      shieldStatus.textContent = shield.ready ? "Shield ready" : `Shield ${Math.ceil(shield.rechargeRemainingSeconds)}s`;
      this.upgradeSummary.append(shieldStatus);
    }
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
