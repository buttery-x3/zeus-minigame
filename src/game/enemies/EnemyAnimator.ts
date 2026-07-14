import * as THREE from "three";
import { ENEMY_ATTACK_INTERVAL } from "../../config";

const CLIP_NAMES = {
  walk: "Walking_Woman",
  attack: "Stylish_Walk_inplace",
} as const;
const ATTACK_ANIMATION_SECONDS = ENEMY_ATTACK_INTERVAL * 0.9;

type AnimationState = keyof typeof CLIP_NAMES;
type LoadState = "loading" | "ready" | "error";

export class EnemyAnimator {
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Object3D | null = null;
  private actions = new Map<AnimationState, THREE.AnimationAction>();
  private loadState: LoadState = "loading";
  private loadError: string | null = null;
  private availableClips: string[] = [];
  private activeState: AnimationState | null = null;
  private attackCount = 0;

  attach(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.disposeMixer();
    this.availableClips = clips.map((clip) => clip.name);
    const walkClip = this.getRequiredClip(clips, CLIP_NAMES.walk);
    const attackClip = this.getRequiredClip(clips, CLIP_NAMES.attack);

    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.mixer.addEventListener("finished", this.handleFinished);

    this.actions.set("walk", this.mixer.clipAction(walkClip));
    const attack = this.mixer.clipAction(attackClip);
    attack.setLoop(THREE.LoopOnce, 1);
    this.actions.set("attack", attack);

    this.loadState = "ready";
    this.loadError = null;
    this.playState("walk", 0);
  }

  markLoadFailed(error: unknown) {
    this.disposeMixer();
    this.loadState = "error";
    this.loadError = error instanceof Error ? error.message : String(error);
  }

  update(dt: number) {
    this.mixer?.update(dt);
  }

  playAttack() {
    if (this.loadState !== "ready") {
      return;
    }

    this.attackCount += 1;
    this.playState("attack", 0.08, true);
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
      timeScale: activeAction?.getEffectiveTimeScale() ?? 0,
      attackCount: this.attackCount,
    };
  }

  dispose() {
    this.disposeMixer();
  }

  private getRequiredClip(clips: THREE.AnimationClip[], clipName: string) {
    const clip = THREE.AnimationClip.findByName(clips, clipName);
    if (!clip) {
      throw new Error(`Missing required melee enemy animation clip "${clipName}"`);
    }
    return clip;
  }

  private playState(nextState: AnimationState, fadeSeconds = 0.12, restart = false) {
    const next = this.actions.get(nextState);
    if (!next) {
      return;
    }

    const previous = this.activeState ? this.actions.get(this.activeState) : null;
    if (previous === next && !restart) {
      return;
    }

    next.reset();
    const timeScale = nextState === "attack" ? next.getClip().duration / ATTACK_ANIMATION_SECONDS : 1;
    next.setEffectiveTimeScale(timeScale);
    next.setEffectiveWeight(1);
    next.play();

    if (previous && previous !== next && fadeSeconds > 0) {
      next.crossFadeFrom(previous, fadeSeconds, false);
    } else if (previous && previous !== next) {
      previous.stop();
    }

    this.activeState = nextState;
  }

  private readonly handleFinished = (event: { action: THREE.AnimationAction }) => {
    if (this.activeState === "attack" && event.action === this.actions.get("attack")) {
      this.playState("walk", 0.08);
    }
  };

  private disposeMixer() {
    if (this.mixer) {
      this.mixer.removeEventListener("finished", this.handleFinished);
      this.mixer.stopAllAction();
      if (this.root) {
        this.mixer.uncacheRoot(this.root);
      }
    }
    this.mixer = null;
    this.root = null;
    this.actions.clear();
    this.activeState = null;
  }
}
