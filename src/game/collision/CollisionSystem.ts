import * as THREE from "three";
import { PATHFINDING_MAX_ITERATIONS } from "../../config";
import { distance2D } from "../../lib/math";
import type { GridWorld } from "../../world/GridWorld";
import { hasLineOfSight } from "./linecast";
import { PathSearchJob } from "./pathfinding";
import { PathResolutionJob } from "./PathResolutionJob";
import { canOccupyWorld, clampWorldToRadius, getCellCenter, isCellBlocked, isCellInBounds } from "./occupancy";
import type { Profiler } from "../perf/Profiler";
import type { CollisionMoveResolution } from "../enemies/navigation/NavigationDebugTypes";

export type { ResolvedPath } from "./PathResolutionJob";

type ResolvePathOptions = {
  canUseDestination?: (destination: THREE.Vector3) => boolean;
  maxCandidatePathAttempts?: number;
  maxIterations?: number;
};

export type CollisionMoveTrace = {
  resolution: CollisionMoveResolution;
};

export class CollisionSystem {
  constructor(
    private readonly gridWorld: GridWorld,
    private readonly profiler?: Profiler,
  ) {}

  canOccupy(worldX: number, worldZ: number, radius: number) {
    return canOccupyWorld(this.gridWorld, worldX, worldZ, radius);
  }

  hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    return hasLineOfSight(this.gridWorld, from, to, radius);
  }

  recordScheduledPathfinding(ms: number, iterations: number, success: boolean) {
    this.profiler?.recordPathfinding(ms, iterations, success);
  }

  createPathSearchJob(start: THREE.Vector3, goal: THREE.Vector3, radius: number, maxIterations = PATHFINDING_MAX_ITERATIONS) {
    const clampedGoal = clampWorldToRadius(this.gridWorld, new THREE.Vector3(goal.x, 0, goal.z), radius);
    return new PathSearchJob(this.gridWorld, start, clampedGoal, { radius, maxIterations });
  }

  createPathResolutionJob(
    start: THREE.Vector3,
    requestedTarget: THREE.Vector3,
    radius: number,
    options: ResolvePathOptions = {},
  ) {
    return new PathResolutionJob(this.gridWorld, start, requestedTarget, radius, {
      canUseDestination: options.canUseDestination,
      maxCandidatePathAttempts: options.maxCandidatePathAttempts,
      maxIterations: options.maxIterations ?? PATHFINDING_MAX_ITERATIONS,
    });
  }

  moveWithCollision(position: THREE.Vector3, desiredDelta: THREE.Vector3, radius: number, trace?: CollisionMoveTrace) {
    const fullMove = new THREE.Vector3(position.x + desiredDelta.x, 0, position.z + desiredDelta.z);
    if (this.canMoveBetween(position, fullMove, radius)) {
      if (trace) trace.resolution = "full";
      return fullMove;
    }

    const xMove = new THREE.Vector3(position.x + desiredDelta.x, 0, position.z);
    if (this.canMoveBetween(position, xMove, radius)) {
      if (trace) trace.resolution = "x";
      return xMove;
    }

    const zMove = new THREE.Vector3(position.x, 0, position.z + desiredDelta.z);
    if (this.canMoveBetween(position, zMove, radius)) {
      if (trace) trace.resolution = "z";
      return zMove;
    }

    if (trace) trace.resolution = "rejected";
    return new THREE.Vector3(position.x, 0, position.z);
  }

  findNearestOpenPoint(point: THREE.Vector3, radius: number, maxRing = 5) {
    const clamped = clampWorldToRadius(this.gridWorld, new THREE.Vector3(point.x, 0, point.z), radius);
    if (this.canOccupy(clamped.x, clamped.z, radius)) {
      return clamped;
    }

    let best: THREE.Vector3 | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidates of this.findNearbyOpenCandidateRings(clamped, radius, maxRing)) {
      for (const candidate of candidates) {
        const distance = distance2D(clamped.x, clamped.z, candidate.x, candidate.z);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }

      return best;
    }

    return null;
  }

  private canMoveBetween(from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    return this.canOccupy(to.x, to.z, radius) && hasLineOfSight(this.gridWorld, from, to, radius);
  }

  private findNearbyOpenCandidateRings(point: THREE.Vector3, radius: number, maxRing = 6) {
    const center = this.gridWorld.worldToCell(point.x, point.z);
    const rings: THREE.Vector3[][] = [];
    const seen = new Set<string>();

    for (let ring = 0; ring <= maxRing; ring += 1) {
      const candidates: THREE.Vector3[] = [];

      for (const cell of this.gridWorld.ring(center, ring)) {
        const key = this.gridWorld.cellKey(cell.q, cell.r);
        if (seen.has(key) || !isCellInBounds(this.gridWorld, cell.q, cell.r) || isCellBlocked(this.gridWorld, cell.q, cell.r)) {
          continue;
        }
        seen.add(key);

        const candidate = this.pointInsideCell(point, cell.q, cell.r, radius);
        if (this.canOccupy(candidate.x, candidate.z, radius)) {
          candidates.push(candidate);
        }
      }

      if (candidates.length > 0) {
        rings.push(candidates);
      }
    }

    return rings;
  }

  private pointInsideCell(point: THREE.Vector3, q: number, r: number, radius: number) {
    const pointCell = this.gridWorld.worldToCell(point.x, point.z);
    if (pointCell.q === q && pointCell.r === r) {
      const candidate = new THREE.Vector3(point.x, 0, point.z);
      if (this.canOccupy(candidate.x, candidate.z, radius)) {
        return candidate;
      }
    }

    return getCellCenter(this.gridWorld, q, r);
  }
}
