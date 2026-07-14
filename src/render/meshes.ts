import * as THREE from "three";
import { createLine, createRing } from "./primitives";

export type PlayerModel = {
  group: THREE.Group;
  body: THREE.Mesh;
  aura: THREE.Mesh;
};

export type EnemyModel = {
  group: THREE.Group;
  body: THREE.Mesh;
};

export type GroundGlyphModel = {
  group: THREE.Group;
  rune: THREE.Object3D;
  ring: THREE.Object3D;
};

export type GroundParticleModel = {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  positions: Float32Array;
  count: number;
};

export const PLAYER_AURA_COLOR = 0xf2a43a;
export const PLAYER_CHARGED_AURA_COLOR = 0xffc857;

export function createPlayerModel(playerMaterial: THREE.Material): PlayerModel {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 1.65, 6, 16), playerMaterial);
  body.castShadow = true;
  body.position.y = 1.55;

  const aura = new THREE.Mesh(
    new THREE.TorusGeometry(1.62, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: PLAYER_AURA_COLOR, transparent: true, opacity: 0.54 }),
  );
  aura.rotation.x = Math.PI / 2;
  aura.position.y = 0.08;

  group.add(aura, body, createLightningMark());
  return { group, body, aura };
}

export function createEnemyModel(enemyMaterial: THREE.Material): EnemyModel {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.05, 5, 12), enemyMaterial);
  body.position.y = 1.22;
  body.castShadow = true;

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffc07a });
  const eyeGeometry = new THREE.SphereGeometry(0.09, 8, 8);
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(-0.28, 1.55, 0.78);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.28;

  group.add(body, leftEye, rightEye);
  return { group, body };
}

export function createChargedGlyph(x: number, z: number): GroundGlyphModel {
  const group = new THREE.Group();
  const rune = createLine(
    [
      new THREE.Vector3(-0.7, 0.03, 0.9),
      new THREE.Vector3(0.05, 0.03, -0.25),
      new THREE.Vector3(0.48, 0.03, 0.1),
      new THREE.Vector3(0.0, 0.03, -0.9),
    ],
    0x67e3c0,
    0.7,
  );
  const ring = createRing(1.34, 0x67e3c0, 0.34);
  group.add(rune, ring);
  group.position.set(x, 0.11, z);
  return { group, rune, ring };
}

export function createCursedGlyph(x: number, z: number): GroundGlyphModel {
  const group = new THREE.Group();
  const rune = new THREE.Group();
  rune.add(
    createLine(
      [
        new THREE.Vector3(-0.88, 0.02, -0.62),
        new THREE.Vector3(-0.18, 0.02, -0.12),
        new THREE.Vector3(-0.7, 0.02, 0.7),
      ],
      0xd475ff,
      0.8,
    ),
    createLine(
      [
        new THREE.Vector3(0.78, 0.02, -0.72),
        new THREE.Vector3(0.14, 0.02, 0.02),
        new THREE.Vector3(0.72, 0.02, 0.76),
      ],
      0x9e4bd1,
      0.72,
    ),
  );
  const ring = createRing(1.42, 0xb65be2, 0.42);
  group.add(rune, ring);
  group.position.set(x, 0.11, z);
  return { group, rune, ring };
}

export function createGroundActivityParticles(count = 7): GroundParticleModel {
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x8ffff0,
    size: 0.26,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, positions, count };
}

function createLightningMark() {
  const shape = new THREE.Shape();
  shape.moveTo(0.18, 0.05);
  shape.lineTo(-0.18, 0.68);
  shape.lineTo(0.18, 0.55);
  shape.lineTo(-0.04, 1.18);
  shape.lineTo(0.48, 0.36);
  shape.lineTo(0.12, 0.48);
  shape.closePath();

  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0x7bd7ff, side: THREE.DoubleSide }),
  );
  mesh.position.set(-0.24, 1.2, 1.08);
  return mesh;
}
