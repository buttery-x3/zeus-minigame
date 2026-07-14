import { UPGRADE_CATALOG } from "../game/upgrades/upgradeCatalog";
import type { UpgradeId, UpgradeOfferSnapshot, UpgradeStacks } from "../game/upgrades/upgradeTypes";
import { mustQuery } from "../lib/dom";
import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";

type UpgradeChoiceCallbacks = {
  choose: (upgradeId: UpgradeId) => void;
  skip: () => void;
};

export class UpgradeChoiceMenu {
  private readonly window: GameWindow;
  private readonly cards: HTMLElement;
  private readonly energy: HTMLElement;
  private readonly timerFill: HTMLElement;
  private readonly timerLabel: HTMLElement;
  private offerKey = "";
  private open = false;

  constructor(
    windowManager: WindowManager,
    private readonly callbacks: UpgradeChoiceCallbacks,
  ) {
    const content = document.createElement("div");
    content.className = "upgrade-choice";
    content.innerHTML = `
      <div class="upgrade-choice__heading">
        <p>Curse cleansed</p>
        <h2>Claim the storm's power</h2>
        <span>Spend now, or preserve your Cursed Energy for a future offering.</span>
      </div>
      <div class="upgrade-choice__energy" aria-label="Available Cursed Energy">
        <i aria-hidden="true"></i>
        <span>Cursed Energy</span>
        <strong data-upgrade-energy>0</strong>
      </div>
      <div class="upgrade-choice__cards" data-upgrade-cards></div>
      <div class="upgrade-choice__timer" aria-label="Time remaining">
        <div><span data-upgrade-timer-fill></span></div>
        <strong data-upgrade-timer-label>10.0s</strong>
      </div>
      <button class="upgrade-choice__skip" type="button" data-upgrade-skip>Save Energy</button>
    `;

    this.cards = mustQuery(content, "[data-upgrade-cards]");
    this.energy = mustQuery(content, "[data-upgrade-energy]");
    this.timerFill = mustQuery(content, "[data-upgrade-timer-fill]");
    this.timerLabel = mustQuery(content, "[data-upgrade-timer-label]");
    mustQuery<HTMLButtonElement>(content, "[data-upgrade-skip]").addEventListener("click", callbacks.skip);

    this.window = windowManager.createWindow({
      id: "upgrade-choice",
      title: "Cursed Offering",
      content,
      placement: { anchor: "top-center", width: 900, offsetY: 54 },
      className: "upgrade-choice-window",
      movable: false,
      closable: false,
      lockable: false,
      modal: true,
      hidden: true,
    });
  }

  update(offer: UpgradeOfferSnapshot | null, cursedEnergy: number, stacks: UpgradeStacks) {
    const shouldOpen = offer !== null;
    if (shouldOpen !== this.open) {
      this.open = shouldOpen;
      this.window.setVisible(shouldOpen);
    }
    if (!offer) {
      this.offerKey = "";
      return;
    }

    this.energy.textContent = `${cursedEnergy}`;
    this.timerFill.style.transform = `scaleX(${offer.progress})`;
    this.timerLabel.textContent = `${offer.remainingSeconds.toFixed(1)}s`;

    const nextOfferKey = offer.cards.map((card) => `${card.id}:${card.cost}`).join("|");
    if (nextOfferKey !== this.offerKey) {
      this.offerKey = nextOfferKey;
      this.renderCards(offer, cursedEnergy, stacks);
      return;
    }

    for (const button of this.cards.querySelectorAll<HTMLButtonElement>("[data-upgrade-id]")) {
      const cost = Number(button.dataset.upgradeCost);
      const affordable = cursedEnergy >= cost;
      button.disabled = !affordable;
      button.setAttribute("aria-disabled", String(!affordable));
    }
  }

  private renderCards(offer: UpgradeOfferSnapshot, cursedEnergy: number, stacks: UpgradeStacks) {
    this.cards.replaceChildren();
    for (const card of offer.cards) {
      const definition = UPGRADE_CATALOG[card.id];
      const button = document.createElement("button");
      button.className = "upgrade-card";
      button.type = "button";
      button.dataset.upgradeId = card.id;
      button.dataset.upgradeCost = `${card.cost}`;
      button.innerHTML = `
        <span class="upgrade-card__cost"><i aria-hidden="true"></i><strong>${card.cost}</strong></span>
        <span class="upgrade-card__art upgrade-card__art--${card.id}" aria-hidden="true"><i></i></span>
        <span class="upgrade-card__title">${definition.label}</span>
        <span class="upgrade-card__effect">${definition.effectLabel}</span>
        <span class="upgrade-card__description">${definition.description}</span>
        <span class="upgrade-card__stack">${stacks[card.id] > 0 ? `Current stack ${stacks[card.id]}` : "New upgrade"}</span>
      `;
      const affordable = cursedEnergy >= card.cost;
      button.disabled = !affordable;
      button.setAttribute("aria-disabled", String(!affordable));
      button.setAttribute("aria-label", `${definition.label}, costs ${card.cost} Cursed Energy`);
      button.addEventListener("click", () => this.callbacks.choose(card.id));
      this.cards.append(button);
    }
  }
}
