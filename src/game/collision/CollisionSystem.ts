import * as THREE from "three";
import { PATHFINDING_MAX_ITERATIONS } from "../../config";
import { distance2D } from "../../lib/math";
import type { GridWorld } from "../../world/GridWorld";
import { hasLineOfSight } from "./linecast";
import { findPath, type PathResult } from "./pathfinding";
import { canOccupyWorld, clampWorldToRadius, getCellBounds, isCellBlocked, isCellInBounds } from "./occupancy";
import type { Profiler } from "../perf/Profiler";

export type ResolvedPath = PathResult & {
  destination: THREE.Vector3;
  requestedBlocked: boolean;
};

type ResolvePathOptions = {
  canUseDestination?: (destination: THREE.Vector3) => boolean;
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

  findPath(start: THREE.Vector3, goal: THREE.Vector3, radius: number, maxIterations = PATHFINDING_MAX_ITERATIONS) {
    const clampedGoal = clampWorldToRadius(this.gridWorld, new THREE.Vector3(goal.x, 0, goal.z), radius);
    const startedAt = performance.now();
    const result = findPath(this.gridWorld, start, clampedGoal, { radius, maxIterations });
    this.profiler?.recordPathfinding(performance.now() - startedAt, result?.iterations ?? 0, result !== null);
    return result;
  }

  resolvePathToTarget(
    start: THREE.Vector3,
    requestedTarget: THREE.Vector3,
    radius: number,
    options: ResolvePathOptions = {},
  ): ResolvedPath | null {
    const requested = clampWorldToRadius(this.gridWorld, new THREE.Vector3(requestedTarget.x, 0, requestedTarget.z), radius);
    const requestedBlocked = !this.canOccupy(requested.x, requested.z, radius);
    const canUseDestination = options.canUseDestination ?? (() => true);
    const direct = requestedBlocked || !canUseDestination(requested) ? null : this.findPath(start, requested, radius);

    if (direct) {
      return { ...direct, destination: requested, requestedBlocked };
    }

    for (const candidates of this.findNearbyOpenCandidateRings(requested, radius)) {
      let best: ResolvedPath | null = null;
      for (const candidate of candidates) {
        if (!canUseDestination(candidate)) {
          continue;
        }

        const path = this.findPath(start, candidate, radius);
        if (!path) {
          continue;
        }

        if (!best || path.distance < best.distance) {
          best = { ...path, destination: candidate, requestedBlocked };
        }
      }

      if (best) {
        return best;
      }
    }

    return null;
  }

  moveWithCollision(position: THREE.Vector3, desiredDelta: THREE.Vector3, radius: number) {
    const fullMove = new THREE.Vector3(position.x + desiredDelta.x, 0, position.z + desiredDelta.z);
    if (this.canMoveBetween(position, fullMove, radius)) {
      return fullMove;
    }

    const xMove = new THREE.Vector3(position.x + desiredDelta.x, 0, position.z);
    if (this.canMoveBetween(position, xMove, radius)) {
      return xMove;
    }

    const zMove = new THREE.Vector3(position.x, 0, position.z + desiredDelta.z);
    if (this.canMoveBetween(position, zMove, radius)) {
      return zMove;
    }

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

      for (let z = center.z - ring; z <= center.z + ring; z += 1) {
        for (let x = center.x - ring; x <= center.x + ring; x += 1) {
          if (ring > 0 && x !== center.x - ring && x !== center.x + ring && z !== center.z - ring && z !== center.z + ring) {
            continue;
          }

          const key = `${x},${z}`;
          if (seen.has(key) || !isCellInBounds(this.gridWorld, x, z) || isCellBlocked(this.gridWorld, x, z)) {
            continue;
          }
          seen.add(key);

          const candidate = this.pointInsideCell(point, x, z, radius);
          if (this.canOccupy(candidate.x, candidate.z, radius)) {
            candidates.push(candidate);
          }
        }
      }

      if (candidates.length > 0) {
        rings.push(candidates);
      }
    }

    return rings;
  }

  private pointInsideCell(point: THREE.Vector3, cellX: number, cellZ: number, radius: number) {
    const bounds = getCellBounds(this.gridWorld, cellX, cellZ);
    const minX = bounds.minX + radius;
    const maxX = bounds.maxX - radius;
    const minZ = bounds.minZ + radius;
    const maxZ = bounds.maxZ - radius;

    if (minX > maxX || minZ > maxZ) {
      return new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    }

    return new THREE.Vector3(Math.min(maxX, Math.max(minX, point.x)), 0, Math.min(maxZ, Math.max(minZ, point.z)));
  }
}
