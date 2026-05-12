import Phaser from "phaser";
import "./style.css";

const TILE_SIZE = 64;
const WORLD_CELLS = 120;
const WORLD_SIZE = TILE_SIZE * WORLD_CELLS;
const WORLD_CENTER = WORLD_SIZE / 2;

type SpellId = "chain" | "bolt";

type TerrainKind = "floor" | "scarred" | "charged" | "reserved_blocker";

type TerrainCell = {
  x: number;
  y: number;
  kind: TerrainKind;
  blocked: boolean;
};

type EnemyState = {
  sprite: Phaser.Physics.Arcade.Sprite;
  hp: number;
  maxHp: number;
  speed: number;
  touchCooldown: number;
};

type SpellConfig = {
  id: SpellId;
  key: "Q" | "W";
  label: string;
  manaCost: number;
  cooldown: number;
  range: number;
  color: number;
};

class GridWorld {
  readonly tileSize = TILE_SIZE;
  readonly worldCells = WORLD_CELLS;
  readonly worldSize = WORLD_SIZE;

  private cells = new Map<string, TerrainCell>();

  worldToCell(worldX: number, worldY: number) {
    return {
      x: Math.floor(Phaser.Math.Clamp(worldX, 0, this.worldSize - 1) / this.tileSize),
      y: Math.floor(Phaser.Math.Clamp(worldY, 0, this.worldSize - 1) / this.tileSize),
    };
  }

  cellToWorld(cellX: number, cellY: number) {
    return {
      x: cellX * this.tileSize + this.tileSize / 2,
      y: cellY * this.tileSize + this.tileSize / 2,
    };
  }

  getCell(cellX: number, cellY: number): TerrainCell {
    const key = `${cellX},${cellY}`;
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }

    const kind = this.resolveTerrainKind(cellX, cellY);
    const cell: TerrainCell = {
      x: cellX,
      y: cellY,
      kind,
      blocked: kind === "reserved_blocker",
    };
    this.cells.set(key, cell);
    return cell;
  }

  isBlockedWorld(worldX: number, worldY: number) {
    const cell = this.worldToCell(worldX, worldY);
    return this.getCell(cell.x, cell.y).blocked;
  }

  private resolveTerrainKind(cellX: number, cellY: number): TerrainKind {
    const h = this.hash(cellX, cellY);

    if (h > 0.986) {
      return "reserved_blocker";
    }

    if (h > 0.92) {
      return "charged";
    }

    if (h < 0.09) {
      return "scarred";
    }

    return "floor";
  }

  private hash(x: number, y: number) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
}

class StormArenaScene extends Phaser.Scene {
  private readonly gridWorld = new GridWorld();
  private readonly spells: Record<SpellId, SpellConfig> = {
    chain: {
      id: "chain",
      key: "Q",
      label: "Chain Lightning",
      manaCost: 22,
      cooldown: 2.8,
      range: 720,
      color: 0x85d8ff,
    },
    bolt: {
      id: "bolt",
      key: "W",
      label: "Lightning Bolt",
      manaCost: 34,
      cooldown: 4.1,
      range: 780,
      color: 0xfff08a,
    },
  };

  private player!: Phaser.Physics.Arcade.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private terrainGraphics!: Phaser.GameObjects.Graphics;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private targetingGraphics!: Phaser.GameObjects.Graphics;
  private effectGraphics!: Phaser.GameObjects.Graphics;
  private uiGraphics!: Phaser.GameObjects.Graphics;
  private killText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private cellText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private abilityTexts: Phaser.GameObjects.Text[] = [];

  private enemiesState: EnemyState[] = [];
  private moveTarget = new Phaser.Math.Vector2(WORLD_CENTER, WORLD_CENTER);
  private castMode: SpellId | null = null;
  private inputMoveLocked = false;
  private health = 120;
  private mana = 100;
  private kills = 0;
  private wave = 1;
  private spawnTimer = 0;
  private spawnInterval = 1.35;
  private nextWaveAt = 12;
  private gameOver = false;

  private cooldowns: Record<SpellId, number> = {
    chain: 0,
    bolt: 0,
  };

