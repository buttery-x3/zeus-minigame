import * as THREE from "three";
import { NAVIGATION_PATH_MAX_NODES_PER_SLICE, PATHFINDING_MAX_ITERATIONS } from "../../config";
import { distance2D } from "../../lib/math";
import { MinHeap } from "../../lib/MinHeap";
import type { GridWorld } from "../../world/GridWorld";
import { hasLineOfSight, LinecastJob } from "./linecast";
import { canOccupyWorld, getCellCenter, isCellInBounds } from "./occupancy";

export type PathResult = {
  waypoints: THREE.Vector3[];
  distance: number;
  iterations: number;
};

type PathNode = {
  q: number;
  r: number;
  key: string;
  g: number;
  f: number;
  parentKey: string | null;
};

type OpenEntry = {
  key: string;
  g: number;
  f: number;
};

type FindPathOptions = {
  radius: number;
  maxIterations?: number;
};

type CurrentExpansion = {
  node: PathNode;
  neighbors: { q: number; r: number }[];
  neighborIndex: number;
};

type PendingNeighbor = {
  current: PathNode;
  currentPoint: THREE.Vector3;
  neighbor: { q: number; r: number };
  neighborPoint: THREE.Vector3;
  neighborKey: string;
  parent: PathNode;
  parentPoint: THREE.Vector3;
  linecast: LinecastJob;
};

type SearchStage = "direct" | "search" | "smooth" | "complete" | "failed";
export type PathSearchCompletionReason =
  | "running"
  | "direct"
  | "path"
  | "invalid-endpoint"
  | "open-exhausted"
  | "iteration-limit"
  | "smoothing-failed";

export class PathSearchJob {
  private readonly radius: number;
  private readonly maxIterations: number;
  private readonly startPoint: THREE.Vector3;
  private readonly goalPoint: THREE.Vector3;
  private readonly startCell;
  private readonly goalCell;
  private readonly startKey: string;
  private readonly goalKey: string;
  private readonly nodes = new Map<string, PathNode>();
  private readonly open = new MinHeap<OpenEntry>((a, b) => a.f - b.f || a.g - b.g);
  private readonly closed = new Set<string>();
  private readonly directLinecast: LinecastJob;
  private stage: SearchStage = "direct";
  private current: CurrentExpansion | null = null;
  private pendingNeighbor: PendingNeighbor | null = null;
  private rawPoints: THREE.Vector3[] = [];
  private smoothedPoints: THREE.Vector3[] = [];
  private smoothAnchorIndex = 0;
  private smoothNextIndex = 0;
  private smoothLinecast: LinecastJob | null = null;
  private result: PathResult | null = null;
  private iterations = 0;
  private accumulatedMs = 0;
  private lineCellsChecked = 0;
  private completionReason: PathSearchCompletionReason = "running";

  constructor(
    private readonly gridWorld: GridWorld,
    start: THREE.Vector3,
    goal: THREE.Vector3,
    options: FindPathOptions,
  ) {
    this.radius = options.radius;
    this.maxIterations = options.maxIterations ?? PATHFINDING_MAX_ITERATIONS;
    this.startPoint = new THREE.Vector3(start.x, 0, start.z);
    this.goalPoint = new THREE.Vector3(goal.x, 0, goal.z);
    this.startCell = gridWorld.worldToCell(this.startPoint.x, this.startPoint.z);
    this.goalCell = gridWorld.worldToCell(this.goalPoint.x, this.goalPoint.z);
    this.startKey = gridWorld.cellKey(this.startCell.q, this.startCell.r);
    this.goalKey = gridWorld.cellKey(this.goalCell.q, this.goalCell.r);
    this.directLinecast = new LinecastJob(gridWorld, this.startPoint, this.goalPoint, this.radius);

    if (
      !canOccupyWorld(gridWorld, this.startPoint.x, this.startPoint.z, this.radius) ||
      !canOccupyWorld(gridWorld, this.goalPoint.x, this.goalPoint.z, this.radius)
    ) {
      this.stage = "failed";
      this.completionReason = "invalid-endpoint";
    }
  }

