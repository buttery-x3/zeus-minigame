import * as THREE from "three";
import { ENEMY_FLOW_FIELD_RADIUS_CELLS, NAVIGATION_FLOW_MAX_NODES_PER_SLICE, TILE_SIZE } from "../../../config";
import { distance2D } from "../../../lib/math";
import { MinHeap } from "../../../lib/MinHeap";
import type { TerrainCell } from "../../../types";
import type { GridWorld, HexCoord } from "../../../world/GridWorld";
import { getCellCenter, isCellInBounds } from "../../collision/occupancy";

type FlowCell = {
  q: number;
  r: number;
  cost: number;
  nextQ: number;
  nextR: number;
};

type OpenCell = {
  q: number;
  r: number;
  cost: number;
};

type FlowBuild = {
  root: HexCoord;
  rootKey: string;
  cells: Map<string, FlowCell>;
  open: MinHeap<OpenCell>;
  accumulatedMs: number;
  settled: number;
  terrainLimited: boolean;
  generationVersion: number;
};

export class EnemyFlowField {
  private cells = new Map<string, FlowCell>();
  private edgeCells: FlowCell[] = [];
  private readonly walkableCache = new Map<string, boolean>();
  private activeRootKey = "";
  private activeRoot: HexCoord = { q: 0, r: 0 };
  private activeGenerationVersion = -1;
  private activeTerrainLimited = false;
  private requestedRootKey = "";
  private requestedRoot: HexCoord = { q: 0, r: 0 };
  private build: FlowBuild | null = null;
  private lastRebuildMs = 0;
  private lastSliceMs = 0;
  private completedBuilds = 0;
  private coalescedRequests = 0;

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly radius = ENEMY_FLOW_FIELD_RADIUS_CELLS,
  ) {}

  request(playerPosition: THREE.Vector3) {
    const playerCell = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const nextKey = this.gridWorld.cellKey(playerCell.q, playerCell.r);
    if (nextKey === this.requestedRootKey) {
      return;
    }

    if (this.build && nextKey !== this.build.rootKey) {
      this.coalescedRequests += 1;
    }
    this.requestedRoot = playerCell;
    this.requestedRootKey = nextKey;
  }

  hasWork() {
    if (this.build) {
      return true;
    }
    if (!this.requestedRootKey || this.requestedRootKey !== this.activeRootKey) {
      return Boolean(this.requestedRootKey);
    }
    return this.activeTerrainLimited && this.gridWorld.getTerrainGenerationVersion() !== this.activeGenerationVersion;
  }

  step(deadline: number, maxNodes = NAVIGATION_FLOW_MAX_NODES_PER_SLICE) {
    if (!this.build) {
      this.startBuild();
    }
    const build = this.build;
    if (!build) {
      this.lastSliceMs = 0;
      return false;
    }

    const startedAt = performance.now();
    let processed = 0;
    while (build.open.size() > 0 && processed < maxNodes && performance.now() < deadline) {
      const current = build.open.pop();
      if (!current) {
        break;
      }

      const currentCell = build.cells.get(this.gridWorld.cellKey(current.q, current.r));
      if (!currentCell || current.cost > currentCell.cost) {
        continue;
      }

      build.settled += 1;
      processed += 1;
      for (const neighbor of this.gridWorld.getNeighbors(current.q, current.r)) {
        if (!this.isInsideField(build.root, neighbor.q, neighbor.r)) {
          continue;
        }

        const walkable = this.isGeneratedCellWalkable(neighbor.q, neighbor.r);
        if (walkable === null) {
          build.terrainLimited = true;
          continue;
        }
        if (!walkable) {
          continue;
        }

        const terrain = this.gridWorld.readCommittedCell(neighbor.q, neighbor.r);
        if (!terrain) {
          build.terrainLimited = true;
          continue;
        }
        const nextCost = currentCell.cost + TILE_SIZE * traversalCostMultiplier(terrain);
        const key = this.gridWorld.cellKey(neighbor.q, neighbor.r);
        const existing = build.cells.get(key);
        if (existing && existing.cost <= nextCost) {
          continue;
        }

        build.cells.set(key, {
          q: neighbor.q,
          r: neighbor.r,
          cost: nextCost,
          nextQ: current.q,
          nextR: current.r,
        });
        build.open.push({ q: neighbor.q, r: neighbor.r, cost: nextCost });
      }
    }

    this.lastSliceMs = performance.now() - startedAt;
    build.accumulatedMs += this.lastSliceMs;
    if (build.open.size() > 0) {
      return false;
    }

    this.finishBuild(build);
    return true;
  }

  sample(position: THREE.Vector3) {
    const cell = this.gridWorld.worldToCell(position.x, position.z);
    const flowCell = this.cells.get(this.gridWorld.cellKey(cell.q, cell.r));
    if (!flowCell) {
      return null;
    }

    const target = getCellCenter(this.gridWorld, flowCell.nextQ, flowCell.nextR);
    const direction = new THREE.Vector3(target.x - position.x, 0, target.z - position.z);
    if (direction.lengthSq() < 0.000001) {
      return null;
    }

    direction.normalize();
    return { target, direction, cost: flowCell.cost };
  }

  getAcquisitionTarget(position: THREE.Vector3) {
    const candidates = this.edgeCells.length > 0 ? this.edgeCells : [...this.cells.values()];
    let closest: FlowCell | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const world = this.gridWorld.cellToWorld(candidate.q, candidate.r);
      const distance = distance2D(position.x, position.z, world.x, world.z);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }

    return closest ? getCellCenter(this.gridWorld, closest.q, closest.r) : null;
  }

  diagnostics() {
    return {
      rebuildMs: this.lastRebuildMs,
      sliceMs: this.lastSliceMs,
      visited: this.cells.size,
      radius: this.radius,
      playerCell: { ...this.activeRoot },
      requestedCell: { ...this.requestedRoot },
      buildingCell: this.build ? { ...this.build.root } : null,
      building: this.build !== null,
      buildVisited: this.build?.cells.size ?? 0,
      buildSettled: this.build?.settled ?? 0,
      terrainLimited: this.build?.terrainLimited ?? this.activeTerrainLimited,
      completedBuilds: this.completedBuilds,
      coalescedRequests: this.coalescedRequests,
      walkableCacheSize: this.walkableCache.size,
      rootLag: this.requestedRootKey ? this.gridWorld.hexDistance(this.activeRoot, this.requestedRoot) : 0,
    };
  }

  clear() {
    this.cells.clear();
    this.edgeCells = [];
    this.activeRootKey = "";
    this.requestedRootKey = "";
    this.build = null;
    this.lastRebuildMs = 0;
    this.lastSliceMs = 0;
    this.activeGenerationVersion = -1;
    this.activeTerrainLimited = false;
    this.completedBuilds = 0;
    this.coalescedRequests = 0;
  }

  invalidateWalkability() {
    this.walkableCache.clear();
  }

  private startBuild() {
    if (!this.requestedRootKey) {
      return;
    }

    const root = { ...this.requestedRoot };
    const rootKey = this.gridWorld.cellKey(root.q, root.r);
    const cells = new Map<string, FlowCell>();
    const open = new MinHeap<OpenCell>((a, b) => a.cost - b.cost);
    const walkable = this.isGeneratedCellWalkable(root.q, root.r);
    if (walkable) {
      cells.set(rootKey, { q: root.q, r: root.r, cost: 0, nextQ: root.q, nextR: root.r });
      open.push({ q: root.q, r: root.r, cost: 0 });
    }

    this.build = {
      root,
      rootKey,
      cells,
      open,
      accumulatedMs: 0,
      settled: 0,
      terrainLimited: walkable === null,
      generationVersion: this.gridWorld.getTerrainGenerationVersion(),
    };
  }

  private finishBuild(build: FlowBuild) {
    this.cells = build.cells;
    this.edgeCells = [...build.cells.values()].filter((cell) => this.isEdgeCell(build.root, cell.q, cell.r));
    this.activeRoot = build.root;
    this.activeRootKey = build.rootKey;
    this.activeGenerationVersion = build.generationVersion;
    this.activeTerrainLimited = build.terrainLimited;
    this.lastRebuildMs = build.accumulatedMs;
    this.completedBuilds += 1;
    this.build = null;
  }

  private isInsideField(root: HexCoord, q: number, r: number) {
    return isCellInBounds(this.gridWorld, q, r) && this.gridWorld.hexDistance(root, { q, r }) <= this.radius;
  }

  private isEdgeCell(root: HexCoord, q: number, r: number) {
    return this.gridWorld.hexDistance(root, { q, r }) >= this.radius - 1;
  }

  private isGeneratedCellWalkable(q: number, r: number) {
    const key = this.gridWorld.cellKey(q, r);
    const cached = this.walkableCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const cell = this.gridWorld.readCommittedCell(q, r);
    if (!cell) {
      return null;
    }
    const walkable = !cell.blocked;
    this.walkableCache.set(key, walkable);
    return walkable;
  }
}

function traversalCostMultiplier(_cell: TerrainCell) {
  // Kept explicit so banks, bridges, hills, and other weighted terrain can
  // change traversal cost without changing the Dijkstra flow-field algorithm.
  return 1;
}
