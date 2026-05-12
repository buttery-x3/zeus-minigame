import * as THREE from "three";
import "./style.css";

const TILE_SIZE = 4;
const WORLD_CELLS = 180;
const WORLD_SIZE = TILE_SIZE * WORLD_CELLS;
const WORLD_HALF = WORLD_SIZE / 2;
const PLAYER_MAX_HEALTH = 120;
const PLAYER_MAX_MANA = 100;

type SpellId = "chain" | "bolt";
type TerrainKind = "floor" | "scarred" | "charged" | "reserved_blocker";

type TerrainCell = {
  x: number;
  z: number;
  kind: TerrainKind;
  blocked: boolean;
};

type EnemyState = {
  id: number;
  group: THREE.Group;
  body: THREE.Mesh;
  hp: number;
  maxHp: number;
  speed: number;
  touchCooldown: number;
  flashTimer: number;
};

type SpellConfig = {
  id: SpellId;
  key: "Q" | "W";
  label: string;
  manaCost: number;
  cooldown: number;
  range: number;
  color: THREE.ColorRepresentation;
};

type EffectState = {
  object: THREE.Object3D;
  ttl: number;
  maxTtl: number;
  update?: (lifeRatio: number) => void;
};

class GridWorld {
  readonly tileSize = TILE_SIZE;
  readonly worldCells = WORLD_CELLS;
  readonly worldSize = WORLD_SIZE;
  readonly half = WORLD_HALF;

  private cells = new Map<string, TerrainCell>();

  worldToCell(worldX: number, worldZ: number) {
    return {
      x: Math.floor(clamp(worldX + this.half, 0, this.worldSize - 0.001) / this.tileSize),
      z: Math.floor(clamp(worldZ + this.half, 0, this.worldSize - 0.001) / this.tileSize),
    };
  }

  cellToWorld(cellX: number, cellZ: number) {
    return {
      x: cellX * this.tileSize - this.half + this.tileSize / 2,
      z: cellZ * this.tileSize - this.half + this.tileSize / 2,
    };
  }

  getCell(cellX: number, cellZ: number): TerrainCell {
    const key = `${cellX},${cellZ}`;
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }

    const kind = this.resolveTerrainKind(cellX, cellZ);
    const cell: TerrainCell = {
      x: cellX,
      z: cellZ,
      kind,
      blocked: kind === "reserved_blocker",
    };
    this.cells.set(key, cell);
    return cell;
  }

  isBlockedWorld(worldX: number, worldZ: number) {
    const cell = this.worldToCell(worldX, worldZ);
    return this.getCell(cell.x, cell.z).blocked;
  }

  clampWorld(point: THREE.Vector3) {
    point.x = clamp(point.x, -this.half + 2, this.half - 2);
    point.z = clamp(point.z, -this.half + 2, this.half - 2);
    return point;
  }

  private resolveTerrainKind(cellX: number, cellZ: number): TerrainKind {
    const h = this.hash(cellX, cellZ);

    if (h > 0.989) {
      return "reserved_blocker";
    }

    if (h > 0.925) {
      return "charged";
    }

    if (h < 0.085) {
      return "scarred";
    }

    return "floor";
  }

  private hash(x: number, z: number) {
    const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
}

class Hud {
  private root: HTMLElement;
  private healthFill: HTMLElement;
  private manaFill: HTMLElement;
  private kills: HTMLElement;
  private wave: HTMLElement;
  private cell: HTMLElement;
  private status: HTMLElement;
  private chainButton: HTMLElement;
  private boltButton: HTMLElement;

