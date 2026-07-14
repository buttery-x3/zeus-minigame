import { AUDIO_CATALOG, AUDIO_CUE_IDS } from "./audioCatalog";
import type { SpellCastFailureReason } from "../spells/spellTypes";
import type { AudioCueId, AudioLoadState, AudioSuspensionReason } from "./audioTypes";
import { AudioSourcePool, type AudioSourceHandle } from "./AudioSourcePool";

export class AudioSystem {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private sourcePool: AudioSourcePool | null = null;
  private loadState: AudioLoadState = "idle";
  private unlocked = false;
  private disposed = false;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastVariantByCue = new Map<AudioCueId, number>();
  private readonly lastPlayedAt = new Map<AudioCueId, number>();
  private readonly playCounts = createCueCounter();
  private readonly optionalUnavailable = new Set<AudioCueId>();
  private readonly suspensionReasons = new Set<AudioSuspensionReason>();
  private desiredLoop: AudioCueId | null = null;
  private loopSource: AudioSourceHandle | null = null;
  private lastCastFailureReason: SpellCastFailureReason | null = null;

  constructor() {
    document.addEventListener("pointerdown", this.handleUnlockGesture, { capture: true });
    document.addEventListener("keydown", this.handleUnlockGesture, { capture: true });
    void this.preload();
  }

  play(cueId: AudioCueId) {
    if (this.disposed) {
      return false;
    }

    const definition = AUDIO_CATALOG[cueId];
    const now = performance.now();
    const lastPlayedAt = this.lastPlayedAt.get(cueId) ?? -Infinity;
    if (now - lastPlayedAt < (definition.minIntervalMs ?? 0)) {
      return false;
    }

    const context = this.ensureContext();
    const buffer = this.chooseBuffer(cueId);
    if (!context || !this.sfxGain || !buffer) {
      return false;
    }

    this.lastPlayedAt.set(cueId, now);
    this.playCounts[cueId] += 1;
    this.sourcePool?.play(cueId, buffer, definition.volume, false, definition.maxVoices);
    return true;
  }

  playSpellCastFailed(reason: SpellCastFailureReason) {
    this.lastCastFailureReason = reason;
    this.play("spell-cast-failed");
  }

  startLoop(cueId: AudioCueId) {
    const definition = AUDIO_CATALOG[cueId];
    if (!definition.loop || this.disposed || this.desiredLoop === cueId) {
      return;
    }

    this.stopLoop();
    this.desiredLoop = cueId;
    const context = this.ensureContext();
    const buffer = this.chooseBuffer(cueId);
    if (!context || !this.sfxGain || !buffer) {
      return;
    }

    this.playCounts[cueId] += 1;
    this.loopSource = this.sourcePool?.play(cueId, buffer, definition.volume, true, definition.maxVoices) ?? null;
  }

  stopLoop(cueId?: AudioCueId) {
    if (cueId && this.desiredLoop !== cueId) {
      return;
    }

    this.desiredLoop = null;
    if (this.loopSource && this.sourcePool) {
      this.sourcePool.stop(this.loopSource);
      this.loopSource = null;
    }
  }

  setSuspended(reason: AudioSuspensionReason, suspended: boolean) {
    if (suspended) {
      this.suspensionReasons.add(reason);
    } else {
      this.suspensionReasons.delete(reason);
    }
    void this.syncContextState();
  }

  reset() {
    this.stopAllSources();
    this.lastVariantByCue.clear();
    this.lastPlayedAt.clear();
    this.lastCastFailureReason = null;
  }

  getDiagnostics() {
    return {
      unlocked: this.unlocked,
      loadState: this.loadState,
      contextState: this.context?.state ?? "unavailable",
      configuredCueCount: AUDIO_CUE_IDS.length,
      loadedVariantCount: this.buffers.size,
      activeVoiceCount: this.sourcePool?.activeCount ?? 0,
      activeLoop: this.desiredLoop,
      loopPlaying: this.loopSource !== null,
      playCounts: { ...this.playCounts },
      lastCastFailureReason: this.lastCastFailureReason,
      optionalUnavailable: [...this.optionalUnavailable],
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
    this.stopAllSources();
    const context = this.context;
    this.context = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.sourcePool = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
  }

  private async preload() {
    this.loadState = "loading";
    const context = this.ensureContext();
    if (!context) {
      this.loadState = "partial";
      return;
    }

    let requiredFailure = false;
    await Promise.all(
      AUDIO_CUE_IDS.flatMap((cueId) => {
        const definition = AUDIO_CATALOG[cueId];
        return definition.urls.map(async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            this.buffers.set(url, buffer);
          } catch (error) {
            if (definition.optional) {
              this.optionalUnavailable.add(cueId);
              return;
            }
            requiredFailure = true;
            console.warn(`[audio] Could not load ${url}`, error);
          }
        });
      }),
    );

    if (!this.disposed) {
      this.loadState = requiredFailure ? "partial" : "ready";
    }
  }

  private readonly handleUnlockGesture = () => {
    void this.unlock();
  };

  private async unlock() {
    const context = this.ensureContext();
    if (!context || this.disposed) {
      return;
    }

    this.unlocked = true;
    document.removeEventListener("pointerdown", this.handleUnlockGesture, { capture: true });
    document.removeEventListener("keydown", this.handleUnlockGesture, { capture: true });
    await this.syncContextState();
  }

  private ensureContext() {
    if (this.context || this.disposed) {
      return this.context;
    }

    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) {
      return null;
    }

    this.context = new AudioContextConstructor();
    this.masterGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.masterGain.gain.value = 0.82;
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);
    this.sourcePool = new AudioSourcePool(this.context, this.sfxGain);
    return this.context;
  }

  private async syncContextState() {
    const context = this.context;
    if (!context || context.state === "closed") {
      return;
    }

    if (this.suspensionReasons.size > 0) {
      if (context.state === "running") {
        await context.suspend();
      }
      return;
    }

    if (this.unlocked && context.state === "suspended") {
      await context.resume();
    }
  }

  private chooseBuffer(cueId: AudioCueId) {
    const urls = AUDIO_CATALOG[cueId].urls;
    const available = urls
      .map((url, index) => ({ buffer: this.buffers.get(url), index }))
      .filter((entry): entry is { buffer: AudioBuffer; index: number } => entry.buffer !== undefined);
    if (available.length === 0) {
      return null;
    }

    const previous = this.lastVariantByCue.get(cueId);
    const choices = available.length > 1 ? available.filter((entry) => entry.index !== previous) : available;
    const selected = choices[Math.floor(Math.random() * choices.length)];
    this.lastVariantByCue.set(cueId, selected.index);
    return selected.buffer;
  }

  private stopAllSources() {
    this.desiredLoop = null;
    this.loopSource = null;
    this.sourcePool?.stopAll();
  }
}

function createCueCounter(): Record<AudioCueId, number> {
  return Object.fromEntries(AUDIO_CUE_IDS.map((cueId) => [cueId, 0])) as Record<AudioCueId, number>;
}
