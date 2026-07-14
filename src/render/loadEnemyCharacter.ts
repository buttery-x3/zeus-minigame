import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const ENEMY_CHARACTER_HEIGHT = 3.2;
const ENEMY_CHARACTER_URL = `${import.meta.env.BASE_URL}assets/models/enemies/melee-enemy/melee-enemy.glb`;

type EnemyCharacterAsset = {
  template: THREE.Group;
  animations: THREE.AnimationClip[];
  sharedGeometries: THREE.BufferGeometry[];
  scale: number;
};

export type LoadedEnemyCharacter = {
  object: THREE.Group;
  animations: THREE.AnimationClip[];
  materials: THREE.Material[];
  sharedGeometries: THREE.BufferGeometry[];
  sourceUrl: string;
  scale: number;
};

let assetPromise: Promise<EnemyCharacterAsset> | null = null;

export async function loadEnemyCharacter(): Promise<LoadedEnemyCharacter> {
  const asset = await (assetPromise ??= loadEnemyCharacterAsset());
  const object = cloneSkeleton(asset.template) as THREE.Group;
  const materials = cloneMaterials(object);

  return {
    object,
    animations: asset.animations,
    materials,
    sharedGeometries: asset.sharedGeometries,
    sourceUrl: ENEMY_CHARACTER_URL,
    scale: asset.scale,
  };
}

async function loadEnemyCharacterAsset(): Promise<EnemyCharacterAsset> {
  const gltf = await new GLTFLoader().loadAsync(ENEMY_CHARACTER_URL);
  const template = gltf.scene;

  template.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(template);
  const initialHeight = initialBounds.getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(initialHeight) || initialHeight <= 0) {
    throw new Error(`Melee enemy model has invalid bounds height: ${initialHeight}`);
  }

  const scale = ENEMY_CHARACTER_HEIGHT / initialHeight;
  template.scale.multiplyScalar(scale);
  template.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(template);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  template.position.x -= center.x;
  template.position.y -= scaledBounds.min.y;
  template.position.z -= center.z;
  template.updateMatrixWorld(true);

  const sharedGeometries = new Set<THREE.BufferGeometry>();
  template.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = false;
      sharedGeometries.add(child.geometry);
    }
  });

  return {
    template,
    animations: gltf.animations,
    sharedGeometries: [...sharedGeometries],
    scale,
  };
}

function cloneMaterials(root: THREE.Object3D) {
  const clones = new Map<THREE.Material, THREE.Material>();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => cloneMaterial(material, clones));
    } else {
      child.material = cloneMaterial(child.material, clones);
    }
  });

  return [...clones.values()];
}

function cloneMaterial(material: THREE.Material, clones: Map<THREE.Material, THREE.Material>) {
  const existing = clones.get(material);
  if (existing) {
    return existing;
  }

  const clone = material.clone();
  clones.set(material, clone);
  return clone;
}
