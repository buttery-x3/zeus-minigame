import * as THREE from "three";
import type { EnemyState } from "../types";
import type { GridWorld } from "../world/GridWorld";
import type {
  CollisionMoveResolution,
  NavigationDebugDiagnostics,
  NavigationDebugMode,
} from "../game/enemies/navigation/NavigationDebugTypes";
import { NavigationDebugPainter, type NavigationDebugDrawable } from "./NavigationDebugPainter";

const STALL_LATCH_SECONDS = 0.4;
const LATCH_VISIBLE_MS = 5000;

type DebugSnapshot = NavigationDebugDrawable & {
  id: number;
  mode: EnemyState["navigationMode"];
  position: THREE.Vector3;
  target: THREE.Vector3;
  desiredVelocity: THREE.Vector3;
  steeredVelocity: THREE.Vector3;
  attemptedDelta: THREE.Vector3;
  actualDelta: THREE.Vector3;
  path: THREE.Vector3[];
  pathQueued: boolean;
  stallTimer: number;
  stationaryTime: number;
  collision: CollisionMoveResolution;
};

type DebugEntry = DebugSnapshot & {
  lastSeenFrame: number;
  latchedUntil: number;
  latched: DebugSnapshot | null;
};

export class NavigationDebugRenderer {
  readonly object = new THREE.Group();
  private readonly painter: NavigationDebugPainter;
  private readonly entries = new Map<number, DebugEntry>();
  private mode: NavigationDebugMode = "off";
  private frame = 0;
  private displayedEnemies = 0;

  constructor(private readonly gridWorld: GridWorld) {
    this.painter = new NavigationDebugPainter(gridWorld);
    this.object.add(this.painter.object);
    this.object.visible = false;
  }

  isEnabled() {
    return this.mode !== "off";
  }

  setMode(mode: NavigationDebugMode) {
    this.mode = mode;
    this.object.visible = mode !== "off";
    if (mode === "off") {
      this.entries.clear();
      this.displayedEnemies = 0;
      this.painter.clear();
    }
  }

  beginSimulationStep() {
    if (!this.isEnabled()) {
      return;
    }
    this.frame += 1;
  }

  record(
    enemy: EnemyState,
    target: THREE.Vector3,
    desiredVelocity: THREE.Vector3,
    steeredVelocity: THREE.Vector3,
    attemptedDelta: THREE.Vector3,
    actualDelta: THREE.Vector3,
    collision: CollisionMoveResolution,
    targetProgress: number,
    dt: number,
  ) {
    if (!this.isEnabled()) {
      return;
    }

    const entry = this.entries.get(enemy.id) ?? createEntry(enemy.id);
    const wasStalled = entry.stationaryTime >= STALL_LATCH_SECONDS;
    const intendedMovement = attemptedDelta.lengthSq() > 0.000001;
    const movedTowardTarget = actualDelta.lengthSq() > 0.000025 && targetProgress > 0.0005;
    entry.stationaryTime = intendedMovement && !movedTowardTarget ? entry.stationaryTime + dt : 0;
    entry.id = enemy.id;
    entry.mode = enemy.navigationMode;
    entry.position.copy(enemy.group.position).sub(actualDelta);
    entry.target.copy(target);
    entry.desiredVelocity.copy(desiredVelocity);
    entry.steeredVelocity.copy(steeredVelocity);
    entry.attemptedDelta.copy(attemptedDelta);
    entry.actualDelta.copy(actualDelta);
    entry.pathQueued = enemy.pathQueued;
    entry.stallTimer = enemy.stallTimer;
    entry.collision = collision;
    entry.lastSeenFrame = this.frame;
    copyPath(entry.path, enemy.path);

    if (!wasStalled && entry.stationaryTime >= STALL_LATCH_SECONDS) {
      entry.latched = cloneSnapshot(entry);
    }
    if (entry.stationaryTime >= STALL_LATCH_SECONDS) {
      entry.latchedUntil = performance.now() + LATCH_VISIBLE_MS;
    }
    this.entries.set(enemy.id, entry);
  }

  update() {
    if (!this.isEnabled()) {
      return;
    }
    const now = performance.now();
    this.painter.begin();
    this.displayedEnemies = 0;

    for (const [id, entry] of this.entries) {
      if (entry.lastSeenFrame < this.frame - 1 && entry.latchedUntil < now) {
        this.entries.delete(id);
        continue;
      }
      const snapshot = this.mode === "all" ? entry : entry.latchedUntil >= now ? (entry.latched ?? entry) : null;
      if (!snapshot) {
        continue;
      }
      this.displayedEnemies += 1;
      this.painter.draw(snapshot);
    }

    this.painter.end();
  }

  diagnostics(): NavigationDebugDiagnostics {
    const now = performance.now();
    const latchedEntries = [...this.entries.values()].filter((entry) => entry.latchedUntil >= now);
    const stalled = latchedEntries
      .sort((a, b) => b.stationaryTime - a.stationaryTime)
      .slice(0, 5)
      .map((entry) => {
        const snapshot = entry.latched ?? entry;
        return {
          id: snapshot.id,
          mode: snapshot.mode,
          cell: this.gridWorld.worldToCell(snapshot.position.x, snapshot.position.z),
          stationaryMs: Math.max(entry.stationaryTime, snapshot.stationaryTime) * 1000,
          stallTimerMs: snapshot.stallTimer * 1000,
          pathQueued: snapshot.pathQueued,
          pathLength: snapshot.path.length,
          collision: snapshot.collision,
        };
      });
    return {
      mode: this.mode,
      trackedEnemies: this.entries.size,
      latchedEnemies: latchedEntries.length,
      displayedEnemies: this.displayedEnemies,
      renderedSegments: this.painter.getSegmentCount(),
      segmentCapacity: this.painter.segmentCapacity,
      stalled,
    };
  }

  dispose() {
    this.painter.dispose();
    this.object.removeFromParent();
  }
}

function createEntry(id: number): DebugEntry {
  return {
    id,
    mode: "waiting",
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    desiredVelocity: new THREE.Vector3(),
    steeredVelocity: new THREE.Vector3(),
    attemptedDelta: new THREE.Vector3(),
    actualDelta: new THREE.Vector3(),
    path: [],
    pathQueued: false,
    stallTimer: 0,
    stationaryTime: 0,
    collision: "rejected",
    lastSeenFrame: 0,
    latchedUntil: 0,
    latched: null,
  };
}

function cloneSnapshot(entry: DebugSnapshot): DebugSnapshot {
  return {
    id: entry.id,
    mode: entry.mode,
    position: entry.position.clone(),
    target: entry.target.clone(),
    desiredVelocity: entry.desiredVelocity.clone(),
    steeredVelocity: entry.steeredVelocity.clone(),
    attemptedDelta: entry.attemptedDelta.clone(),
    actualDelta: entry.actualDelta.clone(),
    path: entry.path.map((point) => point.clone()),
    pathQueued: entry.pathQueued,
    stallTimer: entry.stallTimer,
    stationaryTime: entry.stationaryTime,
    collision: entry.collision,
  };
}

function copyPath(target: THREE.Vector3[], source: THREE.Vector3[]) {
  const count = Math.min(6, source.length);
  while (target.length < count) {
    target.push(new THREE.Vector3());
  }
  target.length = count;
  for (let index = 0; index < count; index += 1) {
    target[index].copy(source[index]);
  }
}
