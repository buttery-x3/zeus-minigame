import type { EnemyNavigationMode } from "../../../types";

export type NavigationDebugMode = "off" | "stalled" | "all";
export type CollisionMoveResolution = "full" | "x" | "z" | "rejected";

export type StalledEnemyDiagnostics = {
  id: number;
  mode: EnemyNavigationMode;
  cell: { q: number; r: number };
  stationaryMs: number;
  stallTimerMs: number;
  pathQueued: boolean;
  pathLength: number;
  collision: CollisionMoveResolution;
};

export type NavigationDebugDiagnostics = {
  mode: NavigationDebugMode;
  trackedEnemies: number;
  latchedEnemies: number;
  displayedEnemies: number;
  renderedSegments: number;
  segmentCapacity: number;
  stalled: StalledEnemyDiagnostics[];
};
