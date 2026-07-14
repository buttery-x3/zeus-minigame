export type AudioCueId =
  | "spell-chain-cast"
  | "spell-bolt-cast"
  | "spell-cast-failed"
  | "player-hit"
  | "minion-death"
  | "charged-tile-channeling"
  | "cursed-tile-channeling";

export type AudioCueDefinition = {
  urls: readonly string[];
  volume: number;
  maxVoices: number;
  minIntervalMs?: number;
  loop?: boolean;
  optional?: boolean;
};

export type AudioLoadState = "idle" | "loading" | "ready" | "partial";

export type AudioSuspensionReason = "pause" | "hidden";
