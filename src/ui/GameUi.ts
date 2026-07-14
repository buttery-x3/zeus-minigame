import type { ProfilerSnapshot } from "../game/perf/Profiler";
import type { EnemyHealthBarVisibilityMode } from "../types";
import type { AudioPreferences } from "../game/audio/AudioPreferences";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { Hud } from "./Hud";
import { PauseMenu } from "./PauseMenu";
import { UiToolbar } from "./UiToolbar";
import { UpgradeChoiceMenu } from "./UpgradeChoiceMenu";
import { WindowManager } from "./window/WindowManager";
import type { UpgradeId, UpgradeOfferSnapshot, UpgradeStacks } from "../game/upgrades/upgradeTypes";

type GameUiCallbacks = {
  resume: () => void;
  togglePause: () => void;
  enemyHealthBarMode: EnemyHealthBarVisibilityMode;
  setEnemyHealthBarMode: (mode: EnemyHealthBarVisibilityMode) => void;
  quickCastEnabled: boolean;
  setQuickCastEnabled: (enabled: boolean) => void;
  allowMaxRangeTargetSnap: boolean;
  setAllowMaxRangeTargetSnap: (enabled: boolean) => void;
  unlockUiEnabled: boolean;
  setUnlockUiEnabled: (enabled: boolean) => void;
  terrainDebugMode: boolean;
  setTerrainDebugMode: (enabled: boolean) => void;
  audioPreferences: AudioPreferences;
  setSfxVolume: (volume: number) => void;
  setBgmVolume: (volume: number) => void;
  setSpellFailureEnabled: (enabled: boolean) => void;
  chooseUpgrade: (upgradeId: UpgradeId) => void;
  skipUpgrade: () => void;
};

export class GameUi {
  readonly manager = new WindowManager();
  readonly hud = new Hud(this.manager);

  private readonly toolbar: UiToolbar;
  private readonly pauseMenu: PauseMenu;
  private readonly diagnostics: DiagnosticsPanel;
  private readonly upgradeChoice: UpgradeChoiceMenu;

  constructor(callbacks: GameUiCallbacks) {
    this.toolbar = new UiToolbar({
      togglePause: callbacks.togglePause,
      toggleDiagnostics: () => this.toggleDiagnostics(),
    });
    this.manager.root.append(this.toolbar.element);

    this.diagnostics = new DiagnosticsPanel(this.manager, () => this.toolbar.setDiagnosticsOpen(false));
    this.upgradeChoice = new UpgradeChoiceMenu(this.manager, {
      choose: callbacks.chooseUpgrade,
      skip: callbacks.skipUpgrade,
    });
    this.pauseMenu = new PauseMenu(
      this.manager,
      {
        resume: callbacks.resume,
        toggleDiagnostics: () => this.toggleDiagnostics(),
        setEnemyHealthBarMode: callbacks.setEnemyHealthBarMode,
        setQuickCastEnabled: callbacks.setQuickCastEnabled,
        setAllowMaxRangeTargetSnap: callbacks.setAllowMaxRangeTargetSnap,
        setUnlockUiEnabled: callbacks.setUnlockUiEnabled,
        setTerrainDebugMode: callbacks.setTerrainDebugMode,
        setSfxVolume: callbacks.setSfxVolume,
        setBgmVolume: callbacks.setBgmVolume,
        setSpellFailureEnabled: callbacks.setSpellFailureEnabled,
      },
      callbacks.enemyHealthBarMode,
      callbacks.quickCastEnabled,
      callbacks.allowMaxRangeTargetSnap,
      callbacks.unlockUiEnabled,
      callbacks.terrainDebugMode,
      callbacks.audioPreferences,
    );
    this.setUnlockUiEnabled(callbacks.unlockUiEnabled);
  }

  setManualPaused(paused: boolean) {
    this.pauseMenu.setOpen(paused);
  }

  setSimulationPaused(paused: boolean, upgradeChoiceActive: boolean) {
    this.toolbar.setPaused(paused);
    this.toolbar.setPauseEnabled(!upgradeChoiceActive);
  }

  updateUpgradeChoice(offer: UpgradeOfferSnapshot | null, cursedEnergy: number, stacks: UpgradeStacks) {
    this.upgradeChoice.update(offer, cursedEnergy, stacks);
  }

  setEnemyHealthBarMode(mode: EnemyHealthBarVisibilityMode) {
    this.pauseMenu.setEnemyHealthBarMode(mode);
  }

  setQuickCastEnabled(enabled: boolean) {
    this.pauseMenu.setQuickCastEnabled(enabled);
  }

  setAllowMaxRangeTargetSnap(enabled: boolean) {
    this.pauseMenu.setAllowMaxRangeTargetSnap(enabled);
  }

  setUnlockUiEnabled(enabled: boolean) {
    this.hud.setUnlockUiEnabled(enabled);
    this.pauseMenu.setUnlockUiEnabled(enabled);
  }

  setTerrainDebugMode(enabled: boolean) {
    this.pauseMenu.setTerrainDebugMode(enabled);
  }

  setSfxVolume(volume: number) {
    this.pauseMenu.setSfxVolume(volume);
  }

  setBgmVolume(volume: number) {
    this.pauseMenu.setBgmVolume(volume);
  }

  setSpellFailureEnabled(enabled: boolean) {
    this.pauseMenu.setSpellFailureEnabled(enabled);
  }

  toggleDiagnostics() {
    this.diagnostics.toggle();
    this.toolbar.setDiagnosticsOpen(this.diagnostics.isOpen());
  }

  updateDiagnostics(snapshot: ProfilerSnapshot) {
    this.diagnostics.update(snapshot);
  }

  remove() {
    this.manager.remove();
  }
}
