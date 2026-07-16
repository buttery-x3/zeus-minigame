import * as THREE from "three";
import type { GridWorld } from "../world/GridWorld";
import type { TerrainPatchBoundarySegment } from "../world/TerrainPatchBoundaries";

const BORDER_COLOR = 0xffc857;
const BORDER_WIDTH = 0.2;
const BORDER_HEIGHT = 0.035;
const BORDER_Y = 0.14;

export function createTerrainPatchDebugOverlay(
  gridWorld: GridWorld,
  segments: readonly TerrainPatchBoundarySegment[],
) {
  if (segments.length === 0) {
    return null;
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: BORDER_COLOR,
    transparent: true,
    opacity: 0.25,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, segments.length);
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(gridWorld.hexSize * 1.02, BORDER_HEIGHT, BORDER_WIDTH);
  const matrix = new THREE.Matrix4();

  segments.forEach((segment, index) => {
    const a = gridWorld.cellToWorld(segment.a.q, segment.a.r);
    const b = gridWorld.cellToWorld(segment.b.q, segment.b.r);
    const normalX = b.x - a.x;
    const normalZ = b.z - a.z;
    const tangentX = -normalZ;
    const tangentZ = normalX;
    position.set((a.x + b.x) * 0.5, BORDER_Y, (a.z + b.z) * 0.5);
    rotation.setFromAxisAngle(up, Math.atan2(-tangentZ, tangentX));
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });

  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  mesh.renderOrder = 900;
  mesh.raycast = () => undefined;
  return mesh;
}
