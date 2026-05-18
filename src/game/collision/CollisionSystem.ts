import * as THREE from "three";
import { PATHFINDING_MAX_ITERATIONS } from "../../config";
import { distance2D } from "../../lib/math";
import type { GridWorld } from "../../world/GridWorld";
import { hasLineOfSight } from "./linecast";
import { findPath, type PathResult } from "./pathfinding";
import { canOccupyWorld, clampWorldToRadius, getCellCenter, isCellBlocked, isCellInBounds } from "./occupancy";
import type { Profiler } from "../perf/Profiler";

export type ResolvedPath = PathResult & {
  destination: THREE.Vector3;
  requestedBlocked: boolean;
};

const MIN_LINE_FALLBACK_DISTANCE = 0.75;
const MAX_LINE_FALLBACK_SAMPLES = 72;

type ResolvePathOptions = {
  canUseDestination?: (destination: THREE.Vector3) => boolean;
  maxCandidatePathAttempts?: number;
  maxPathfindingMs?: number;
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

  findPath(start: THREE.Vector3, goal: THREE.Vector3, radius: number, maxIterations = PATHFINDING_MAX_ITERATIONS, maxMs?: number) {
    const clampedGoal = clampWorldToRadius(this.gridWorld, new THREE.Vector3(goal.x, 0, goal.z), radius);
    const startedAt = performance.now();
    const result = findPath(this.gridWorld, start, clampedGoal, { radius, maxIterations, maxMs });
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
    const deadline = options.maxPathfindingMs ? performance.now() + options.maxPathfindingMs : Number.POSITIVE_INFINITY;
    const remainingPathMs = () =>
      Number.isFinite(deadline) ? Math.max(0.25, deadline - performance.now()) : undefined;
    const direct =
      requestedBlocked || !canUseDestination(requested)
        ? null
        : this.findPath(start, requested, radius, PATHFINDING_MAX_ITERATIONS, remainingPathMs());

    if (direct) {
      return { ...direct, destination: requested, requestedBlocked };
    }

    let attemptedPaths = 0;
    const maxCandidatePathAttempts = options.maxCandidatePathAttempts ?? Number.POSITIVE_INFINITY;

    for (const candidates of this.findNearbyOpenCandidateRings(requested, radius)) {
      let best: ResolvedPath | null = null;
      const sortedCandidates = candidates
        .slice()
        .sort(
          (a, b) =>
            distance2D(start.x, start.z, a.x, a.z) +
            distance2D(requested.x, requested.z, a.x, a.z) -
            (distance2D(start.x, start.z, b.x, b.z) + distance2D(requested.x, requested.z, b.x, b.z)),
        );

      for (const candidate of sortedCandidates) {
        if (attemptedPaths >= maxCandidatePathAttempts || performance.now() >= deadline) {
          return best;
        }

        if (!canUseDestination(candidate)) {
          continue;
        }

        attemptedPaths += 1;
        const path = this.findPath(start, candidate, radius, PATHFINDING_MAX_ITERATIONS, remainingPathMs());
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

    const fallback = this.findLineFallbackDestination(start, requested, radius, canUseDestination);
    if (fallback) {
      const distance = distance2D(start.x, start.z, fallback.x, fallback.z);
      return {
        waypoints: [fallback],
        distance,
        iterations: 0,
        destination: fallback,
        requestedBlocked,
      };
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

  private findLineFallbackDestination(
    start: THREE.Vector3,
    requested: THREE.Vector3,
    radius: number,
    canUseDestination: (destination: THREE.Vector3) => boolean,
  ) {
    const dx = requested.x - start.x;
    const dz = requested.z - start.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= MIN_LINE_FALLBACK_DISTANCE) {
      return null;
    }

    const sampleCount = Math.min(MAX_LINE_FALLBACK_SAMPLES, Math.max(4, Math.ceil(distance / (this.gridWorld.tileSize * 0.5))));
    let best: THREE.Vector3 | null = null;

    for (let index = 1; index <= sampleCount; index += 1) {
      const amount = index / sampleCount;
      const point = new THREE.Vector3(start.x + dx * amount, 0, start.z + dz * amount);
      if (!canUseDestination(point) || !this.canMoveBetween(start, point, radius)) {
        break;
      }
      best = point;
    }

    if (!best || distance2D(start.x, start.z, best.x, best.z) < MIN_LINE_FALLBACK_DISTANCE) {
      return null;
    }

    return best;
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
