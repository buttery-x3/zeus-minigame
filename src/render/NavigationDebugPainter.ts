import * as THREE from "three";
import { ENEMY_COLLISION_RADIUS } from "../config";
import type { CollisionMoveResolution } from "../game/enemies/navigation/NavigationDebugTypes";
import type { GridWorld } from "../world/GridWorld";

const MAX_SEGMENTS = 4096;
const VECTOR_HEIGHT = 0.42;
const VECTOR_LENGTH = 2.7;

const COLORS = {
  target: [0.36, 0.93, 1] as const,
  desired: [0.3, 0.58, 1] as const,
  steered: [1, 0.35, 0.92] as const,
  actual: [0.3, 1, 0.48] as const,
  rejected: [1, 0.18, 0.12] as const,
  path: [1, 0.62, 0.18] as const,
  cell: [0.78, 0.86, 0.9] as const,
  blocked: [1, 0.12, 0.08] as const,
  fullCandidate: [1, 0.86, 0.2] as const,
  xCandidate: [0.4, 1, 0.4] as const,
  zCandidate: [0.75, 0.48, 1] as const,
};

export type NavigationDebugDrawable = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  desiredVelocity: THREE.Vector3;
  steeredVelocity: THREE.Vector3;
  attemptedDelta: THREE.Vector3;
  actualDelta: THREE.Vector3;
  path: THREE.Vector3[];
  collision: CollisionMoveResolution;
};

export class NavigationDebugPainter {
  readonly object: THREE.LineSegments;
  readonly segmentCapacity = MAX_SEGMENTS;
  private readonly positions = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private readonly colors = new Float32Array(MAX_SEGMENTS * 2 * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private segmentCount = 0;

  constructor(private readonly gridWorld: GridWorld) {
    const positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    const colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", positionAttribute);
    this.geometry.setAttribute("color", colorAttribute);
    this.geometry.setDrawRange(0, 0);
    this.object = new THREE.LineSegments(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 1000;
  }

  begin() {
    this.segmentCount = 0;
  }

  draw(snapshot: NavigationDebugDrawable) {
    const position = snapshot.position;
    this.addCellOutline(position, COLORS.cell);
    this.addCircle(position, ENEMY_COLLISION_RADIUS, snapshot.collision === "rejected" ? COLORS.rejected : COLORS.cell);
    this.addArrow(position, snapshot.target, COLORS.target, 5.5, false);
    this.addDirection(position, snapshot.desiredVelocity, COLORS.desired);
    this.addDirection(position, snapshot.steeredVelocity, COLORS.steered);

    if (snapshot.actualDelta.lengthSq() > 0.000025) {
      this.addDirection(position, snapshot.actualDelta, COLORS.actual);
    } else if (snapshot.attemptedDelta.lengthSq() > 0.000001) {
      this.addCross(position, 0.34, COLORS.rejected);
    }

    this.addCollisionCandidates(snapshot);
    let from = position;
    for (let index = 0; index < Math.min(6, snapshot.path.length); index += 1) {
      const waypoint = snapshot.path[index];
      this.addSegment(from.x, from.z, waypoint.x, waypoint.z, COLORS.path, VECTOR_HEIGHT + 0.03);
      from = waypoint;
    }

    const cell = this.gridWorld.worldToCell(position.x, position.z);
    this.gridWorld.forEachCellInRange(cell, 1, (q, r) => {
      if (this.gridWorld.readCommittedCell(q, r)?.blocked) {
        this.addHexOutline(q, r, COLORS.blocked);
      }
    });
  }

  end() {
    this.geometry.setDrawRange(0, this.segmentCount * 2);
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.segmentCount = 0;
    this.geometry.setDrawRange(0, 0);
  }

  getSegmentCount() {
    return this.segmentCount;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }

  private addCollisionCandidates(snapshot: NavigationDebugDrawable) {
    const scale = 8;
    const start = snapshot.position;
    const delta = snapshot.attemptedDelta;
    if (delta.lengthSq() <= 0.000001) return;
    this.addSegment(start.x, start.z, start.x + delta.x * scale, start.z + delta.z * scale, COLORS.fullCandidate, VECTOR_HEIGHT + 0.08);
    this.addSegment(start.x, start.z, start.x + delta.x * scale, start.z, COLORS.xCandidate, VECTOR_HEIGHT + 0.1);
    this.addSegment(start.x, start.z, start.x, start.z + delta.z * scale, COLORS.zCandidate, VECTOR_HEIGHT + 0.12);
  }

  private addDirection(position: THREE.Vector3, direction: THREE.Vector3, color: readonly [number, number, number]) {
    if (direction.lengthSq() <= 0.000001) return;
    const scale = VECTOR_LENGTH / Math.hypot(direction.x, direction.z);
    this.addArrow(position, { x: position.x + direction.x * scale, z: position.z + direction.z * scale }, color, VECTOR_LENGTH, true);
  }

  private addArrow(from: { x: number; z: number }, to: { x: number; z: number }, color: readonly [number, number, number], maxLength: number, exactLength: boolean) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.0001) return;
    const length = exactLength ? maxLength : Math.min(maxLength, distance);
    const nx = dx / distance;
    const nz = dz / distance;
    const endX = from.x + nx * length;
    const endZ = from.z + nz * length;
    this.addSegment(from.x, from.z, endX, endZ, color, VECTOR_HEIGHT);
    const head = Math.min(0.55, length * 0.25);
    this.addSegment(endX, endZ, endX - nx * head - nz * head * 0.55, endZ - nz * head + nx * head * 0.55, color, VECTOR_HEIGHT);
    this.addSegment(endX, endZ, endX - nx * head + nz * head * 0.55, endZ - nz * head - nx * head * 0.55, color, VECTOR_HEIGHT);
  }

