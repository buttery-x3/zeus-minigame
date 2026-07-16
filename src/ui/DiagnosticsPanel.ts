import type { ProfilerSnapshot } from "../game/perf/Profiler";
import type { GameWindow } from "./window/GameWindow";
import type { WindowManager } from "./window/WindowManager";
import type { NavigationDebugDiagnostics } from "../game/enemies/navigation/NavigationDebugTypes";
import type { PlayerNavigationDiagnostics } from "../game/player/PlayerController";

const METRICS = [
  ["frameTotal", "Frame"],
  ["gameLogic", "Game"],
  ["render", "Render"],
  ["camera", "Camera"],
  ["lighting", "Lighting"],
  ["terrainGeneration", "Terrain Gen"],
  ["terrainPreparation", "Terrain Prep"],
  ["terrain", "Terrain"],
  ["targeting", "Targeting"],
  ["hud", "HUD"],
  ["player", "Player"],
  ["navigation", "Navigation"],
  ["navigationDebug", "Nav Debug"],
  ["enemies", "Enemies"],
  ["spawning", "Spawning"],
  ["effects", "Effects"],
] as const;

export type TerrainGenerationDiagnostics = {
  wfc?: {
    generatedLastEnsure: number;
    generationPatchBudget: number | null;
    generationLastDurationMs: number;
    generationMaxDurationMs: number;
    patchGenerationLastDurationMs: number;
    patchGenerationMaxDurationMs: number;
    topologyEvaluationCount: number;
    synthesisDurationMs: number;
  };
};

export class DiagnosticsPanel {
  private readonly window: GameWindow;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly fpsValue: HTMLElement;
  private readonly pathValue: HTMLElement;
  private readonly flowValue: HTMLElement;
  private readonly modesValue: HTMLElement;
  private readonly schedulerValue: HTMLElement;
  private readonly playerNavigationValue: HTMLElement;
  private readonly framePacingValue: HTMLElement;
  private readonly memoryValue: HTMLElement;
  private readonly resourcesValue: HTMLElement;
  private readonly terrainGenerationValue: HTMLElement;
  private readonly navigationDebugValue: HTMLElement;
  private readonly navigationDebugLegend: HTMLElement;
  private nextUpdateAt = 0;

