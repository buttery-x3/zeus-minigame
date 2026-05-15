import type { ProfilerSnapshot } from "../game/perf/Profiler";
import type { EnemyHealthBarVisibilityMode } from "../types";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { Hud } from "./Hud";
import { PauseMenu } from "./PauseMenu";
import { UiToolbar } from "./UiToolbar";
import { WindowManager } from "./window/WindowManager";

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
};

export class GameUi {
  readonly manager = new WindowManager();
  readonly hud = new Hud(this.manager);

  private readonly toolbar: UiToolbar;
  private readonly pauseMenu: PauseMenu;
  private readonly diagnostics: DiagnosticsPanel;

  constructor(callbacks: GameUiCallbacks) {
    this.toolbar = new UiToolbar({
      togglePause: callbacks.togglePause,
      toggleDiagnostics: () => this.toggleDiagnostics(),
    });
    this.manager.root.append(this.toolbar.element);

    this.diagnostics = new DiagnosticsPanel(this.manager, () => this.toolbar.setDiagnosticsOpen(false));
    this.pauseMenu = new PauseMenu(
      this.manager,
      {
        resume: callbacks.resume,
        toggleDiagnostics: () => this.toggleDiagnostics(),
        setEnemyHealthBarMode: callbacks.setEnemyHealthBarMode,
        setQuickCastEnabled: callbacks.setQuickCastEnabled,
        setAllowMaxRangeTargetSnap: callbacks.setAllowMaxRangeTargetSnap,
        setUnlockUiEnabled: callbacks.setUnlockUiEnabled,
      },
      callbacks.enemyHealthBarMode,
      callbacks.quickCastEnabled,
      callbacks.allowMaxRangeTargetSnap,
      callbacks.unlockUiEnabled,
    );
    this.setUnlockUiEnabled(callbacks.unlockUiEnabled);
  }

  setPaused(paused: boolean) {
    this.pauseMenu.setOpen(paused);
    this.toolbar.setPaused(paused);
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
