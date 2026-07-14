import * as THREE from "three";

export type GameMaterials = ReturnType<typeof createGameMaterials>;

export function createGameMaterials() {
  return {
    grass: new THREE.MeshStandardMaterial({
      color: 0x17251f,
      roughness: 0.92,
      metalness: 0.02,
    }),
    dirt: new THREE.MeshStandardMaterial({
      color: 0x242019,
      roughness: 0.94,
      metalness: 0.02,
    }),
    sand: new THREE.MeshStandardMaterial({
      color: 0x343125,
      roughness: 0.9,
    }),
    mud: new THREE.MeshStandardMaterial({
      color: 0x1d211c,
      roughness: 0.98,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: 0x293033,
      roughness: 0.86,
    }),
    scarred: new THREE.MeshStandardMaterial({
      color: 0x231a1a,
      roughness: 0.96,
    }),
    charged: new THREE.MeshStandardMaterial({
      color: 0x173733,
      emissive: 0x0b312c,
      emissiveIntensity: 0.29,
      roughness: 0.7,
    }),
    cursed: new THREE.MeshStandardMaterial({
      color: 0x28162f,
      emissive: 0x3c0d54,
      emissiveIntensity: 0.34,
      roughness: 0.76,
    }),
    lake: new THREE.MeshStandardMaterial({
      color: 0x102833,
      emissive: 0x07151b,
      emissiveIntensity: 0.16,
      roughness: 0.58,
      metalness: 0.08,
    }),
    river: new THREE.MeshStandardMaterial({
      color: 0x0f3038,
      emissive: 0x061c22,
      emissiveIntensity: 0.2,
      roughness: 0.54,
      metalness: 0.1,
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
