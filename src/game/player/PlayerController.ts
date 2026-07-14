import * as THREE from "three";
import { PLAYER_COLLISION_RADIUS, PLAYER_PATHFINDING_BUDGET_MS, PLAYER_PATHFINDING_CANDIDATE_ATTEMPTS } from "../../config";
import { distance2D } from "../../lib/math";
import type { GameMaterials } from "../../render/materials";
import type { GameEffects } from "../../render/GameEffects";
import { createCrosshair, createRing } from "../../render/primitives";
import { createPlayerModel, PLAYER_AURA_COLOR, PLAYER_CHARGED_AURA_COLOR } from "../../render/meshes";
import type { CollisionSystem } from "../collision/CollisionSystem";
import type { GridWorld, HexCoord } from "../../world/GridWorld";

type MoveTargetOptions = {
  force?: boolean;
  canUseDestination?: (destination: THREE.Vector3) => boolean;
};

export class PlayerController {
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

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly effects: GameEffects,
    private readonly materials: GameMaterials,
  ) {
    this.model = createPlayerModel(this.materials.player);
    this.object = this.model.group;
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
      this.rotateAura(dt);
      return;
    }

    const offset = new THREE.Vector3(waypoint.x - this.object.position.x, 0, waypoint.z - this.object.position.z);
    const distance = offset.length();
    if (distance < 0.18) {
      this.path.shift();
      this.rotateAura(dt);
      return;
    }

    const step = Math.min(distance, 18 * dt);
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
      this.rotateAura(dt);
      return;
    }

    this.object.position.x = nextPosition.x;
    this.object.position.z = nextPosition.z;
    this.syncGroundCell();
    this.object.rotation.y = Math.atan2(actualX, actualZ);
    this.moveMarker.position.set(this.moveTarget.x, 0.08, this.moveTarget.z);

    if (this.path[0] && distance2D(this.object.position.x, this.object.position.z, this.path[0].x, this.path[0].z) < 0.24) {
      this.path.shift();
    }

    this.rotateAura(dt);
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

    if (!force && requestedCellKey === this.lastRequestedCellKey && this.path.length > 0) {
      return;
    }

    const resolved = this.collision.resolvePathToTarget(this.object.position, requestedTarget, PLAYER_COLLISION_RADIUS, {
      canUseDestination: options.canUseDestination,
      maxCandidatePathAttempts: PLAYER_PATHFINDING_CANDIDATE_ATTEMPTS,
      maxPathfindingMs: PLAYER_PATHFINDING_BUDGET_MS,
    });
    this.lastRequestedCellKey = requestedCellKey;

    if (!resolved) {
      this.lastRequestedBlocked = !this.collision.canOccupy(requestedTarget.x, requestedTarget.z, PLAYER_COLLISION_RADIUS);
      this.path = [];
      this.effects.createShockwave(requestedTarget, 0x879190, 2.4);
      return;
    }

    this.lastRequestedBlocked = resolved.requestedBlocked;
    this.path = resolved.waypoints;
    this.moveTarget.copy(resolved.destination);
    this.moveMarker.position.set(resolved.destination.x, 0.08, resolved.destination.z);
  }

  flash(color: THREE.ColorRepresentation, shouldReset = () => true) {
    this.materials.player.color.set(color);
    window.setTimeout(() => {
      if (shouldReset()) {
        this.materials.player.color.set(0xdfe8ee);
      }
    }, 95);
  }

  setDefeated() {
    this.materials.player.color.set(0x59676a);
    this.materials.player.emissive.set(0x1b2020);
  }

  reset() {
    this.object.position.set(0, 0, 0);
    this.moveTarget.set(0, 0, 0);
    this.moveMarker.position.set(0, 0.08, 0);
    this.path = [];
    this.lastRequestedCellKey = "";
    this.lastRequestedBlocked = false;
    this.materials.player.color.set(0xdfe8ee);
    this.materials.player.emissive.set(0x21526b);
    this.setGroundAura(null);
    this.syncGroundCell();
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
    };
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

  private rotateAura(dt: number) {
    this.model.aura.rotation.z += dt * (this.groundAura === "charged" ? 4.2 : this.groundAura === "cursed" ? 2.5 : 1.6);
  }
}
