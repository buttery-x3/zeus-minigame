export type AudioPreferences = {
  sfxVolume: number;
  bgmVolume: number;
  spellFailureEnabled: boolean;
};

export const AUDIO_PREFERENCES_STORAGE_KEY = "zeus.audio.v1";

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  sfxVolume: 1,
  bgmVolume: 0.35,
  spellFailureEnabled: false,
};

export function loadAudioPreferences(): AudioPreferences {
  try {
    const stored = window.localStorage.getItem(AUDIO_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_AUDIO_PREFERENCES };
    }
    const parsed = JSON.parse(stored) as Partial<AudioPreferences>;
    return {
      sfxVolume: normalizeVolume(parsed.sfxVolume, DEFAULT_AUDIO_PREFERENCES.sfxVolume),
      bgmVolume: normalizeVolume(parsed.bgmVolume, DEFAULT_AUDIO_PREFERENCES.bgmVolume),
      spellFailureEnabled:
        typeof parsed.spellFailureEnabled === "boolean"
          ? parsed.spellFailureEnabled
          : DEFAULT_AUDIO_PREFERENCES.spellFailureEnabled,
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function saveAudioPreferences(preferences: AudioPreferences) {
  try {
    window.localStorage.setItem(AUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

export function clampAudioVolume(volume: number) {
  return Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
}

function normalizeVolume(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? clampAudioVolume(value) : fallback;
}
