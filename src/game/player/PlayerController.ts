import * as THREE from "three";
import {
  PATHFINDING_MAX_ITERATIONS,
  PLAYER_COLLISION_RADIUS,
  PLAYER_MOVE_SPEED,
  PLAYER_PATHFINDING_CANDIDATE_ATTEMPTS,
  PLAYER_PATHFINDING_ITERATIONS_PER_HEX,
  PLAYER_PATHFINDING_MAX_ITERATIONS,
  PLAYER_PATH_RETRY_COOLDOWN_SECONDS,
} from "../../config";
import { distance2D } from "../../lib/math";
import type { GameMaterialPalettes } from "../../render/materials";
import type { GameEffects } from "../../render/GameEffects";
import { createCrosshair, createRing } from "../../render/primitives";
import { createPlayerModel, PLAYER_AURA_COLOR, PLAYER_CHARGED_AURA_COLOR } from "../../render/meshes";
import type { SpellId } from "../../types";
import type { CollisionSystem } from "../collision/CollisionSystem";
import type { RenderMode } from "../preferences/GamePreferences";
import type { GridWorld, HexCoord } from "../../world/GridWorld";
import { PlayerCharacter } from "./PlayerCharacter";
import type { NavigationWorkSource } from "../navigation/NavigationScheduler";
import type { PathResolutionJob } from "../collision/PathResolutionJob";

type MoveTargetOptions = {
  force?: boolean;
  canUseDestination?: (destination: THREE.Vector3) => boolean;
};

type MoveRequest = {
  id: number;
  target: THREE.Vector3;
  cellKey: string;
  submittedAt: number;
  canUseDestination?: (destination: THREE.Vector3) => boolean;
};

type PlayerRouteApplication = "applied" | "superseded" | "stale-unreachable" | "failed";

type PlayerRouteResultDiagnostics = {
  requestId: number;
  application: PlayerRouteApplication;
  completionReason: string;
  lastSearchCompletion: string | null;
  latencyMs: number;
  cpuMs: number;
  slices: number;
  goalDistanceCells: number;
  iterations: number;
  visitedNodes: number;
};

export class PlayerController {
  private moveSpeed = PLAYER_MOVE_SPEED;
  readonly model: ReturnType<typeof createPlayerModel>;
  readonly object: THREE.Group;
  readonly moveMarker = new THREE.Group();
  readonly moveTarget = new THREE.Vector3(0, 0, 0);

