import * as THREE from "three";
import {
  INITIAL_NEXT_WAVE_AT,
  INITIAL_SPAWN_INTERVAL,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_MANA,
  VISIBILITY_LIGHT_EPSILON,
} from "../config";
import { CameraRig } from "./camera/CameraRig";
import { AudioSystem } from "./audio/AudioSystem";
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
import { createGameMaterialPalettes } from "../render/materials";
import { GameUi } from "../ui/GameUi";
import { GridWorld } from "../world/GridWorld";
import { UpgradeSystem } from "./upgrades/UpgradeSystem";
import type { UpgradeId } from "./upgrades/upgradeTypes";
import { GamePreferencesStore, type RenderMode } from "./preferences/GamePreferences";

export class ZeusGame {
  private readonly clock = new THREE.Clock();
  private readonly profiler = new Profiler();
  private readonly simulationStepper = new SimulationStepper();
  private readonly gridWorld = new GridWorld();
  private readonly collision = new CollisionSystem(this.gridWorld, this.profiler);
  private readonly visibility = new VisibilitySystem(this.gridWorld);
  private readonly groups = {
    terrain: new THREE.Group(),
    blockers: new THREE.Group(),
    enemies: new THREE.Group(),
    enemyHealthBars: new THREE.Group(),
    effects: new THREE.Group(),
    targeting: new THREE.Group(),
  };
  private readonly preferences = new GamePreferencesStore();
  private readonly savedPreferences = this.preferences.getSnapshot();
  private renderMode: RenderMode = this.savedPreferences.renderMode;
  private readonly materialPalettes = createGameMaterialPalettes();

