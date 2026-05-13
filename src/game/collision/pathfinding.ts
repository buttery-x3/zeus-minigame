import * as THREE from "three";
import { PATHFINDING_MAX_ITERATIONS } from "../../config";
import { distance2D } from "../../lib/math";
import type { GridWorld } from "../../world/GridWorld";
import { hasLineOfSight } from "./linecast";
import { canOccupyWorld, getCellCenter, isCellInBounds } from "./occupancy";

export type PathResult = {
  waypoints: THREE.Vector3[];
  distance: number;
  iterations: number;
};

type PathNode = {
  x: number;
  z: number;
  key: string;
  g: number;
  f: number;
  parentKey: string | null;
};

type FindPathOptions = {
  radius: number;
  maxIterations?: number;
};

const NEIGHBORS = [
  { x: -1, z: -1 },
  { x: 0, z: -1 },
  { x: 1, z: -1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: -1, z: 1 },
  { x: 0, z: 1 },
  { x: 1, z: 1 },
];

export function findPath(gridWorld: GridWorld, start: THREE.Vector3, goal: THREE.Vector3, options: FindPathOptions) {
  const radius = options.radius;
  const startPoint = new THREE.Vector3(start.x, 0, start.z);
  const goalPoint = new THREE.Vector3(goal.x, 0, goal.z);

  if (!canOccupyWorld(gridWorld, startPoint.x, startPoint.z, radius) || !canOccupyWorld(gridWorld, goalPoint.x, goalPoint.z, radius)) {
    return null;
  }

  if (hasLineOfSight(gridWorld, startPoint, goalPoint, radius)) {
    return pathResult([startPoint, goalPoint], 0);
  }

  const startCell = gridWorld.worldToCell(startPoint.x, startPoint.z);
  const goalCell = gridWorld.worldToCell(goalPoint.x, goalPoint.z);
  const startKey = cellKey(startCell.x, startCell.z);
  const goalKey = cellKey(goalCell.x, goalCell.z);
  const nodes = new Map<string, PathNode>();
  const openKeys = [startKey];
  const openSet = new Set(openKeys);
  const closedSet = new Set<string>();
  const maxIterations = options.maxIterations ?? PATHFINDING_MAX_ITERATIONS;

  nodes.set(startKey, {
    x: startCell.x,
    z: startCell.z,
    key: startKey,
    g: 0,
    f: heuristic(gridWorld, startCell.x, startCell.z, goalPoint),
    parentKey: null,
  });

  for (let iterations = 1; openKeys.length > 0 && iterations <= maxIterations; iterations += 1) {
    const current = takeBestOpenNode(openKeys, openSet, nodes);
    if (!current) {
      break;
    }

    if (current.key === goalKey) {
      const points = reconstructPath(gridWorld, nodes, current.key, startPoint, goalPoint);
      return pathResult(smoothPath(gridWorld, points, radius), iterations);
    }

    closedSet.add(current.key);

    for (const offset of NEIGHBORS) {
      const neighborX = current.x + offset.x;
      const neighborZ = current.z + offset.z;

      if (!isCellInBounds(gridWorld, neighborX, neighborZ)) {
        continue;
      }

      const neighborPoint = getCellCenter(gridWorld, neighborX, neighborZ);
      if (!canOccupyWorld(gridWorld, neighborPoint.x, neighborPoint.z, radius)) {
        continue;
      }

      const neighborKey = cellKey(neighborX, neighborZ);
      if (closedSet.has(neighborKey)) {
        continue;
      }

      const currentPoint = nodePoint(gridWorld, current, startKey, startPoint);
      if (!hasLineOfSight(gridWorld, currentPoint, neighborPoint, radius)) {
        continue;
      }

      const parent = current.parentKey ? nodes.get(current.parentKey) : null;
      const parentPoint = parent ? nodePoint(gridWorld, parent, startKey, startPoint) : null;
      const canSeeFromParent = parent && parentPoint && hasLineOfSight(gridWorld, parentPoint, neighborPoint, radius);
      const pathParent = canSeeFromParent ? parent : current;
      const pathParentPoint = canSeeFromParent && parentPoint ? parentPoint : currentPoint;
      const tentativeG = pathParent.g + distance2D(pathParentPoint.x, pathParentPoint.z, neighborPoint.x, neighborPoint.z);
      const existing = nodes.get(neighborKey);

      if (existing && tentativeG >= existing.g) {
        continue;
      }

      nodes.set(neighborKey, {
        x: neighborX,
        z: neighborZ,
        key: neighborKey,
        g: tentativeG,
        f: tentativeG + heuristic(gridWorld, neighborX, neighborZ, goalPoint),
        parentKey: pathParent.key,
      });

      if (!openSet.has(neighborKey)) {
        openSet.add(neighborKey);
        openKeys.push(neighborKey);
      }
    }
  }

  return null;
}

function takeBestOpenNode(openKeys: string[], openSet: Set<string>, nodes: Map<string, PathNode>) {
  let bestIndex = 0;
  let bestNode = nodes.get(openKeys[0]);

  for (let index = 1; index < openKeys.length; index += 1) {
    const node = nodes.get(openKeys[index]);
    if (node && (!bestNode || node.f < bestNode.f)) {
      bestNode = node;
      bestIndex = index;
    }
  }

  if (!bestNode) {
    return null;
  }

  openKeys.splice(bestIndex, 1);
  openSet.delete(bestNode.key);
  return bestNode;
}

function reconstructPath(
  gridWorld: GridWorld,
  nodes: Map<string, PathNode>,
  endKey: string,
  startPoint: THREE.Vector3,
  goalPoint: THREE.Vector3,
) {
  const points = [goalPoint.clone()];
  let key: string | null = endKey;

  while (key) {
    const node = nodes.get(key);
    if (!node) {
      break;
    }
    points.push(node.parentKey ? getCellCenter(gridWorld, node.x, node.z) : startPoint.clone());
    key = node.parentKey;
  }

  return points.reverse();
}

function smoothPath(gridWorld: GridWorld, points: THREE.Vector3[], radius: number) {
  if (points.length <= 2) {
    return points;
  }

  const smoothed = [points[0]];
  let anchorIndex = 0;

  while (anchorIndex < points.length - 1) {
    let nextIndex = points.length - 1;
    while (nextIndex > anchorIndex + 1 && !hasLineOfSight(gridWorld, points[anchorIndex], points[nextIndex], radius)) {
      nextIndex -= 1;
    }
    smoothed.push(points[nextIndex]);
    anchorIndex = nextIndex;
  }

  return smoothed;
}

function pathResult(points: THREE.Vector3[], iterations: number): PathResult {
  const waypoints = points.slice(1).map((point) => point.clone());
  let distance = 0;

  for (let index = 1; index < points.length; index += 1) {
    distance += distance2D(points[index - 1].x, points[index - 1].z, points[index].x, points[index].z);
  }

  return { waypoints, distance, iterations };
}

function nodePoint(gridWorld: GridWorld, node: PathNode, startKey: string, startPoint: THREE.Vector3) {
  return node.key === startKey ? startPoint : getCellCenter(gridWorld, node.x, node.z);
}

function heuristic(gridWorld: GridWorld, cellX: number, cellZ: number, goal: THREE.Vector3) {
  const point = getCellCenter(gridWorld, cellX, cellZ);
  return distance2D(point.x, point.z, goal.x, goal.z);
}

function cellKey(cellX: number, cellZ: number) {
  return `${cellX},${cellZ}`;
}
