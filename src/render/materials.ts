import * as THREE from "three";

export type GameMaterials = ReturnType<typeof createGameMaterials>;
export type GameMaterialPalettes = ReturnType<typeof createGameMaterialPalettes>;

export function createGameMaterialPalettes() {
  return {
    normal: createGameMaterials(false),
    potato: createGameMaterials(true),
  };
}

export function createGameMaterials(unlit = false) {
  return {
    grass: createMaterial(unlit, {
      color: 0x17251f,
      roughness: 0.92,
      metalness: 0.02,
    }),
    meadow: createMaterial(unlit, {
      color: 0x1b2d24,
      roughness: 0.92,
      metalness: 0.02,
    }),
    sand: createMaterial(unlit, {
      color: 0x343125,
      roughness: 0.9,
    }),
    mud: createMaterial(unlit, {
      color: 0x1d211c,
      roughness: 0.98,
    }),
    stone: createMaterial(unlit, {
      color: 0x293033,
      roughness: 0.86,
    }),
    scarred: createMaterial(unlit, {
      color: 0x231a1a,
      roughness: 0.96,
    }),
    charged: createMaterial(unlit, {
      color: 0x173733,
      emissive: 0x0b312c,
      emissiveIntensity: 0.29,
      roughness: 0.7,
    }),
    cursed: createMaterial(unlit, {
      color: 0x28162f,
      emissive: 0x3c0d54,
      emissiveIntensity: 0.34,
      roughness: 0.76,
    }),
    lake: createMaterial(unlit, {
      color: 0x102833,
      emissive: 0x07151b,
      emissiveIntensity: 0.16,
      roughness: 0.58,
      metalness: 0.08,
    }),
    river: createMaterial(unlit, {
      color: 0x0f3038,
      emissive: 0x061c22,
      emissiveIntensity: 0.2,
      roughness: 0.54,
      metalness: 0.1,
    }),
    blocker: createMaterial(unlit, {
      color: 0x4d5554,
      roughness: 0.84,
    }),
    player: createMaterial(unlit, {
      color: 0xdfe8ee,
      emissive: 0x21526b,
      emissiveIntensity: 0.25,
      roughness: 0.42,
    }),
    enemy: createMaterial(unlit, {
      color: 0xb7423f,
      emissive: 0x2d0508,
      emissiveIntensity: 0.22,
      roughness: 0.68,
    }),
    enemyHit: createMaterial(unlit, {
      color: 0xffffff,
      emissive: 0xff755e,
      emissiveIntensity: 0.8,
      roughness: 0.42,
    }),
  };
}

type MaterialOptions = THREE.MeshStandardMaterialParameters;

function createMaterial(unlit: boolean, options: MaterialOptions): THREE.Material {
  if (!unlit) {
    return new THREE.MeshStandardMaterial(options);
  }

  return new THREE.MeshBasicMaterial({ color: options.color });
}