  constructor() {
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
      <section class="hud__stats">
        <div class="hud__bar hud__bar--health"><span></span></div>
        <div class="hud__bar hud__bar--mana"><span></span></div>
        <div class="hud__line"><strong data-kills>0</strong><span>Kills</span></div>
        <div class="hud__line"><strong data-wave>1</strong><span>Wave</span></div>
      </section>
      <div class="hud__status" data-status></div>
      <section class="hud__cell"><i></i><span data-cell>Cell 90, 90</span></section>
      <section class="hud__abilities">
        <button class="ability" data-ability="chain" type="button" aria-label="Chain Lightning">
          <b>Q</b><i class="ability__icon ability__icon--chain"></i><span>Chain</span><em></em>
        </button>
        <button class="ability" data-ability="bolt" type="button" aria-label="Lightning Bolt">
          <b>W</b><i class="ability__icon ability__icon--bolt"></i><span>Bolt</span><em></em>
        </button>
      </section>
    `;

    document.body.append(root);
    this.root = root;
    this.healthFill = mustQuery(root, ".hud__bar--health span");
    this.manaFill = mustQuery(root, ".hud__bar--mana span");
    this.kills = mustQuery(root, "[data-kills]");
    this.wave = mustQuery(root, "[data-wave]");
    this.cell = mustQuery(root, "[data-cell]");
    this.status = mustQuery(root, "[data-status]");
    this.chainButton = mustQuery(root, '[data-ability="chain"]');
    this.boltButton = mustQuery(root, '[data-ability="bolt"]');
  }

  update(state: {
    health: number;
    mana: number;
    kills: number;
    wave: number;
    cellX: number;
    cellZ: number;
    castMode: SpellId | null;
    cooldowns: Record<SpellId, number>;
    spells: Record<SpellId, SpellConfig>;
    gameOver: boolean;
  }) {
    this.healthFill.style.transform = `scaleX(${clamp(state.health / PLAYER_MAX_HEALTH, 0, 1)})`;
    this.manaFill.style.transform = `scaleX(${clamp(state.mana / PLAYER_MAX_MANA, 0, 1)})`;
    this.kills.textContent = `${state.kills}`;
    this.wave.textContent = `${state.wave}`;
    this.cell.textContent = `Cell ${state.cellX}, ${state.cellZ}`;

    if (state.gameOver) {
      this.status.textContent = "Storm spent. Press R.";
    } else if (state.castMode) {
      this.status.textContent = state.spells[state.castMode].label;
    } else {
      this.status.textContent = "";
    }

    this.updateAbility(this.chainButton, "chain", state);
    this.updateAbility(this.boltButton, "bolt", state);
  }

  private updateAbility(
    button: HTMLElement,
    spellId: SpellId,
    state: {
      mana: number;
      castMode: SpellId | null;
      cooldowns: Record<SpellId, number>;
      spells: Record<SpellId, SpellConfig>;
    },
  ) {
    const spell = state.spells[spellId];
    const cooldown = state.cooldowns[spellId];
    const ready = cooldown <= 0 && state.mana >= spell.manaCost;
    const cooldownLabel = mustQuery(button, "em");

    button.classList.toggle("ability--ready", ready);
    button.classList.toggle("ability--active", state.castMode === spellId);
    cooldownLabel.textContent = cooldown > 0 ? `${Math.ceil(cooldown)}` : "";
  }

  remove() {
    this.root.remove();
  }
}

class ZeusMinigame {
  private readonly container = mustQuery<HTMLElement>(document, "#game");
  private readonly gridWorld = new GridWorld();
  private readonly spells: Record<SpellId, SpellConfig> = {
    chain: {
      id: "chain",
      key: "Q",
      label: "Chain Lightning",
      manaCost: 22,
      cooldown: 2.8,
      range: 44,
      color: 0x83dfff,
    },
    bolt: {
      id: "bolt",
      key: "W",
      label: "Lightning Bolt",
      manaCost: 34,
      cooldown: 4.1,
      range: 50,
      color: 0xffe27a,
    },
  };

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1400);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointerWorld = new THREE.Vector3();
  private readonly hud = new Hud();

  private readonly player = new THREE.Group();
  private readonly playerBody: THREE.Mesh;
  private readonly playerAura: THREE.Mesh;
  private readonly moveTarget = new THREE.Vector3(0, 0, 0);
  private readonly terrainGroup = new THREE.Group();
  private readonly blockerGroup = new THREE.Group();
  private readonly enemyGroup = new THREE.Group();
  private readonly effectGroup = new THREE.Group();
  private readonly targetGroup = new THREE.Group();
  private readonly moveMarker = new THREE.Group();
  private readonly clock = new THREE.Clock();

  private readonly floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x172126,
    roughness: 0.92,
    metalness: 0.02,
  });
  private readonly scarredMaterial = new THREE.MeshStandardMaterial({
    color: 0x231a1a,
    roughness: 0.96,
  });
  private readonly chargedMaterial = new THREE.MeshStandardMaterial({
    color: 0x173733,
    emissive: 0x0b312c,
    emissiveIntensity: 0.45,
    roughness: 0.7,
  });
  private readonly blockerMaterial = new THREE.MeshStandardMaterial({
    color: 0x4d5554,
    roughness: 0.84,
  });
  private readonly playerMaterial = new THREE.MeshStandardMaterial({
    color: 0xdfe8ee,
    emissive: 0x21526b,
    emissiveIntensity: 0.25,
    roughness: 0.42,
  });
  private readonly enemyMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7423f,
    emissive: 0x2d0508,
    emissiveIntensity: 0.22,
    roughness: 0.68,
  });
  private readonly enemyHitMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xff755e,
    emissiveIntensity: 0.8,
    roughness: 0.42,
  });

  private terrainWindowKey = "";
  private enemies: EnemyState[] = [];
  private effects: EffectState[] = [];
  private pressedPointerId: number | null = null;
  private castMode: SpellId | null = null;
  private inputMoveLocked = false;
  private health = PLAYER_MAX_HEALTH;
  private mana = PLAYER_MAX_MANA;
  private kills = 0;
  private wave = 1;
  private spawnTimer = 0;
  private spawnInterval = 1.25;
  private nextWaveAt = 12;
  private gameOver = false;
  private enemyId = 0;
  private cameraZoom = 44;
  private lastTime = 0;
  private animationId = 0;

  private cooldowns: Record<SpellId, number> = {
    chain: 0,
    bolt: 0,
  };

  constructor() {
    const bodyGeometry = new THREE.CapsuleGeometry(1.05, 1.65, 6, 16);
    this.playerBody = new THREE.Mesh(bodyGeometry, this.playerMaterial);
    this.playerBody.castShadow = true;
    this.playerBody.position.y = 1.55;

    this.playerAura = new THREE.Mesh(
      new THREE.TorusGeometry(1.62, 0.045, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x7bd7ff, transparent: true, opacity: 0.54 }),
    );
    this.playerAura.rotation.x = Math.PI / 2;
    this.playerAura.position.y = 0.08;

    this.player.add(this.playerAura, this.playerBody, this.createLightningMark());
    this.player.position.set(0, 0, 0);
    this.moveTarget.copy(this.player.position);

    this.setupRenderer();
    this.setupScene();
    this.setupInput();
    this.resize();

    for (let i = 0; i < 8; i += 1) {
      this.spawnEnemy(true);
    }

    this.animationId = window.requestAnimationFrame(this.tick);
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
      this.updateEffects(dt);
      return;
    }

    this.mana = Math.min(PLAYER_MAX_MANA, this.mana + dt * 8.5);
    this.cooldowns.chain = Math.max(0, this.cooldowns.chain - dt);
    this.cooldowns.bolt = Math.max(0, this.cooldowns.bolt - dt);

    this.updateMovement(dt);
    this.updateEnemies(dt);
    this.updateSpawner(dt);
    this.updateEffects(dt);
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
      enemy.body.material = enemy.flashTimer > 0 ? this.enemyHitMaterial : this.enemyMaterial;

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
      this.createShockwave(this.player.position, 0xb184ff, 10);
    }

    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.spawnInterval;
      this.spawnEnemy();
    }
  }

  private updateEffects(dt: number) {
    this.effects = this.effects.filter((effect) => {
      effect.ttl -= dt;
      const lifeRatio = clamp(effect.ttl / effect.maxTtl, 0, 1);
      effect.update?.(lifeRatio);

      if (effect.ttl <= 0) {
        effect.object.removeFromParent();
        return false;
      }

      return true;
    });
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
            ? this.chargedMaterial
            : cell.kind === "scarred"
              ? this.scarredMaterial
              : this.floorMaterial;

        const tile = new THREE.Mesh(tileGeometry, material);
        tile.position.set(world.x, -0.04, world.z);
        tile.receiveShadow = true;
        this.terrainGroup.add(tile);

        if (cell.kind === "charged") {
          this.terrainGroup.add(this.createChargedGlyph(world.x, world.z));
        }

        if (cell.blocked) {
          const blocker = new THREE.Mesh(blockerGeometry, this.blockerMaterial);
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
      this.createShockwave(target, 0x83dfff, 3.5);
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
      this.createLightningArc(origin.clone().setY(2.4), enemyPosition, 0x91e7ff);
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

    this.createVerticalBolt(impact);
    this.createShockwave(impact, 0xffe27a, 7.5);

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
    const group = new THREE.Group();

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.05, 5, 12), this.enemyMaterial);
    body.position.y = 1.22;
    body.castShadow = true;

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffc07a });
    const eyeGeometry = new THREE.SphereGeometry(0.09, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.28, 1.55, 0.78);
    const rightEye = leftEye.clone();
    rightEye.position.x = 0.28;

    group.add(body, leftEye, rightEye);
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
    this.createShockwave(deathPosition, 0x67e3c0, 3);
  }

  private damagePlayer(amount: number) {
    this.health = Math.max(0, this.health - amount);
    this.flashPlayer(0xff5c66);
    this.createShockwave(this.player.position, 0xff5c66, 2.5);

    if (this.health <= 0) {
      this.gameOver = true;
      this.playerMaterial.color.set(0x59676a);
      this.playerMaterial.emissive.set(0x1b2020);
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
      this.createShockwave(target, 0x879190, 2.4);
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

  private createLightningArc(start: THREE.Vector3, end: THREE.Vector3, color: THREE.ColorRepresentation) {
    const group = new THREE.Group();
    const points = jaggedLine(start, end, 11, 0.8);
    const glow = createLine(points, 0xffffff, 0.32);
    glow.scale.setScalar(1.015);
    const core = createLine(points, color, 1);
    group.add(glow, core);
    this.effectGroup.add(group);
    this.effects.push({
      object: group,
      ttl: 0.2,
      maxTtl: 0.2,
      update: (lifeRatio) => {
        setLineOpacity(glow, lifeRatio * 0.32);
        setLineOpacity(core, lifeRatio);
      },
    });
  }

  private createVerticalBolt(position: THREE.Vector3) {
    const group = new THREE.Group();
    const start = new THREE.Vector3(position.x - 1.7, 26, position.z - 1.2);
    const end = new THREE.Vector3(position.x, 0.5, position.z);
    const points = jaggedLine(start, end, 14, 1.2);
    const glow = createLine(points, 0xffffff, 0.36);
    const core = createLine(points, 0xffe27a, 1);
    const light = new THREE.PointLight(0xffe27a, 34, 18);
    light.position.copy(new THREE.Vector3(position.x, 4, position.z));
    group.add(glow, core, light);
    this.effectGroup.add(group);
    this.effects.push({
      object: group,
      ttl: 0.26,
      maxTtl: 0.26,
      update: (lifeRatio) => {
        setLineOpacity(glow, lifeRatio * 0.36);
        setLineOpacity(core, lifeRatio);
        light.intensity = 34 * lifeRatio;
      },
    });
  }

  private createShockwave(position: THREE.Vector3, color: THREE.ColorRepresentation, radius: number) {
    const ring = createRing(0.55, color, 0.84);
    ring.position.set(position.x, 0.19, position.z);
    this.effectGroup.add(ring);
    this.effects.push({
      object: ring,
      ttl: 0.32,
      maxTtl: 0.32,
      update: (lifeRatio) => {
        const growth = 1 + (1 - lifeRatio) * radius;
        ring.scale.set(growth, growth, growth);
        setLineOpacity(ring, lifeRatio * 0.84);
      },
    });
  }

  private flashPlayer(color: THREE.ColorRepresentation) {
    this.playerMaterial.color.set(color);
    window.setTimeout(() => {
      if (!this.gameOver) {
        this.playerMaterial.color.set(0xdfe8ee);
      }
    }, 95);
  }

  private createLightningMark() {
    const shape = new THREE.Shape();
    shape.moveTo(0.18, 0.05);
    shape.lineTo(-0.18, 0.68);
    shape.lineTo(0.18, 0.55);
    shape.lineTo(-0.04, 1.18);
    shape.lineTo(0.48, 0.36);
    shape.lineTo(0.12, 0.48);
    shape.closePath();

    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0x7bd7ff, side: THREE.DoubleSide }),
    );
    mesh.position.set(-0.24, 1.2, 1.08);
    mesh.rotation.x = 0;
    return mesh;
  }

  private createChargedGlyph(x: number, z: number) {
    const group = new THREE.Group();
    const line = createLine(
      [
        new THREE.Vector3(-0.7, 0.03, 0.9),
        new THREE.Vector3(0.05, 0.03, -0.25),
        new THREE.Vector3(0.48, 0.03, 0.1),
        new THREE.Vector3(0.0, 0.03, -0.9),
      ],
      0x67e3c0,
      0.7,
    );
    group.add(line);
    group.position.set(x, 0.05, z);
    return group;
  }

  private restart() {
    this.health = PLAYER_MAX_HEALTH;
    this.mana = PLAYER_MAX_MANA;
    this.kills = 0;
    this.wave = 1;
    this.nextWaveAt = 12;
    this.spawnInterval = 1.25;
    this.spawnTimer = 0;
    this.gameOver = false;
    this.castMode = null;
    this.player.position.set(0, 0, 0);
    this.moveTarget.set(0, 0, 0);
    this.moveMarker.position.set(0, 0.08, 0);
    this.playerMaterial.color.set(0xdfe8ee);
    this.playerMaterial.emissive.set(0x21526b);

    for (const enemy of this.enemies) {
      enemy.group.removeFromParent();
    }
    this.enemies = [];

    for (let i = 0; i < 8; i += 1) {
      this.spawnEnemy(true);
    }
  }

  dispose() {
    window.cancelAnimationFrame(this.animationId);
    this.hud.remove();
    this.renderer.dispose();
  }
}

function createRing(radius: number, color: THREE.ColorRepresentation, opacity: number) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2);
  const points = curve.getPoints(96).map((point) => new THREE.Vector3(point.x, 0, point.y));
  return createLine(points, color, opacity);
}

function createCrosshair(radius: number, color: THREE.ColorRepresentation, opacity: number) {
  const points = [
    new THREE.Vector3(-radius, 0, 0),
    new THREE.Vector3(-radius * 0.45, 0, 0),
    new THREE.Vector3(radius * 0.45, 0, 0),
    new THREE.Vector3(radius, 0, 0),
    new THREE.Vector3(0, 0, -radius),
    new THREE.Vector3(0, 0, -radius * 0.45),
    new THREE.Vector3(0, 0, radius * 0.45),
    new THREE.Vector3(0, 0, radius),
  ];
  const group = new THREE.Group();
  group.add(createLine(points.slice(0, 4), color, opacity));
  group.add(createLine(points.slice(4), color, opacity));
  return group;
}

function createLine(points: THREE.Vector3[], color: THREE.ColorRepresentation, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.Line(geometry, material);
}

function setLineOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse((child) => {
    const maybeLine = child as THREE.Line;
    const material = maybeLine.material;
    if (material instanceof THREE.LineBasicMaterial) {
      material.opacity = opacity;
    }
  });
}

function jaggedLine(start: THREE.Vector3, end: THREE.Vector3, steps: number, jitter: number) {
  const points: THREE.Vector3[] = [];
  const direction = end.clone().sub(start).normalize();
  const side = new THREE.Vector3(-direction.z, 0, direction.x);

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = start.clone().lerp(end, t);
    if (i > 0 && i < steps) {
      point.addScaledVector(side, randomBetween(-jitter, jitter));
      point.y += randomBetween(-jitter * 0.35, jitter * 0.35);
    }
    points.push(point);
  }

  return points;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function distance2D(x1: number, z1: number, x2: number, z2: number) {
  return Math.hypot(x2 - x1, z2 - z1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function mustQuery<T extends Element = Element>(parent: ParentNode, selector: string) {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

new ZeusMinigame();
