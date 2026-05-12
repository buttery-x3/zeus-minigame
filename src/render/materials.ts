import * as THREE from "three";

export type GameMaterials = ReturnType<typeof createGameMaterials>;

export function createGameMaterials() {
  return {
    floor: new THREE.MeshStandardMaterial({
      color: 0x172126,
      roughness: 0.92,
      metalness: 0.02,
    }),
    scarred: new THREE.MeshStandardMaterial({
      color: 0x231a1a,
      roughness: 0.96,
    }),
    charged: new THREE.MeshStandardMaterial({
      color: 0x173733,
      emissive: 0x0b312c,
      emissiveIntensity: 0.45,
      roughness: 0.7,
    }),
    blocker: new THREE.MeshStandardMaterial({
      color: 0x4d5554,
      roughness: 0.84,
    }),
    player: new THREE.MeshStandardMaterial({
      color: 0xdfe8ee,
      emissive: 0x21526b,
      emissiveIntensity: 0.25,
      roughness: 0.42,
    }),
    enemy: new THREE.MeshStandardMaterial({
      color: 0xb7423f,
      emissive: 0x2d0508,
      emissiveIntensity: 0.22,
      roughness: 0.68,
    }),
    enemyHit: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xff755e,
      emissiveIntensity: 0.8,
      roughness: 0.42,
    }),
  };
}