  private readonly scene = new GameScene(this.renderMode);
  private readonly visibilityOverlay = new VisibilityOverlay(this.gridWorld);
  private readonly effects = new GameEffects(this.groups.effects);
  private readonly player = new PlayerController(
    this.gridWorld,
    this.collision,
    this.effects,
    this.materialPalettes,
    this.renderMode,
  );
  private readonly stormLight = new THREE.PointLight(0x61cfff, 16, 22);
  private readonly audio = new AudioSystem();
  private readonly upgrades = new UpgradeSystem();
  private readonly groundEffects = new GroundEffectSystem(this.gridWorld, {
    onCursedCleared: (cell, reward) => {
      this.grantCursedEnergy(reward);
      const world = this.gridWorld.cellToWorldPoint(cell);
      this.effects.createEnergyAbsorption(world, this.player.object.position);
      this.effects.createShockwave(world, 0xc266f0, 4.8);
    },
    onSpecialTileInteractionStarted: (surface) =>
      this.audio.startLoop(surface === "charged" ? "charged-tile-channeling" : "cursed-tile-channeling"),
    onSpecialTileInteractionStopped: (surface) =>
      this.audio.stopLoop(surface === "charged" ? "charged-tile-channeling" : "cursed-tile-channeling"),
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
  private enemyHealthBarMode: EnemyHealthBarVisibilityMode = this.savedPreferences.enemyHealthBarMode;
  private quickCastEnabled = this.savedPreferences.quickCastEnabled;
  private allowMaxRangeTargetSnap = this.savedPreferences.allowMaxRangeTargetSnap;
  private unlockUiEnabled = this.savedPreferences.unlockUiEnabled;
  private terrainDebugMode = false;
  private manualPaused = false;
  private readonly ui = new GameUi({
    resume: () => this.setManualPaused(false),
    togglePause: () => this.toggleManualPause(),
    enemyHealthBarMode: this.enemyHealthBarMode,
    setEnemyHealthBarMode: (mode) => this.setEnemyHealthBarMode(mode),
    quickCastEnabled: this.quickCastEnabled,
    setQuickCastEnabled: (enabled) => this.setQuickCastEnabled(enabled),
    allowMaxRangeTargetSnap: this.allowMaxRangeTargetSnap,
    setAllowMaxRangeTargetSnap: (enabled) => this.setAllowMaxRangeTargetSnap(enabled),
    unlockUiEnabled: this.unlockUiEnabled,
    setUnlockUiEnabled: (enabled) => this.setUnlockUiEnabled(enabled),
    renderMode: this.renderMode,
    setRenderMode: (mode) => this.setRenderMode(mode),
    hudPanelPositions: this.savedPreferences.hudPanelPositions,
    setHudPanelPosition: (id, position) => this.preferences.setHudPanelPosition(id, position),
    terrainDebugMode: this.terrainDebugMode,
    setTerrainDebugMode: (enabled) => this.setTerrainDebugMode(enabled),
    audioPreferences: this.audio.getPreferences(),
    setSfxVolume: (volume) => this.setSfxVolume(volume),
    setBgmVolume: (volume) => this.setBgmVolume(volume),
    setSpellFailureEnabled: (enabled) => this.setSpellFailureEnabled(enabled),
    chooseUpgrade: (upgradeId) => this.chooseUpgrade(upgradeId),
    skipUpgrade: () => this.skipUpgrade(),
  });
  private readonly hudPresenter = new HudPresenter(this.ui.hud, this.gridWorld);
  private readonly enemies = new EnemySystem(
    this.groups.enemies,
    this.groups.enemyHealthBars,
    this.collision,
    this.gridWorld,
    this.profiler,
    this.materialPalettes,
    this.effects,
    {
      damagePlayer: (amount) => this.damagePlayer(amount),
      enemyDied: () => this.audio.play("minion-death"),
      waveStarted: () => this.audio.play("new-wave-announce"),
      restoreMana: (amount) => this.restoreMana(amount),
    },
    this.renderMode,
  );
  private readonly spells = new SpellSystem(this.effects, this.enemies, {
    castFailed: (reason) => {
      this.player.flash(0x657172);
      this.audio.playSpellCastFailed(reason);
    },
    castSucceeded: (spellId, target) => {
      this.player.playSpellCast(spellId, target);
      this.audio.play(spellId === "chain" ? "spell-chain-cast" : "spell-bolt-cast");
    },
    canCastAt: (target) => this.canCastAt(target),
    canAffectEnemy: (enemy) => this.isEnemyVisible(enemy),
    getRunStats: () => this.upgrades.getStats(),
  });
  private readonly targeting = new TargetingRenderer(this.groups.targeting);
  private readonly terrain = new TerrainSystem(
    this.gridWorld,
    this.groups.terrain,
    this.groups.blockers,
    this.materialPalettes,
    this.groundEffects,
    this.renderMode,
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
  private renderedFrameCount = 0;

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

    this.stormLight.position.set(0, 9, 0);
    this.stormLight.visible = this.renderMode === "normal";
    this.player.object.add(this.stormLight);
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
    this.audio.dispose();
    this.enemies.clear();
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
        renderMode: this.renderMode,
        pointerWorld: this.input.pointerWorld.toArray(),
      },
      spells: {
        castMode: this.spells.castMode,
        cooldowns: { ...this.spells.cooldowns },
        mana: this.state.mana,
        effectiveConfig: this.spells.spells,
      },
      groundEffects: {
        ...this.groundEffects.getDiagnostics(),
        cursedEnergy: this.state.cursedEnergy,
      },
      upgrades: this.upgrades.getDiagnostics(),
      pauseReason: this.upgrades.hasActiveOffer() ? "upgrade" : this.manualPaused ? "manual" : null,
      enemyHealthBars: {
        mode: this.enemyHealthBarMode,
        ...this.enemies.getHealthBarDiagnostics(),
      },
      enemyVisibility: this.enemies.getVisibilityDiagnostics(),
      enemyAvoidance: this.enemies.getAvoidanceDiagnostics(),
      enemyAnimations: this.enemies.getAnimationDiagnostics(),
      audio: this.audio.getDiagnostics(),
      terrain: this.terrain.getDiagnostics(),
      visibilityOverlay: this.visibilityOverlay.getDiagnostics(),
      rendering: {
        ...this.scene.getRenderDiagnostics(),
        renderedFrames: this.renderedFrameCount,
      },
      timing: this.simulationStepper.diagnostics(),
    };
  }

