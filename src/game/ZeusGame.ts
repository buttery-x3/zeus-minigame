import * as THREE from "three";
import {
  DEFAULT_ENEMY_HEALTH_BAR_VISIBILITY_MODE,
  INITIAL_NEXT_WAVE_AT,
  INITIAL_SPAWN_INTERVAL,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_MANA,
  PLAYER_MANA_REGEN_PER_SECOND,
  VISIBILITY_LIGHT_EPSILON,
} from "../config";
import { CameraRig } from "./camera/CameraRig";
import { CollisionSystem } from "./collision/CollisionSystem";
import { GameDiagnostics } from "./diagnostics/GameDiagnostics";
import { EnemySystem } from "./enemies/EnemySystem";
import { HudPresenter } from "./hud/HudPresenter";
import { GameInput } from "./input/GameInput";
import { Profiler } from "./perf/Profiler";
import { PlayerController } from "./player/PlayerController";
import { GameScene } from "./scene/GameScene";
import { getBoundedFrameDelta, SimulationStepper } from "./SimulationStepper";
import { SpellSystem } from "./spells/SpellSystem";
import { TargetingRenderer } from "./spells/TargetingRenderer";
import { TerrainSystem } from "./terrain/TerrainSystem";
import { GroundEffectSystem } from "./terrain/GroundEffectSystem";
import type { EnemyHealthBarVisibilityMode, EnemyState, GameRuntimeState } from "../types";
import { VisibilitySystem } from "./visibility/VisibilitySystem";
import { GameEffects } from "../render/GameEffects";
import { VisibilityOverlay } from "../render/VisibilityOverlay";
import { createGameMaterials } from "../render/materials";
import { GameUi } from "../ui/GameUi";
import { GridWorld } from "../world/GridWorld";

export class ZeusGame {
  private readonly clock = new THREE.Clock();
  private readonly profiler = new Profiler();
  private readonly simulationStepper = new SimulationStepper();
  private readonly gridWorld = new GridWorld();
  private readonly collision = new CollisionSystem(this.gridWorld, this.profiler);
  private readonly visibility = new VisibilitySystem(this.gridWorld);
  private readonly materials = createGameMaterials();
  private readonly groups = {
    terrain: new THREE.Group(),
    blockers: new THREE.Group(),
    enemies: new THREE.Group(),
    enemyHealthBars: new THREE.Group(),
    effects: new THREE.Group(),
    targeting: new THREE.Group(),
  };

  private readonly scene = new GameScene();
  private readonly visibilityOverlay = new VisibilityOverlay(this.gridWorld);
  private readonly effects = new GameEffects(this.groups.effects);
  private readonly player = new PlayerController(this.gridWorld, this.collision, this.effects, this.materials);
  private readonly groundEffects = new GroundEffectSystem(this.gridWorld, {
    onCursedCleared: (cell, reward) => {
      this.state.cursedEnergy += reward;
      const world = this.gridWorld.cellToWorldPoint(cell);
      this.effects.createEnergyAbsorption(world, this.player.object.position);
      this.effects.createShockwave(world, 0xc266f0, 4.8);
    },
  });
  private readonly diagnostics = new GameDiagnostics(
    this.scene,
    this.gridWorld,
    this.collision,
    this.player,
    this.visibility,
    this.groundEffects,
    this.profiler,
  );
  private readonly cameraRig = new CameraRig(this.scene.camera, this.scene.renderer);
  private enemyHealthBarMode: EnemyHealthBarVisibilityMode = DEFAULT_ENEMY_HEALTH_BAR_VISIBILITY_MODE;
  private quickCastEnabled = true;
  private allowMaxRangeTargetSnap = true;
  private unlockUiEnabled = false;
  private terrainDebugMode = false;
  private readonly ui = new GameUi({
    resume: () => this.setPaused(false),
    togglePause: () => this.setPaused(!this.state.paused),
    enemyHealthBarMode: this.enemyHealthBarMode,
    setEnemyHealthBarMode: (mode) => this.setEnemyHealthBarMode(mode),
    quickCastEnabled: this.quickCastEnabled,
    setQuickCastEnabled: (enabled) => this.setQuickCastEnabled(enabled),
    allowMaxRangeTargetSnap: this.allowMaxRangeTargetSnap,
    setAllowMaxRangeTargetSnap: (enabled) => this.setAllowMaxRangeTargetSnap(enabled),
    unlockUiEnabled: this.unlockUiEnabled,
    setUnlockUiEnabled: (enabled) => this.setUnlockUiEnabled(enabled),
    terrainDebugMode: this.terrainDebugMode,
    setTerrainDebugMode: (enabled) => this.setTerrainDebugMode(enabled),
  });
  private readonly hudPresenter = new HudPresenter(this.ui.hud, this.gridWorld);
  private readonly enemies = new EnemySystem(
    this.groups.enemies,
    this.groups.enemyHealthBars,
    this.collision,
    this.gridWorld,
    this.profiler,
    this.materials,
    this.effects,
    {
      damagePlayer: (amount) => this.damagePlayer(amount),
    },
  );
  private readonly spells = new SpellSystem(this.effects, this.enemies, {
    invalidCast: () => this.player.flash(0x657172),
    castSucceeded: (spellId) => this.player.playSpellCast(spellId),
    canCastAt: (target) => this.canCastAt(target),
    canAffectEnemy: (enemy) => this.isEnemyVisible(enemy),
  });
  private readonly targeting = new TargetingRenderer(this.groups.targeting);
  private readonly terrain = new TerrainSystem(
    this.gridWorld,
    this.groups.terrain,
    this.groups.blockers,
    this.materials,
    this.groundEffects,
  );
  private readonly input = new GameInput(this.scene.camera, this.scene.renderer, this.gridWorld, {
    isGameOver: () => this.state.gameOver,
    isPaused: () => this.state.paused,
    isQuickCastEnabled: () => this.quickCastEnabled,
    getCastMode: () => this.spells.castMode,
    beginTargeting: (spellId) => this.spells.beginTargeting(spellId, this.state),
    cancelTargeting: () => this.spells.cancelTargeting(),
    castAt: (target) =>
      this.spells.castAt(target, this.player.object.position, this.state, {
        allowMaxRangeTargetSnap: this.allowMaxRangeTargetSnap,
      }),
    setMoveTarget: (x, z) => this.requestMoveTarget(x, z),
    restart: () => this.restart(),
    handleEscape: () => this.handleEscape(),
    toggleDiagnostics: () => this.ui.toggleDiagnostics(),
    toggleEnemyHealthBarMode: () => this.toggleEnemyHealthBarMode(),
    toggleTerrainDebugMode: () => this.setTerrainDebugMode(!this.terrainDebugMode),
  });

