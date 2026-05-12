import * as THREE from "three";
import {
  CAMERA_ZOOM,
  INITIAL_ENEMY_COUNT,
  INITIAL_NEXT_WAVE_AT,
  INITIAL_SPAWN_INTERVAL,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_MANA,
  SPELLS,
  TILE_SIZE,
  WORLD_CELLS,
  WORLD_HALF,
  WORLD_SIZE,
} from "../config";
import { mustQuery } from "../lib/dom";
import { clamp, distance2D, randomBetween } from "../lib/math";
import { GameEffects } from "../render/GameEffects";
import { createGameMaterials } from "../render/materials";
import { createChargedGlyph, createEnemyModel, createPlayerModel } from "../render/meshes";
import { createCrosshair, createRing } from "../render/primitives";
import type { EnemyState, SpellConfig, SpellId } from "../types";
import { Hud } from "../ui/Hud";
import { GridWorld } from "../world/GridWorld";

export class ZeusGame {
  private readonly container = mustQuery<HTMLElement>(document, "#game");
  private readonly gridWorld = new GridWorld();
  private readonly spells: Record<SpellId, SpellConfig> = SPELLS;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1400);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointerWorld = new THREE.Vector3();
  private readonly hud = new Hud();
  private readonly materials = createGameMaterials();

  private readonly playerModel = createPlayerModel(this.materials.player);
  private readonly player = this.playerModel.group;
  private readonly playerAura = this.playerModel.aura;
  private readonly moveTarget = new THREE.Vector3(0, 0, 0);
  private readonly terrainGroup = new THREE.Group();
  private readonly blockerGroup = new THREE.Group();
  private readonly enemyGroup = new THREE.Group();
  private readonly effectGroup = new THREE.Group();
  private readonly effectsLayer = new GameEffects(this.effectGroup);
  private readonly targetGroup = new THREE.Group();
  private readonly moveMarker = new THREE.Group();
  private readonly clock = new THREE.Clock();

  private terrainWindowKey = "";
  private enemies: EnemyState[] = [];
  private pressedPointerId: number | null = null;
  private castMode: SpellId | null = null;
  private inputMoveLocked = false;
  private health = PLAYER_MAX_HEALTH;
  private mana = PLAYER_MAX_MANA;
  private kills = 0;
  private wave = 1;
  private spawnTimer = 0;
  private spawnInterval = INITIAL_SPAWN_INTERVAL;
  private nextWaveAt = INITIAL_NEXT_WAVE_AT;
  private gameOver = false;
  private enemyId = 0;
  private cameraZoom = CAMERA_ZOOM;
  private lastTime = 0;
  private animationId = 0;

  private cooldowns: Record<SpellId, number> = {
    chain: 0,
    bolt: 0,
  };

  constructor() {
    this.player.position.set(0, 0, 0);
    this.moveTarget.copy(this.player.position);

    this.setupRenderer();
    this.setupScene();
    this.setupInput();
    this.resize();

    for (let i = 0; i < INITIAL_ENEMY_COUNT; i += 1) {
      this.spawnEnemy(true);
    }

    this.animationId = window.requestAnimationFrame(this.tick);
  }

  dispose() {
    window.cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    this.hud.remove();
    this.renderer.dispose();
  }

  private setupRenderer() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0c1110, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.append(this.renderer.domElement);
  }

  private setupScene() {
    this.scene.fog = new THREE.Fog(0x0c1110, 70, 190);
    this.scene.add(this.terrainGroup, this.blockerGroup, this.enemyGroup, this.effectGroup, this.targetGroup, this.moveMarker);
    this.scene.add(this.player);

    const hemi = new THREE.HemisphereLight(0xbedce4, 0x251a18, 1.8);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff0c8, 2.2);
    keyLight.position.set(-22, 38, 18);
    keyLight.castShadow = true;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 90;
    keyLight.shadow.camera.left = -42;
    keyLight.shadow.camera.right = 42;
    keyLight.shadow.camera.top = 42;
    keyLight.shadow.camera.bottom = -42;
    keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(keyLight);

    const stormLight = new THREE.PointLight(0x61cfff, 16, 22);
    stormLight.position.set(0, 9, 0);
    this.player.add(stormLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x101819, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.moveMarker.add(createRing(1.15, 0x8bdfff, 0.55));
    this.moveMarker.add(createCrosshair(1.9, 0x8bdfff, 0.65));
    this.moveMarker.position.copy(this.moveTarget);
    this.moveMarker.position.y = 0.08;

    this.targetGroup.visible = false;
  }

  private setupInput() {
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private readonly tick = (time: number) => {
    const dt = Math.min(0.05, this.clock.getDelta() || (time - this.lastTime) / 1000 || 0.016);
    this.lastTime = time;

    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.animationId = window.requestAnimationFrame(this.tick);
  };

  private update(dt: number) {
    this.updateCamera(dt);
    this.updateTerrainWindow();
    this.updateTargetingVisual();
    this.updateHud();

    if (this.gameOver) {
      this.effectsLayer.update(dt);
      return;
    }

    this.mana = Math.min(PLAYER_MAX_MANA, this.mana + dt * 8.5);
    this.cooldowns.chain = Math.max(0, this.cooldowns.chain - dt);
    this.cooldowns.bolt = Math.max(0, this.cooldowns.bolt - dt);

    this.updateMovement(dt);
    this.updateEnemies(dt);
    this.updateSpawner(dt);
    this.effectsLayer.update(dt);
  }

  private updateMovement(dt: number) {
    if (this.pressedPointerId !== null && !this.castMode && !this.inputMoveLocked) {
      this.setMoveTarget(this.pointerWorld.x, this.pointerWorld.z);
    }

    const offset = new THREE.Vector3(this.moveTarget.x - this.player.position.x, 0, this.moveTarget.z - this.player.position.z);
    const distance = offset.length();
    if (distance < 0.18) {
      return;
    }

    const step = Math.min(distance, 18 * dt);
    offset.normalize();
    this.player.position.x += offset.x * step;
    this.player.position.z += offset.z * step;
    this.player.rotation.y = Math.atan2(offset.x, offset.z);
    this.moveMarker.position.set(this.moveTarget.x, 0.08, this.moveTarget.z);
    this.playerAura.rotation.z += dt * 1.6;
  }

  private updateEnemies(dt: number) {
    for (const enemy of this.enemies) {
      const toPlayer = new THREE.Vector3(
        this.player.position.x - enemy.group.position.x,
        0,
        this.player.position.z - enemy.group.position.z,
      );
      const distance = toPlayer.length();

      if (distance > 0.001) {
        toPlayer.normalize();
        enemy.group.position.x += toPlayer.x * enemy.speed * dt;
        enemy.group.position.z += toPlayer.z * enemy.speed * dt;
        enemy.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      }

      enemy.group.position.y = Math.sin(performance.now() * 0.006 + enemy.id) * 0.06;
      enemy.touchCooldown = Math.max(0, enemy.touchCooldown - dt);
      enemy.flashTimer = Math.max(0, enemy.flashTimer - dt);
      enemy.body.material = enemy.flashTimer > 0 ? this.materials.enemyHit : this.materials.enemy;

      if (distance < 2.25 && enemy.touchCooldown <= 0) {
        enemy.touchCooldown = 0.58;
        this.damagePlayer(8 + this.wave);
      }
    }
  }

  private updateSpawner(dt: number) {
    this.spawnTimer -= dt;

    if (this.kills >= this.nextWaveAt) {
      this.wave += 1;
      this.nextWaveAt += 12 + this.wave * 5;
      this.spawnInterval = Math.max(0.46, this.spawnInterval - 0.12);
      this.effectsLayer.createShockwave(this.player.position, 0xb184ff, 10);
    }

    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.spawnInterval;
      this.spawnEnemy();
    }
  }

  private updateCamera(dt: number) {
    const target = this.player.position;
    const cameraTarget = new THREE.Vector3(target.x + 32, 36, target.z + 32);
    this.camera.position.lerp(cameraTarget, 1 - Math.pow(0.001, dt));
    this.camera.lookAt(target.x, 0, target.z);
  }

  private updateTerrainWindow() {
    const center = this.gridWorld.worldToCell(this.player.position.x, this.player.position.z);
    const radius = 16;
    const key = `${Math.floor(center.x / 2)},${Math.floor(center.z / 2)}`;

    if (key === this.terrainWindowKey) {
      return;
    }

    this.terrainWindowKey = key;
    this.terrainGroup.clear();
    this.blockerGroup.clear();

    const tileGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.98, 0.1, TILE_SIZE * 0.98);
    const blockerGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.88, 2.6, TILE_SIZE * 0.88);

    for (let z = center.z - radius; z <= center.z + radius; z += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        if (x < 0 || z < 0 || x >= WORLD_CELLS || z >= WORLD_CELLS) {
          continue;
        }

        const cell = this.gridWorld.getCell(x, z);
        const world = this.gridWorld.cellToWorld(x, z);
        const material =
          cell.kind === "charged"
            ? this.materials.charged
            : cell.kind === "scarred"
              ? this.materials.scarred
              : this.materials.floor;

        const tile = new THREE.Mesh(tileGeometry, material);
        tile.position.set(world.x, -0.04, world.z);
        tile.receiveShadow = true;
        this.terrainGroup.add(tile);

        if (cell.kind === "charged") {
          this.terrainGroup.add(createChargedGlyph(world.x, world.z));
        }

        if (cell.blocked) {
          const blocker = new THREE.Mesh(blockerGeometry, this.materials.blocker);
          blocker.position.set(world.x, 1.25, world.z);
          blocker.castShadow = true;
          blocker.receiveShadow = true;
          this.blockerGroup.add(blocker);
        }
      }
    }

    const grid = new THREE.GridHelper((radius * 2 + 1) * TILE_SIZE, radius * 2 + 1, 0x38515a, 0x263238);
    grid.position.set(
      center.x * TILE_SIZE - WORLD_HALF + TILE_SIZE / 2,
      0.025,
      center.z * TILE_SIZE - WORLD_HALF + TILE_SIZE / 2,
    );
    grid.material = new THREE.LineBasicMaterial({ color: 0x263238, transparent: true, opacity: 0.62 });
    this.terrainGroup.add(grid);
  }

  private updateTargetingVisual() {
    this.targetGroup.clear();

    if (!this.castMode) {
      this.targetGroup.visible = false;
      return;
    }

    this.targetGroup.visible = true;
    const spell = this.spells[this.castMode];
    const target = this.clampToSpellRange(this.pointerWorld, spell.range);
    const inRange =
      distance2D(this.player.position.x, this.player.position.z, this.pointerWorld.x, this.pointerWorld.z) <= spell.range;
    const color = inRange ? spell.color : 0xff5465;

    const spellRadius = this.castMode === "chain" ? 4.4 : 3.3;
    const rangeRing = createRing(spell.range, color, 0.18);
    rangeRing.position.set(this.player.position.x, 0.13, this.player.position.z);
    this.targetGroup.add(rangeRing);

    const reticle = createRing(spellRadius, color, 0.86);
    reticle.position.set(target.x, 0.16, target.z);
    this.targetGroup.add(reticle);

    const crosshair = createCrosshair(spellRadius + 1, color, 0.84);
    crosshair.position.copy(reticle.position);
    this.targetGroup.add(crosshair);
  }

  private updateHud() {
    const cell = this.gridWorld.worldToCell(this.player.position.x, this.player.position.z);
    this.hud.update({
      health: this.health,
      mana: this.mana,
      kills: this.kills,
      wave: this.wave,
      cellX: cell.x,
      cellZ: cell.z,
      castMode: this.castMode,
      cooldowns: this.cooldowns,
      spells: this.spells,
      gameOver: this.gameOver,
    });
  }

  private readonly resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / Math.max(1, height);

    this.camera.left = -this.cameraZoom * aspect;
    this.camera.right = this.cameraZoom * aspect;
    this.camera.top = this.cameraZoom;
    this.camera.bottom = -this.cameraZoom;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    if (event.key.toLowerCase() === "q") {
      this.beginTargeting("chain");
    } else if (event.key.toLowerCase() === "w") {
      this.beginTargeting("bolt");
    } else if (event.key === "Escape") {
      this.castMode = null;
    } else if (event.key.toLowerCase() === "r" && this.gameOver) {
      this.restart();
    }
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.gameOver) {
      return;
    }

    this.updatePointerWorld(event);
    this.pressedPointerId = event.pointerId;

    if (this.castMode) {
      this.castAt(this.castMode, this.pointerWorld);
      this.castMode = null;
      this.inputMoveLocked = true;
      return;
    }

    this.setMoveTarget(this.pointerWorld.x, this.pointerWorld.z);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.updatePointerWorld(event);
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId === this.pressedPointerId) {
      this.pressedPointerId = null;
      this.inputMoveLocked = false;
    }
  };

  private updatePointerWorld(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.pointerWorld);
    this.gridWorld.clampWorld(this.pointerWorld);
  }

  private beginTargeting(spellId: SpellId) {
    if (this.gameOver) {
      return;
    }

    const spell = this.spells[spellId];
    if (this.cooldowns[spellId] > 0 || this.mana < spell.manaCost) {
      this.flashPlayer(0x657172);
      return;
    }

    this.castMode = spellId;
  }

  private castAt(spellId: SpellId, rawTarget: THREE.Vector3) {
    const spell = this.spells[spellId];
    if (this.cooldowns[spellId] > 0 || this.mana < spell.manaCost) {
      this.flashPlayer(0x657172);
      return;
    }

    const target = this.clampToSpellRange(rawTarget, spell.range);
    this.mana -= spell.manaCost;
    this.cooldowns[spellId] = spell.cooldown;

    if (spellId === "chain") {
      this.castChainLightning(target);
    } else {
      this.castLightningBolt(target);
    }
  }

  private castChainLightning(target: THREE.Vector3) {
    const firstTarget = this.findClosestEnemy(target, 12);
    if (!firstTarget) {
      this.effectsLayer.createShockwave(target, 0x83dfff, 3.5);
      return;
    }

    const struck = new Set<EnemyState>();
    let origin = this.player.position.clone();
    let current: EnemyState | null = firstTarget;
    let damage = 42 + this.wave * 1.5;

    for (let jump = 0; jump < 5 && current; jump += 1) {
      struck.add(current);
      const enemyPosition = current.group.position.clone();
      enemyPosition.y = 1.8;
      this.effectsLayer.createLightningArc(origin.clone().setY(2.4), enemyPosition, 0x91e7ff);
      this.damageEnemy(current, damage);
      origin = enemyPosition;
      damage *= 0.82;
      current = this.findClosestEnemy(origin, 18, struck);
    }
  }

  private castLightningBolt(target: THREE.Vector3) {
    const primary = this.findClosestEnemy(target, 7);
    const impact = primary ? primary.group.position.clone() : target.clone();
    impact.y = 0;

    this.effectsLayer.createVerticalBolt(impact);
    this.effectsLayer.createShockwave(impact, 0xffe27a, 7.5);

    if (primary) {
      this.damageEnemy(primary, 94 + this.wave * 2.5);
    }

    for (const enemy of this.enemies) {
      if (enemy === primary) {
        continue;
      }

      const distance = distance2D(impact.x, impact.z, enemy.group.position.x, enemy.group.position.z);
      if (distance <= 7.2) {
        this.damageEnemy(enemy, 28);
      }
    }
  }

  private spawnEnemy(initial = false) {
    const angle = randomBetween(0, Math.PI * 2);
    const distance = initial ? randomBetween(20, 34) : randomBetween(42, 56);
    const x = clamp(this.player.position.x + Math.cos(angle) * distance, -WORLD_HALF + 5, WORLD_HALF - 5);
    const z = clamp(this.player.position.z + Math.sin(angle) * distance, -WORLD_HALF + 5, WORLD_HALF - 5);
    const { group, body } = createEnemyModel(this.materials.enemy);
    group.position.set(x, 0, z);
    this.enemyGroup.add(group);

    this.enemies.push({
      id: this.enemyId,
      group,
      body,
      hp: 70 + this.wave * 9,
      maxHp: 70 + this.wave * 9,
      speed: randomBetween(5.7, 7.4) + this.wave * 0.16,
      touchCooldown: randomBetween(0.1, 0.5),
      flashTimer: 0,
    });
    this.enemyId += 1;
  }

  private damageEnemy(enemy: EnemyState, amount: number) {
    enemy.hp -= amount;
    enemy.flashTimer = 0.09;

    if (enemy.hp > 0) {
      return;
    }

    const deathPosition = enemy.group.position.clone();
    enemy.group.removeFromParent();
    this.enemies = this.enemies.filter((candidate) => candidate !== enemy);
    this.kills += 1;
    this.mana = Math.min(PLAYER_MAX_MANA, this.mana + 4);
    this.effectsLayer.createShockwave(deathPosition, 0x67e3c0, 3);
  }

  private damagePlayer(amount: number) {
    this.health = Math.max(0, this.health - amount);
    this.flashPlayer(0xff5c66);
    this.effectsLayer.createShockwave(this.player.position, 0xff5c66, 2.5);

    if (this.health <= 0) {
      this.gameOver = true;
      this.materials.player.color.set(0x59676a);
      this.materials.player.emissive.set(0x1b2020);
    }
  }

  private findClosestEnemy(target: THREE.Vector3, maxDistance: number, excluded: Set<EnemyState> = new Set()) {
    let closest: EnemyState | null = null;
    let closestDistance = maxDistance;

    for (const enemy of this.enemies) {
      if (excluded.has(enemy)) {
        continue;
      }

      const distance = distance2D(target.x, target.z, enemy.group.position.x, enemy.group.position.z);
      if (distance < closestDistance) {
        closest = enemy;
        closestDistance = distance;
      }
    }

    return closest;
  }

  private setMoveTarget(x: number, z: number) {
    const target = new THREE.Vector3(clamp(x, -WORLD_HALF + 2, WORLD_HALF - 2), 0, clamp(z, -WORLD_HALF + 2, WORLD_HALF - 2));

    if (this.gridWorld.isBlockedWorld(target.x, target.z)) {
      this.effectsLayer.createShockwave(target, 0x879190, 2.4);
      return;
    }

    this.moveTarget.copy(target);
    this.moveMarker.position.set(target.x, 0.08, target.z);
  }

  private clampToSpellRange(rawTarget: THREE.Vector3, range: number) {
    const origin = this.player.position;
    const offset = new THREE.Vector3(rawTarget.x - origin.x, 0, rawTarget.z - origin.z);
    const distance = offset.length();

    if (distance <= range) {
      return new THREE.Vector3(rawTarget.x, 0, rawTarget.z);
    }

    offset.normalize().multiplyScalar(range);
    return new THREE.Vector3(origin.x + offset.x, 0, origin.z + offset.z);
  }

  private flashPlayer(color: THREE.ColorRepresentation) {
    this.materials.player.color.set(color);
    window.setTimeout(() => {
      if (!this.gameOver) {
        this.materials.player.color.set(0xdfe8ee);
      }
    }, 95);
  }

  private restart() {
    this.health = PLAYER_MAX_HEALTH;
    this.mana = PLAYER_MAX_MANA;
    this.kills = 0;
    this.wave = 1;
    this.nextWaveAt = INITIAL_NEXT_WAVE_AT;
    this.spawnInterval = INITIAL_SPAWN_INTERVAL;
    this.spawnTimer = 0;
    this.gameOver = false;
    this.castMode = null;
    this.player.position.set(0, 0, 0);
    this.moveTarget.set(0, 0, 0);
    this.moveMarker.position.set(0, 0.08, 0);
    this.materials.player.color.set(0xdfe8ee);
    this.materials.player.emissive.set(0x21526b);

    for (const enemy of this.enemies) {
      enemy.group.removeFromParent();
    }
    this.enemies = [];

    for (let i = 0; i < INITIAL_ENEMY_COUNT; i += 1) {
      this.spawnEnemy(true);
    }
  }
}
