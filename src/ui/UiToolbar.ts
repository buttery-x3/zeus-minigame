type UiToolbarCallbacks = {
  togglePause: () => void;
  toggleDiagnostics: () => void;
};

export class UiToolbar {
  readonly element: HTMLElement;

  private readonly pauseButton: HTMLButtonElement;
  private readonly diagnosticsButton: HTMLButtonElement;

  constructor(callbacks: UiToolbarCallbacks) {
    this.element = document.createElement("nav");
    this.element.className = "ui-toolbar";
    this.element.setAttribute("aria-label", "Game menu");
    this.element.innerHTML = `
      <button class="ui-tool ui-tool--pause" data-ui-action="pause" type="button" aria-label="Pause" title="Pause"><i></i></button>
      <button class="ui-tool ui-tool--diagnostics" data-ui-action="diagnostics" type="button" aria-label="Diagnostics" title="Diagnostics"><i></i></button>
    `;

    this.pauseButton = this.element.querySelector('[data-ui-action="pause"]') as HTMLButtonElement;
    this.diagnosticsButton = this.element.querySelector('[data-ui-action="diagnostics"]') as HTMLButtonElement;
    this.pauseButton.addEventListener("click", callbacks.togglePause);
    this.diagnosticsButton.addEventListener("click", callbacks.toggleDiagnostics);
  }

  setPaused(paused: boolean) {
    this.pauseButton.classList.toggle("ui-tool--active", paused);
    this.pauseButton.setAttribute("aria-label", paused ? "Resume" : "Pause");
    this.pauseButton.title = paused ? "Resume" : "Pause";
  }

  setPauseEnabled(enabled: boolean) {
    this.pauseButton.disabled = !enabled;
    this.pauseButton.setAttribute("aria-disabled", String(!enabled));
  }

  setDiagnosticsOpen(open: boolean) {
    this.diagnosticsButton.classList.toggle("ui-tool--active", open);
  }
}
