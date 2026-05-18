import {
  DISCOVERED_MEMORY_LIGHT,
  PLAYER_LIGHT_INNER_RADIUS,
  PLAYER_LIGHT_OUTER_RADIUS,
  TILE_SIZE,
  VISIBILITY_LIGHT_EPSILON,
} from "../../config";
import { clamp, distance2D } from "../../lib/math";
import { hasOpaqueLineOfSight } from "../collision/linecast";
import type { GridWorld } from "../../world/GridWorld";
import { hexCellKey } from "../../world/hexCoordinates";

export type VisibilityCell = {
  discovered: boolean;
  visible: boolean;
  light: number;
  lightReach: number;
  memoryLight: number;
  lastSeenAt: number;
};

export type VisibilityLightSource = {
  q: number;
  r: number;
  x: number;
  z: number;
  innerRadiusCells: number;
  outerRadiusCells: number;
  intensity: number;
  blocksByLos: boolean;
};

export class VisibilitySystem {
  readonly innerRadiusCells = Math.max(1, Math.floor(PLAYER_LIGHT_INNER_RADIUS / TILE_SIZE));
  readonly outerRadiusCells = Math.max(this.innerRadiusCells + 1, Math.ceil(PLAYER_LIGHT_OUTER_RADIUS / TILE_SIZE));
  private readonly updateDistanceEpsilon = TILE_SIZE / 8;