  step(deadline: number, maxNodes = NAVIGATION_PATH_MAX_NODES_PER_SLICE) {
    if (this.isComplete()) {
      return;
    }

    const startedAt = performance.now();
    let expanded = 0;
    while (!this.isComplete() && performance.now() < deadline) {
      if (this.stage === "direct") {
        this.directLinecast.step(deadline);
        if (!this.directLinecast.isComplete()) {
          break;
        }
        this.lineCellsChecked += this.directLinecast.diagnostics().checkedLineCells;
        if (this.directLinecast.isClear()) {
          this.result = pathResult([this.startPoint, this.goalPoint], 0);
          this.stage = "complete";
          this.completionReason = "direct";
          break;
        }
        this.initializeSearch();
        continue;
      }

      if (this.stage === "search") {
        if (expanded >= maxNodes) {
          break;
        }
        if (!this.stepSearch(deadline)) {
          break;
        }
        expanded += 1;
        continue;
      }

      if (this.stage === "smooth") {
        if (!this.stepSmoothing(deadline)) {
          break;
        }
      }
    }
    this.accumulatedMs += performance.now() - startedAt;
  }

  isComplete() {
    return this.stage === "complete" || this.stage === "failed";
  }

  getResult() {
    return this.result;
  }

  diagnostics() {
    return {
      stage: this.stage,
      iterations: this.iterations,
      accumulatedMs: this.accumulatedMs,
      lineCellsChecked: this.lineCellsChecked,
      openNodes: this.open.size(),
      visitedNodes: this.nodes.size,
      completionReason: this.completionReason,
    };
  }

  private initializeSearch() {
    const startNode: PathNode = {
      q: this.startCell.q,
      r: this.startCell.r,
      key: this.startKey,
      g: 0,
      f: heuristic(this.gridWorld, this.startCell.q, this.startCell.r, this.goalPoint),
      parentKey: null,
    };
    this.nodes.set(this.startKey, startNode);
    this.open.push({ key: startNode.key, g: startNode.g, f: startNode.f });
    this.stage = "search";
  }

  private stepSearch(deadline: number) {
    if (this.pendingNeighbor) {
      const pending = this.pendingNeighbor;
      pending.linecast.step(deadline);
      if (!pending.linecast.isComplete()) {
        return false;
      }
      this.lineCellsChecked += pending.linecast.diagnostics().checkedLineCells;
      this.relaxNeighbor(pending, pending.linecast.isClear() ? pending.parent : pending.current);
      this.pendingNeighbor = null;
      return true;
    }

    if (!this.current) {
      if (this.iterations >= this.maxIterations) {
        this.stage = "failed";
        this.completionReason = "iteration-limit";
        return true;
      }
      const node = this.popOpenNode();
      if (!node) {
        this.stage = "failed";
        this.completionReason = "open-exhausted";
        return true;
      }
      if (node.key === this.goalKey) {
        this.beginSmoothing(reconstructPath(this.gridWorld, this.nodes, node.key, this.startPoint, this.goalPoint));
        return true;
      }
      this.closed.add(node.key);
      this.iterations += 1;
      this.current = { node, neighbors: this.gridWorld.getNeighbors(node.q, node.r), neighborIndex: 0 };
    }

    const expansion = this.current;
    if (expansion.neighborIndex >= expansion.neighbors.length) {
      this.current = null;
      return true;
    }

    const neighbor = expansion.neighbors[expansion.neighborIndex];
    expansion.neighborIndex += 1;
    if (!isCellInBounds(this.gridWorld, neighbor.q, neighbor.r)) {
      return true;
    }

    const neighborPoint = getCellCenter(this.gridWorld, neighbor.q, neighbor.r);
    if (!canOccupyWorld(this.gridWorld, neighborPoint.x, neighborPoint.z, this.radius)) {
      return true;
    }

    const neighborKey = this.gridWorld.cellKey(neighbor.q, neighbor.r);
    if (this.closed.has(neighborKey)) {
      return true;
    }

    const currentPoint = nodePoint(this.gridWorld, expansion.node, this.startKey, this.startPoint);
    if (!hasLineOfSight(this.gridWorld, currentPoint, neighborPoint, this.radius)) {
      return true;
    }

    const parent = expansion.node.parentKey ? this.nodes.get(expansion.node.parentKey) : null;
    if (!parent) {
      this.relaxNeighbor(
        {
          current: expansion.node,
          currentPoint,
          neighbor,
          neighborPoint,
          neighborKey,
          parent: expansion.node,
          parentPoint: currentPoint,
          linecast: new LinecastJob(this.gridWorld, currentPoint, neighborPoint, this.radius),
        },
        expansion.node,
      );
      return true;
    }

    const parentPoint = nodePoint(this.gridWorld, parent, this.startKey, this.startPoint);
    this.pendingNeighbor = {
      current: expansion.node,
      currentPoint,
      neighbor,
      neighborPoint,
      neighborKey,
      parent,
      parentPoint,
      linecast: new LinecastJob(this.gridWorld, parentPoint, neighborPoint, this.radius),
    };
    return true;
  }

