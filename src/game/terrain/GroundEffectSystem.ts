import {
  CHARGED_GROUND_CAPACITY_SECONDS,
  CHARGED_GROUND_RECOVERY_MULTIPLIER,
  CURSED_GROUND_CLEANSE_SECONDS,
  CURSED_GROUND_REWARD,
} from "../../config";
import { clamp } from "../../lib/math";
import type { TerrainCell, TerrainSurface } from "../../types";
import type { GridWorld, HexCoord } from "../../world/GridWorld";

export type GroundCellPhase = "normal" | "charged" | "depleted" | "cursed" | "cleansed";

export type GroundCellVisualState = {
  phase: GroundCellPhase;
  displaySurface: TerrainSurface;
  progress: number;
};

export type GroundEffectSnapshot = {
  cell: HexCoord;
  surface: TerrainSurface;
  phase: GroundCellPhase;
  cooldownRecoveryMultiplier: number;
  energyRecoveryMultiplier: number;
  chargedRemainingSeconds: number;
  chargedProgress: number;
  curseProgress: number;
  rewardFeedbackVisible: boolean;
  cleansedCount: number;
  depletedCount: number;
};

type GroundEffectCallbacks = {
  onCursedCleared: (cell: HexCoord, reward: number) => void;
  onSpecialTileInteractionStarted: (surface: "charged" | "cursed", cell: HexCoord) => void;
  onSpecialTileInteractionStopped: (surface: "charged" | "cursed", cell: HexCoord) => void;
};

const REWARD_FEEDBACK_SECONDS = 1.6;

