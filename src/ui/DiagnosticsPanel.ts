import type { ProfilerSnapshot } from "../game/perf/Profiler";
import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";

const METRICS = [
  ["frameTotal", "Frame"],
  ["gameLogic", "Game"],
  ["render", "Render"],
  ["camera", "Camera"],
  ["terrain", "Terrain"],
  ["targeting", "Targeting"],
  ["hud", "HUD"],
  ["player", "Player"],
  ["enemies", "Enemies"],
  ["spawning", "Spawning"],
  ["effects", "Effects"],
] as const;

export class DiagnosticsPanel {
  private readonly window: GameWindow;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly fpsValue: HTMLElement;
  private readonly pathValue: HTMLElement;
  private readonly flowValue: HTMLElement;
  private readonly modesValue: HTMLElement;
  private nextUpdateAt = 0;

  constructor(windowManager: WindowManager, onClose: () => void) {
    const content = document.createElement("div");
    content.className = "diagnostics";
    content.innerHTML = `
      <div class="diagnostics__hero"><span data-fps>0</span><small>FPS</small></div>
      <table class="diagnostics__table"><tbody></tbody></table>
      <div class="diagnostics__path" data-path></div>
      <div class="diagnostics__path" data-flow></div>
      <div class="diagnostics__path" data-modes></div>
    `;

    const body = content.querySelector("tbody");
    for (const [, label] of METRICS) {
      const row = document.createElement("tr");
      row.innerHTML = `<th>${label}</th><td>0.00</td>`;
      body?.append(row);
      this.rows.set(label, row.querySelector("td") as HTMLElement);
    }

    this.fpsValue = content.querySelector("[data-fps]") as HTMLElement;
    this.pathValue = content.querySelector("[data-path]") as HTMLElement;
    this.flowValue = content.querySelector("[data-flow]") as HTMLElement;
    this.modesValue = content.querySelector("[data-modes]") as HTMLElement;
    this.window = windowManager.createWindow({
      id: "diagnostics",
      title: "Diagnostics",
      content,
      placement: { anchor: "top-right", width: 300, offsetX: 18, offsetY: 128 },
      className: "diagnostics-window",
      closable: true,
      lockable: true,
      locked: false,
      hidden: true,
      onClose,
    });
  }

  toggle() {
    this.setOpen(!this.window.isVisible());
  }

  setOpen(open: boolean) {
    this.window.setVisible(open);
  }

  isOpen() {
    return this.window.isVisible();
  }

  update(snapshot: ProfilerSnapshot) {
    if (!this.window.isVisible() || performance.now() < this.nextUpdateAt) {
      return;
    }
    this.nextUpdateAt = performance.now() + 120;
    this.fpsValue.textContent = `${Math.round(snapshot.fps)}`;

    for (const [key, label] of METRICS) {
      const metric = snapshot.metrics[key];
      const row = this.rows.get(label);
      if (metric && row) {
        row.textContent = `${metric.avg.toFixed(2)} ms`;
      }
    }

    const path = snapshot.pathfinding;
    const nav = snapshot.enemyNavigation;
    this.pathValue.textContent = `Path ${path.calls} calls, ${path.totalMs.toFixed(2)} ms, avg ${path.avgMs.toFixed(2)}, max ${path.maxMs.toFixed(2)}, iter ${path.iterations}/${path.maxIterations}`;
    this.flowValue.textContent = `Flow ${nav.flowVisited} cells, rebuild ${nav.flowRebuildMs.toFixed(2)} ms, radius ${nav.flowRadius}, queue ${nav.queueLength}, solved ${nav.queueSolved}, budget ${nav.queueUsedMs.toFixed(2)}/${nav.queueBudgetMs.toFixed(2)} ms`;
    this.modesValue.textContent = `Modes direct ${nav.direct}, flow ${nav.flow}, acquire ${nav.acquire}, fallback ${nav.fallback}, wait ${nav.waiting}`;
  }
}