  constructor(windowManager: WindowManager, onClose: () => void) {
    const content = document.createElement("div");
    content.className = "diagnostics";
    content.innerHTML = `
      <div class="diagnostics__hero"><span data-fps>0</span><small>FPS</small></div>
      <table class="diagnostics__table"><tbody></tbody></table>
      <div class="diagnostics__path" data-path></div>
      <div class="diagnostics__path" data-flow></div>
      <div class="diagnostics__path" data-scheduler></div>
      <div class="diagnostics__path" data-player-navigation></div>
      <div class="diagnostics__path" data-modes></div>
      <div class="diagnostics__path" data-frame-pacing></div>
      <div class="diagnostics__path" data-memory></div>
      <div class="diagnostics__path" data-resources></div>
      <div class="diagnostics__path" data-terrain-generation></div>
      <div class="diagnostics__path" data-navigation-debug></div>
      <div class="diagnostics__path" data-navigation-debug-legend hidden></div>
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
    this.schedulerValue = content.querySelector("[data-scheduler]") as HTMLElement;
    this.playerNavigationValue = content.querySelector("[data-player-navigation]") as HTMLElement;
    this.modesValue = content.querySelector("[data-modes]") as HTMLElement;
    this.framePacingValue = content.querySelector("[data-frame-pacing]") as HTMLElement;
    this.memoryValue = content.querySelector("[data-memory]") as HTMLElement;
    this.resourcesValue = content.querySelector("[data-resources]") as HTMLElement;
    this.terrainGenerationValue = content.querySelector("[data-terrain-generation]") as HTMLElement;
    this.navigationDebugValue = content.querySelector("[data-navigation-debug]") as HTMLElement;
    this.navigationDebugLegend = content.querySelector("[data-navigation-debug-legend]") as HTMLElement;
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

  update(
    snapshot: ProfilerSnapshot,
    getNavigationDebug: () => NavigationDebugDiagnostics,
    getPlayerNavigation: () => PlayerNavigationDiagnostics,
    getTerrainGeneration: () => TerrainGenerationDiagnostics,
  ) {
    if (!this.window.isVisible() || performance.now() < this.nextUpdateAt) {
      return;
    }
    this.nextUpdateAt = performance.now() + 120;
    this.fpsValue.textContent = `${Math.round(snapshot.fps)}`;

    for (const [key, label] of METRICS) {
      const metric = snapshot.metrics[key];
      const row = this.rows.get(label);
      if (metric && row) {
        row.textContent = key === "terrainGeneration"
          ? `${metric.avg.toFixed(2)} ms · max ${metric.max.toFixed(2)}`
          : `${metric.avg.toFixed(2)} ms`;
      }
    }

    const path = snapshot.pathfinding;
    const nav = snapshot.enemyNavigation;
    const scheduler = snapshot.navigationScheduler;
    this.pathValue.textContent = `Path ${path.calls} calls, ${path.totalMs.toFixed(2)} ms, avg ${path.avgMs.toFixed(2)}, max ${path.maxMs.toFixed(2)}, iter ${path.iterations}/${path.maxIterations}`;
    this.flowValue.textContent = `Flow ${nav.flowVisited} cells, slice ${nav.flowSliceMs.toFixed(2)} ms, total ${nav.flowRebuildMs.toFixed(2)} ms, build ${nav.flowBuilding ? nav.flowBuildVisited : "idle"}, lag ${nav.flowRootLag}, queue ${nav.queueLength}`;
    this.schedulerValue.textContent = `Nav ${scheduler.usedMs.toFixed(2)}/${scheduler.budgetMs.toFixed(2)} ms, max slice ${scheduler.maxSliceMs.toFixed(2)}, over ${scheduler.overshootMs.toFixed(2)}, work P${scheduler.slices.player}/F${scheduler.slices.flow}/E${scheduler.slices.fallback}`;
    const playerNavigation = getPlayerNavigation();
    const activePlayerRoute = playerNavigation.pathJob;
    const lastPlayerRoute = playerNavigation.lastRouteResult;
    this.playerNavigationValue.textContent = activePlayerRoute
      ? `Player route ${activePlayerRoute.stage}, d${playerNavigation.activePathGoalDistance}, slices ${playerNavigation.activePathSlices}, iter ${activePlayerRoute.iterations}, pending ${playerNavigation.pendingPath ? "yes" : "no"}`
      : `Player route idle, applied ${playerNavigation.appliedRoutes}, superseded ${playerNavigation.supersededRoutes}, failed ${playerNavigation.failedRoutes}${lastPlayerRoute ? `, last ${lastPlayerRoute.application}/${lastPlayerRoute.completionReason} ${lastPlayerRoute.latencyMs.toFixed(1)} ms` : ""}`;
    this.modesValue.textContent = `Modes direct ${nav.direct}, flow ${nav.flow}, acquire ${nav.acquire}, fallback ${nav.fallback}, wait ${nav.waiting}`;
    const pacing = snapshot.framePacing;
    this.framePacingValue.textContent = `Frame Δ ${pacing.lastDeltaMs.toFixed(1)} ms, CPU ${pacing.lastCpuMs.toFixed(1)}, p95 ${pacing.p95DeltaMs.toFixed(0)}, p99 ${pacing.p99DeltaMs.toFixed(0)}, max ${pacing.maxDeltaMs.toFixed(1)}, >20/33/50 ${pacing.above20Ms}/${pacing.above33Ms}/${pacing.above50Ms}, missed@60 ${pacing.missedVsyncs}`;
    const memory = snapshot.memory;
    this.memoryValue.textContent = memory.heapSupported
      ? `Heap ~${memory.usedHeapMb?.toFixed(1)}/${memory.allocatedHeapMb?.toFixed(1)} MB, high ${memory.highWaterHeapMb?.toFixed(1)}, trend ${formatSigned(memory.heapGrowthMbPerMinute)} MB/min, GC? ${memory.probableGcPauses}`
      : "Heap unavailable in this browser";
    const resources = memory.resources;
    this.resourcesValue.textContent = `Resources geo ${resources.geometries}, tex ${resources.textures}, prog ${resources.programs}, objects ${resources.sceneObjects}, cells ${resources.terrainCells}, enemies ${resources.enemies}, FX ${resources.effects}`;
    const terrainGeneration = getTerrainGeneration().wfc;
    this.terrainGenerationValue.textContent = terrainGeneration
      ? `Terrain gen patch ${terrainGeneration.patchGenerationLastDurationMs.toFixed(2)} ms, max ${terrainGeneration.patchGenerationMaxDurationMs.toFixed(2)}, ensure ${terrainGeneration.generationLastDurationMs.toFixed(2)} ms/${terrainGeneration.generatedLastEnsure} patches, budget ${terrainGeneration.generationPatchBudget ?? "∞"}, topo ${terrainGeneration.topologyEvaluationCount}, synth ${terrainGeneration.synthesisDurationMs.toFixed(2)} ms`
      : "Terrain generation unavailable";
    const debug = getNavigationDebug();
    const stalled = debug.stalled
      .map((enemy) => `#${enemy.id} ${enemy.mode} ${enemy.collision} ${enemy.stationaryMs.toFixed(0)}ms p${enemy.pathLength}${enemy.pathQueued ? "q" : ""}`)
      .join(" · ");
    this.navigationDebugValue.textContent = `Debug ${debug.mode}, shown ${debug.displayedEnemies}/${debug.trackedEnemies}, latched ${debug.latchedEnemies}, lines ${debug.renderedSegments}/${debug.segmentCapacity}${stalled ? ` — ${stalled}` : ""}`;
    const fallbacks = debug.fallbacks;
    if (fallbacks) {
      const fallbackStates = fallbacks.states
        .map((state) => `#${state.id} ${state.source} g${state.goalCell.q},${state.goalCell.r} ${state.ageSeconds.toFixed(1)}s`)
        .join(" · ");
      this.navigationDebugValue.textContent += `, fallback ${fallbacks.active} q${fallbacks.queued} oldest ${fallbacks.oldestQueuedSeconds.toFixed(1)}s${!stalled && fallbackStates ? ` | ${fallbackStates}` : ""}`;
    }
    this.navigationDebugLegend.hidden = debug.mode === "off";
    this.navigationDebugLegend.textContent = "Vectors cyan target · blue desired · magenta avoidance · green moved · red rejected · orange path";
  }
}

function formatSigned(value: number | null) {
  if (value === null) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
