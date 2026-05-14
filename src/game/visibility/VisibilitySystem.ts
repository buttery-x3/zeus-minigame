import {
  DISCOVERED_MEMORY_LIGHT,
  PLAYER_LIGHT_INNER_RADIUS,
  PLAYER_LIGHT_OUTER_RADIUS,
  TILE_SIZE,
  VISIBILITY_LIGHT_EPSILON,
} from "../../config";
import { clamp, distance2D } from "../../lib/math";
import type { GridWorld } from "../../world/GridWorld";

export type VisibilityCell = {
  discovered: boolean;
  visible: boolean;
  light: number;
  memoryLight: number;
  lastSeenAt: number;
};

export type VisibilityLightSource = {
  cellX: number;
  cellZ: number;
  innerRadiusCells: number;
  outerRadiusCells: number;
  intensity: number;
  blocksByLos: boolean;
};

type Octant = {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
};

const OCTANTS: Octant[] = [
  { xx: 1, xy: 0, yx: 0, yy: 1 },
  { xx: 0, xy: 1, yx: 1, yy: 0 },
  { xx: 0, xy: -1, yx: 1, yy: 0 },
  { xx: -1, xy: 0, yx: 0, yy: 1 },
  { xx: -1, xy: 0, yx: 0, yy: -1 },
  { xx: 0, xy: -1, yx: -1, yy: 0 },
  { xx: 0, xy: 1, yx: -1, yy: 0 },
  { xx: 1, xy: 0, yx: 0, yy: -1 },
];

export class VisibilitySystem {
  readonly innerRadiusCells = Math.max(1, Math.floor(PLAYER_LIGHT_INNER_RADIUS / TILE_SIZE));
  readonly outerRadiusCells = Math.max(this.innerRadiusCells + 1, Math.ceil(PLAYER_LIGHT_OUTER_RADIUS / TILE_SIZE));

  private readonly visible: Uint8Array;
  private readonly discovered: Uint8Array;
  private readonly light: Float32Array;
  private readonly memoryLight: Float32Array;
  private readonly lastSeenAt: Float32Array;
  private visibleCount = 0;
  private discoveredCount = 0;
  private version = 0;
  private lastComputeMs = 0;
  private lastSourceCellKey = "";
  private lastSourceCell = { x: 0, z: 0 };

  constructor(private readonly gridWorld: GridWorld) {
    const cellCount = this.gridWorld.worldCells * this.gridWorld.worldCells;
    this.visible = new Uint8Array(cellCount);
    this.discovered = new Uint8Array(cellCount);
    this.light = new Float32Array(cellCount);
    this.memoryLight = new Float32Array(cellCount);
    this.lastSeenAt = new Float32Array(cellCount);
  }

  update(playerPosition: { x: number; z: number }, nowSeconds = performance.now() / 1000) {
    const sourceCell = this.gridWorld.worldToCell(playerPosition.x, playerPosition.z);
    const sourceCellKey = `${sourceCell.x},${sourceCell.z}`;
    if (sourceCellKey === this.lastSourceCellKey) {
      return false;
    }

    const startedAt = performance.now();
    this.lastSourceCellKey = sourceCellKey;
    this.lastSourceCell = sourceCell;
    this.visible.fill(0);
    this.light.fill(0);
    this.visibleCount = 0;

    this.applyLightSource(
      {
        cellX: sourceCell.x,
        cellZ: sourceCell.z,
        innerRadiusCells: this.innerRadiusCells,
        outerRadiusCells: this.outerRadiusCells,
        intensity: 1,
        blocksByLos: true,
      },
      nowSeconds,
    );

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
    this.memoryLight.fill(0);
    this.lastSeenAt.fill(0);
    this.visibleCount = 0;
    this.discoveredCount = 0;
    this.lastComputeMs = 0;
    this.lastSourceCellKey = "";
    this.lastSourceCell = { x: 0, z: 0 };
    this.version += 1;
  }

  isDiscoveredWorld(worldX: number, worldZ: number) {
    const cell = this.gridWorld.worldToCell(worldX, worldZ);
    return this.isDiscoveredCell(cell.x, cell.z);
  }

  isVisibleWorld(worldX: number, worldZ: number) {
    const cell = this.gridWorld.worldToCell(worldX, worldZ);
    return this.isVisibleCell(cell.x, cell.z);
  }

  getLightWorld(worldX: number, worldZ: number) {
    const cell = this.gridWorld.worldToCell(worldX, worldZ);
    return this.getLightCell(cell.x, cell.z);
  }

  isDiscoveredCell(cellX: number, cellZ: number) {
    const index = this.indexIfInBounds(cellX, cellZ);
    return index !== -1 && this.discovered[index] === 1;
  }

  isVisibleCell(cellX: number, cellZ: number) {
    const index = this.indexIfInBounds(cellX, cellZ);
    return index !== -1 && this.visible[index] === 1;
  }

  getLightCell(cellX: number, cellZ: number) {
    const index = this.indexIfInBounds(cellX, cellZ);
    return index === -1 ? 0 : this.light[index];
  }

  getMemoryLightCell(cellX: number, cellZ: number) {
    const index = this.indexIfInBounds(cellX, cellZ);
    return index === -1 ? 0 : this.memoryLight[index];
  }

