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
      },
      callbacks.enemyHealthBarMode,
    );
  }

  setPaused(paused: boolean) {
    this.pauseMenu.setOpen(paused);
    this.toolbar.setPaused(paused);
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
