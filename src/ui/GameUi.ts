import type { ProfilerSnapshot } from "../game/perf/Profiler";
import type { TerrainGenerationDiagnostics } from "./DiagnosticsPanel";
import type { EnemyHealthBarVisibilityMode } from "../types";
import type { AudioPreferences } from "../game/audio/AudioPreferences";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { Hud } from "./Hud";
import { PauseMenu } from "./PauseMenu";
import { UiToolbar } from "./UiToolbar";
import { UpgradeChoiceMenu } from "./UpgradeChoiceMenu";
import { WindowManager } from "./window/WindowManager";
import type { UpgradeId, UpgradeOfferSnapshot, UpgradeStacks } from "../game/upgrades/upgradeTypes";
import type { HudPanelId, HudPanelPositions, RenderMode } from "../game/preferences/GamePreferences";
import type { NormalizedWindowPosition } from "./window/types";
import type { NavigationDebugDiagnostics, NavigationDebugMode } from "../game/enemies/navigation/NavigationDebugTypes";
import type { PlayerNavigationDiagnostics } from "../game/player/PlayerController";

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
  renderMode: RenderMode;
  setRenderMode: (mode: RenderMode) => void;
  hudPanelPositions: HudPanelPositions;
  setHudPanelPosition: (id: HudPanelId, position: NormalizedWindowPosition) => void;
  terrainDebugMode: boolean;
  setTerrainDebugMode: (enabled: boolean) => void;
  navigationDebugMode: NavigationDebugMode;
  setNavigationDebugMode: (mode: NavigationDebugMode) => void;
  audioPreferences: AudioPreferences;
  setSfxVolume: (volume: number) => void;
  setBgmVolume: (volume: number) => void;
  setSpellFailureEnabled: (enabled: boolean) => void;
  chooseUpgrade: (upgradeId: UpgradeId) => void;
  skipUpgrade: () => void;
};

export class GameUi {
  readonly manager: WindowManager;
  readonly hud: Hud;

  private readonly toolbar: UiToolbar;
  private readonly pauseMenu: PauseMenu;
  private readonly diagnostics: DiagnosticsPanel;
  private readonly upgradeChoice: UpgradeChoiceMenu;

  constructor(callbacks: GameUiCallbacks) {
    this.manager = new WindowManager(callbacks.unlockUiEnabled);
    this.hud = new Hud(this.manager, callbacks.hudPanelPositions, callbacks.setHudPanelPosition);
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
        setRenderMode: callbacks.setRenderMode,
        setTerrainDebugMode: callbacks.setTerrainDebugMode,
        setNavigationDebugMode: callbacks.setNavigationDebugMode,
        setSfxVolume: callbacks.setSfxVolume,
        setBgmVolume: callbacks.setBgmVolume,
        setSpellFailureEnabled: callbacks.setSpellFailureEnabled,
      },
      callbacks.enemyHealthBarMode,
      callbacks.quickCastEnabled,
      callbacks.allowMaxRangeTargetSnap,
      callbacks.unlockUiEnabled,
      callbacks.renderMode,
      callbacks.terrainDebugMode,
      callbacks.navigationDebugMode,
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

  setRenderMode(mode: RenderMode) {
    this.pauseMenu.setRenderMode(mode);
  }

  setTerrainDebugMode(enabled: boolean) {
    this.pauseMenu.setTerrainDebugMode(enabled);
  }

  setNavigationDebugMode(mode: NavigationDebugMode) {
    this.pauseMenu.setNavigationDebugMode(mode);
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

  updateDiagnostics(
    snapshot: ProfilerSnapshot,
    getNavigationDebug: () => NavigationDebugDiagnostics,
    getPlayerNavigation: () => PlayerNavigationDiagnostics,
    getTerrainGeneration: () => TerrainGenerationDiagnostics,
  ) {
    this.diagnostics.update(snapshot, getNavigationDebug, getPlayerNavigation, getTerrainGeneration);
  }

  remove() {
    this.manager.remove();
  }
}
