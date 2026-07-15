import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PLAYER_CHARACTER_HEIGHT = 3.4;
const PLAYER_CHARACTER_URL = `${import.meta.env.BASE_URL}assets/models/characters/zeus/zeus.glb`;

export type LoadedPlayerCharacter = {
  object: THREE.Group;
  animations: THREE.AnimationClip[];
  materials: THREE.Material[];
  sourceUrl: string;
  scale: number;
};

export async function loadPlayerCharacter(): Promise<LoadedPlayerCharacter> {
  const gltf = await new GLTFLoader().loadAsync(PLAYER_CHARACTER_URL);
  const object = gltf.scene;
  const materials = cloneCharacterMaterials(object);

  object.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(object);
  const initialHeight = initialBounds.getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(initialHeight) || initialHeight <= 0) {
    throw new Error(`Zeus model has invalid bounds height: ${initialHeight}`);
  }

  const scale = PLAYER_CHARACTER_HEIGHT / initialHeight;
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(object);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= scaledBounds.min.y;
  object.position.z -= center.z;
  object.updateMatrixWorld(true);

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = false;
    }
  });

  return {
    object,
    animations: gltf.animations,
    materials,
    sourceUrl: PLAYER_CHARACTER_URL,
    scale,
  };
}

function cloneCharacterMaterials(root: THREE.Object3D) {
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
  clone.transparent = false;
  clone.opacity = 1;
  clone.depthWrite = true;
  clone.depthTest = true;
  clone.alphaTest = 0;
  clone.needsUpdate = true;
  clones.set(material, clone);
  return clone;
}
