import { AUDIO_CATALOG, AUDIO_CUE_IDS } from "./audioCatalog";
import type { AudioMixer } from "./AudioMixer";
import type { AudioSourceHandle } from "./AudioSourcePool";
import type { AudioCueId } from "./audioTypes";
import { SfxBufferStore } from "./SfxBufferStore";

export type SfxPlayOptions = {
  detuneCents?: number;
  randomDetuneCents?: number;
};

export class SfxPlayer {
  private readonly bufferStore = new SfxBufferStore();
  private readonly lastVariantByCue = new Map<AudioCueId, number>();
  private readonly lastPlayedAt = new Map<AudioCueId, number>();
  private readonly playCounts = createCueCounter();
  private readonly lastDetuneByCue = new Map<AudioCueId, number>();
  private desiredLoop: AudioCueId | null = null;
  private loopSource: AudioSourceHandle | null = null;

  preload(context: AudioContext) {
    return this.bufferStore.preload(context);
  }

  play(mixer: AudioMixer, cueId: AudioCueId, options: SfxPlayOptions = {}) {
    const definition = AUDIO_CATALOG[cueId];
    const now = performance.now();
    if (now - (this.lastPlayedAt.get(cueId) ?? -Infinity) < (definition.minIntervalMs ?? 0)) {
      return false;
    }

    const buffer = this.chooseBuffer(cueId);
    if (!buffer) {
      return false;
    }

    this.lastPlayedAt.set(cueId, now);
    this.playCounts[cueId] += 1;
    const detuneCents = getRandomDetune(options.detuneCents ?? 0, options.randomDetuneCents ?? 0);
    this.lastDetuneByCue.set(cueId, detuneCents);
    mixer.playSfx(cueId, buffer, definition.volume, false, definition.maxVoices, detuneCents);
    return true;
  }

  startLoop(mixer: AudioMixer, cueId: AudioCueId) {
    const definition = AUDIO_CATALOG[cueId];
    if (!definition.loop || this.desiredLoop === cueId) {
      return;
    }

    this.stopLoop(mixer);
    this.desiredLoop = cueId;
    const buffer = this.chooseBuffer(cueId);
    if (!buffer) {
      return;
    }
    this.playCounts[cueId] += 1;
    this.loopSource = mixer.playSfx(cueId, buffer, definition.volume, true, definition.maxVoices);
  }

  stopLoop(mixer: AudioMixer, cueId?: AudioCueId) {
    if (cueId && this.desiredLoop !== cueId) {
      return;
    }
    this.desiredLoop = null;
    if (this.loopSource) {
      mixer.stopSfx(this.loopSource);
      this.loopSource = null;
    }
  }

  reset(mixer: AudioMixer | null) {
    this.desiredLoop = null;
    this.loopSource = null;
    mixer?.stopAllSfx();
    this.lastVariantByCue.clear();
    this.lastPlayedAt.clear();
    this.lastDetuneByCue.clear();
  }

  getDiagnostics() {
    return {
      ...this.bufferStore.getDiagnostics(),
      configuredCueCount: AUDIO_CUE_IDS.length,
      activeLoop: this.desiredLoop,
      loopPlaying: this.loopSource !== null,
      playCounts: { ...this.playCounts },
      cueVolumes: Object.fromEntries(AUDIO_CUE_IDS.map((cueId) => [cueId, AUDIO_CATALOG[cueId].volume])),
      lastDetuneCents: Object.fromEntries(this.lastDetuneByCue),
    };
  }

  private chooseBuffer(cueId: AudioCueId) {
    const available = AUDIO_CATALOG[cueId].urls
      .map((url, index) => ({ buffer: this.bufferStore.get(url), index }))
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
}

function createCueCounter(): Record<AudioCueId, number> {
  return Object.fromEntries(AUDIO_CUE_IDS.map((cueId) => [cueId, 0])) as Record<AudioCueId, number>;
}

function getRandomDetune(baseCents: number, randomCents: number) {
  return baseCents + (Math.random() * 2 - 1) * randomCents;
}
