import { AUDIO_CATALOG, AUDIO_CUE_IDS } from "./audioCatalog";
import type { AudioCueId, AudioLoadState } from "./audioTypes";

export class SfxBufferStore {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly optionalUnavailable = new Set<AudioCueId>();
  private loadState: AudioLoadState = "idle";

  async preload(context: AudioContext) {
    this.loadState = "loading";
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
            this.buffers.set(url, await context.decodeAudioData(await response.arrayBuffer()));
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
    this.loadState = requiredFailure ? "partial" : "ready";
  }

  get(url: string) {
    return this.buffers.get(url);
  }

  getDiagnostics() {
    return {
      loadState: this.loadState,
      loadedVariantCount: this.buffers.size,
      optionalUnavailable: [...this.optionalUnavailable],
    };
  }
}
