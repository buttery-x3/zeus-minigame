import * as THREE from "three";
import { randomBetween } from "../lib/math";

export function createRing(radius: number, color: THREE.ColorRepresentation, opacity: number) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2);
  const points = curve.getPoints(96).map((point) => new THREE.Vector3(point.x, 0, point.y));
  return createLine(points, color, opacity);
}

export function createCrosshair(radius: number, color: THREE.ColorRepresentation, opacity: number) {
  const points = [
    new THREE.Vector3(-radius, 0, 0),
    new THREE.Vector3(-radius * 0.45, 0, 0),
    new THREE.Vector3(radius * 0.45, 0, 0),
    new THREE.Vector3(radius, 0, 0),
    new THREE.Vector3(0, 0, -radius),
    new THREE.Vector3(0, 0, -radius * 0.45),
    new THREE.Vector3(0, 0, radius * 0.45),
    new THREE.Vector3(0, 0, radius),
  ];
  const group = new THREE.Group();
  group.add(createLine(points.slice(0, 4), color, opacity));
  group.add(createLine(points.slice(4), color, opacity));
  return group;
}

export function createLine(points: THREE.Vector3[], color: THREE.ColorRepresentation, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.Line(geometry, material);
}

export function setLineOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse((child) => {
    const maybeLine = child as THREE.Line;
    const material = maybeLine.material;
    if (material instanceof THREE.LineBasicMaterial) {
      material.opacity = opacity;
    }
  });
}

export function setLineColor(object: THREE.Object3D, color: THREE.ColorRepresentation) {
  object.traverse((child) => {
    const maybeLine = child as THREE.Line;
    const material = maybeLine.material;
    if (material instanceof THREE.LineBasicMaterial) {
      material.color.set(color);
    }
  });
}

export function jaggedLine(start: THREE.Vector3, end: THREE.Vector3, steps: number, jitter: number) {
  const points: THREE.Vector3[] = [];
  const direction = end.clone().sub(start).normalize();
  const side = new THREE.Vector3(-direction.z, 0, direction.x);

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = start.clone().lerp(end, t);
    if (i > 0 && i < steps) {
      point.addScaledVector(side, randomBetween(-jitter, jitter));
      point.y += randomBetween(-jitter * 0.35, jitter * 0.35);
    }
    points.push(point);
  }

  return points;
}
