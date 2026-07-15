import { DEFAULT_ENEMY_HEALTH_BAR_VISIBILITY_MODE } from "../../config";
import type { EnemyHealthBarVisibilityMode } from "../../types";
import type { NormalizedWindowPosition } from "../../ui/window/types";

export const GAME_PREFERENCES_STORAGE_KEY = "zeus.settings.v1";

export const HUD_PANEL_IDS = ["hud-vitals", "hud-status", "hud-position", "hud-abilities", "hud-currencies"] as const;

export type HudPanelId = (typeof HUD_PANEL_IDS)[number];
export type HudPanelPositions = Partial<Record<HudPanelId, NormalizedWindowPosition>>;
export type RenderMode = "normal" | "potato";

export type GamePreferences = {
  enemyHealthBarMode: EnemyHealthBarVisibilityMode;
  quickCastEnabled: boolean;
  allowMaxRangeTargetSnap: boolean;
  unlockUiEnabled: boolean;
  renderMode: RenderMode;
  hudPanelPositions: HudPanelPositions;
};

export const DEFAULT_GAME_PREFERENCES: GamePreferences = {
  enemyHealthBarMode: DEFAULT_ENEMY_HEALTH_BAR_VISIBILITY_MODE,
  quickCastEnabled: true,
  allowMaxRangeTargetSnap: true,
  unlockUiEnabled: false,
  renderMode: "normal",
  hudPanelPositions: {},
};

export class GamePreferencesStore {
  private preferences = loadGamePreferences();

  getSnapshot(): GamePreferences {
    return {
      ...this.preferences,
      hudPanelPositions: cloneHudPanelPositions(this.preferences.hudPanelPositions),
    };
  }

  update(settings: Partial<Omit<GamePreferences, "hudPanelPositions">>) {
    this.preferences = { ...this.preferences, ...settings };
    saveGamePreferences(this.preferences);
  }

  setHudPanelPosition(id: HudPanelId, position: NormalizedWindowPosition) {
    this.preferences = {
      ...this.preferences,
      hudPanelPositions: {
        ...this.preferences.hudPanelPositions,
        [id]: normalizePosition(position),
      },
    };
    saveGamePreferences(this.preferences);
  }
}

export function loadGamePreferences(): GamePreferences {
  try {
    const stored = window.localStorage.getItem(GAME_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return defaultPreferences();
    }

    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) {
      return defaultPreferences();
    }

    return {
      enemyHealthBarMode: normalizeHealthBarMode(parsed.enemyHealthBarMode),
      quickCastEnabled: normalizeBoolean(parsed.quickCastEnabled, DEFAULT_GAME_PREFERENCES.quickCastEnabled),
      allowMaxRangeTargetSnap: normalizeBoolean(
        parsed.allowMaxRangeTargetSnap,
        DEFAULT_GAME_PREFERENCES.allowMaxRangeTargetSnap,
      ),
      unlockUiEnabled: normalizeBoolean(parsed.unlockUiEnabled, DEFAULT_GAME_PREFERENCES.unlockUiEnabled),
      renderMode: normalizeRenderMode(parsed.renderMode),
      hudPanelPositions: normalizeHudPanelPositions(parsed.hudPanelPositions),
    };
  } catch {
    return defaultPreferences();
  }
}

function saveGamePreferences(preferences: GamePreferences) {
  try {
    window.localStorage.setItem(GAME_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

function defaultPreferences(): GamePreferences {
  return {
    ...DEFAULT_GAME_PREFERENCES,
    hudPanelPositions: {},
  };
}

function normalizeHudPanelPositions(value: unknown): HudPanelPositions {
  if (!isRecord(value)) {
    return {};
  }

  const positions: HudPanelPositions = {};
  for (const id of HUD_PANEL_IDS) {
    const position = value[id];
    if (isRecord(position) && isFiniteNumber(position.x) && isFiniteNumber(position.y)) {
      positions[id] = normalizePosition(position as NormalizedWindowPosition);
    }
  }
  return positions;
}

function cloneHudPanelPositions(positions: HudPanelPositions): HudPanelPositions {
  return Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, { ...position }])) as HudPanelPositions;
}

function normalizePosition(position: NormalizedWindowPosition): NormalizedWindowPosition {
  return {
    x: clamp01(position.x),
    y: clamp01(position.y),
  };
}

function normalizeHealthBarMode(value: unknown): EnemyHealthBarVisibilityMode {
  return value === "always" || value === "smart" ? value : DEFAULT_GAME_PREFERENCES.enemyHealthBarMode;
}

function normalizeRenderMode(value: unknown): RenderMode {
  return value === "potato" ? "potato" : DEFAULT_GAME_PREFERENCES.renderMode;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