  constructor() {
    super("storm-arena");
  }

  preload() {
    this.createGeneratedTextures();
  }

  create() {
    this.physics.world.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);

    this.terrainGraphics = this.add.graphics().setDepth(-30);
    this.gridGraphics = this.add.graphics().setDepth(-20);
    this.effectGraphics = this.add.graphics().setDepth(40);
    this.targetingGraphics = this.add.graphics().setDepth(35);
    this.uiGraphics = this.add.graphics().setDepth(100).setScrollFactor(0);

    this.player = this.physics.add.sprite(WORLD_CENTER, WORLD_CENTER, "player");
    this.player.setCircle(18, 14, 14);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(20);
    this.player.setDrag(900);

    this.enemies = this.physics.add.group();

    this.cameras.main.setBackgroundColor(0x071016);
    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
    this.cameras.main.startFollow(this.player, true, 0.14, 0.14);
    this.cameras.main.setDeadzone(80, 80);

    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointerup", () => {
      this.inputMoveLocked = false;
    });

    this.input.keyboard?.on("keydown-Q", () => this.beginTargeting("chain"));
    this.input.keyboard?.on("keydown-W", () => this.beginTargeting("bolt"));
    this.input.keyboard?.on("keydown-ESC", () => {
      this.castMode = null;
    });
    this.input.keyboard?.on("keydown-R", () => {
      if (this.gameOver) {
        this.scene.restart();
      }
    });

    this.killText = this.add.text(24, 78, "", this.hudTextStyle(16)).setDepth(110).setScrollFactor(0);
    this.waveText = this.add.text(24, 102, "", this.hudTextStyle(16)).setDepth(110).setScrollFactor(0);
    this.cellText = this.add.text(0, 0, "", this.hudTextStyle(12)).setDepth(110).setScrollFactor(0);
    this.statusText = this.add
      .text(0, 0, "", {
        ...this.hudTextStyle(20),
        align: "center",
        color: "#eaf8ff",
      })
      .setOrigin(0.5)
      .setDepth(120)
      .setScrollFactor(0);

    this.abilityTexts = [
      this.add.text(0, 0, "", this.hudTextStyle(12)).setOrigin(0.5).setDepth(110).setScrollFactor(0),
      this.add.text(0, 0, "", this.hudTextStyle(12)).setOrigin(0.5).setDepth(110).setScrollFactor(0),
    ];

    for (let i = 0; i < 7; i += 1) {
      this.spawnEnemy(true);
    }
  }

  update(_time: number, deltaMs: number) {
    const dt = deltaMs / 1000;

    this.drawVisibleWorld();
    this.drawTargeting();
    this.updateUi();

    if (this.gameOver) {
      this.player.setVelocity(0, 0);
      return;
    }

    this.mana = Math.min(100, this.mana + dt * 8.5);
    this.cooldowns.chain = Math.max(0, this.cooldowns.chain - dt);
    this.cooldowns.bolt = Math.max(0, this.cooldowns.bolt - dt);

    this.updateMovement();
    this.updateEnemies(dt);
    this.updateSpawner(dt);
  }

  private createGeneratedTextures() {
    if (this.textures.exists("player")) {
      return;
    }

    const g = this.make.graphics({ x: 0, y: 0 });

    g.clear();
    g.fillStyle(0x22384f, 1);
    g.fillCircle(32, 32, 24);
    g.fillStyle(0xd8f7ff, 1);
    g.fillCircle(32, 32, 14);
    g.lineStyle(3, 0x71d9ff, 1);
    g.beginPath();
    g.moveTo(34, 9);
    g.lineTo(24, 32);
    g.lineTo(35, 29);
    g.lineTo(27, 55);
    g.lineTo(45, 24);
    g.lineTo(34, 27);
    g.closePath();
    g.strokePath();
    g.generateTexture("player", 64, 64);

    g.clear();
    g.fillStyle(0x3a1015, 1);
    g.fillCircle(24, 24, 20);
    g.lineStyle(3, 0xff5c63, 1);
    g.strokeCircle(24, 24, 18);
    g.fillStyle(0xff9a75, 1);
    g.fillCircle(17, 18, 4);
    g.fillCircle(31, 18, 4);
    g.generateTexture("enemy", 48, 48);

    g.clear();
    g.fillStyle(0x1d2b34, 1);
    g.fillRoundedRect(0, 0, 64, 64, 10);
    g.lineStyle(2, 0x42515a, 0.8);
    g.strokeRoundedRect(5, 5, 54, 54, 8);
    g.fillStyle(0x5c6a75, 0.5);
    g.fillCircle(25, 23, 7);
    g.fillCircle(42, 42, 10);
    g.generateTexture("reserved-blocker", 64, 64);

    g.destroy();
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (pointer.button !== 0 || this.gameOver) {
      return;
    }

    const worldPoint = this.pointerToWorld(pointer);

    if (this.castMode) {
      this.castAt(this.castMode, worldPoint);
      this.castMode = null;
      this.inputMoveLocked = true;
      return;
    }

    this.setMoveTarget(worldPoint.x, worldPoint.y);
  }

  private beginTargeting(spellId: SpellId) {
    if (this.gameOver) {
      return;
    }

    const spell = this.spells[spellId];
    if (this.cooldowns[spellId] > 0 || this.mana < spell.manaCost) {
      this.flashPlayer(0x4b6575);
      return;
    }

    this.castMode = spellId;
  }

  private castAt(spellId: SpellId, rawTarget: Phaser.Math.Vector2) {
    const spell = this.spells[spellId];
    if (this.cooldowns[spellId] > 0 || this.mana < spell.manaCost) {
      this.flashPlayer(0x4b6575);
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

  private castChainLightning(target: Phaser.Math.Vector2) {
    const firstTarget = this.findClosestEnemy(target, 220);
    if (!firstTarget) {
      this.createImpactPulse(target.x, target.y, 0x85d8ff, 42);
      return;
    }

    const struck = new Set<EnemyState>();
    let origin = new Phaser.Math.Vector2(this.player.x, this.player.y);
    let current: EnemyState | null = firstTarget;
    let damage = 42 + this.wave * 1.5;

    for (let jump = 0; jump < 5 && current; jump += 1) {
      struck.add(current);
      this.createLightningArc(origin.x, origin.y, current.sprite.x, current.sprite.y, 0x92e6ff);
      this.damageEnemy(current, damage);
      origin = new Phaser.Math.Vector2(current.sprite.x, current.sprite.y);
      damage *= 0.82;

      current = this.findClosestEnemy(origin, 340, struck);
    }
  }

  private castLightningBolt(target: Phaser.Math.Vector2) {
    const primary = this.findClosestEnemy(target, 145);
    const impact = primary
      ? new Phaser.Math.Vector2(primary.sprite.x, primary.sprite.y)
      : new Phaser.Math.Vector2(target.x, target.y);

    this.createLightningBolt(impact.x, impact.y);
    this.createImpactPulse(impact.x, impact.y, 0xfff08a, 96);

    if (primary) {
      this.damageEnemy(primary, 94 + this.wave * 2.5);
    }

    for (const enemy of this.enemiesState) {
      if (enemy === primary || !enemy.sprite.active) {
        continue;
      }

      const dist = Phaser.Math.Distance.Between(impact.x, impact.y, enemy.sprite.x, enemy.sprite.y);
      if (dist <= 108) {
        this.damageEnemy(enemy, 28);
      }
    }
  }

  private updateMovement() {
    const pointer = this.input.activePointer;
    if (!this.castMode && pointer.isDown && !this.inputMoveLocked) {
      const worldPoint = this.pointerToWorld(pointer);
      this.setMoveTarget(worldPoint.x, worldPoint.y);
    }

    const toTarget = new Phaser.Math.Vector2(this.moveTarget.x - this.player.x, this.moveTarget.y - this.player.y);
    const distance = toTarget.length();

    if (distance < 8) {
      this.player.setVelocity(0, 0);
      return;
    }

    const speed = 255;
    toTarget.normalize();
    this.player.setVelocity(toTarget.x * speed, toTarget.y * speed);
    this.player.rotation = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.moveTarget.x, this.moveTarget.y);
  }

  private updateEnemies(dt: number) {
    for (const enemy of this.enemiesState) {
      if (!enemy.sprite.active) {
        continue;
      }

      const angle = Phaser.Math.Angle.Between(enemy.sprite.x, enemy.sprite.y, this.player.x, this.player.y);
      enemy.sprite.setVelocity(Math.cos(angle) * enemy.speed, Math.sin(angle) * enemy.speed);
      enemy.sprite.rotation += dt * 2.4;

      enemy.touchCooldown = Math.max(0, enemy.touchCooldown - dt);
      const dist = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, this.player.x, this.player.y);
      if (dist < 40 && enemy.touchCooldown <= 0) {
        enemy.touchCooldown = 0.56;
        this.damagePlayer(8 + this.wave);
      }
    }

    this.enemiesState = this.enemiesState.filter((enemy) => enemy.sprite.active);
  }

  private updateSpawner(dt: number) {
    this.spawnTimer -= dt;

    if (this.kills >= this.nextWaveAt) {
      this.wave += 1;
      this.nextWaveAt += 12 + this.wave * 5;
      this.spawnInterval = Math.max(0.48, this.spawnInterval - 0.12);
      this.cameras.main.flash(180, 128, 216, 255, false);
    }

    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.spawnInterval;
      this.spawnEnemy();
    }
  }

  private spawnEnemy(initial = false) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = initial ? Phaser.Math.Between(280, 560) : Phaser.Math.Between(680, 920);
    const spawnX = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * distance, 96, WORLD_SIZE - 96);
    const spawnY = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * distance, 96, WORLD_SIZE - 96);

    const sprite = this.physics.add.sprite(spawnX, spawnY, "enemy");
    sprite.setCircle(18, 6, 6);
    sprite.setDepth(15);
    sprite.setTint(Phaser.Display.Color.GetColor(255, Phaser.Math.Between(70, 120), Phaser.Math.Between(55, 75)));

    this.enemies.add(sprite);
    this.enemiesState.push({
      sprite,
      hp: 70 + this.wave * 9,
      maxHp: 70 + this.wave * 9,
      speed: Phaser.Math.Between(86, 116) + this.wave * 2,
      touchCooldown: Phaser.Math.FloatBetween(0.1, 0.5),
    });
  }

  private damageEnemy(enemy: EnemyState, amount: number) {
    if (!enemy.sprite.active) {
      return;
    }

    enemy.hp -= amount;
    enemy.sprite.setTint(0xffffff);
    this.time.delayedCall(70, () => {
      if (enemy.sprite.active) {
        enemy.sprite.setTint(0xff6f61);
      }
    });

    if (enemy.hp <= 0) {
      const { x, y } = enemy.sprite;
      enemy.sprite.destroy();
      this.kills += 1;
      this.createImpactPulse(x, y, 0x7ad7ff, 34);
      this.mana = Math.min(100, this.mana + 4);
    }
  }

  private damagePlayer(amount: number) {
    this.health = Math.max(0, this.health - amount);
    this.flashPlayer(0xff4f5f);
    this.cameras.main.shake(90, 0.003);

    if (this.health <= 0) {
      this.gameOver = true;
      this.player.setTint(0x55606a);
      this.statusText.setText("Storm spent\nR to restart");
    }
  }

  private findClosestEnemy(
    point: Phaser.Math.Vector2,
    maxDistance: number,
    excluded: Set<EnemyState> = new Set(),
  ) {
    let closest: EnemyState | null = null;
    let closestDistance = maxDistance;

    for (const enemy of this.enemiesState) {
      if (!enemy.sprite.active || excluded.has(enemy)) {
        continue;
      }

      const distance = Phaser.Math.Distance.Between(point.x, point.y, enemy.sprite.x, enemy.sprite.y);
      if (distance < closestDistance) {
        closest = enemy;
        closestDistance = distance;
      }
    }

    return closest;
  }

  private setMoveTarget(x: number, y: number) {
    const clampedX = Phaser.Math.Clamp(x, 0, WORLD_SIZE);
    const clampedY = Phaser.Math.Clamp(y, 0, WORLD_SIZE);

    if (this.gridWorld.isBlockedWorld(clampedX, clampedY)) {
      this.createImpactPulse(clampedX, clampedY, 0x52606a, 28);
      return;
    }

    this.moveTarget.set(clampedX, clampedY);
  }

  private pointerToWorld(pointer: Phaser.Input.Pointer) {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return new Phaser.Math.Vector2(worldPoint.x, worldPoint.y);
  }

  private clampToSpellRange(target: Phaser.Math.Vector2, range: number) {
    const origin = new Phaser.Math.Vector2(this.player.x, this.player.y);
    const offset = target.clone().subtract(origin);

    if (offset.length() <= range) {
      return target;
    }

    return origin.add(offset.normalize().scale(range));
  }

  private createLightningArc(x1: number, y1: number, x2: number, y2: number, color: number) {
    const graphics = this.add.graphics().setDepth(50);
    const points = this.makeJaggedLine(x1, y1, x2, y2, 9, 18);

    graphics.lineStyle(9, 0xffffff, 0.26);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();

    graphics.lineStyle(3, color, 1);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();

    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: 210,
      onComplete: () => graphics.destroy(),
    });
  }

  private createLightningBolt(x: number, y: number) {
    const topY = y - 620;
    const graphics = this.add.graphics().setDepth(55);
    const points = this.makeJaggedLine(x - 24, topY, x, y, 13, 30);

    graphics.lineStyle(16, 0xffffff, 0.2);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();

    graphics.lineStyle(5, 0xfff08a, 1);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();

    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: 250,
      onComplete: () => graphics.destroy(),
    });
  }

  private createImpactPulse(x: number, y: number, color: number, radius: number) {
    const circle = this.add.circle(x, y, 8, color, 0.24).setDepth(45);
    circle.setStrokeStyle(3, color, 0.9);
    this.tweens.add({
      targets: circle,
      radius,
      alpha: 0,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => circle.destroy(),
    });
  }

  private makeJaggedLine(x1: number, y1: number, x2: number, y2: number, steps: number, jitter: number) {
    const points: Phaser.Math.Vector2[] = [];
    const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2) + Math.PI / 2;

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const baseX = Phaser.Math.Linear(x1, x2, t);
      const baseY = Phaser.Math.Linear(y1, y2, t);
      const wobble = i === 0 || i === steps ? 0 : Phaser.Math.Between(-jitter, jitter);
      points.push(new Phaser.Math.Vector2(baseX + Math.cos(angle) * wobble, baseY + Math.sin(angle) * wobble));
    }

    return points;
  }

  private drawVisibleWorld() {
    const camera = this.cameras.main;
    const margin = TILE_SIZE * 2;
    const startCell = this.gridWorld.worldToCell(camera.scrollX - margin, camera.scrollY - margin);
    const endCell = this.gridWorld.worldToCell(
      camera.scrollX + camera.width / camera.zoom + margin,
      camera.scrollY + camera.height / camera.zoom + margin,
    );

    this.terrainGraphics.clear();
    this.gridGraphics.clear();

    for (let y = startCell.y; y <= endCell.y; y += 1) {
      for (let x = startCell.x; x <= endCell.x; x += 1) {
        const cell = this.gridWorld.getCell(x, y);
        const worldX = x * TILE_SIZE;
        const worldY = y * TILE_SIZE;

        if (cell.kind === "scarred") {
          this.terrainGraphics.fillStyle(0x111a20, 0.38);
          this.terrainGraphics.fillRect(worldX + 8, worldY + 8, TILE_SIZE - 16, TILE_SIZE - 16);
        } else if (cell.kind === "charged") {
          this.terrainGraphics.fillStyle(0x173344, 0.46);
          this.terrainGraphics.fillTriangle(
            worldX + 12,
            worldY + 52,
            worldX + 34,
            worldY + 14,
            worldX + 52,
            worldY + 48,
          );
        } else if (cell.kind === "reserved_blocker") {
          this.terrainGraphics.fillStyle(0x1d2b34, 1);
          this.terrainGraphics.fillRoundedRect(worldX + 5, worldY + 5, TILE_SIZE - 10, TILE_SIZE - 10, 10);
          this.terrainGraphics.lineStyle(2, 0x586875, 0.8);
          this.terrainGraphics.strokeRoundedRect(worldX + 5, worldY + 5, TILE_SIZE - 10, TILE_SIZE - 10, 10);
          this.terrainGraphics.fillStyle(0x7f909b, 0.36);
          this.terrainGraphics.fillCircle(worldX + 26, worldY + 24, 7);
          this.terrainGraphics.fillCircle(worldX + 43, worldY + 43, 10);
        }
      }
    }

    this.gridGraphics.lineStyle(1, 0x24343d, 0.52);
    for (let x = startCell.x; x <= endCell.x + 1; x += 1) {
      const worldX = x * TILE_SIZE;
      this.gridGraphics.lineBetween(worldX, startCell.y * TILE_SIZE, worldX, (endCell.y + 1) * TILE_SIZE);
    }

    for (let y = startCell.y; y <= endCell.y + 1; y += 1) {
      const worldY = y * TILE_SIZE;
      this.gridGraphics.lineBetween(startCell.x * TILE_SIZE, worldY, (endCell.x + 1) * TILE_SIZE, worldY);
    }
  }

  private drawTargeting() {
    this.targetingGraphics.clear();

    this.targetingGraphics.lineStyle(2, 0x75c7e8, 0.48);
    this.targetingGraphics.strokeCircle(this.moveTarget.x, this.moveTarget.y, 10);
    this.targetingGraphics.lineBetween(this.moveTarget.x - 18, this.moveTarget.y, this.moveTarget.x + 18, this.moveTarget.y);
    this.targetingGraphics.lineBetween(this.moveTarget.x, this.moveTarget.y - 18, this.moveTarget.x, this.moveTarget.y + 18);

    if (!this.castMode) {
      return;
    }

    const spell = this.spells[this.castMode];
    const target = this.pointerToWorld(this.input.activePointer);
    const inRange = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y) <= spell.range;
    const color = inRange ? spell.color : 0xff5465;

    this.targetingGraphics.lineStyle(2, color, 0.28);
    this.targetingGraphics.strokeCircle(this.player.x, this.player.y, spell.range);
    this.targetingGraphics.lineStyle(2, color, 0.9);
    this.targetingGraphics.strokeCircle(target.x, target.y, this.castMode === "chain" ? 74 : 54);
    this.targetingGraphics.lineBetween(target.x - 24, target.y, target.x + 24, target.y);
    this.targetingGraphics.lineBetween(target.x, target.y - 24, target.x, target.y + 24);
  }

  private updateUi() {
    const width = this.scale.width;
    const height = this.scale.height;
    const healthRatio = this.health / 120;
    const manaRatio = this.mana / 100;

    this.uiGraphics.clear();

    this.uiGraphics.fillStyle(0x05090d, 0.72);
    this.uiGraphics.fillRoundedRect(18, 18, 250, 112, 8);
    this.uiGraphics.lineStyle(1, 0x304351, 0.9);
    this.uiGraphics.strokeRoundedRect(18, 18, 250, 112, 8);

    this.drawBar(32, 32, 210, 18, 0x1d2a31, 0xed4057, healthRatio);
    this.drawBar(32, 58, 210, 14, 0x182631, 0x4aa7ff, manaRatio);

    this.killText.setText(`Kills ${this.kills}`);
    this.waveText.setText(`Wave ${this.wave}`);

    const cell = this.gridWorld.worldToCell(this.player.x, this.player.y);
    this.uiGraphics.fillStyle(0x05090d, 0.58);
    this.uiGraphics.fillRoundedRect(width - 156, 20, 132, 34, 8);
    this.uiGraphics.lineStyle(1, 0x304351, 0.72);
    this.uiGraphics.strokeRoundedRect(width - 156, 20, 132, 34, 8);
    this.uiGraphics.fillStyle(0x9fdfff, 0.95);
    this.uiGraphics.fillCircle(width - 132, 37, 4);

    if (!this.statusText.text && this.castMode) {
      this.statusText.setText(this.spells[this.castMode].label);
    } else if (!this.gameOver && !this.castMode) {
      this.statusText.setText("");
    }

    this.statusText.setPosition(width / 2, 68);

    this.drawAbilityDock(width, height);
    this.drawMiniCellReadout(width, cell.x, cell.y);
  }

  private drawBar(x: number, y: number, w: number, h: number, bg: number, fill: number, ratio: number) {
    this.uiGraphics.fillStyle(bg, 1);
    this.uiGraphics.fillRoundedRect(x, y, w, h, 5);
    this.uiGraphics.fillStyle(fill, 1);
    this.uiGraphics.fillRoundedRect(x, y, Math.max(0, w * Phaser.Math.Clamp(ratio, 0, 1)), h, 5);
    this.uiGraphics.lineStyle(1, 0xd8eef7, 0.26);
    this.uiGraphics.strokeRoundedRect(x, y, w, h, 5);
  }

  private drawAbilityDock(width: number, height: number) {
    const dockY = height - 86;
    const dockX = width / 2 - 88;
    const configs = [this.spells.chain, this.spells.bolt];

    this.uiGraphics.fillStyle(0x05090d, 0.76);
    this.uiGraphics.fillRoundedRect(dockX - 16, dockY - 14, 208, 76, 8);
    this.uiGraphics.lineStyle(1, 0x304351, 0.86);
    this.uiGraphics.strokeRoundedRect(dockX - 16, dockY - 14, 208, 76, 8);

    configs.forEach((spell, index) => {
      const x = dockX + index * 96;
      const y = dockY;
      const ready = this.cooldowns[spell.id] <= 0 && this.mana >= spell.manaCost;
      const cooldownRatio = this.cooldowns[spell.id] / spell.cooldown;

      this.uiGraphics.fillStyle(ready ? 0x142531 : 0x11161b, 1);
      this.uiGraphics.fillRoundedRect(x, y, 70, 52, 7);
      this.uiGraphics.lineStyle(2, this.castMode === spell.id ? spell.color : 0x3d5160, 1);
      this.uiGraphics.strokeRoundedRect(x, y, 70, 52, 7);

      this.uiGraphics.lineStyle(3, spell.color, ready ? 0.92 : 0.36);
      if (spell.id === "chain") {
        this.uiGraphics.beginPath();
        this.uiGraphics.moveTo(x + 18, y + 30);
        this.uiGraphics.lineTo(x + 30, y + 18);
        this.uiGraphics.lineTo(x + 42, y + 32);
        this.uiGraphics.lineTo(x + 54, y + 20);
        this.uiGraphics.strokePath();
      } else {
        this.uiGraphics.beginPath();
        this.uiGraphics.moveTo(x + 38, y + 10);
        this.uiGraphics.lineTo(x + 27, y + 30);
        this.uiGraphics.lineTo(x + 39, y + 27);
        this.uiGraphics.lineTo(x + 31, y + 44);
        this.uiGraphics.strokePath();
      }

      if (cooldownRatio > 0) {
        this.uiGraphics.fillStyle(0x020507, 0.68);
        this.uiGraphics.fillRect(x, y, 70, 52 * cooldownRatio);
      }

      this.abilityTexts[index].setPosition(x + 35, y + 58);
      this.abilityTexts[index].setText(`${spell.key}  ${Math.ceil(this.cooldowns[spell.id]) || ""}`);
    });
  }

  private drawMiniCellReadout(width: number, cellX: number, cellY: number) {
    this.cellText.setPosition(width - 130, 29);
    this.cellText.setText(`Cell ${cellX}, ${cellY}`);
  }

  private hudTextStyle(size: number): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: `${size}px`,
      color: "#bfeaff",
      stroke: "#020507",
      strokeThickness: 3,
    };
  }

  private flashPlayer(color: number) {
    this.player.setTint(color);
    this.time.delayedCall(95, () => {
      if (this.player.active) {
        this.player.clearTint();
      }
    });
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#070b10",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },
  scene: [StormArenaScene],
};

new Phaser.Game(config);
