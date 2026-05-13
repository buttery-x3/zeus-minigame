import * as THREE from "three";
import { INITIAL_NEXT_WAVE_AT, INITIAL_SPAWN_INTERVAL, PLAYER_MAX_HEALTH, PLAYER_MAX_MANA } from "../config";
import { CameraRig } from "./camera/CameraRig";
import { EnemySystem } from "./enemies/EnemySystem";
import { HudPresenter } from "./hud/HudPresenter";
import { GameInput } from "./input/GameInput";
import { PlayerController } from "./player/PlayerController";
import { GameScene } from "./scene/GameScene";
import { SpellSystem } from "./spells/SpellSystem";
import { TargetingRenderer } from "./spells/TargetingRenderer";
import { TerrainSystem } from "./terrain/TerrainSystem";
import type { GameRuntimeState } from "../types";
import { GameEffects } from "../render/GameEffects";
import { createGameMaterials } from "../render/materials";
import { Hud } from "../ui/Hud";
import { GridWorld } from "../world/GridWorld";

export class ZeusGame {
  private readonly clock = new THREE.Clock();
  private readonly gridWorld = new GridWorld();
  private readonly materials = createGameMaterials();
  private readonly groups = {
    terrain: new THREE.Group(),
    blockers: new THREE.Group(),
    enemies: new THREE.Group(),
    effects: new THREE.Group(),
    targeting: new THREE.Group(),
  };

  private readonly scene = new GameScene();
  private readonly effects = new GameEffects(this.groups.effects);
  private readonly player = new PlayerController(this.gridWorld, this.effects, this.materials);
  private readonly cameraRig = new CameraRig(this.scene.camera, this.scene.renderer);
  private readonly hud = new Hud();
  private readonly hudPresenter = new HudPresenter(this.hud, this.gridWorld);
  private readonly enemies = new EnemySystem(this.groups.enemies, this.materials, this.effects, {
    damagePlayer: (amount) => this.damagePlayer(amount),
  });
  private readonly spells = new SpellSystem(this.effects, this.enemies, {
    invalidCast: () => this.player.flash(0x657172),
  });
  private readonly targeting = new TargetingRenderer(this.groups.targeting);
  private readonly terrain = new TerrainSystem(this.gridWorld, this.groups.terrain, this.groups.blockers, this.materials);
  private readonly input = new GameInput(this.scene.camera, this.scene.renderer, this.gridWorld, {
    isGameOver: () => this.state.gameOver,
    getCastMode: () => this.spells.castMode,
    beginTargeting: (spellId) => this.spells.beginTargeting(spellId, this.state),
    cancelTargeting: () => this.spells.cancelTargeting(),
    castAt: (target) => this.spells.castAt(target, this.player.object.position, this.state),
    setMoveTarget: (x, z) => this.player.setMoveTarget(x, z),
    restart: () => this.restart(),
  });

  private state = createInitialState();
  private lastTime = 0;
  private animationId = 0;

  constructor() {
    this.scene.mount({
      terrain: this.groups.terrain,
      blockers: this.groups.blockers,
      enemies: this.groups.enemies,
      effects: this.groups.effects,
      targeting: this.groups.targeting,
      player: this.player.object,
      moveMarker: this.player.moveMarker,
    });

    const stormLight = new THREE.PointLight(0x61cfff, 16, 22);
    stormLight.position.set(0, 9, 0);
    this.player.object.add(stormLight);

    window.addEventListener("resize", this.cameraRig.resize);
    this.cameraRig.resize();
    this.enemies.spawnInitial(this.state, this.player.object.position);

    this.animationId = window.requestAnimationFrame(this.tick);
  }

  dispose() {
    window.cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.cameraRig.resize);
    this.input.dispose();
    this.hud.remove();
    this.scene.dispose();
  }

  getDiagnostics() {
    const cameraForward = new THREE.Vector3();
    this.scene.camera.getWorldDirection(cameraForward);

    return {
      camera: {
        position: this.scene.camera.position.toArray(),
        quaternion: this.scene.camera.quaternion.toArray(),
        forward: cameraForward.toArray(),
      },
      player: {
        position: this.player.object.position.toArray(),
        rotationY: this.player.object.rotation.y,
      },
    };
  }

  private readonly tick = (time: number) => {
    const dt = Math.min(0.05, this.clock.getDelta() || (time - this.lastTime) / 1000 || 0.016);
    this.lastTime = time;

    this.update(dt);
    this.scene.render();
    this.animationId = window.requestAnimationFrame(this.tick);
  };

  private update(dt: number) {
    const playerPosition = this.player.object.position;

    this.cameraRig.update(dt, playerPosition);
    this.terrain.update(playerPosition);
    this.targeting.update({
      castMode: this.spells.castMode,
      spells: this.spells.spells,
      pointerWorld: this.input.pointerWorld,
      playerPosition,
    });
    this.hudPresenter.update({
      state: this.state,
      playerPosition,
      castMode: this.spells.castMode,
      cooldowns: this.spells.cooldowns,
      spells: this.spells.spells,
    });

    if (this.state.gameOver) {
      this.effects.update(dt);
      return;
    }

    this.state.mana = Math.min(PLAYER_MAX_MANA, this.state.mana + dt * 8.5);
    this.spells.update(dt);
    this.player.update(dt, this.input.shouldMoveContinuously(), this.input.pointerWorld);
    this.enemies.update(dt, this.state, playerPosition);
    this.enemies.updateSpawner(dt, this.state, playerPosition);
    this.effects.update(dt);
  }

  private damagePlayer(amount: number) {
    this.state.health = Math.max(0, this.state.health - amount);
    this.player.flash(0xff5c66, () => !this.state.gameOver);
    this.effects.createShockwave(this.player.object.position, 0xff5c66, 2.5);

    if (this.state.health <= 0) {
      this.state.gameOver = true;
      this.spells.cancelTargeting();
      this.player.setDefeated();
    }
  }

  private restart() {
    this.state = createInitialState();
    this.spells.reset();
    this.player.reset();
    this.enemies.reset(this.state, this.player.object.position);
  }
}

function createInitialState(): GameRuntimeState {
  return {
    health: PLAYER_MAX_HEALTH,
    mana: PLAYER_MAX_MANA,
    kills: 0,
    wave: 1,
    spawnTimer: 0,
    spawnInterval: INITIAL_SPAWN_INTERVAL,
    nextWaveAt: INITIAL_NEXT_WAVE_AT,
    gameOver: false,
  };
}
