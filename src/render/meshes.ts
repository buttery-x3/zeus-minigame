import * as THREE from "three";
import { createLine } from "./primitives";

export type PlayerModel = {
  group: THREE.Group;
  body: THREE.Mesh;
  aura: THREE.Mesh;
};

export type EnemyModel = {
  group: THREE.Group;
  body: THREE.Mesh;
};

export function createPlayerModel(playerMaterial: THREE.Material): PlayerModel {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 1.65, 6, 16), playerMaterial);
  body.castShadow = true;
  body.position.y = 1.55;

  const aura = new THREE.Mesh(
    new THREE.TorusGeometry(1.62, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x7bd7ff, transparent: true, opacity: 0.54 }),
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

export function createChargedGlyph(x: number, z: number) {
  const group = new THREE.Group();
  const line = createLine(
    [
      new THREE.Vector3(-0.7, 0.03, 0.9),
      new THREE.Vector3(0.05, 0.03, -0.25),
      new THREE.Vector3(0.48, 0.03, 0.1),
      new THREE.Vector3(0.0, 0.03, -0.9),
    ],
    0x67e3c0,
    0.7,
  );
  group.add(line);
  group.position.set(x, 0.05, z);
  return group;
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
