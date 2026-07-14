import type { AudioCueId } from "./audioTypes";

export type AudioSourceHandle = {
  cueId: AudioCueId;
  source: AudioBufferSourceNode;
  gain: GainNode;
};

export class AudioSourcePool {
  private readonly active = new Set<AudioSourceHandle>();

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
  ) {}

  get activeCount() {
    return this.active.size;
  }

  play(cueId: AudioCueId, buffer: AudioBuffer, volume: number, loop: boolean, maxVoices: number, detuneCents = 0) {
    this.enforceVoiceLimit(cueId, maxVoices);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    source.detune.value = detuneCents;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.output);

    const handle: AudioSourceHandle = { cueId, source, gain };
    this.active.add(handle);
    source.onended = () => this.cleanup(handle);
    source.start();
    return handle;
  }

  stop(handle: AudioSourceHandle) {
    if (!this.active.delete(handle)) {
      return;
    }

    handle.source.onended = null;
    try {
      handle.source.stop();
    } catch {
      // A source may already have ended between collection and cleanup.
    }
    handle.source.disconnect();
    handle.gain.disconnect();
  }

  stopAll() {
    for (const handle of [...this.active]) {
      this.stop(handle);
    }
  }

  private enforceVoiceLimit(cueId: AudioCueId, maxVoices: number) {
    const matches = [...this.active].filter((handle) => handle.cueId === cueId);
    while (matches.length >= maxVoices) {
      const oldest = matches.shift();
      if (oldest) {
        this.stop(oldest);
      }
    }
  }

  private cleanup(handle: AudioSourceHandle) {
    this.active.delete(handle);
    handle.source.disconnect();
    handle.gain.disconnect();
  }
}