  private readonly visible = new Set<string>();
  private readonly discovered = new Set<string>();
  private readonly light = new Map<string, number>();
  private readonly lightReach = new Map<string, number>();
  private readonly memoryLight = new Map<string, number>();
  private readonly lastSeenAt = new Map<string, number>();
  private visibleCount = 0;
  private lightReachCount = 0;
  private occludedMemoryCount = 0;
  private discoveredUnlitCount = 0;
  private discoveredCount = 0;
  private version = 0;
  private lastComputeMs = 0;
  private lastSourceCellKey = "";
  private lastSourceCell = { q: 0, r: 0 };
  private lastSourceWorld = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };

  constructor(private readonly gridWorld: GridWorld) {}

  update(playerPosition: { x: number; z: number }, nowSeconds = performance.now() / 1000) {
    const sourceCell = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const sourceCellKey = this.gridWorld.cellKey(sourceCell.q, sourceCell.r);
    if (
      sourceCellKey === this.lastSourceCellKey &&
      distance2D(playerPosition.x, playerPosition.z, this.lastSourceWorld.x, this.lastSourceWorld.z) < this.updateDistanceEpsilon
    ) {
      return false;
    }

    const startedAt = performance.now();
    this.lastSourceCellKey = sourceCellKey;
    this.lastSourceCell = sourceCell;
    this.lastSourceWorld = { x: playerPosition.x, z: playerPosition.z };
    this.visible.clear();
    this.light.clear();
    this.lightReach.clear();
    this.visibleCount = 0;
    this.lightReachCount = 0;
    this.occludedMemoryCount = 0;
    this.discoveredUnlitCount = 0;

    const source = {
      q: sourceCell.q,
      r: sourceCell.r,
      x: playerPosition.x,
      z: playerPosition.z,
      innerRadiusCells: this.innerRadiusCells,
      outerRadiusCells: this.outerRadiusCells,
      intensity: 1,
      blocksByLos: true,
    };
    this.applyLightReach(source);
    this.applyLightSource(source, nowSeconds);
    this.updateMemoryCounts();

    this.version += 1;
    this.lastComputeMs = performance.now() - startedAt;
    return true;
  }

  getVersion() {
    return this.version;
  }

  reset() {
    this.visible.clear();
    this.discovered.clear();
    this.light.clear();
    this.lightReach.clear();
    this.memoryLight.clear();
    this.lastSeenAt.clear();
    this.visibleCount = 0;
    this.lightReachCount = 0;
    this.occludedMemoryCount = 0;
    this.discoveredUnlitCount = 0;
    this.discoveredCount = 0;
    this.lastComputeMs = 0;
    this.lastSourceCellKey = "";
    this.lastSourceCell = { q: 0, r: 0 };
    this.lastSourceWorld = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
    this.version += 1;
  }

  isDiscoveredWorld(worldX: number, worldZ: number) {
    const cell = this.gridWorld.worldToCell(worldX, worldZ);
    return this.isDiscoveredCell(cell.q, cell.r);
  }

  isVisibleWorld(worldX: number, worldZ: number) {
    const cell = this.gridWorld.worldToCell(worldX, worldZ);
    return this.isVisibleCell(cell.q, cell.r);
  }

  getLightWorld(worldX: number, worldZ: number) {
    const cell = this.gridWorld.worldToCell(worldX, worldZ);
    return this.getLightCell(cell.q, cell.r);
  }

  getLightReachWorld(worldX: number, worldZ: number) {
    const cell = this.gridWorld.worldToCell(worldX, worldZ);
    return this.getLightReachCell(cell.q, cell.r);
  }

  isDiscoveredCell(q: number, r: number) {
    return this.discovered.has(hexCellKey(q, r));
  }

  isVisibleCell(q: number, r: number) {
    return this.visible.has(hexCellKey(q, r));
  }

  getLightCell(q: number, r: number) {
    return this.light.get(hexCellKey(q, r)) ?? 0;
  }

  getLightReachCell(q: number, r: number) {
    return this.lightReach.get(hexCellKey(q, r)) ?? 0;
  }

  getMemoryLightCell(q: number, r: number) {
    return this.memoryLight.get(hexCellKey(q, r)) ?? 0;
  }

  getCell(q: number, r: number): VisibilityCell {
    const key = hexCellKey(q, r);
    return {
      discovered: this.discovered.has(key),
      visible: this.visible.has(key),
      light: this.light.get(key) ?? 0,
      lightReach: this.lightReach.get(key) ?? 0,
      memoryLight: this.memoryLight.get(key) ?? 0,
      lastSeenAt: this.lastSeenAt.get(key) ?? 0,
    };
  }

  getDiagnostics() {
    return {
      version: this.version,
      playerCell: { ...this.lastSourceCell },
      playerWorld: { ...this.lastSourceWorld },
      innerRadiusCells: this.innerRadiusCells,
      outerRadiusCells: this.outerRadiusCells,
      visibleCells: this.visibleCount,
      lightReachCells: this.lightReachCount,
      discoveredCells: this.discoveredCount,
      occludedMemoryCells: this.occludedMemoryCount,
      discoveredUnlitCells: this.discoveredUnlitCount,
      lastComputeMs: this.lastComputeMs,
      shadowSample: this.findShadowSample(),
    };
  }

  private applyLightReach(source: VisibilityLightSource) {
    this.gridWorld.forEachCellInRange(source, source.outerRadiusCells + 1, (q, r) => {
      const distanceWorld = this.distanceFromSource(source, q, r);
      const lightReach = this.lightAtDistance(distanceWorld, source);
      if (lightReach <= VISIBILITY_LIGHT_EPSILON) {
        return;
      }

      const key = hexCellKey(q, r);
      const previous = this.lightReach.get(key) ?? 0;
      if (previous <= VISIBILITY_LIGHT_EPSILON) {
        this.lightReachCount += 1;
      }
      this.lightReach.set(key, Math.max(previous, lightReach));
    });
  }

  private applyLightSource(source: VisibilityLightSource, nowSeconds: number) {
    const sourceWorld = { x: source.x, z: source.z };
    this.gridWorld.forEachCellInRange(source, source.outerRadiusCells + 1, (q, r) => {
      if (!this.distanceWithinLight(source, q, r)) {
        return;
      }

      const targetWorld = this.gridWorld.cellToWorld(q, r);
      if (
        source.blocksByLos &&
        (q !== source.q || r !== source.r) &&
        !hasOpaqueLineOfSight(this.gridWorld, sourceWorld, targetWorld)
      ) {
        return;
      }

      this.revealCell(source, q, r, nowSeconds);
    });
  }

  private revealCell(source: VisibilityLightSource, q: number, r: number, nowSeconds: number) {
    const key = hexCellKey(q, r);
    const light = this.lightAtDistance(this.distanceFromSource(source, q, r), source);
    if (light <= VISIBILITY_LIGHT_EPSILON) {
      return;
    }

    if (!this.visible.has(key)) {
      this.visible.add(key);
      this.visibleCount += 1;
    }

    if (!this.discovered.has(key)) {
      this.discovered.add(key);
      this.discoveredCount = this.discovered.size;
    }

    this.light.set(key, Math.max(this.light.get(key) ?? 0, light));
    this.memoryLight.set(key, Math.max(this.memoryLight.get(key) ?? 0, DISCOVERED_MEMORY_LIGHT));
    this.lastSeenAt.set(key, nowSeconds);
  }

  private updateMemoryCounts() {
    for (const key of this.discovered) {
      if ((this.lightReach.get(key) ?? 0) <= VISIBILITY_LIGHT_EPSILON) {
        this.discoveredUnlitCount += 1;
      } else if (!this.visible.has(key)) {
        this.occludedMemoryCount += 1;
      }
    }
  }

  private lightAtDistance(distanceWorld: number, source: VisibilityLightSource) {
    const inner = PLAYER_LIGHT_INNER_RADIUS;
    const outer = PLAYER_LIGHT_OUTER_RADIUS;
    if (distanceWorld <= inner) {
      return source.intensity;
    }

    const fade = clamp((distanceWorld - inner) / Math.max(TILE_SIZE, outer - inner), 0, 1);
    const smooth = fade * fade * (3 - 2 * fade);
    return source.intensity * (1 - smooth);
  }

  private distanceWithinLight(source: VisibilityLightSource, q: number, r: number) {
    return this.distanceFromSource(source, q, r) <= PLAYER_LIGHT_OUTER_RADIUS;
  }

  private distanceFromSource(source: VisibilityLightSource, q: number, r: number) {
    const cellWorld = this.gridWorld.cellToWorld(q, r);
    return distance2D(source.x, source.z, cellWorld.x, cellWorld.z);
  }

  private findShadowSample() {
    const center = this.lastSourceCell;
    for (let radius = 2; radius <= this.outerRadiusCells; radius += 1) {
      for (const cell of this.gridWorld.ring(center, radius)) {
        if (
          this.getLightReachCell(cell.q, cell.r) <= VISIBILITY_LIGHT_EPSILON ||
          this.isVisibleCell(cell.q, cell.r) ||
          this.gridWorld.getCell(cell.q, cell.r).opaque
        ) {
          continue;
        }

        return {
          blocker: { ...center },
          shadow: cell,
        };
      }
    }

    return null;
  }
}