  defeatPlayerForVerification() {
    if (import.meta.env.DEV) {
      this.damagePlayer(this.upgrades.getStats().maxHealth);
    }
  }

  triggerEnemyAttackForVerification() {
    return import.meta.env.DEV && this.enemies.triggerAttackForVerification();
  }

  defeatEnemyForVerification() {
    return import.meta.env.DEV && this.enemies.defeatEnemyForVerification(this.state);
  }

  setPlayerManaForVerification(mana: number) {
    if (import.meta.env.DEV) {
      this.state.mana = Math.max(0, Math.min(this.upgrades.getStats().maxMana, mana));
    }
  }

  openUpgradeOfferForVerification(cursedEnergy = 3, upgradeIds: UpgradeId[] = ["healthRegen", "spellCooldown", "shield"]) {
    if (!import.meta.env.DEV || this.upgrades.hasActiveOffer()) {
      return false;
    }
    this.state.cursedEnergy = cursedEnergy;
    this.upgrades.beginOffer(performance.now(), upgradeIds);
    this.syncPauseState();
    return true;
  }

  applyUpgradeForVerification(upgradeId: UpgradeId) {
    if (!import.meta.env.DEV) {
      return false;
    }
    const previousStats = this.upgrades.getStats();
    const applied = this.upgrades.applyUpgradeForVerification(upgradeId);
    if (applied) {
      this.applyDerivedStats(previousStats);
    }
    return applied;
  }

  damagePlayerForVerification(amount: number) {
    if (import.meta.env.DEV) {
      this.damagePlayer(amount);
    }
  }

  advanceShieldRechargeForVerification(seconds: number) {
    if (import.meta.env.DEV) {
      this.upgrades.update(Math.max(0, seconds));
    }
  }

  startNextWaveForVerification() {
    if (!import.meta.env.DEV) {
      return false;
    }

    const previousWave = this.state.wave;
    this.state.kills = this.state.nextWaveAt;
    this.enemies.updateSpawner(0, this.state, this.player.object.position);
    return this.state.wave === previousWave + 1;
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
    this.renderedFrameCount += 1;
    this.profiler.endFrame();
    this.ui.updateDiagnostics(this.profiler.snapshot());
    this.animationId = window.requestAnimationFrame(this.tick);
  };

