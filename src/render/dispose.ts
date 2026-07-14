import * as THREE from "three";

type DisposableObject = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

type DisposeOptions = {
  preserveGeometries?: Iterable<THREE.BufferGeometry>;
  preserveMaterials?: Iterable<THREE.Material>;
};

export function disposeObject3D(root: THREE.Object3D, options: DisposeOptions = {}) {
  const preservedGeometries = new Set(options.preserveGeometries ?? []);
  const preservedMaterials = new Set(options.preserveMaterials ?? []);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((child) => {
    const object = child as DisposableObject;

    if (object.geometry) {
      geometries.add(object.geometry);
    }

    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        materials.add(material);
      }
    } else if (object.material) {
      materials.add(object.material);
    }
  });

  for (const geometry of geometries) {
    if (!preservedGeometries.has(geometry)) {
      geometry.dispose();
    }
  }

  for (const material of materials) {
    if (!preservedMaterials.has(material)) {
      material.dispose();
    }
  }
}
