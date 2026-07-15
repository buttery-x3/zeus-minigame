import * as THREE from "three";
import { PATHFINDING_MAX_ITERATIONS } from "../../config";
import { distance2D } from "../../lib/math";
import type { GridWorld } from "../../world/GridWorld";
import { LinecastJob } from "./linecast";
import { canOccupyWorld, getCellCenter } from "./occupancy";
import { PathSearchJob, type PathResult } from "./pathfinding";

export type ResolvedPath = PathResult & {
  destination: THREE.Vector3;
  requestedBlocked: boolean;
};

export type PathResolutionOptions = {
  canUseDestination?: (destination: THREE.Vector3) => boolean;
  maxCandidatePathAttempts?: number;
  maxIterations?: number;
};

type ResolutionStage = "direct" | "scanCandidates" | "candidatePath" | "fallback" | "complete" | "failed";

const MIN_LINE_FALLBACK_DISTANCE = 0.75;
const MAX_CANDIDATE_RING = 6;
const CANDIDATE_CHECKS_PER_STEP = 8;
const FALLBACK_BINARY_STEPS = 9;

export class PathResolutionJob {
  private readonly start: THREE.Vector3;
  private readonly requested: THREE.Vector3;
  private readonly requestedBlocked: boolean;
  private readonly canUseDestination: (destination: THREE.Vector3) => boolean;
  private readonly maxCandidatePathAttempts: number;
  private readonly maxIterations: number;
  private stage: ResolutionStage;
  private activePath: PathSearchJob | null = null;
  private activeDestination: THREE.Vector3 | null = null;
  private result: ResolvedPath | null = null;
  private ring = 0;
  private ringCells: { q: number; r: number }[] = [];
  private ringCellIndex = 0;
  private candidates: THREE.Vector3[] = [];
  private candidateIndex = 0;
  private attemptedPaths = 0;
  private bestCandidate: ResolvedPath | null = null;
  private fallbackLow = 0;
  private fallbackHigh = 1;
  private fallbackSteps = 0;
  private fallbackLinecast: LinecastJob | null = null;
  private fallbackPoint: THREE.Vector3 | null = null;
  private accumulatedMs = 0;

  constructor(
    private readonly gridWorld: GridWorld,
    start: THREE.Vector3,
    requestedTarget: THREE.Vector3,
    private readonly radius: number,
    options: PathResolutionOptions = {},
  ) {
    this.start = new THREE.Vector3(start.x, 0, start.z);
    this.requested = gridWorld.clampWorld(new THREE.Vector3(requestedTarget.x, 0, requestedTarget.z), radius);
    this.requestedBlocked = !canOccupyWorld(gridWorld, this.requested.x, this.requested.z, radius);
    this.canUseDestination = options.canUseDestination ?? (() => true);
    this.maxCandidatePathAttempts = options.maxCandidatePathAttempts ?? Number.POSITIVE_INFINITY;
    this.maxIterations = options.maxIterations ?? PATHFINDING_MAX_ITERATIONS;

    if (!this.requestedBlocked && this.canUseDestination(this.requested)) {
      this.activeDestination = this.requested;
      this.activePath = this.createPath(this.requested);
      this.stage = "direct";
    } else {
      this.stage = "scanCandidates";
      this.beginRing(0);
    }
  }

  step(deadline: number) {
    if (this.isComplete()) {
      return;
    }
    const startedAt = performance.now();

    while (!this.isComplete() && performance.now() < deadline) {
      if (this.stage === "direct") {
        if (!this.stepActivePath(deadline)) {
          break;
        }
        if (this.completeFromActivePath()) {
          break;
        }
        this.stage = "scanCandidates";
        this.beginRing(0);
        continue;
      }

      if (this.stage === "scanCandidates") {
        if (!this.stepCandidateScan(deadline)) {
          break;
        }
        continue;
      }

      if (this.stage === "candidatePath") {
        if (!this.stepCandidatePath(deadline)) {
          break;
        }
        continue;
      }

      if (this.stage === "fallback") {
        if (!this.stepFallback(deadline)) {
          break;
        }
      }
    }

    this.accumulatedMs += performance.now() - startedAt;
  }