  getCell(cellX: number, cellZ: number): VisibilityCell {
    const index = this.indexIfInBounds(cellX, cellZ);
    if (index === -1) {
      return { discovered: false, visible: false, light: 0, memoryLight: 0, lastSeenAt: 0 };
    }

    return {
      discovered: this.discovered[index] === 1,
      visible: this.visible[index] === 1,
      light: this.light[index],
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
      discoveredCells: this.discoveredCount,
      lastComputeMs: this.lastComputeMs,
      shadowSample: this.findShadowSample(),
    };
  }

  private applyLightSource(source: VisibilityLightSource, nowSeconds: number) {
    this.revealCell(source, source.cellX, source.cellZ, nowSeconds);

    for (const octant of OCTANTS) {
      this.castLight(source, 1, 1, 0, octant, nowSeconds);
    }
  }

  private castLight(
    source: VisibilityLightSource,
    row: number,
    startSlope: number,
    endSlope: number,
    octant: Octant,
    nowSeconds: number,
  ) {
    if (startSlope < endSlope) {
      return;
    }

    let nextStartSlope = startSlope;
    for (let distance = row; distance <= source.outerRadiusCells; distance += 1) {
      let blocked = false;
      let deltaX = -distance - 1;
      const deltaZ = -distance;

      while (deltaX <= 0) {
        deltaX += 1;

        const cellX = source.cellX + deltaX * octant.xx + deltaZ * octant.xy;
        const cellZ = source.cellZ + deltaX * octant.yx + deltaZ * octant.yy;
        const leftSlope = (deltaX - 0.5) / (deltaZ + 0.5);
        const rightSlope = (deltaX + 0.5) / (deltaZ - 0.5);

        if (startSlope < rightSlope) {
          continue;
        }
        if (endSlope > leftSlope) {
          break;
        }

        if (this.distanceWithinLight(source, cellX, cellZ)) {
          this.revealCell(source, cellX, cellZ, nowSeconds);
        }

        const cellBlocks = source.blocksByLos && this.isOpaqueCell(cellX, cellZ);
        if (blocked) {
          if (cellBlocks) {
            nextStartSlope = rightSlope;
            continue;
          }

          blocked = false;
          startSlope = nextStartSlope;
        } else if (cellBlocks && distance < source.outerRadiusCells) {
          blocked = true;
          this.castLight(source, distance + 1, startSlope, leftSlope, octant, nowSeconds);
          nextStartSlope = rightSlope;
        }
      }

      if (blocked) {
        break;
      }
    }
  }

  private revealCell(source: VisibilityLightSource, cellX: number, cellZ: number, nowSeconds: number) {
    const index = this.indexIfInBounds(cellX, cellZ);
    if (index === -1) {
      return;
    }

    const distanceWorld = distance2D(source.cellX, source.cellZ, cellX, cellZ) * TILE_SIZE;
    if (distanceWorld > PLAYER_LIGHT_OUTER_RADIUS) {
      return;
    }

    const light = this.lightAtDistance(distanceWorld, source);
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

  private distanceWithinLight(source: VisibilityLightSource, cellX: number, cellZ: number) {
    const dx = cellX - source.cellX;
    const dz = cellZ - source.cellZ;
    return dx * dx + dz * dz <= source.outerRadiusCells * source.outerRadiusCells;
  }

  private isOpaqueCell(cellX: number, cellZ: number) {
    return this.indexIfInBounds(cellX, cellZ) === -1 || this.gridWorld.getCell(cellX, cellZ).blocked;
  }

  private findShadowSample() {
    const center = this.lastSourceCell;
    for (let radius = 1; radius <= this.outerRadiusCells; radius += 1) {
      for (let z = center.z - radius; z <= center.z + radius; z += 1) {
        for (let x = center.x - radius; x <= center.x + radius; x += 1) {
          if (x !== center.x - radius && x !== center.x + radius && z !== center.z - radius && z !== center.z + radius) {
            continue;
          }
          if (!this.isVisibleCell(x, z) || !this.gridWorld.getCell(x, z).blocked) {
            continue;
          }

          const stepX = Math.sign(x - center.x);
          const stepZ = Math.sign(z - center.z);
          if (stepX === 0 && stepZ === 0) {
            continue;
          }

          for (let step = 1; step <= 4; step += 1) {
            const shadowX = x + stepX * step;
            const shadowZ = z + stepZ * step;
            if (!this.isInBounds(shadowX, shadowZ)) {
              break;
            }
            if (distance2D(center.x, center.z, shadowX, shadowZ) > this.outerRadiusCells) {
              break;
            }
            if (this.gridWorld.getCell(shadowX, shadowZ).blocked) {
              continue;
            }
            if (!this.isVisibleCell(shadowX, shadowZ)) {
              return {
                blocker: { x, z },
                shadow: { x: shadowX, z: shadowZ },
              };
            }
          }
        }
      }
    }

    return null;
  }

  private indexIfInBounds(cellX: number, cellZ: number) {
    if (!this.isInBounds(cellX, cellZ)) {
      return -1;
    }
    return cellZ * this.gridWorld.worldCells + cellX;
  }

  private isInBounds(cellX: number, cellZ: number) {
    return cellX >= 0 && cellZ >= 0 && cellX < this.gridWorld.worldCells && cellZ < this.gridWorld.worldCells;
  }
}