  private addCellOutline(position: THREE.Vector3, color: readonly [number, number, number]) {
    const cell = this.gridWorld.worldToCell(position.x, position.z);
    this.addHexOutline(cell.q, cell.r, color);
  }

  private addHexOutline(q: number, r: number, color: readonly [number, number, number]) {
    const corners = this.gridWorld.getHexCorners(q, r, 0.94);
    for (let index = 0; index < corners.length; index += 1) {
      const a = corners[index];
      const b = corners[(index + 1) % corners.length];
      this.addSegment(a.x, a.z, b.x, b.z, color, VECTOR_HEIGHT - 0.08);
    }
  }

  private addCircle(position: THREE.Vector3, radius: number, color: readonly [number, number, number]) {
    const steps = 12;
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2;
      const b = ((index + 1) / steps) * Math.PI * 2;
      this.addSegment(position.x + Math.cos(a) * radius, position.z + Math.sin(a) * radius, position.x + Math.cos(b) * radius, position.z + Math.sin(b) * radius, color, VECTOR_HEIGHT - 0.04);
    }
  }

  private addCross(position: THREE.Vector3, radius: number, color: readonly [number, number, number]) {
    this.addSegment(position.x - radius, position.z - radius, position.x + radius, position.z + radius, color, VECTOR_HEIGHT + 0.14);
    this.addSegment(position.x - radius, position.z + radius, position.x + radius, position.z - radius, color, VECTOR_HEIGHT + 0.14);
  }

  private addSegment(ax: number, az: number, bx: number, bz: number, color: readonly [number, number, number], y: number) {
    if (this.segmentCount >= MAX_SEGMENTS) return;
    const offset = this.segmentCount * 6;
    this.positions[offset] = ax;
    this.positions[offset + 1] = y;
    this.positions[offset + 2] = az;
    this.positions[offset + 3] = bx;
    this.positions[offset + 4] = y;
    this.positions[offset + 5] = bz;
    this.colors[offset] = color[0];
    this.colors[offset + 1] = color[1];
    this.colors[offset + 2] = color[2];
    this.colors[offset + 3] = color[0];
    this.colors[offset + 4] = color[1];
    this.colors[offset + 5] = color[2];
    this.segmentCount += 1;
  }
}
