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
  innerRadiusCells: number;
  outerRadiusCells: number;
  intensity: number;
  blocksByLos: boolean;
};

export class VisibilitySystem {
  readonly innerRadiusCells = Math.max(1, Math.floor(PLAYER_LIGHT_INNER_RADIUS / TILE_SIZE));
  readonly outerRadiusCells = Math.max(this.innerRadiusCells + 1, Math.ceil(PLAYER_LIGHT_OUTER_RADIUS / TILE_SIZE));

  private readonly visible: Uint8Array;
  private readonly discovered: Uint8Array;
  private readonly light: Float32Array;
  private readonly lightReach: Float32Array;
  private readonly memoryLight: Float32Array;
  private readonly lastSeenAt: Float32Array;
  private visibleCount = 0;
  private lightReachCount = 0;
  private occludedMemoryCount = 0;
  private discoveredUnlitCount = 0;
  private discoveredCount = 0;
  private version = 0;
  private lastComputeMs = 0;
  private lastSourceCellKey = "";
  private lastSourceCell = { q: 0, r: 0 };

  constructor(private readonly gridWorld: GridWorld) {
    const cellCount = this.gridWorld.worldCells * this.gridWorld.worldCells;
    this.visible = new Uint8Array(cellCount);
    this.discovered = new Uint8Array(cellCount);
    this.light = new Float32Array(cellCount);
    this.lightReach = new Float32Array(cellCount);
    this.memoryLight = new Float32Array(cellCount);
    this.lastSeenAt = new Float32Array(cellCount);
  }

  update(playerPosition: { x: number; z: number }, nowSeconds = performance.now() / 1000) {
    const sourceCell = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const sourceCellKey = this.gridWorld.cellKey(sourceCell.q, sourceCell.r);
    if (sourceCellKey === this.lastSourceCellKey) {
      return false;
    }

    const startedAt = performance.now();
    this.lastSourceCellKey = sourceCellKey;
    this.lastSourceCell = sourceCell;
    this.visible.fill(0);
    this.light.fill(0);
    this.lightReach.fill(0);
    this.visibleCount = 0;
    this.lightReachCount = 0;
    this.occludedMemoryCount = 0;
    this.discoveredUnlitCount = 0;

    const source = {
      q: sourceCell.q,
      r: sourceCell.r,
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
    this.visible.fill(0);
    this.discovered.fill(0);
    this.light.fill(0);
    this.lightReach.fill(0);
    this.memoryLight.fill(0);
    this.lastSeenAt.fill(0);
    this.visibleCount = 0;
    this.lightReachCount = 0;
    this.occludedMemoryCount = 0;
    this.discoveredUnlitCount = 0;
    this.discoveredCount = 0;
    this.lastComputeMs = 0;
    this.lastSourceCellKey = "";
    this.lastSourceCell = { q: 0, r: 0 };
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
    const index = this.indexIfInBounds(q, r);
    return index !== -1 && this.discovered[index] === 1;
  }

  isVisibleCell(q: number, r: number) {
    const index = this.indexIfInBounds(q, r);
    return index !== -1 && this.visible[index] === 1;
  }

  getLightCell(q: number, r: number) {
    const index = this.indexIfInBounds(q, r);
    return index === -1 ? 0 : this.light[index];
  }

  getLightReachCell(q: number, r: number) {
    const index = this.indexIfInBounds(q, r);
    return index === -1 ? 0 : this.lightReach[index];
  }

  getMemoryLightCell(q: number, r: number) {
    const index = this.indexIfInBounds(q, r);
    return index === -1 ? 0 : this.memoryLight[index];
  }

  getCell(q: number, r: number): VisibilityCell {
    const index = this.indexIfInBounds(q, r);
    if (index === -1) {
      return { discovered: false, visible: false, light: 0, lightReach: 0, memoryLight: 0, lastSeenAt: 0 };
    }

    return {
      discovered: this.discovered[index] === 1,
      visible: this.visible[index] === 1,
      light: this.light[index],
      lightReach: this.lightReach[index],
      memoryLight: this.memoryLight[index],
      lastSeenAt: this.lastSeenAt[index],
    };
  }

  getDiagnostics() {
    return {
      version: this.version,
      playerCell: { ...this.lastSourceCell },
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
    this.gridWorld.forEachCellInRange(source, source.outerRadiusCells, (q, r) => {
      const distanceWorld = this.distanceFromSource(source, q, r);
      const lightReach = this.lightAtDistance(distanceWorld, source);
      if (lightReach <= VISIBILITY_LIGHT_EPSILON) {
        return;
      }

      const index = this.indexIfInBounds(q, r);
      if (index === -1) {
        return;
      }

      if (this.lightReach[index] <= VISIBILITY_LIGHT_EPSILON) {
        this.lightReachCount += 1;
      }
      this.lightReach[index] = Math.max(this.lightReach[index], lightReach);
    });
  }

  private applyLightSource(source: VisibilityLightSource, nowSeconds: number) {
    const sourceWorld = this.gridWorld.cellToWorld(source.q, source.r);
    this.gridWorld.forEachCellInRange(source, source.outerRadiusCells, (q, r) => {
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
    const index = this.indexIfInBounds(q, r);
    if (index === -1) {
      return;
    }

    const light = this.lightAtDistance(this.distanceFromSource(source, q, r), source);
    if (light <= VISIBILITY_LIGHT_EPSILON) {
      return;
    }

    if (this.visible[index] === 0) {
      this.visible[index] = 1;
      this.visibleCount += 1;
    }

    if (this.discovered[index] === 0) {
      this.discovered[index] = 1;
      this.discoveredCount += 1;
    }

    this.light[index] = Math.max(this.light[index], light);
    this.memoryLight[index] = Math.max(this.memoryLight[index], DISCOVERED_MEMORY_LIGHT);
    this.lastSeenAt[index] = nowSeconds;
  }

  private updateMemoryCounts() {
    for (let i = 0; i < this.discovered.length; i += 1) {
      if (this.discovered[i] === 0) {
        continue;
      }

      if (this.lightReach[i] <= VISIBILITY_LIGHT_EPSILON) {
        this.discoveredUnlitCount += 1;
      } else if (this.visible[i] === 0) {
        this.occludedMemoryCount += 1;
      }
    }
  }

  private lightAtDistance(distanceWorld: number, source: VisibilityLightSource) {
    const inner = source.innerRadiusCells * TILE_SIZE;
    const outer = source.outerRadiusCells * TILE_SIZE;
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
    const sourceWorld = this.gridWorld.cellToWorld(source.q, source.r);
    const cellWorld = this.gridWorld.cellToWorld(q, r);
    return distance2D(sourceWorld.x, sourceWorld.z, cellWorld.x, cellWorld.z);
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

  private indexIfInBounds(q: number, r: number) {
    return this.gridWorld.indexIfInBounds(q, r);
  }
}
