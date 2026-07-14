import type { SpellCastFailureReason } from "../spells/spellTypes";
import type { AudioCueId, AudioSuspensionReason } from "./audioTypes";
import { AudioMixer } from "./AudioMixer";
import { clampAudioVolume, loadAudioPreferences, saveAudioPreferences } from "./AudioPreferences";
import { SfxPlayer, type SfxPlayOptions } from "./SfxPlayer";
import { audioAssetUrl } from "./audioAssetUrl";

const COOLDOWN_FAILURE_DETUNE_CENTS = -1200;
const COOLDOWN_FAILURE_RANDOM_DETUNE_CENTS = 45;
const MUSIC_SOURCE = audioAssetUrl("music/storm-arena-loop.mp3");

export class AudioSystem {
  private mixer: AudioMixer | null = null;
  private readonly sfx = new SfxPlayer();
  private preferences = loadAudioPreferences();
  private unlocked = false;
  private disposed = false;
  private readonly suspensionReasons = new Set<AudioSuspensionReason>();
  private lastCastFailureReason: SpellCastFailureReason | null = null;

  constructor() {
    document.addEventListener("pointerdown", this.handleUnlockGesture, { capture: true });
    document.addEventListener("keydown", this.handleUnlockGesture, { capture: true });
    void this.preload();
  }

  play(cueId: AudioCueId, options: SfxPlayOptions = {}) {
    if (this.disposed) {
      return false;
    }

    const mixer = this.ensureMixer();
    if (!mixer) {
      return false;
    }
    return this.sfx.play(mixer, cueId, options);
  }

  playSpellCastFailed(reason: SpellCastFailureReason) {
    this.lastCastFailureReason = reason;
    if (!this.preferences.spellFailureEnabled) {
      return;
    }
    this.play(
      "spell-cast-failed",
      reason === "cooldown"
        ? {
            detuneCents: COOLDOWN_FAILURE_DETUNE_CENTS,
            randomDetuneCents: COOLDOWN_FAILURE_RANDOM_DETUNE_CENTS,
          }
        : undefined,
    );
  }

  startLoop(cueId: AudioCueId) {
    if (this.disposed) {
      return;
    }
    const mixer = this.ensureMixer();
    if (mixer) {
      this.sfx.startLoop(mixer, cueId);
    }
  }

  stopLoop(cueId?: AudioCueId) {
    if (this.mixer) {
      this.sfx.stopLoop(this.mixer, cueId);
    }
  }

  setSuspended(reason: AudioSuspensionReason, suspended: boolean) {
    if (suspended) {
      this.suspensionReasons.add(reason);
    } else {
      this.suspensionReasons.delete(reason);
    }
    if (reason === "pause") {
      this.applySfxVolume();
    }
    if (reason === "hidden") {
      if (suspended) {
        this.mixer?.pauseMusic();
      } else if (this.unlocked) {
        void this.mixer?.playMusic();
      }
    }
    void this.syncContextState();
  }

  getPreferences() {
    return { ...this.preferences };
  }

  setSfxVolume(volume: number) {
    this.preferences.sfxVolume = clampAudioVolume(volume);
    this.savePreferences();
    this.applySfxVolume();
  }

  setBgmVolume(volume: number) {
    this.preferences.bgmVolume = clampAudioVolume(volume);
    this.savePreferences();
    this.applyMusicVolume();
  }

  setSpellFailureEnabled(enabled: boolean) {
    this.preferences.spellFailureEnabled = enabled;
    this.savePreferences();
  }

  reset() {
    this.sfx.reset(this.mixer);
    this.lastCastFailureReason = null;
  }

  getDiagnostics() {
    const sfxDiagnostics = this.sfx.getDiagnostics();
    const mixerDiagnostics = this.mixer?.getDiagnostics();
    return {
      unlocked: this.unlocked,
      loadState: sfxDiagnostics.loadState,
      contextState: this.mixer?.context.state ?? "unavailable",
      configuredCueCount: sfxDiagnostics.configuredCueCount,
      loadedVariantCount: sfxDiagnostics.loadedVariantCount,
      activeVoiceCount: mixerDiagnostics?.activeVoiceCount ?? 0,
      activeLoop: sfxDiagnostics.activeLoop,
      loopPlaying: sfxDiagnostics.loopPlaying,
      playCounts: sfxDiagnostics.playCounts,
      cueVolumes: sfxDiagnostics.cueVolumes,
      lastDetuneCents: sfxDiagnostics.lastDetuneCents,
      cooldownFailurePitch: {
        detuneCents: COOLDOWN_FAILURE_DETUNE_CENTS,
        randomDetuneCents: COOLDOWN_FAILURE_RANDOM_DETUNE_CENTS,
      },
      preferences: { ...this.preferences },
      effectiveSfxGain: mixerDiagnostics?.effectiveSfxGain ?? 0,
      effectiveBgmGain: mixerDiagnostics?.effectiveBgmGain ?? 0,
      music: mixerDiagnostics?.music ?? null,
      lastCastFailureReason: this.lastCastFailureReason,
      optionalUnavailable: sfxDiagnostics.optionalUnavailable,
      suspensionReasons: [...this.suspensionReasons],
    };
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    document.removeEventListener("pointerdown", this.handleUnlockGesture, { capture: true });
    document.removeEventListener("keydown", this.handleUnlockGesture, { capture: true });
    this.sfx.reset(this.mixer);
    this.mixer?.dispose();
    this.mixer = null;
  }

  private async preload() {
    const mixer = this.ensureMixer();
    if (!mixer) {
      return;
    }
    await this.sfx.preload(mixer.context);
  }

  private readonly handleUnlockGesture = () => {
    void this.unlock();
  };

  private async unlock() {
    const mixer = this.ensureMixer();
    if (!mixer || this.disposed) {
      return;
    }

    this.unlocked = true;
    document.removeEventListener("pointerdown", this.handleUnlockGesture, { capture: true });
    document.removeEventListener("keydown", this.handleUnlockGesture, { capture: true });
    const musicPlayback = mixer.playMusic();
    this.applyMusicVolume(true);
    await Promise.all([this.syncContextState(), musicPlayback]);
  }

  private ensureMixer() {
    if (this.mixer || this.disposed) {
      return this.mixer;
    }

    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      return null;
    }

    this.mixer = new AudioMixer(new AudioContextConstructor(), this.preferences, MUSIC_SOURCE);
    return this.mixer;
  }

  private async syncContextState() {
    const context = this.mixer?.context;
    if (!context || context.state === "closed") {
      return;
    }

    if (this.suspensionReasons.has("hidden")) {
      if (context.state === "running") {
        await context.suspend();
      }
      return;
    }

    if (this.unlocked && context.state === "suspended") {
      await context.resume();
    }
  }

  private applySfxVolume() {
    this.mixer?.setSfxVolume(this.preferences.sfxVolume, this.suspensionReasons.has("pause"));
  }

  private applyMusicVolume(fadeIn = false) {
    this.mixer?.setMusicVolume(this.preferences.bgmVolume, fadeIn);
  }

  private savePreferences() {
    saveAudioPreferences(this.preferences);
  }
}