  private path: THREE.Vector3[] = [];
  private lastRequestedCellKey = "";
  private lastRequestedBlocked = false;
  private groundAura: "charged" | "cursed" | null = null;
  private groundCell: HexCoord = { q: 0, r: 0 };
  private groundCellKey = "";
  private readonly character: PlayerCharacter;
  private pendingRequest: MoveRequest | null = null;
  private activeRequest: MoveRequest | null = null;
  private activePathJob: PathResolutionJob | null = null;
  private requestId = 0;
  private coalescedRequests = 0;
  private cancelledRequests = 0;
  private cooldownSuppressedRequests = 0;
  private appliedRoutes = 0;
  private supersededRoutes = 0;
  private failedRoutes = 0;
  private activePathSlices = 0;
  private activePathGoalDistance = 0;
  private lastRouteResult: PlayerRouteResultDiagnostics | null = null;
  private lastFailedCellKey = "";
  private failedCellRetryAt = 0;
  private readonly navigationWorkSource: NavigationWorkSource = {
    id: "player",
    hasWork: () => this.pendingRequest !== null || this.activePathJob !== null,
    runSlice: (deadline) => this.runNavigationSlice(deadline),
  };

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly effects: GameEffects,
    private readonly materialPalettes: GameMaterialPalettes,
    private renderMode: RenderMode,
  ) {
    const materials = this.materialPalettes[this.renderMode];
    this.model = createPlayerModel(materials.player);
    this.object = this.model.group;
    this.character = new PlayerCharacter(this.model, materials.player, this.renderMode === "potato");
    this.object.position.set(0, 0, 0);
    this.moveTarget.copy(this.object.position);
    this.syncGroundCell();

    this.moveMarker.add(createRing(1.15, 0x8bdfff, 0.55));
    this.moveMarker.add(createCrosshair(1.9, 0x8bdfff, 0.65));
    this.moveMarker.position.set(0, 0.08, 0);
  }

  update(dt: number) {
    const waypoint = this.currentWaypoint();
    if (!waypoint) {
      this.character.setMoving(false);
      this.rotateAura(dt);
      return;
    }

    const offset = new THREE.Vector3(waypoint.x - this.object.position.x, 0, waypoint.z - this.object.position.z);
    const distance = offset.length();
    if (distance < 0.18) {
      this.path.shift();
      this.character.setMoving(false);
      this.rotateAura(dt);
      return;
    }

    const step = Math.min(distance, this.moveSpeed * dt);
    offset.normalize();
    const nextPosition = this.collision.moveWithCollision(
      this.object.position,
      new THREE.Vector3(offset.x * step, 0, offset.z * step),
      PLAYER_COLLISION_RADIUS,
    );
    const actualX = nextPosition.x - this.object.position.x;
    const actualZ = nextPosition.z - this.object.position.z;

    if (distance2D(this.object.position.x, this.object.position.z, nextPosition.x, nextPosition.z) < 0.001) {
      this.path = [];
      this.character.setMoving(false);
      this.rotateAura(dt);
      return;
    }

    this.object.position.x = nextPosition.x;
    this.object.position.z = nextPosition.z;
    this.syncGroundCell();
    if (!this.character.isCasting()) {
      this.object.rotation.y = Math.atan2(actualX, actualZ);
    }
    if (this.path[0] && distance2D(this.object.position.x, this.object.position.z, this.path[0].x, this.path[0].z) < 0.24) {
      this.path.shift();
    }

    this.character.setMoving(true);
    this.rotateAura(dt);
  }

  updateAnimation(dt: number) {
    this.character.update(dt);
  }

  setMoveSpeed(moveSpeed: number) {
    this.moveSpeed = moveSpeed;
  }

  setRenderMode(renderMode: RenderMode) {
    if (this.renderMode === renderMode) {
      return;
    }
    this.renderMode = renderMode;
    this.character.setLowDetail(renderMode === "potato", this.materialPalettes[renderMode].player);
  }

  playSpellCast(spellId: SpellId, target: THREE.Vector3) {
    const targetX = target.x - this.object.position.x;
    const targetZ = target.z - this.object.position.z;
    if (targetX * targetX + targetZ * targetZ > 0.0001) {
      this.object.rotation.y = Math.atan2(targetX, targetZ);
    }
    this.character.playSpell(spellId);
  }

  setGroundAura(mode: "charged" | "cursed" | null) {
    if (this.groundAura === mode) {
      return;
    }

    this.groundAura = mode;
    const material = this.model.aura.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) {
      return;
    }
    material.color.set(mode === "cursed" ? 0xd475ff : mode === "charged" ? PLAYER_CHARGED_AURA_COLOR : PLAYER_AURA_COLOR);
    material.opacity = mode ? 0.82 : 0.54;
  }

  setMoveTarget(x: number, z: number, options: MoveTargetOptions = {}) {
    const force = options.force ?? true;
    const requestedTarget = this.gridWorld.clampWorld(new THREE.Vector3(x, 0, z), PLAYER_COLLISION_RADIUS);
    const requestedCell = this.gridWorld.worldToCell(requestedTarget.x, requestedTarget.z);
    const requestedCellKey = this.gridWorld.cellKey(requestedCell.q, requestedCell.r);
    this.moveMarker.position.set(requestedTarget.x, 0.08, requestedTarget.z);

    if (
      !force &&
      requestedCellKey === this.lastRequestedCellKey &&
      (this.path.length > 0 || this.pendingRequest !== null || this.activePathJob !== null)
    ) {
      return;
    }
    if (!force && requestedCellKey === this.lastFailedCellKey && performance.now() < this.failedCellRetryAt) {
      this.cooldownSuppressedRequests += 1;
      return;
    }

    if (this.pendingRequest?.cellKey === requestedCellKey) {
      this.pendingRequest.target.copy(requestedTarget);
      this.pendingRequest.canUseDestination = options.canUseDestination;
      this.coalescedRequests += 1;
      return;
    }
    if (!force && this.activeRequest?.cellKey === requestedCellKey) {
      this.coalescedRequests += 1;
      return;
    }
    if (this.activePathJob) {
      if (force) {
        this.activePathJob = null;
        this.activeRequest = null;
        this.cancelledRequests += 1;
      } else if (this.pendingRequest) {
        this.coalescedRequests += 1;
      }
    }

    this.requestId += 1;
    this.pendingRequest = {
      id: this.requestId,
      target: requestedTarget,
      cellKey: requestedCellKey,
      submittedAt: performance.now(),
      canUseDestination: options.canUseDestination,
    };
    this.lastRequestedCellKey = requestedCellKey;
  }

  getNavigationWorkSource() {
    return this.navigationWorkSource;
  }

  private runNavigationSlice(deadline: number) {
    if (!this.activePathJob && this.pendingRequest) {
      this.activeRequest = this.pendingRequest;
      this.pendingRequest = null;
      const startCell = this.gridWorld.worldToCell(this.object.position.x, this.object.position.z);
      const targetCell = this.gridWorld.worldToCell(this.activeRequest.target.x, this.activeRequest.target.z);
      this.activePathGoalDistance = this.gridWorld.hexDistance(startCell, targetCell);
      this.activePathSlices = 0;
      this.activePathJob = this.collision.createPathResolutionJob(
        this.object.position,
        this.activeRequest.target,
        PLAYER_COLLISION_RADIUS,
        {
          canUseDestination: this.activeRequest.canUseDestination,
          maxCandidatePathAttempts: PLAYER_PATHFINDING_CANDIDATE_ATTEMPTS,
          maxIterations: this.playerPathIterationLimit(this.activePathGoalDistance),
        },
      );
    }
    if (!this.activePathJob || !this.activeRequest) {
      return;
    }

    this.activePathSlices += 1;
    this.activePathJob.step(deadline);
    if (!this.activePathJob.isComplete()) {
      return;
    }

    const request = this.activeRequest;
    const diagnostics = this.activePathJob.diagnostics();
    const resolved = this.activePathJob.getResult();
    this.collision.recordScheduledPathfinding(
      diagnostics.accumulatedMs,
      diagnostics.iterations,
      resolved !== null,
    );
    this.activePathJob = null;
    this.activeRequest = null;
    const superseded = Boolean(this.pendingRequest && this.pendingRequest.id > request.id);
    let application: PlayerRouteApplication = "failed";

    if (!resolved) {
      if (!superseded) {
        this.lastRequestedBlocked = !this.collision.canOccupy(request.target.x, request.target.z, PLAYER_COLLISION_RADIUS);
        this.lastFailedCellKey = request.cellKey;
        this.failedCellRetryAt = performance.now() + PLAYER_PATH_RETRY_COOLDOWN_SECONDS * 1000;
        this.effects.createShockwave(request.target, 0x879190, 2.4);
        this.moveMarker.position.set(this.moveTarget.x, 0.08, this.moveTarget.z);
        this.failedRoutes += 1;
      } else {
        application = "superseded";
        this.supersededRoutes += 1;
      }
    } else if (!superseded || this.path.length === 0) {
      const rebasedPath = this.rebaseWaypoints(resolved.waypoints);
      if (rebasedPath) {
        this.lastRequestedBlocked = resolved.requestedBlocked;
        this.lastFailedCellKey = "";
        this.path = rebasedPath;
        this.moveTarget.copy(resolved.destination);
        if (!superseded) {
          this.moveMarker.position.set(resolved.destination.x, 0.08, resolved.destination.z);
        }
        application = "applied";
        this.appliedRoutes += 1;
      } else {
        application = "stale-unreachable";
        if (!superseded) {
          this.moveMarker.position.set(this.moveTarget.x, 0.08, this.moveTarget.z);
        }
        this.failedRoutes += 1;
      }
    } else {
      application = "superseded";
      this.supersededRoutes += 1;
    }

    this.lastRouteResult = {
      requestId: request.id,
      application,
      completionReason: diagnostics.completionReason,
      lastSearchCompletion: diagnostics.lastSearchCompletion,
      latencyMs: performance.now() - request.submittedAt,
      cpuMs: diagnostics.accumulatedMs,
      slices: this.activePathSlices,
      goalDistanceCells: this.activePathGoalDistance,
      iterations: diagnostics.iterations,
      visitedNodes: diagnostics.visitedNodes,
    };
    this.activePathSlices = 0;
    this.activePathGoalDistance = 0;
  }

  flash(color: THREE.ColorRepresentation, shouldReset = () => true) {
    this.character.flash(color, shouldReset);
  }

  setDefeated() {
    this.character.setDefeated();
  }

  reset() {
    this.object.position.set(0, 0, 0);
    this.moveTarget.set(0, 0, 0);
    this.moveMarker.position.set(0, 0.08, 0);
    this.path = [];
    this.moveSpeed = PLAYER_MOVE_SPEED;
    this.lastRequestedCellKey = "";
    this.lastRequestedBlocked = false;
    this.pendingRequest = null;
    this.activeRequest = null;
    this.activePathJob = null;
    this.lastFailedCellKey = "";
    this.failedCellRetryAt = 0;
    this.coalescedRequests = 0;
    this.cancelledRequests = 0;
    this.cooldownSuppressedRequests = 0;
    this.appliedRoutes = 0;
    this.supersededRoutes = 0;
    this.failedRoutes = 0;
    this.activePathSlices = 0;
    this.activePathGoalDistance = 0;
    this.lastRouteResult = null;
    this.character.reset();
    this.setGroundAura(null);
    this.syncGroundCell();
  }

  dispose() {
    this.character.dispose();
  }

  getGroundCell() {
    return this.groundCell;
  }

  getNavigationDiagnostics() {
    const auraMaterial = this.model.aura.material;
    return {
      moveTarget: this.moveTarget.toArray(),
      pathLength: this.path.length,
      requestedBlocked: this.lastRequestedBlocked,
      groundCell: { ...this.groundCell },
      groundCellKey: this.groundCellKey,
      groundAuraMode: this.groundAura ?? "normal",
      groundAuraColor: auraMaterial instanceof THREE.MeshBasicMaterial ? `#${auraMaterial.color.getHexString()}` : null,
      moveSpeed: this.moveSpeed,
      pathJob: this.activePathJob?.diagnostics() ?? null,
      pendingPath: this.pendingRequest !== null,
      coalescedRequests: this.coalescedRequests,
      cancelledRequests: this.cancelledRequests,
      cooldownSuppressedRequests: this.cooldownSuppressedRequests,
      appliedRoutes: this.appliedRoutes,
      supersededRoutes: this.supersededRoutes,
      failedRoutes: this.failedRoutes,
      requestedTarget: [this.moveMarker.position.x, 0, this.moveMarker.position.z],
      activePathSlices: this.activePathSlices,
      activePathGoalDistance: this.activePathGoalDistance,
      lastRouteResult: this.lastRouteResult ? { ...this.lastRouteResult } : null,
    };
  }

  getAnimationDiagnostics() {
    return this.character.getDiagnostics();
  }

  private syncGroundCell() {
    const cell = this.gridWorld.worldToCell(this.object.position.x, this.object.position.z);
    const key = this.gridWorld.cellKey(cell.q, cell.r);
    if (key === this.groundCellKey) {
      return;
    }
    this.groundCell = cell;
    this.groundCellKey = key;
  }

  private currentWaypoint() {
    while (this.path[0] && distance2D(this.object.position.x, this.object.position.z, this.path[0].x, this.path[0].z) < 0.18) {
      this.path.shift();
    }

    return this.path[0] ?? null;
  }

  private playerPathIterationLimit(goalDistanceCells: number) {
    return Math.min(
      PLAYER_PATHFINDING_MAX_ITERATIONS,
      Math.max(PATHFINDING_MAX_ITERATIONS, goalDistanceCells * PLAYER_PATHFINDING_ITERATIONS_PER_HEX),
    );
  }

  private rebaseWaypoints(waypoints: THREE.Vector3[]) {
    if (waypoints.length === 0) {
      return [];
    }
    for (let index = waypoints.length - 1; index >= 0; index -= 1) {
      if (this.collision.hasLineOfSight(this.object.position, waypoints[index], PLAYER_COLLISION_RADIUS)) {
        return waypoints.slice(index);
      }
    }
    return null;
  }

  private rotateAura(dt: number) {
    this.model.aura.rotation.z += dt * (this.groundAura === "charged" ? 4.2 : this.groundAura === "cursed" ? 2.5 : 1.6);
  }
}

export type PlayerNavigationDiagnostics = ReturnType<PlayerController["getNavigationDiagnostics"]>;
