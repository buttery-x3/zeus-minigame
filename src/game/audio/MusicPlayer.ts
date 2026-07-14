export type MusicLoadState = "loading" | "ready" | "error";

export class MusicPlayer {
  private readonly element = new Audio();
  private readonly source: MediaElementAudioSourceNode;
  private loadState: MusicLoadState = "loading";
  private loadError: string | null = null;

  constructor(
    context: AudioContext,
    output: AudioNode,
    private readonly sourceUrl: string,
  ) {
    this.element.src = sourceUrl;
    this.element.loop = true;
    this.element.preload = "metadata";
    this.element.addEventListener("canplay", this.handleCanPlay);
    this.element.addEventListener("error", this.handleError);
    this.source = context.createMediaElementSource(this.element);
    this.source.connect(output);
    this.element.load();
  }

  play() {
    return this.element
      .play()
      .then(() => {
        this.loadError = null;
      })
      .catch((error: unknown) => {
        this.loadError = error instanceof Error ? error.message : String(error);
      });
  }

  pause() {
    this.element.pause();
  }

  getDiagnostics() {
    return {
      source: this.sourceUrl,
      loadState: this.loadState,
      loadError: this.loadError,
      playing: !this.element.paused && !this.element.ended,
      loop: this.element.loop,
      currentTime: this.element.currentTime,
      duration: Number.isFinite(this.element.duration) ? this.element.duration : null,
    };
  }

  dispose() {
    this.element.pause();
    this.element.removeEventListener("canplay", this.handleCanPlay);
    this.element.removeEventListener("error", this.handleError);
    this.element.removeAttribute("src");
    this.element.load();
    this.source.disconnect();
  }

  private readonly handleCanPlay = () => {
    this.loadState = "ready";
    this.loadError = null;
  };

  private readonly handleError = () => {
    this.loadState = "error";
    this.loadError = this.element.error?.message ?? "Unknown music loading error";
  };
}
