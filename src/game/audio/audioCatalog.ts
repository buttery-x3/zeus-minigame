import type { AudioCueDefinition, AudioCueId } from "./audioTypes";

export const AUDIO_CATALOG: Record<AudioCueId, AudioCueDefinition> = {
  "spell-chain-cast": {
    urls: ["/assets/audio/sfx/spells/chain_lightning.wav"],
    volume: 0.72,
    maxVoices: 2,
  },
  "spell-bolt-cast": {
    urls: ["/assets/audio/sfx/spells/lightning_bolt.wav"],
    volume: 0.72,
    maxVoices: 2,
  },
  "spell-cast-failed": {
    urls: ["/assets/audio/sfx/UX/spell_fail.wav"],
    volume: 0.58,
    maxVoices: 1,
    minIntervalMs: 120,
  },
  "player-hit": {
    urls: [
      "/assets/audio/sfx/player/hit1.wav",
      "/assets/audio/sfx/player/hit2.wav",
      "/assets/audio/sfx/player/hit3.wav",
    ],
    volume: 0.66,
    maxVoices: 2,
    minIntervalMs: 80,
  },
  "minion-death": {
    urls: [
      "/assets/audio/sfx/enemies/minion_death_1.wav",
      "/assets/audio/sfx/enemies/minion_death2.wav",
      "/assets/audio/sfx/enemies/minion_death3.wav",
      "/assets/audio/sfx/enemies/minion_death4.wav",
    ],
    volume: 0.62,
    maxVoices: 5,
    minIntervalMs: 35,
  },
  "charged-tile-channeling": {
    urls: ["/assets/audio/sfx/UX/channeling_charged_tile.wav"],
    volume: 0.48,
    maxVoices: 1,
    loop: true,
  },
  "cursed-tile-channeling": {
    urls: ["/assets/audio/sfx/UX/channeling_cursed_tile.wav"],
    volume: 0.48,
    maxVoices: 1,
    loop: true,
  },
};

export const AUDIO_CUE_IDS = Object.keys(AUDIO_CATALOG) as AudioCueId[];
