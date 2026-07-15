import * as THREE from "three";
import {
  ENEMY_UNIT_AVOIDANCE_RADIUS,
  ENEMY_UNIT_MAX_STEERING_FRACTION,
  ENEMY_UNIT_SEPARATION_RADIUS,
  ENEMY_UNIT_SEPARATION_STRENGTH,
  ENEMY_UNIT_TANGENTIAL_STRENGTH,
} from "../../config";
import { clamp, distance2D } from "../../lib/math";
import type { EnemyState } from "../../types";

export type EnemyAvoidanceDiagnostics = {
  enemyCount: number;
  maxNeighbors: number;
  overlappingPairs: number;
  averageOverlap: number;
  maxOverlap: number;
  maxSpeedRatio: number;
  obstacleFallbackAttempts: number;
  obstacleFallbackWins: number;
};

const EMPTY_DIAGNOSTICS: EnemyAvoidanceDiagnostics = {
  enemyCount: 0,
  maxNeighbors: 0,
  overlappingPairs: 0,
  averageOverlap: 0,
  maxOverlap: 0,
  maxSpeedRatio: 0,
  obstacleFallbackAttempts: 0,
  obstacleFallbackWins: 0,
};

export class EnemyAvoidance {
  private readonly cells = new Map<string, EnemyState[]>();
  private diagnosticsSnapshot: EnemyAvoidanceDiagnostics = { ...EMPTY_DIAGNOSTICS };

  beginFrame(enemies: EnemyState[]) {
    this.cells.clear();
    for (const enemy of enemies) {
      const key = this.cellKey(enemy.group.position.x, enemy.group.position.z);
      const bucket = this.cells.get(key);
      if (bucket) {
        bucket.push(enemy);
      } else {
        this.cells.set(key, [enemy]);
      }
    }

    this.diagnosticsSnapshot = this.measureSpacing(enemies);
  }

  steer(enemy: EnemyState, preferredVelocity: THREE.Vector3, target: THREE.Vector3) {
    const speed = preferredVelocity.length();
    if (speed <= 0.001) {
      return preferredVelocity.clone();
    }

    const position = enemy.group.position;
    const preferredDirection = preferredVelocity.clone().normalize();
    const targetDirection = directionToTarget(position, target, preferredDirection);
    const steering = new THREE.Vector3();

    for (const neighbor of this.queryNeighbors(position)) {
      if (neighbor === enemy) {
        continue;
      }

      this.addNeighborSteering(enemy, neighbor, preferredDirection, targetDirection, speed, steering);
    }

    clampLength(steering, speed * ENEMY_UNIT_MAX_STEERING_FRACTION);
    const velocity = preferredVelocity.clone().add(steering);
    clampLength(velocity, speed);
    return velocity;
  }

  recordSpeedRatio(speedRatio: number) {
    this.diagnosticsSnapshot.maxSpeedRatio = Math.max(this.diagnosticsSnapshot.maxSpeedRatio, speedRatio);
  }

  recordObstacleFallback(attempted: boolean, used: boolean) {
    this.diagnosticsSnapshot.obstacleFallbackAttempts += attempted ? 1 : 0;
    this.diagnosticsSnapshot.obstacleFallbackWins += used ? 1 : 0;
  }

  diagnostics() {
    return { ...this.diagnosticsSnapshot };
  }

  private addNeighborSteering(
    enemy: EnemyState,
    neighbor: EnemyState,
    preferredDirection: THREE.Vector3,
    targetDirection: THREE.Vector3,
    speed: number,
    steering: THREE.Vector3,
  ) {
    const position = enemy.group.position;
    const neighborPosition = neighbor.group.position;
    let awayX = position.x - neighborPosition.x;
    let awayZ = position.z - neighborPosition.z;
    let distance = Math.hypot(awayX, awayZ);

    if (distance <= 0.001) {
      const angle = enemy.id * 2.399963;
      awayX = Math.cos(angle);
      awayZ = Math.sin(angle);
      distance = 1;
    } else {
      awayX /= distance;
      awayZ /= distance;
    }

    if (distance >= ENEMY_UNIT_AVOIDANCE_RADIUS) {
      return;
    }

    const proximity = 1 - distance / ENEMY_UNIT_AVOIDANCE_RADIUS;
    const overlap = clamp((ENEMY_UNIT_SEPARATION_RADIUS - distance) / ENEMY_UNIT_SEPARATION_RADIUS, 0, 1);
    const radialWeight = speed * ENEMY_UNIT_SEPARATION_STRENGTH * (overlap + proximity * proximity * 0.34);
    steering.x += awayX * radialWeight;
    steering.z += awayZ * radialWeight;

    const toNeighborX = -awayX;
    const toNeighborZ = -awayZ;
    const ahead = Math.max(0, preferredDirection.x * toNeighborX + preferredDirection.z * toNeighborZ);
    if (ahead <= 0.001) {
      return;
    }

    const tangent = chooseTangent(awayX, awayZ, targetDirection, enemy.id, neighbor.id);
    const tangentWeight = speed * ENEMY_UNIT_TANGENTIAL_STRENGTH * ahead * proximity;
    steering.x += tangent.x * tangentWeight;
    steering.z += tangent.z * tangentWeight;
  }

