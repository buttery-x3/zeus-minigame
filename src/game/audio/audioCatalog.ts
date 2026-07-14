import type { AudioCueDefinition, AudioCueId } from "./audioTypes";
import { audioAssetUrl } from "./audioAssetUrl";

export const AUDIO_CATALOG: Record<AudioCueId, AudioCueDefinition> = {
  "spell-chain-cast": {
    urls: [audioAssetUrl("sfx/spells/chain_lightning.wav")],
    volume: 0.576,
    maxVoices: 2,
  },
  "spell-bolt-cast": {
    urls: [audioAssetUrl("sfx/spells/lightning_bolt.wav")],
    volume: 0.576,
    maxVoices: 2,
  },
  "spell-cast-failed": {
    urls: [audioAssetUrl("sfx/UX/spell_fail.wav")],
    volume: 0.58,
    maxVoices: 1,
    minIntervalMs: 120,
  },
  "player-hit": {
    urls: [
      audioAssetUrl("sfx/player/hit1.wav"),
      audioAssetUrl("sfx/player/hit2.wav"),
      audioAssetUrl("sfx/player/hit3.wav"),
    ],
    volume: 0.66,
    maxVoices: 2,
    minIntervalMs: 80,
  },
  "minion-death": {
    urls: [
      audioAssetUrl("sfx/enemies/minion_death_1.wav"),
      audioAssetUrl("sfx/enemies/minion_death2.wav"),
      audioAssetUrl("sfx/enemies/minion_death3.wav"),
      audioAssetUrl("sfx/enemies/minion_death4.wav"),
    ],
    volume: 0.651,
    maxVoices: 5,
    minIntervalMs: 35,
  },
  "new-wave-announce": {
    urls: [audioAssetUrl("sfx/UX/new_wave_announce.wav")],
    volume: 0.455,
    maxVoices: 1,
  },
  "charged-tile-channeling": {
    urls: [audioAssetUrl("sfx/UX/channeling_charged_tile.wav")],
    volume: 0.528,
    maxVoices: 1,
    loop: true,
  },
  "cursed-tile-channeling": {
    urls: [audioAssetUrl("sfx/UX/channeling_cursed_tile.wav")],
    volume: 0.456,
    maxVoices: 1,
    loop: true,
  },
};

export const AUDIO_CUE_IDS = Object.keys(AUDIO_CATALOG) as AudioCueId[];
