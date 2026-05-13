import * as THREE from "three";

export function targetFromDirection(position: THREE.Vector3, direction: THREE.Vector3, distance: number) {
  return new THREE.Vector3(position.x + direction.x * distance, 0, position.z + direction.z * distance);
}

export function directionTo(from: THREE.Vector3, to: THREE.Vector3) {
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  if (direction.lengthSq() > 0.000001) {
    direction.normalize();
  }
  return direction;
}

export function retreatFrom(position: THREE.Vector3, threat: THREE.Vector3) {
  return directionTo(threat, position);
}

export function holdRangePosition(position: THREE.Vector3, target: THREE.Vector3, preferredRange: number) {
  // Stub for ranged enemies: this gives a simple desired point on the radius around the target.
  // Later tactical scoring should choose a point with cover, line of sight, and ally spacing.
  const away = retreatFrom(position, target);
  return new THREE.Vector3(target.x + away.x * preferredRange, 0, target.z + away.z * preferredRange);
}