  isComplete() {
    return this.stage === "complete" || this.stage === "failed";
  }

  getResult() {
    return this.result;
  }

  diagnostics() {
    return {
      stage: this.stage,
      accumulatedMs: this.accumulatedMs,
      attemptedPaths: this.attemptedPaths,
      ring: this.ring,
      candidateIndex: this.candidateIndex,
      candidateCount: this.candidates.length,
      fallbackSteps: this.fallbackSteps,
      activePath: this.activePath?.diagnostics() ?? null,
    };
  }

  private stepActivePath(deadline: number) {
    if (!this.activePath) {
      return true;
    }
    this.activePath.step(deadline);
    return this.activePath.isComplete();
  }

  private completeFromActivePath() {
    const path = this.activePath?.getResult();
    if (!path || !this.activeDestination) {
      this.activePath = null;
      this.activeDestination = null;
      return false;
    }
    this.result = {
      ...path,
      destination: this.activeDestination.clone(),
      requestedBlocked: this.requestedBlocked,
    };
    this.stage = "complete";
    return true;
  }

  private stepCandidateScan(deadline: number) {
    let checked = 0;
    while (
      this.ring <= MAX_CANDIDATE_RING &&
      this.ringCellIndex < this.ringCells.length &&
      checked < CANDIDATE_CHECKS_PER_STEP &&
      performance.now() < deadline
    ) {
      const cell = this.ringCells[this.ringCellIndex];
      this.ringCellIndex += 1;
      checked += 1;
      const candidate = this.pointForCandidate(cell.q, cell.r);
      if (
        this.canUseDestination(candidate) &&
        canOccupyWorld(this.gridWorld, candidate.x, candidate.z, this.radius)
      ) {
        this.candidates.push(candidate);
      }
    }

    if (this.ringCellIndex < this.ringCells.length) {
      return false;
    }

    if (this.candidates.length > 0 && this.attemptedPaths < this.maxCandidatePathAttempts) {
      this.candidates.sort(
        (a, b) =>
          distance2D(this.start.x, this.start.z, a.x, a.z) + distance2D(this.requested.x, this.requested.z, a.x, a.z) -
          (distance2D(this.start.x, this.start.z, b.x, b.z) + distance2D(this.requested.x, this.requested.z, b.x, b.z)),
      );
      this.candidateIndex = 0;
      this.stage = "candidatePath";
      this.startNextCandidatePath();
      return true;
    }

    if (this.ring >= MAX_CANDIDATE_RING || this.attemptedPaths >= this.maxCandidatePathAttempts) {
      this.beginFallback();
      return true;
    }

    this.beginRing(this.ring + 1);
    return true;
  }

  private stepCandidatePath(deadline: number) {
    if (!this.activePath || !this.activeDestination) {
      this.startNextCandidatePath();
      return true;
    }
    this.activePath.step(deadline);
    if (!this.activePath.isComplete()) {
      return false;
    }

    const path = this.activePath.getResult();
    if (path) {
      const resolved: ResolvedPath = {
        ...path,
        destination: this.activeDestination.clone(),
        requestedBlocked: this.requestedBlocked,
      };
      if (!this.bestCandidate || resolved.distance < this.bestCandidate.distance) {
        this.bestCandidate = resolved;
      }
    }
    this.activePath = null;
    this.activeDestination = null;
    this.candidateIndex += 1;

    if (
      this.candidateIndex < this.candidates.length &&
      this.attemptedPaths < this.maxCandidatePathAttempts
    ) {
      this.startNextCandidatePath();
      return true;
    }

    if (this.bestCandidate) {
      this.result = this.bestCandidate;
      this.stage = "complete";
      return true;
    }

    if (this.ring < MAX_CANDIDATE_RING && this.attemptedPaths < this.maxCandidatePathAttempts) {
      this.beginRing(this.ring + 1);
      this.stage = "scanCandidates";
      return true;
    }
    this.beginFallback();
    return true;
  }