  private relaxNeighbor(pending: PendingNeighbor, pathParent: PathNode) {
    const pathParentPoint = pathParent === pending.parent ? pending.parentPoint : pending.currentPoint;
    const tentativeG = pathParent.g + distance2D(pathParentPoint.x, pathParentPoint.z, pending.neighborPoint.x, pending.neighborPoint.z);
    const existing = this.nodes.get(pending.neighborKey);
    if (existing && tentativeG >= existing.g) {
      return;
    }

    const node: PathNode = {
      q: pending.neighbor.q,
      r: pending.neighbor.r,
      key: pending.neighborKey,
      g: tentativeG,
      f: tentativeG + heuristic(this.gridWorld, pending.neighbor.q, pending.neighbor.r, this.goalPoint),
      parentKey: pathParent.key,
    };
    this.nodes.set(node.key, node);
    this.open.push({ key: node.key, g: node.g, f: node.f });
  }

  private popOpenNode() {
    while (this.open.size() > 0) {
      const entry = this.open.pop();
      if (!entry || this.closed.has(entry.key)) {
        continue;
      }
      const node = this.nodes.get(entry.key);
      if (!node || node.g !== entry.g || node.f !== entry.f) {
        continue;
      }
      return node;
    }
    return null;
  }

  private beginSmoothing(points: THREE.Vector3[]) {
    this.rawPoints = points;
    if (points.length <= 2) {
      this.result = pathResult(points, this.iterations);
      this.stage = "complete";
      this.completionReason = "path";
      return;
    }
    this.smoothedPoints = [points[0]];
    this.smoothAnchorIndex = 0;
    this.smoothNextIndex = points.length - 1;
    this.stage = "smooth";
  }

  private stepSmoothing(deadline: number) {
    if (this.smoothAnchorIndex >= this.rawPoints.length - 1) {
      this.result = pathResult(this.smoothedPoints, this.iterations);
      this.stage = "complete";
      this.completionReason = "path";
      return true;
    }

    if (!this.smoothLinecast) {
      this.smoothLinecast = new LinecastJob(
        this.gridWorld,
        this.rawPoints[this.smoothAnchorIndex],
        this.rawPoints[this.smoothNextIndex],
        this.radius,
      );
    }
    this.smoothLinecast.step(deadline);
    if (!this.smoothLinecast.isComplete()) {
      return false;
    }
    this.lineCellsChecked += this.smoothLinecast.diagnostics().checkedLineCells;

    if (this.smoothLinecast.isClear()) {
      this.smoothedPoints.push(this.rawPoints[this.smoothNextIndex]);
      this.smoothAnchorIndex = this.smoothNextIndex;
      this.smoothNextIndex = this.rawPoints.length - 1;
    } else {
      this.smoothNextIndex -= 1;
      if (this.smoothNextIndex <= this.smoothAnchorIndex) {
        this.stage = "failed";
        this.completionReason = "smoothing-failed";
      }
    }
    this.smoothLinecast = null;
    return true;
  }
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
    points.push(node.parentKey ? getCellCenter(gridWorld, node.q, node.r) : startPoint.clone());
    key = node.parentKey;
  }
  return points.reverse();
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
  return node.key === startKey ? startPoint : getCellCenter(gridWorld, node.q, node.r);
}

function heuristic(gridWorld: GridWorld, q: number, r: number, goal: THREE.Vector3) {
  const point = getCellCenter(gridWorld, q, r);
  return distance2D(point.x, point.z, goal.x, goal.z);
}