  private state = createInitialState();
  private lastTime = 0;
  private animationId = 0;
  private discardNextFrameDelta = false;

  constructor() {
    this.scene.mount({
      terrain: this.groups.terrain,
      blockers: this.groups.blockers,
      visibility: this.visibilityOverlay.object,
      enemies: this.groups.enemies,
      enemyHealthBars: this.groups.enemyHealthBars,
      effects: this.groups.effects,
      targeting: this.groups.targeting,
      player: this.player.object,
      moveMarker: this.player.moveMarker,
    });

    const stormLight = new THREE.PointLight(0x61cfff, 16, 22);
    stormLight.position.set(0, 9, 0);
    this.player.object.add(stormLight);
    this.visibility.update(this.player.object.position, 0);

    window.addEventListener("resize", this.cameraRig.resize);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.cameraRig.resize();
    this.enemies.spawnInitial(this.state, this.player.object.position);
    this.gridWorld.ensureTerrainGeneratedAroundWorld(this.player.object.position);

    this.animationId = window.requestAnimationFrame(this.tick);
  }

  dispose() {
    window.cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.cameraRig.resize);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.input.dispose();
    this.player.dispose();
    this.ui.remove();
    this.visibilityOverlay.dispose();
    this.scene.dispose();
  }

  getDiagnostics() {
    return {
      ...this.diagnostics.get(this.state),
      input: {
        quickCastEnabled: this.quickCastEnabled,
        allowMaxRangeTargetSnap: this.allowMaxRangeTargetSnap,
        unlockUiEnabled: this.unlockUiEnabled,
        terrainDebugMode: this.terrainDebugMode,
        pointerWorld: this.input.pointerWorld.toArray(),
      },
      spells: {
        castMode: this.spells.castMode,
        cooldowns: { ...this.spells.cooldowns },
        mana: this.state.mana,
      },
      groundEffects: {
        ...this.groundEffects.getDiagnostics(),
        cursedEnergy: this.state.cursedEnergy,
      },
      enemyHealthBars: {
        mode: this.enemyHealthBarMode,
        ...this.enemies.getHealthBarDiagnostics(),
      },
      enemyVisibility: this.enemies.getVisibilityDiagnostics(),
      enemyAvoidance: this.enemies.getAvoidanceDiagnostics(),
      terrain: this.terrain.getDiagnostics(),
      visibilityOverlay: this.visibilityOverlay.getDiagnostics(),
      timing: this.simulationStepper.diagnostics(),
    };
  }

  defeatPlayerForVerification() {
    if (import.meta.env.DEV) {
      this.damagePlayer(PLAYER_MAX_HEALTH);
    }
  }

  private readonly tick = (time: number) => {
    const rawDt = this.clock.getDelta() || (time - this.lastTime) / 1000 || 0.016;
    this.lastTime = time;
    const discardForVisibility = document.hidden || this.discardNextFrameDelta;
    if (!document.hidden) {
      this.discardNextFrameDelta = false;
    }

    this.profiler.beginFrame(time);
    this.profiler.measure("gameLogic", () => this.update(rawDt, discardForVisibility));
    this.profiler.measure("render", () => this.scene.render());
    this.profiler.endFrame();
    this.ui.updateDiagnostics(this.profiler.snapshot());
    this.animationId = window.requestAnimationFrame(this.tick);
  };

  private update(rawDt: number, discardForVisibility: boolean) {
    const playerPosition = this.player.object.position;
    let ground = this.groundEffects.getSnapshot();

    if (this.terrainDebugMode) {
      this.state.health = PLAYER_MAX_HEALTH;
    }

    this.profiler.measure("terrainGeneration", () => this.gridWorld.ensureTerrainGeneratedAroundWorld(playerPosition));
    this.profiler.measure("terrainPreparation", () => this.terrain.prepare(playerPosition, this.terrainDebugMode));
    const frameDt = getBoundedFrameDelta(rawDt, discardForVisibility);
    this.profiler.measure("camera", () => this.cameraRig.update(frameDt, playerPosition));
    this.profiler.measure("input", () => this.input.update(frameDt));

    const timing = this.simulationStepper.advance(rawDt, this.state.paused, discardForVisibility, (dt) => {
      ground = this.updateSimulation(dt, ground);
    });
    this.updatePresentation(frameDt, timing.simulatedDeltaSeconds, ground);
  }

  private updateSimulation(dt: number, ground: ReturnType<GroundEffectSystem["getSnapshot"]>) {
    const playerPosition = this.player.object.position;
    if (!this.state.gameOver && !this.state.paused) {
      this.profiler.measure("player", () => {
        if (this.input.consumeMoveRequest()) {
          this.requestMoveTarget(this.input.pointerWorld.x, this.input.pointerWorld.z, false);
        }
        this.player.update(dt);
        this.terrain.prepare(playerPosition, this.terrainDebugMode);
      });
      ground = this.profiler.measure("groundEffects", () => this.groundEffects.update(dt, this.player.getGroundCell()));
      this.player.setGroundAura(
        ground.phase === "charged" && ground.cooldownRecoveryMultiplier > 1
          ? "charged"
          : ground.phase === "cursed"
            ? "cursed"
            : null,
      );
      this.state.mana = Math.min(
        PLAYER_MAX_MANA,
        this.state.mana + dt * PLAYER_MANA_REGEN_PER_SECOND * ground.energyRecoveryMultiplier,
      );
      this.profiler.measure("spells", () => this.spells.update(dt, ground.cooldownRecoveryMultiplier));
    }

    if (this.state.gameOver) {
      this.profiler.measure("playerAnimation", () => this.player.updateAnimation(dt));
      this.profiler.measure("effects", () => this.effects.update(dt));
      return ground;
    }

    this.profiler.measure("enemies", () => this.enemies.update(dt, this.state, playerPosition));
    if (this.terrainDebugMode) {
      this.state.health = PLAYER_MAX_HEALTH;
    }
    this.profiler.measure("spawning", () => this.enemies.updateSpawner(dt, this.state, playerPosition));
    this.profiler.measure("effects", () => this.effects.update(dt));
    this.profiler.measure("playerAnimation", () => this.player.updateAnimation(dt));
    return ground;
  }

  private updatePresentation(frameDt: number, simulatedDt: number, ground: ReturnType<GroundEffectSystem["getSnapshot"]>) {
    const playerPosition = this.player.object.position;

    this.profiler.measure("visibility", () => this.visibility.update(playerPosition));
    this.profiler.measure("terrain", () =>
      this.terrain.update(this.state.paused ? 0 : simulatedDt, playerPosition, ground, this.visibility, this.terrainDebugMode),
    );
    this.profiler.measure("visibilityOverlay", () => this.visibilityOverlay.update(this.visibility, frameDt, playerPosition));
    this.profiler.measure("targeting", () => this.targeting.update({
      castMode: this.spells.castMode,
      spells: this.spells.spells,
      pointerWorld: this.input.pointerWorld,
      playerPosition,
      allowMaxRangeTargetSnap: this.allowMaxRangeTargetSnap,
      canCastAt: (target) => this.canCastAt(target),
    }));
    this.profiler.measure("hud", () => this.hudPresenter.update({
      state: this.state,
      playerPosition,
      castMode: this.spells.castMode,
      cooldowns: this.spells.cooldowns,
      spells: this.spells.spells,
      ground: this.groundEffects.getSnapshot(),
      paused: this.state.paused,
    }));

    this.profiler.measure("enemyVisibility", () => this.enemies.updateVisibility((enemy) => this.isEnemyVisible(enemy)));
    this.profiler.measure("enemyHealthBars", () =>
      this.enemies.updateHealthBars(
        this.state.gameOver || this.state.paused ? 0 : simulatedDt,
        this.scene.camera,
        this.enemyHealthBarMode,
        playerPosition,
        this.input.pointerWorld,
        (enemy) => this.isEnemyVisible(enemy),
      ),
    );
    this.profiler.measure("lighting", () => this.scene.updateLighting(playerPosition));
  }

  private readonly handleVisibilityChange = () => {
    this.discardNextFrameDelta = true;
  };

  private damagePlayer(amount: number) {
    if (this.terrainDebugMode) {
      this.state.health = PLAYER_MAX_HEALTH;
      return;
    }

    this.state.health = Math.max(0, this.state.health - amount);
    this.player.flash(0xff5c66, () => !this.state.gameOver);
    this.effects.createShockwave(this.player.object.position, 0xff5c66, 2.5);

    if (this.state.health <= 0) {
      this.state.gameOver = true;
      this.spells.cancelTargeting();
      this.player.setDefeated();
    }
  }

  private requestMoveTarget(x: number, z: number, force = true) {
    if (!this.terrainDebugMode && !this.visibility.isDiscoveredWorld(x, z)) {
      this.player.flash(0x657172);
      return;
    }

    this.player.setMoveTarget(x, z, {
      force,
      canUseDestination: (destination) => this.terrainDebugMode || this.visibility.isDiscoveredWorld(destination.x, destination.z),
    });
  }

  private canCastAt(target: THREE.Vector3) {
    if (this.terrainDebugMode) {
      return true;
    }

    return this.visibility.isVisibleWorld(target.x, target.z) && this.visibility.getLightWorld(target.x, target.z) > VISIBILITY_LIGHT_EPSILON;
  }

  private isEnemyVisible(enemy: EnemyState) {
    return this.visibility.isVisibleWorld(enemy.group.position.x, enemy.group.position.z);
  }

  private restart() {
    this.state = createInitialState();
    this.ui.setPaused(false);
    this.spells.reset();
    this.groundEffects.reset();
    this.player.reset();
    this.gridWorld.ensureTerrainGeneratedAroundWorld(this.player.object.position);
    this.visibility.reset();
    this.visibility.update(this.player.object.position);
    this.enemies.reset(this.state, this.player.object.position);
  }

  private handleEscape() {
    if (this.state.paused) {
      this.setPaused(false);
    } else if (this.spells.castMode) {
      this.spells.cancelTargeting();
    } else {
      this.setPaused(true);
    }
  }

  private setPaused(paused: boolean) {
    this.state.paused = paused;
    if (paused) {
      this.spells.cancelTargeting();
    }
    this.ui.setPaused(paused);
  }

  private setEnemyHealthBarMode(mode: EnemyHealthBarVisibilityMode) {
    this.enemyHealthBarMode = mode;
    this.ui.setEnemyHealthBarMode(mode);
  }

  private setQuickCastEnabled(enabled: boolean) {
    this.quickCastEnabled = enabled;
    this.ui.setQuickCastEnabled(enabled);
  }

  private setAllowMaxRangeTargetSnap(enabled: boolean) {
    this.allowMaxRangeTargetSnap = enabled;
    this.ui.setAllowMaxRangeTargetSnap(enabled);
  }

  private setUnlockUiEnabled(enabled: boolean) {
    this.unlockUiEnabled = enabled;
    this.ui.setUnlockUiEnabled(enabled);
  }

  private setTerrainDebugMode(enabled: boolean) {
    this.terrainDebugMode = enabled;
    this.cameraRig.setZoomMultiplier(enabled ? 3 : 1);
    this.visibilityOverlay.setDebugReveal(enabled);
    if (enabled) {
      this.state.health = PLAYER_MAX_HEALTH;
    }
    this.ui.setTerrainDebugMode(enabled);
  }

  private toggleEnemyHealthBarMode() {
    this.setEnemyHealthBarMode(this.enemyHealthBarMode === "smart" ? "always" : "smart");
  }

}

function createInitialState(): GameRuntimeState {
  return {
    health: PLAYER_MAX_HEALTH,
    mana: PLAYER_MAX_MANA,
    cursedEnergy: 0,
    kills: 0,
    wave: 1,
    spawnTimer: 0,
    spawnInterval: INITIAL_SPAWN_INTERVAL,
    nextWaveAt: INITIAL_NEXT_WAVE_AT,
    gameOver: false,
    paused: false,
  };
}