  private measureSpacing(enemies: EnemyState[]) {
    let maxNeighbors = 0;
    let overlappingPairs = 0;
    let totalOverlap = 0;
    let maxOverlap = 0;

    for (const enemy of enemies) {
      let neighbors = 0;
      for (const neighbor of this.queryNeighbors(enemy.group.position)) {
        if (neighbor === enemy) {
          continue;
        }

        const distance = distance2D(
          enemy.group.position.x,
          enemy.group.position.z,
          neighbor.group.position.x,
          neighbor.group.position.z,
        );
        if (distance < ENEMY_UNIT_AVOIDANCE_RADIUS) {
          neighbors += 1;
        }
        if (neighbor.id < enemy.id || distance >= ENEMY_UNIT_SEPARATION_RADIUS) {
          continue;
        }

        const overlap = ENEMY_UNIT_SEPARATION_RADIUS - distance;
        overlappingPairs += 1;
        totalOverlap += overlap;
        maxOverlap = Math.max(maxOverlap, overlap);
      }
      maxNeighbors = Math.max(maxNeighbors, neighbors);
    }

    return {
      enemyCount: enemies.length,
      maxNeighbors,
      overlappingPairs,
      averageOverlap: overlappingPairs > 0 ? totalOverlap / overlappingPairs : 0,
      maxOverlap,
      maxSpeedRatio: 0,
      obstacleFallbackAttempts: 0,
      obstacleFallbackWins: 0,
    };
  }

  private queryNeighbors(position: THREE.Vector3) {
    const cellX = this.cellCoordinate(position.x);
    const cellZ = this.cellCoordinate(position.z);
    const neighbors: EnemyState[] = [];

    for (let z = cellZ - 1; z <= cellZ + 1; z += 1) {
      for (let x = cellX - 1; x <= cellX + 1; x += 1) {
        const bucket = this.cells.get(`${x},${z}`);
        if (bucket) {
          neighbors.push(...bucket);
        }
      }
    }

    return neighbors;
  }

  private cellKey(x: number, z: number) {
    return `${this.cellCoordinate(x)},${this.cellCoordinate(z)}`;
  }

  private cellCoordinate(value: number) {
    return Math.floor(value / ENEMY_UNIT_AVOIDANCE_RADIUS);
  }
}

function directionToTarget(position: THREE.Vector3, target: THREE.Vector3, fallback: THREE.Vector3) {
  const direction = new THREE.Vector3(target.x - position.x, 0, target.z - position.z);
  if (direction.lengthSq() <= 0.000001) {
    return fallback;
  }
  return direction.normalize();
}

function chooseTangent(awayX: number, awayZ: number, targetDirection: THREE.Vector3, enemyId: number, neighborId: number) {
  const left = { x: -awayZ, z: awayX };
  const right = { x: awayZ, z: -awayX };
  const leftDot = left.x * targetDirection.x + left.z * targetDirection.z;
  const rightDot = right.x * targetDirection.x + right.z * targetDirection.z;

  if (Math.abs(leftDot - rightDot) < 0.001) {
    return enemyId < neighborId ? left : right;
  }

  return leftDot > rightDot ? left : right;
}

function clampLength(vector: THREE.Vector3, maxLength: number) {
  const lengthSq = vector.lengthSq();
  if (lengthSq > maxLength * maxLength) {
    vector.multiplyScalar(maxLength / Math.sqrt(lengthSq));
  }
}
