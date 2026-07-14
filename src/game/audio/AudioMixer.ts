import type { AudioPreferences } from "./AudioPreferences";
import { AudioSourcePool, type AudioSourceHandle } from "./AudioSourcePool";
import type { AudioCueId } from "./audioTypes";
import { MusicPlayer } from "./MusicPlayer";

export class AudioMixer {
  private readonly masterGain: GainNode;
  private readonly sfxGain: GainNode;
  private readonly musicGain: GainNode;
  private readonly sourcePool: AudioSourcePool;
  private readonly musicPlayer: MusicPlayer;

  constructor(
    readonly context: AudioContext,
    preferences: AudioPreferences,
    musicSource: string,
  ) {
    this.masterGain = context.createGain();
    this.sfxGain = context.createGain();
    this.musicGain = context.createGain();
    this.masterGain.gain.value = 0.82;
    this.sfxGain.gain.value = preferences.sfxVolume;
    this.musicGain.gain.value = 0;
    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(context.destination);
    this.sourcePool = new AudioSourcePool(context, this.sfxGain);
    this.musicPlayer = new MusicPlayer(context, this.musicGain, musicSource);
  }

  playSfx(cueId: AudioCueId, buffer: AudioBuffer, volume: number, loop: boolean, maxVoices: number, detuneCents = 0) {
    return this.sourcePool.play(cueId, buffer, volume, loop, maxVoices, detuneCents);
  }

  stopSfx(handle: AudioSourceHandle) {
    this.sourcePool.stop(handle);
  }

  stopAllSfx() {
    this.sourcePool.stopAll();
  }

  playMusic() {
    return this.musicPlayer.play();
  }

  pauseMusic() {
    this.musicPlayer.pause();
  }

  setSfxVolume(volume: number, paused: boolean) {
    setGain(this.context, this.sfxGain, paused ? 0 : volume, 0.02);
  }

  setMusicVolume(volume: number, fadeIn = false) {
    setGain(this.context, this.musicGain, volume, fadeIn ? 1 : 0.03);
  }

  getDiagnostics() {
    return {
      activeVoiceCount: this.sourcePool.activeCount,
      effectiveSfxGain: this.sfxGain.gain.value,
      effectiveBgmGain: this.musicGain.gain.value,
      music: this.musicPlayer.getDiagnostics(),
    };
  }

  dispose() {
    this.sourcePool.stopAll();
    this.musicPlayer.dispose();
    this.sfxGain.disconnect();
    this.musicGain.disconnect();
    this.masterGain.disconnect();
    if (this.context.state !== "closed") {
      void this.context.close();
    }
  }
}

function setGain(context: AudioContext, gain: GainNode, target: number, seconds: number) {
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(target, now + seconds);
}