export class GroundEffectSystem {
  private readonly chargedUsage = new Map<string, number>();
  private readonly cleansedCurses = new Set<string>();
  private currentCurseKey: string | null = null;
  private currentCurseProgress = 0;
  private currentInteraction: { key: string; surface: "charged" | "cursed"; cell: HexCoord } | null = null;
  private stateVersion = 0;
  private rewardFeedbackSeconds = 0;
  private snapshot: GroundEffectSnapshot = {
    cell: { q: 0, r: 0 },
    surface: "grass",
    phase: "normal",
    cooldownRecoveryMultiplier: 1,
    energyRecoveryMultiplier: 1,
    chargedRemainingSeconds: 0,
    chargedProgress: 0,
    curseProgress: 0,
    rewardFeedbackVisible: false,
    cleansedCount: 0,
    depletedCount: 0,
  };

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly callbacks: GroundEffectCallbacks,
  ) {}

  update(dt: number, playerCell: HexCoord) {
    this.rewardFeedbackSeconds = Math.max(0, this.rewardFeedbackSeconds - dt);
    const cell = playerCell;
    const terrain = this.gridWorld.getCell(cell.q, cell.r);
    const key = this.gridWorld.cellKey(cell.q, cell.r);
    let cooldownRecoveryMultiplier = 1;
    let energyRecoveryMultiplier = 1;
    let activeInteraction: { key: string; surface: "charged" | "cursed"; cell: HexCoord } | null = null;

    if (terrain.surface === "charged") {
      this.resetCurseProgress();
      const used = this.chargedUsage.get(key) ?? 0;
      const remainingBeforeUpdate = Math.max(0, CHARGED_GROUND_CAPACITY_SECONDS - used);
      const boostedSeconds = Math.min(dt, remainingBeforeUpdate);
      const nextUsed = Math.min(CHARGED_GROUND_CAPACITY_SECONDS, used + boostedSeconds);
      if (boostedSeconds > 0) {
        this.chargedUsage.set(key, nextUsed);
      }
      if (used < CHARGED_GROUND_CAPACITY_SECONDS) {
        const boostedShare = dt > 0 ? boostedSeconds / dt : 1;
        const multiplier = 1 + (CHARGED_GROUND_RECOVERY_MULTIPLIER - 1) * boostedShare;
        cooldownRecoveryMultiplier = multiplier;
        energyRecoveryMultiplier = multiplier;
      }
      if (nextUsed < CHARGED_GROUND_CAPACITY_SECONDS) {
        activeInteraction = { key, surface: "charged", cell: { ...cell } };
      }
      if (used < CHARGED_GROUND_CAPACITY_SECONDS && nextUsed >= CHARGED_GROUND_CAPACITY_SECONDS) {
        this.stateVersion += 1;
      }
    } else if (terrain.surface === "cursed" && !this.cleansedCurses.has(key)) {
      if (this.currentCurseKey !== key) {
        this.currentCurseKey = key;
        this.currentCurseProgress = 0;
      }
      this.currentCurseProgress = Math.min(CURSED_GROUND_CLEANSE_SECONDS, this.currentCurseProgress + dt);
      if (this.currentCurseProgress >= CURSED_GROUND_CLEANSE_SECONDS) {
        this.cleansedCurses.add(key);
        this.currentCurseKey = null;
        this.currentCurseProgress = 0;
        this.rewardFeedbackSeconds = REWARD_FEEDBACK_SECONDS;
        this.stateVersion += 1;
        this.callbacks.onCursedCleared(cell, CURSED_GROUND_REWARD);
      } else {
        activeInteraction = { key, surface: "cursed", cell: { ...cell } };
      }
    } else {
      this.resetCurseProgress();
    }

    this.syncSpecialTileInteraction(activeInteraction);

    const visual = this.getCellVisualState(terrain);
    const chargedUsed = terrain.surface === "charged" ? this.chargedUsage.get(key) ?? 0 : 0;
    this.snapshot = {
      cell,
      surface: terrain.surface,
      phase: visual.phase,
      cooldownRecoveryMultiplier,
      energyRecoveryMultiplier,
      chargedRemainingSeconds:
        terrain.surface === "charged" ? Math.max(0, CHARGED_GROUND_CAPACITY_SECONDS - chargedUsed) : 0,
      chargedProgress: terrain.surface === "charged" ? clamp(chargedUsed / CHARGED_GROUND_CAPACITY_SECONDS, 0, 1) : 0,
      curseProgress:
        terrain.surface === "cursed" && visual.phase === "cursed"
          ? clamp(this.currentCurseProgress / CURSED_GROUND_CLEANSE_SECONDS, 0, 1)
          : 0,
      rewardFeedbackVisible: this.rewardFeedbackSeconds > 0,
      cleansedCount: this.cleansedCurses.size,
      depletedCount: this.countDepletedChargedTiles(),
    };

    return this.snapshot;
  }

  getSnapshot() {
    return this.snapshot;
  }

  getDiagnostics() {
    return {
      ...this.snapshot,
      chargedCells: [...this.chargedUsage.entries()].map(([key, usedSeconds]) => ({
        key,
        usedSeconds,
        remainingSeconds: Math.max(0, CHARGED_GROUND_CAPACITY_SECONDS - usedSeconds),
      })),
      cleansedCells: [...this.cleansedCurses],
    };
  }

  getStateVersion() {
    return this.stateVersion;
  }

  getCellVisualState(cell: TerrainCell): GroundCellVisualState {
    const key = this.gridWorld.cellKey(cell.q, cell.r);
    if (cell.surface === "charged") {
      const progress = clamp((this.chargedUsage.get(key) ?? 0) / CHARGED_GROUND_CAPACITY_SECONDS, 0, 1);
      return progress >= 1
        ? { phase: "depleted", displaySurface: "scarred", progress }
        : { phase: "charged", displaySurface: "charged", progress };
    }
    if (cell.surface === "cursed") {
      if (this.cleansedCurses.has(key)) {
        return { phase: "cleansed", displaySurface: "scarred", progress: 1 };
      }
      const progress = this.currentCurseKey === key ? clamp(this.currentCurseProgress / CURSED_GROUND_CLEANSE_SECONDS, 0, 1) : 0;
      return { phase: "cursed", displaySurface: "cursed", progress };
    }
    return { phase: "normal", displaySurface: cell.surface, progress: 0 };
  }

  reset() {
    this.syncSpecialTileInteraction(null);
    this.chargedUsage.clear();
    this.cleansedCurses.clear();
    this.currentCurseKey = null;
    this.currentCurseProgress = 0;
    this.rewardFeedbackSeconds = 0;
    this.stateVersion += 1;
    this.snapshot = {
      ...this.snapshot,
      phase: "normal",
      cooldownRecoveryMultiplier: 1,
      energyRecoveryMultiplier: 1,
      chargedRemainingSeconds: 0,
      chargedProgress: 0,
      curseProgress: 0,
      rewardFeedbackVisible: false,
      cleansedCount: 0,
      depletedCount: 0,
    };
  }

  private resetCurseProgress() {
    this.currentCurseKey = null;
    this.currentCurseProgress = 0;
  }

  private syncSpecialTileInteraction(next: typeof this.currentInteraction) {
    const current = this.currentInteraction;
    if (current?.key === next?.key && current?.surface === next?.surface) {
      return;
    }

    if (current) {
      this.callbacks.onSpecialTileInteractionStopped(current.surface, current.cell);
    }
    this.currentInteraction = next;
    if (next) {
      this.callbacks.onSpecialTileInteractionStarted(next.surface, next.cell);
    }
  }

  private countDepletedChargedTiles() {
    let count = 0;
    for (const used of this.chargedUsage.values()) {
      if (used >= CHARGED_GROUND_CAPACITY_SECONDS) {
        count += 1;
      }
    }
    return count;
  }
}