  private update(rawDt: number, discardForVisibility: boolean) {
    const playerPosition = this.player.object.position;
    let ground = this.groundEffects.getSnapshot();
    const runStats = this.upgrades.getStats();

    if (this.upgrades.expireOffer(performance.now())) {
      this.syncPauseState();
    }

    if (this.terrainDebugMode) {
      this.state.health = runStats.maxHealth;
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
    if (this.state.paused) {
      return ground;
    }

    if (!this.state.gameOver) {
      const runStats = this.upgrades.getStats();
      this.profiler.measure("player", () => {
        if (this.input.consumeMoveRequest()) {
          this.requestMoveTarget(this.input.pointerWorld.x, this.input.pointerWorld.z, false);
        }
        this.player.update(dt);
        this.terrain.prepare(playerPosition, this.terrainDebugMode);
      });
      ground = this.profiler.measure("groundEffects", () => this.groundEffects.update(dt, this.player.getGroundCell()));
      if (this.state.paused) {
        return ground;
      }
      this.player.setGroundAura(
        ground.phase === "charged" && ground.cooldownRecoveryMultiplier > 1
          ? "charged"
          : ground.phase === "cursed"
            ? "cursed"
            : null,
      );
      this.state.health = Math.min(runStats.maxHealth, this.state.health + dt * runStats.healthRegenPerSecond);
      this.state.mana = Math.min(runStats.maxMana, this.state.mana + dt * runStats.manaRegenPerSecond * ground.energyRecoveryMultiplier);
      this.upgrades.update(dt);
      this.profiler.measure("spells", () => this.spells.update(dt, ground.cooldownRecoveryMultiplier));
    }

    if (this.state.gameOver) {
      this.profiler.measure("playerAnimation", () => this.player.updateAnimation(dt));
      this.profiler.measure("effects", () => this.effects.update(dt));
      return ground;
    }

    this.profiler.measure("enemies", () => this.enemies.update(dt, this.state, playerPosition));
    if (this.terrainDebugMode) {
      this.state.health = this.upgrades.getStats().maxHealth;
    }
    this.profiler.measure("spawning", () => this.enemies.updateSpawner(dt, this.state, playerPosition));
    this.profiler.measure("effects", () => this.effects.update(dt));
    this.profiler.measure("playerAnimation", () => this.player.updateAnimation(dt));
    return ground;
  }

  private updatePresentation(frameDt: number, simulatedDt: number, ground: ReturnType<GroundEffectSystem["getSnapshot"]>) {
    const playerPosition = this.player.object.position;
    const runStats = this.upgrades.getStats();

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
      runStats,
      upgradeStacks: this.upgrades.getStacks(),
      shield: this.upgrades.getShieldSnapshot(),
    }));
    this.profiler.measure("upgradeUi", () =>
      this.ui.updateUpgradeChoice(this.upgrades.getOfferSnapshot(performance.now()), this.state.cursedEnergy, this.upgrades.getStacks()),
    );

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
    this.audio.setSuspended("hidden", document.hidden);
  };

  private damagePlayer(amount: number) {
    const maxHealth = this.upgrades.getStats().maxHealth;
    if (this.terrainDebugMode) {
      this.state.health = maxHealth;
      return;
    }

    if (this.upgrades.absorbDamage()) {
      this.player.flash(0x8fe9ff, () => !this.state.gameOver);
      this.effects.createShockwave(this.player.object.position, 0x8fe9ff, 3.2);
      return;
    }

    this.state.health = Math.max(0, this.state.health - amount);
    this.audio.play("player-hit");
    this.player.flash(0xff5c66, () => !this.state.gameOver);
    this.effects.createShockwave(this.player.object.position, 0xff5c66, 2.5);

    if (this.state.health <= 0) {
      this.state.gameOver = true;
      this.spells.cancelTargeting();
      this.audio.stopLoop();
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
    this.manualPaused = false;
    this.upgrades.reset();
    this.state = createInitialState();
    this.ui.updateUpgradeChoice(null, 0, this.upgrades.getStacks());
    this.spells.reset();
    this.groundEffects.reset();
    this.audio.reset();
    this.player.reset();
    this.applyDerivedStats();
    this.gridWorld.ensureTerrainGeneratedAroundWorld(this.player.object.position);
    this.visibility.reset();
    this.visibility.update(this.player.object.position);
    this.enemies.reset(this.state, this.player.object.position);
    this.syncPauseState();
  }

  private handleEscape() {
    if (this.upgrades.hasActiveOffer()) {
      return;
    }
    if (this.manualPaused) {
      this.setManualPaused(false);
    } else if (this.spells.castMode) {
      this.spells.cancelTargeting();
    } else {
      this.setManualPaused(true);
    }
  }

  private setManualPaused(paused: boolean) {
    if (this.upgrades.hasActiveOffer()) {
      return;
    }
    this.manualPaused = paused;
    if (this.manualPaused) {
      this.spells.cancelTargeting();
    }
    this.syncPauseState();
  }

  private toggleManualPause() {
    if (!this.upgrades.hasActiveOffer()) {
      this.setManualPaused(!this.manualPaused);
    }
  }

  private syncPauseState() {
    const upgradeChoiceActive = this.upgrades.hasActiveOffer();
    this.state.paused = this.manualPaused || upgradeChoiceActive;
    this.audio.setSuspended("pause", this.state.paused);
    this.ui.setManualPaused(this.manualPaused);
    this.ui.setSimulationPaused(this.state.paused, upgradeChoiceActive);
  }

  private setEnemyHealthBarMode(mode: EnemyHealthBarVisibilityMode) {
    this.enemyHealthBarMode = mode;
    this.ui.setEnemyHealthBarMode(mode);
    this.preferences.update({ enemyHealthBarMode: mode });
  }

  private setQuickCastEnabled(enabled: boolean) {
    this.quickCastEnabled = enabled;
    this.ui.setQuickCastEnabled(enabled);
    this.preferences.update({ quickCastEnabled: enabled });
  }

  private setAllowMaxRangeTargetSnap(enabled: boolean) {
    this.allowMaxRangeTargetSnap = enabled;
    this.ui.setAllowMaxRangeTargetSnap(enabled);
    this.preferences.update({ allowMaxRangeTargetSnap: enabled });
  }

  private setUnlockUiEnabled(enabled: boolean) {
    this.unlockUiEnabled = enabled;
    this.ui.setUnlockUiEnabled(enabled);
    this.preferences.update({ unlockUiEnabled: enabled });
  }

  private setRenderMode(renderMode: RenderMode) {
    if (this.renderMode === renderMode) {
      return;
    }
    this.renderMode = renderMode;
    this.scene.setRenderMode(renderMode);
    this.terrain.setRenderMode(renderMode);
    this.player.setRenderMode(renderMode);
    this.enemies.setRenderMode(renderMode);
    this.stormLight.visible = renderMode === "normal";
    this.ui.setRenderMode(renderMode);
    this.preferences.update({ renderMode });
  }

  private setTerrainDebugMode(enabled: boolean) {
    if (this.upgrades.hasActiveOffer()) {
      return;
    }
    this.terrainDebugMode = enabled;
    this.cameraRig.setZoomMultiplier(enabled ? 3 : 1);
    this.visibilityOverlay.setDebugReveal(enabled);
    if (enabled) {
      this.state.health = this.upgrades.getStats().maxHealth;
    }
    this.ui.setTerrainDebugMode(enabled);
  }

  private setSfxVolume(volume: number) {
    this.audio.setSfxVolume(volume);
    this.ui.setSfxVolume(volume);
  }

  private setBgmVolume(volume: number) {
    this.audio.setBgmVolume(volume);
    this.ui.setBgmVolume(volume);
  }

  private setSpellFailureEnabled(enabled: boolean) {
    this.audio.setSpellFailureEnabled(enabled);
    this.ui.setSpellFailureEnabled(enabled);
  }

  private toggleEnemyHealthBarMode() {
    this.setEnemyHealthBarMode(this.enemyHealthBarMode === "smart" ? "always" : "smart");
  }

  private grantCursedEnergy(amount: number) {
    this.state.cursedEnergy += amount;
    this.upgrades.beginOffer();
    this.spells.cancelTargeting();
    this.syncPauseState();
  }

  private chooseUpgrade(upgradeId: UpgradeId) {
    const previousStats = this.upgrades.getStats();
    const result = this.upgrades.choose(upgradeId, this.state.cursedEnergy);
    if (!result) {
      return;
    }
    this.state.cursedEnergy = result.cursedEnergy;
    this.applyDerivedStats(previousStats);
    this.syncPauseState();
  }

  private skipUpgrade() {
    if (this.upgrades.skipOffer()) {
      this.syncPauseState();
    }
  }

  private applyDerivedStats(previousStats = this.upgrades.getStats()) {
    const nextStats = this.upgrades.getStats();
    if (previousStats.maxHealth !== nextStats.maxHealth) {
      this.state.health = nextStats.maxHealth * (this.state.health / previousStats.maxHealth);
    }
    if (previousStats.maxMana !== nextStats.maxMana) {
      this.state.mana = nextStats.maxMana * (this.state.mana / previousStats.maxMana);
    }
    this.player.setMoveSpeed(nextStats.moveSpeed);
    this.state.health = Math.min(nextStats.maxHealth, this.state.health);
    this.state.mana = Math.min(nextStats.maxMana, this.state.mana);
  }

  private restoreMana(amount: number) {
    this.state.mana = Math.min(this.upgrades.getStats().maxMana, this.state.mana + amount);
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
