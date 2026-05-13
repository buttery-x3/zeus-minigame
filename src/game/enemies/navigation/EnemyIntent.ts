import type * as THREE from "three";
import type { EnemyState } from "../../../types";

export type EnemyIntentKind = "meleeChase" | "rangedPosition" | "retreat" | "specialGoal";

export type EnemyIntent = {
  kind: EnemyIntentKind;
  goal?: THREE.Vector3;
  preferredRange?: number;
};

export function getMeleeChaseIntent(): EnemyIntent {
  return { kind: "meleeChase" };
}

export function getRangedPositionIntent(_enemy: EnemyState, _playerPosition: THREE.Vector3): EnemyIntent {
  // Future ranged enemies should use the shared flow field to approach broad engagement range,
  // then local line-of-sight, hold-range, strafe, and retreat steering to choose exact positions.
  return { kind: "rangedPosition", preferredRange: 28 };
}

export function getRetreatIntent(_enemy: EnemyState, playerPosition: THREE.Vector3): EnemyIntent {
  // Future retreating enemies can use local steering away from Zeus first, then an escape/reverse
  // flow field if simple steering is not enough for denser obstacle layouts.
  return { kind: "retreat", goal: playerPosition };
}

export function getSpecialGoalIntent(goal: THREE.Vector3): EnemyIntent {
  // Bosses and scripted enemies should request individual paths through EnemyPathQueue,
  // never by running Theta* directly during their frame update.
  return { kind: "specialGoal", goal };
}