  private startNextCandidatePath() {
    const destination = this.candidates[this.candidateIndex];
    if (!destination || this.attemptedPaths >= this.maxCandidatePathAttempts) {
      return;
    }
    this.attemptedPaths += 1;
    this.activeDestination = destination;
    this.activePath = this.createPath(destination);
  }

  private beginRing(ring: number) {
    this.ring = ring;
    this.ringCells = this.gridWorld.ring(this.gridWorld.worldToCell(this.requested.x, this.requested.z), ring);
    this.ringCellIndex = 0;
    this.candidates = [];
    this.candidateIndex = 0;
    this.bestCandidate = null;
  }

  private pointForCandidate(q: number, r: number) {
    const requestedCell = this.gridWorld.worldToCell(this.requested.x, this.requested.z);
    if (requestedCell.q === q && requestedCell.r === r) {
      return this.requested.clone();
    }
    return getCellCenter(this.gridWorld, q, r);
  }

  private beginFallback() {
    this.stage = "fallback";
    this.activePath = null;
    this.activeDestination = null;
    this.fallbackLow = 0;
    this.fallbackHigh = 1;
    this.fallbackSteps = 0;
    this.fallbackLinecast = null;
    this.fallbackPoint = null;
  }

  private stepFallback(deadline: number) {
    const requestedDistance = distance2D(this.start.x, this.start.z, this.requested.x, this.requested.z);
    if (requestedDistance <= MIN_LINE_FALLBACK_DISTANCE) {
      this.stage = "failed";
      return true;
    }

    if (this.fallbackSteps >= FALLBACK_BINARY_STEPS) {
      const destination = pointOnLine(this.start, this.requested, this.fallbackLow);
      const distance = distance2D(this.start.x, this.start.z, destination.x, destination.z);
      if (distance < MIN_LINE_FALLBACK_DISTANCE) {
        this.stage = "failed";
        return true;
      }
      this.result = {
        waypoints: [destination],
        distance,
        iterations: 0,
        destination,
        requestedBlocked: this.requestedBlocked,
      };
      this.stage = "complete";
      return true;
    }

    if (!this.fallbackLinecast || !this.fallbackPoint) {
      const amount = (this.fallbackLow + this.fallbackHigh) * 0.5;
      const point = pointOnLine(this.start, this.requested, amount);
      if (!this.canUseDestination(point) || !canOccupyWorld(this.gridWorld, point.x, point.z, this.radius)) {
        this.fallbackHigh = amount;
        this.fallbackSteps += 1;
        return true;
      }
      this.fallbackPoint = point;
      this.fallbackLinecast = new LinecastJob(this.gridWorld, this.start, point, this.radius);
    }

    this.fallbackLinecast.step(deadline);
    if (!this.fallbackLinecast.isComplete()) {
      return false;
    }
    const amount = (this.fallbackLow + this.fallbackHigh) * 0.5;
    if (this.fallbackLinecast.isClear()) {
      this.fallbackLow = amount;
    } else {
      this.fallbackHigh = amount;
    }
    this.fallbackSteps += 1;
    this.fallbackLinecast = null;
    this.fallbackPoint = null;
    return true;
  }

  private createPath(destination: THREE.Vector3) {
    return new PathSearchJob(this.gridWorld, this.start, destination, {
      radius: this.radius,
      maxIterations: this.maxIterations,
    });
  }
}

function pointOnLine(start: THREE.Vector3, end: THREE.Vector3, amount: number) {
  return new THREE.Vector3(
    start.x + (end.x - start.x) * amount,
    0,
    start.z + (end.z - start.z) * amount,
  );
}
