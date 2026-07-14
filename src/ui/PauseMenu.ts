import type { EnemyHealthBarVisibilityMode } from "../types";
import { mustQuery } from "../lib/dom";
import type { AudioPreferences } from "../game/audio/AudioPreferences";
import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";

type PauseMenuCallbacks = {
  resume: () => void;
  toggleDiagnostics: () => void;
  setEnemyHealthBarMode: (mode: EnemyHealthBarVisibilityMode) => void;
  setQuickCastEnabled: (enabled: boolean) => void;
  setAllowMaxRangeTargetSnap: (enabled: boolean) => void;
  setUnlockUiEnabled: (enabled: boolean) => void;
  setTerrainDebugMode: (enabled: boolean) => void;
  setSfxVolume: (volume: number) => void;
  setBgmVolume: (volume: number) => void;
  setSpellFailureEnabled: (enabled: boolean) => void;
};

export class PauseMenu {
  private readonly window: GameWindow;
  private readonly healthModeButtons: HTMLButtonElement[];
  private readonly quickCastToggle: HTMLInputElement;
  private readonly maxRangeTargetSnapToggle: HTMLInputElement;
  private readonly unlockUiToggle: HTMLInputElement;
  private readonly terrainDebugToggle: HTMLInputElement;
  private readonly sfxVolumeSlider: HTMLInputElement;
  private readonly sfxVolumeOutput: HTMLOutputElement;
  private readonly bgmVolumeSlider: HTMLInputElement;
  private readonly bgmVolumeOutput: HTMLOutputElement;
  private readonly spellFailureToggle: HTMLInputElement;

