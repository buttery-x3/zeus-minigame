import * as THREE from "three";
import { TILE_SIZE, WORLD_CELLS, WORLD_HALF, WORLD_SIZE } from "../config";
import { clamp } from "../lib/math";
import type { TerrainCell, TerrainKind } from "../types";

export class GridWorld {
  readonly tileSize = TILE_SIZE;
  readonly worldCells = WORLD_CELLS;
  readonly worldSize = WORLD_SIZE;
  readonly half = WORLD_HALF;

  private cells = new Map<string, TerrainCell>();

  worldToCell(worldX: number, worldZ: number) {
    return {
      x: Math.floor(clamp(worldX + this.half, 0, this.worldSize - 0.001) / this.tileSize),
      z: Math.floor(clamp(worldZ + this.half, 0, this.worldSize - 0.001) / this.tileSize),
    };
  }

  cellToWorld(cellX: number, cellZ: number) {
    return {
      x: cellX * this.tileSize - this.half + this.tileSize / 2,
      z: cellZ * this.tileSize - this.half + this.tileSize / 2,
    };
  }

  getCell(cellX: number, cellZ: number): TerrainCell {
    const key = `${cellX},${cellZ}`;
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }

    const kind = this.resolveTerrainKind(cellX, cellZ);
    const cell: TerrainCell = {
      x: cellX,
      z: cellZ,
      kind,
      blocked: kind === "reserved_blocker",
    };
    this.cells.set(key, cell);
    return cell;
  }

  isBlockedWorld(worldX: number, worldZ: number) {
    const cell = this.worldToCell(worldX, worldZ);
    return this.getCell(cell.x, cell.z).blocked;
  }

  clampWorld(point: THREE.Vector3) {
    point.x = clamp(point.x, -this.half + 2, this.half - 2);
    point.z = clamp(point.z, -this.half + 2, this.half - 2);
    return point;
  }

  private resolveTerrainKind(cellX: number, cellZ: number): TerrainKind {
    const h = this.hash(cellX, cellZ);

    if (h > 0.989) {
      return "reserved_blocker";
    }

    if (h > 0.925) {
      return "charged";
    }

    if (h < 0.085) {
      return "scarred";
    }

    return "floor";
  }

  private hash(x: number, z: number) {
    const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
}
