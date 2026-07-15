import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS } from "../../config";
import { distance2D } from "../../lib/math";
import type { CollisionMoveTrace } from "../collision/CollisionSystem";

type CollisionMover = {
  moveWithCollision: (
    position: THREE.Vector3,
    desiredDelta: THREE.Vector3,
    radius: number,
    trace?: CollisionMoveTrace,
  ) => THREE.Vector3;
};

type MoveCandidate = {
  attemptedDelta: THREE.Vector3;
  nextPosition: THREE.Vector3;
  movedDistance: number;
  targetProgress: number;
  collisionResolution: CollisionMoveTrace["resolution"];
};

export type EnemyMoveChoice = MoveCandidate & {
  avoidanceFallbackAttempted: boolean;
  usedPreferredFallback: boolean;
};

const MIN_PROGRESS = 0.0005;

export function chooseEnemyMove(
  collision: CollisionMover,
  position: THREE.Vector3,
  target: THREE.Vector3,
  desiredVelocity: THREE.Vector3,
  steeredVelocity: THREE.Vector3,
  dt: number,
  trace?: CollisionMoveTrace,
): EnemyMoveChoice {
  const primary = evaluateMove(collision, position, target, steeredVelocity, dt, trace);
  const avoidanceChangedDirection = steeredVelocity.distanceToSquared(desiredVelocity) > 0.000001;
  if (!avoidanceChangedDirection || desiredVelocity.lengthSq() <= 0.000001 || primary.targetProgress > MIN_PROGRESS) {
    return { ...primary, avoidanceFallbackAttempted: false, usedPreferredFallback: false };
  }

  const preferred = evaluateMove(collision, position, target, desiredVelocity, dt, trace);
  const usePreferred =
    preferred.targetProgress > primary.targetProgress + MIN_PROGRESS ||
    (primary.movedDistance < 0.001 && preferred.movedDistance >= 0.001);
  if (usePreferred) {
    return { ...preferred, avoidanceFallbackAttempted: true, usedPreferredFallback: true };
  }

  if (trace) {
    trace.resolution = primary.collisionResolution;
  }
  return { ...primary, avoidanceFallbackAttempted: true, usedPreferredFallback: false };
}

function evaluateMove(
  collision: CollisionMover,
  position: THREE.Vector3,
  target: THREE.Vector3,
  velocity: THREE.Vector3,
  dt: number,
  trace?: CollisionMoveTrace,
): MoveCandidate {
  const attemptedDelta = new THREE.Vector3(velocity.x * dt, 0, velocity.z * dt);
  const startDistance = distance2D(position.x, position.z, target.x, target.z);
  const nextPosition = collision.moveWithCollision(position, attemptedDelta, ENEMY_COLLISION_RADIUS, trace);
  return {
    attemptedDelta,
    nextPosition,
    movedDistance: distance2D(position.x, position.z, nextPosition.x, nextPosition.z),
    targetProgress: startDistance - distance2D(nextPosition.x, nextPosition.z, target.x, target.z),
    collisionResolution: trace?.resolution ?? "full",
  };
}