  constructor(
    windowManager: WindowManager,
    callbacks: PauseMenuCallbacks,
    enemyHealthBarMode: EnemyHealthBarVisibilityMode,
    quickCastEnabled: boolean,
    allowMaxRangeTargetSnap: boolean,
    unlockUiEnabled: boolean,
    terrainDebugMode: boolean,
    audioPreferences: AudioPreferences,
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
      <div class="pause-menu__audio" aria-label="Audio settings">
        <label class="pause-menu__setting pause-menu__slider">
          <span>SFX Volume <output data-sfx-volume-output></output></span>
          <input type="range" min="0" max="100" step="1" data-sfx-volume aria-label="SFX volume" />
        </label>
        <label class="pause-menu__setting pause-menu__slider">
          <span>BGM Volume <output data-bgm-volume-output></output></span>
          <input type="range" min="0" max="100" step="1" data-bgm-volume aria-label="BGM volume" />
        </label>
        <label class="pause-menu__setting pause-menu__switch" data-spell-failure-sfx-toggle>
          <span>Spell-Failed SFX</span>
          <input type="checkbox" data-spell-failure-sfx aria-label="Spell-failed SFX" />
          <i aria-hidden="true"></i>
        </label>
      </div>
      <label class="pause-menu__setting pause-menu__switch" data-quick-cast-toggle>
        <span>Quick Cast</span>
        <input type="checkbox" data-quick-cast aria-label="Quick cast" />
        <i aria-hidden="true"></i>
      </label>
      <label class="pause-menu__setting pause-menu__switch" data-max-range-target-snap-toggle>
        <span>Allow Max Range Target Snap</span>
        <input type="checkbox" data-max-range-target-snap aria-label="Allow max range target snap" />
        <i aria-hidden="true"></i>
      </label>
      <label class="pause-menu__setting pause-menu__switch" data-unlock-ui-toggle>
        <span>Unlock UI</span>
        <input type="checkbox" data-unlock-ui aria-label="Unlock UI" />
        <i aria-hidden="true"></i>
      </label>
      <label class="pause-menu__setting pause-menu__switch" data-terrain-debug-toggle>
        <span>Terrain Debug</span>
        <input type="checkbox" data-terrain-debug aria-label="Terrain debug" />
        <i aria-hidden="true"></i>
      </label>
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

    this.sfxVolumeSlider = mustQuery<HTMLInputElement>(content, "[data-sfx-volume]");
    this.sfxVolumeOutput = mustQuery<HTMLOutputElement>(content, "[data-sfx-volume-output]");
    this.sfxVolumeSlider.addEventListener("input", () => {
      const volume = Number(this.sfxVolumeSlider.value) / 100;
      this.setSfxVolume(volume);
      callbacks.setSfxVolume(volume);
    });
    this.setSfxVolume(audioPreferences.sfxVolume);

    this.bgmVolumeSlider = mustQuery<HTMLInputElement>(content, "[data-bgm-volume]");
    this.bgmVolumeOutput = mustQuery<HTMLOutputElement>(content, "[data-bgm-volume-output]");
    this.bgmVolumeSlider.addEventListener("input", () => {
      const volume = Number(this.bgmVolumeSlider.value) / 100;
      this.setBgmVolume(volume);
      callbacks.setBgmVolume(volume);
    });
    this.setBgmVolume(audioPreferences.bgmVolume);

    this.spellFailureToggle = mustQuery<HTMLInputElement>(content, "[data-spell-failure-sfx]");
    this.spellFailureToggle.addEventListener("change", () => {
      this.setSpellFailureEnabled(this.spellFailureToggle.checked);
      callbacks.setSpellFailureEnabled(this.spellFailureToggle.checked);
    });
    this.setSpellFailureEnabled(audioPreferences.spellFailureEnabled);

    this.quickCastToggle = mustQuery<HTMLInputElement>(content, "[data-quick-cast]");
    this.quickCastToggle.addEventListener("change", () => {
      this.setQuickCastEnabled(this.quickCastToggle.checked);
      callbacks.setQuickCastEnabled(this.quickCastToggle.checked);
    });
    this.setQuickCastEnabled(quickCastEnabled);

    this.maxRangeTargetSnapToggle = mustQuery<HTMLInputElement>(content, "[data-max-range-target-snap]");
    this.maxRangeTargetSnapToggle.addEventListener("change", () => {
      this.setAllowMaxRangeTargetSnap(this.maxRangeTargetSnapToggle.checked);
      callbacks.setAllowMaxRangeTargetSnap(this.maxRangeTargetSnapToggle.checked);
    });
    this.setAllowMaxRangeTargetSnap(allowMaxRangeTargetSnap);

    this.unlockUiToggle = mustQuery<HTMLInputElement>(content, "[data-unlock-ui]");
    this.unlockUiToggle.addEventListener("change", () => {
      this.setUnlockUiEnabled(this.unlockUiToggle.checked);
      callbacks.setUnlockUiEnabled(this.unlockUiToggle.checked);
    });
    this.setUnlockUiEnabled(unlockUiEnabled);

    this.terrainDebugToggle = mustQuery<HTMLInputElement>(content, "[data-terrain-debug]");
    this.terrainDebugToggle.addEventListener("change", () => {
      this.setTerrainDebugMode(this.terrainDebugToggle.checked);
      callbacks.setTerrainDebugMode(this.terrainDebugToggle.checked);
    });
    this.setTerrainDebugMode(terrainDebugMode);

    this.window = windowManager.createWindow({
      id: "pause-menu",
      title: "Pause",
      content,
      placement: { anchor: "center", width: 380, offsetY: -20 },
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

  setQuickCastEnabled(enabled: boolean) {
    this.quickCastToggle.checked = enabled;
    this.quickCastToggle.closest(".pause-menu__switch")?.classList.toggle("pause-menu__switch--active", enabled);
  }

  setAllowMaxRangeTargetSnap(enabled: boolean) {
    this.maxRangeTargetSnapToggle.checked = enabled;
    this.maxRangeTargetSnapToggle.closest(".pause-menu__switch")?.classList.toggle("pause-menu__switch--active", enabled);
  }

  setUnlockUiEnabled(enabled: boolean) {
    this.unlockUiToggle.checked = enabled;
    this.unlockUiToggle.closest(".pause-menu__switch")?.classList.toggle("pause-menu__switch--active", enabled);
  }

  setTerrainDebugMode(enabled: boolean) {
    this.terrainDebugToggle.checked = enabled;
    this.terrainDebugToggle.closest(".pause-menu__switch")?.classList.toggle("pause-menu__switch--active", enabled);
  }

  setSfxVolume(volume: number) {
    const percent = Math.round(volume * 100);
    this.sfxVolumeSlider.value = String(percent);
    this.sfxVolumeOutput.value = `${percent}%`;
  }

  setBgmVolume(volume: number) {
    const percent = Math.round(volume * 100);
    this.bgmVolumeSlider.value = String(percent);
    this.bgmVolumeOutput.value = `${percent}%`;
  }

  setSpellFailureEnabled(enabled: boolean) {
    this.spellFailureToggle.checked = enabled;
    this.spellFailureToggle.closest(".pause-menu__switch")?.classList.toggle("pause-menu__switch--active", enabled);
  }
}
