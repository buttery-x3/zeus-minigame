import * as THREE from "three";
import type { SpellId } from "../../types";

const CLIP_NAMES = {
  idle: "Idle_8",
  run: "Run_03",
  chain: "mage_soell_cast_3",
  bolt: "mage_soell_cast",
  dead: "Dead",
} as const;

type AnimationState = "idle" | "run" | "cast-chain" | "cast-bolt" | "dead";
type LoadState = "loading" | "ready" | "error";

export class PlayerAnimator {
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Object3D | null = null;
  private actions = new Map<AnimationState, THREE.AnimationAction>();
  private loadState: LoadState = "loading";
  private loadError: string | null = null;
  private availableClips: string[] = [];
  private activeState: AnimationState | null = null;
  private moving = false;
  private defeated = false;

  attach(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.disposeMixer();
    this.root = root;
    this.availableClips = clips.map((clip) => clip.name);
    this.mixer = new THREE.AnimationMixer(root);
    this.mixer.addEventListener("finished", this.handleFinished);

    this.actions.set("idle", this.createRequiredAction(clips, CLIP_NAMES.idle));
    this.actions.set("run", this.createRequiredAction(clips, CLIP_NAMES.run));
    this.actions.set("cast-chain", this.createRequiredAction(clips, CLIP_NAMES.chain, true));
    this.actions.set("cast-bolt", this.createRequiredAction(clips, CLIP_NAMES.bolt, true));
    this.actions.set("dead", this.createRequiredAction(clips, CLIP_NAMES.dead, true, true));

    this.loadState = "ready";
    this.loadError = null;
    this.playState(this.defeated ? "dead" : this.moving ? "run" : "idle", 0);
  }

  markLoadFailed(error: unknown) {
    this.disposeMixer();
    this.loadState = "error";
    this.loadError = error instanceof Error ? error.message : String(error);
  }

  update(dt: number) {
    this.mixer?.update(dt);
  }

  setMoving(moving: boolean) {
    this.moving = moving;
    if (this.defeated || this.activeState === "cast-chain" || this.activeState === "cast-bolt") {
      return;
    }

    this.playState(moving ? "run" : "idle");
  }

  playSpell(spellId: SpellId) {
    if (this.loadState !== "ready" || this.defeated) {
      return;
    }

    this.playState(spellId === "chain" ? "cast-chain" : "cast-bolt", 0.1, true);
  }

  setDefeated() {
    this.defeated = true;
    if (this.loadState === "ready") {
      this.playState("dead", 0.12, true);
    }
  }

  reset() {
    this.defeated = false;
    this.moving = false;
    this.mixer?.stopAllAction();
    this.activeState = null;
    if (this.loadState === "ready") {
      this.playState("idle", 0);
    }
  }

  getDiagnostics() {
    const activeAction = this.activeState ? this.actions.get(this.activeState) : null;
    return {
      loadState: this.loadState,
      loadError: this.loadError,
      availableClips: [...this.availableClips],
      activeState: this.activeState,
      activeClip: activeAction?.getClip().name ?? null,
      animationTime: activeAction?.time ?? 0,
      moving: this.moving,
      defeated: this.defeated,
    };
  }

  dispose() {
    this.disposeMixer();
  }

  private createRequiredAction(
    clips: THREE.AnimationClip[],
    clipName: string,
    playOnce = false,
    clampWhenFinished = false,
  ) {
    const clip = THREE.AnimationClip.findByName(clips, clipName);
    if (!clip || !this.mixer) {
      throw new Error(`Missing required Zeus animation clip "${clipName}"`);
    }

    const action = this.mixer.clipAction(clip);
    if (playOnce) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = clampWhenFinished;
    }
    return action;
  }

  private playState(nextState: AnimationState, fadeSeconds = 0.16, restart = false) {
    const next = this.actions.get(nextState);
    if (!next) {
      return;
    }

    const previous = this.activeState ? this.actions.get(this.activeState) : null;
    if (previous === next && !restart) {
      return;
    }

    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.reset().play();

    if (previous && previous !== next && fadeSeconds > 0) {
      next.crossFadeFrom(previous, fadeSeconds, false);
    } else if (previous && previous !== next) {
      previous.stop();
    }

    this.activeState = nextState;
  }

  private readonly handleFinished = (event: { action: THREE.AnimationAction }) => {
    if (this.defeated || event.action !== (this.activeState ? this.actions.get(this.activeState) : null)) {
      return;
    }

    if (this.activeState === "cast-chain" || this.activeState === "cast-bolt") {
      this.playState(this.moving ? "run" : "idle", 0.12);
    }
  };

  private disposeMixer() {
    if (!this.mixer) {
      return;
    }

    this.mixer.removeEventListener("finished", this.handleFinished);
    this.mixer.stopAllAction();
    if (this.root) {
      this.mixer.uncacheRoot(this.root);
    }
    this.mixer = null;
    this.root = null;
    this.actions.clear();
    this.activeState = null;
  }
}
