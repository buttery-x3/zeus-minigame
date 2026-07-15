import * as THREE from "three";
import { TILE_SIZE } from "../config";
import type { TerrainCell } from "../types";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  HEX_RING_ORDER,
  hexCellKey,
  hexDistance,
  type HexCoord,
} from "./hexCoordinates";
import type { TerrainProvider } from "./TerrainProvider";
import { WfcTerrainProvider } from "./WfcTerrainProvider";

export type { HexCoord };

export class GridWorld {
  readonly tileSize = TILE_SIZE;
  readonly hexSize = TILE_SIZE / Math.sqrt(3);
  readonly hexHeight = this.hexSize * 2;
  readonly hexVerticalSpacing = this.hexSize * 1.5;

  private cells = new Map<string, TerrainCell>();

  constructor(private readonly terrainProvider: TerrainProvider = new WfcTerrainProvider()) {}

  worldToCell(worldX: number, worldZ: number): HexCoord {
    const r = worldZ / this.hexVerticalSpacing;
    const q = worldX / this.tileSize - r / 2;
    return roundAxial(q, r);
  }

  cellToWorld(q: number, r: number) {
    return {
      x: this.tileSize * (q + r / 2),
      z: this.hexVerticalSpacing * r,
    };
  }

  getCell(q: number, r: number): TerrainCell {
    const key = this.cellKey(q, r);
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }

    const cell = this.terrainProvider.getCell(q, r);
    this.cells.set(key, cell);
    return cell;
  }

  getGeneratedCell(q: number, r: number) {
    const key = this.cellKey(q, r);
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }

    const generated = this.terrainProvider.getGeneratedCell?.(q, r) ?? null;
    if (generated) {
      this.cells.set(key, generated);
    }
    return generated;
  }

  getGeneratedCellsInRange(center: HexCoord, radius: number) {
    if (this.terrainProvider.getGeneratedCellsInRange) {
      return this.terrainProvider.getGeneratedCellsInRange(center, radius);
    }

    const cells: TerrainCell[] = [];
    for (const cell of this.cells.values()) {
      if (this.hexDistance(center, cell) <= radius) {
        cells.push(cell);
      }
    }
    return cells;
  }

  getTerrainGenerationVersion() {
    return this.terrainProvider.getGenerationVersion?.() ?? this.cells.size;
  }

  getCachedCellCount() {
    return this.cells.size;
  }

  ensureTerrainGeneratedAroundCell(q: number, r: number) {
    this.terrainProvider.ensureGeneratedAround?.(q, r);
  }

  ensureTerrainGeneratedAroundWorld(point: THREE.Vector3) {
    const cell = this.worldToCell(point.x, point.z);
    this.ensureTerrainGeneratedAroundCell(cell.q, cell.r);
  }

  isBlockedWorld(worldX: number, worldZ: number) {
    const cell = this.worldToCell(worldX, worldZ);
    return this.getCell(cell.q, cell.r).blocked;
  }

  clampWorld(point: THREE.Vector3, margin = 2) {
    const clamped = this.cellToWorldPoint(this.worldToCell(point.x, point.z));
    const direction = new THREE.Vector3(point.x - clamped.x, 0, point.z - clamped.z);
    const maxDistance = Math.max(0, this.hexSize - margin * 0.12);

    if (direction.lengthSq() > maxDistance * maxDistance) {
      direction.setLength(maxDistance);
      point.x = clamped.x + direction.x;
      point.z = clamped.z + direction.z;
    }

    return point;
  }

  cellToWorldPoint(cell: HexCoord) {
    const world = this.cellToWorld(cell.q, cell.r);
    return new THREE.Vector3(world.x, 0, world.z);
  }

  cellKey(q: number, r: number) {
    return hexCellKey(q, r);
  }

  isInBounds(q: number, r: number) {
    return Number.isFinite(q) && Number.isFinite(r);
  }

  indexIfInBounds(q: number, r: number) {
    return this.isInBounds(q, r) ? 0 : -1;
  }

  getNeighbors(q: number, r: number): HexCoord[] {
    return HEX_DIRECTION_ORDER.map((direction) => {
      const offset = HEX_DIRECTIONS[direction];
      return { q: q + offset.q, r: r + offset.r };
    });
  }

  getDirectionOffsets() {
    return HEX_DIRECTION_ORDER.map((direction) => HEX_DIRECTIONS[direction]);
  }

  forEachCellInRange(center: HexCoord, radius: number, visit: (q: number, r: number) => void) {
    for (let dq = -radius; dq <= radius; dq += 1) {
      const minDr = Math.max(-radius, -dq - radius);
      const maxDr = Math.min(radius, -dq + radius);
      for (let dr = minDr; dr <= maxDr; dr += 1) {
        const q = center.q + dq;
        const r = center.r + dr;
        visit(q, r);
      }
    }
  }

  ring(center: HexCoord, radius: number) {
    if (radius === 0) {
      return [center];
    }

    const cells: HexCoord[] = [];
    let q = center.q + HEX_DIRECTIONS.sw.q * radius;
    let r = center.r + HEX_DIRECTIONS.sw.r * radius;

    for (const direction of HEX_RING_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      for (let step = 0; step < radius; step += 1) {
        cells.push({ q, r });
        q += offset.q;
        r += offset.r;
      }
    }

    return cells;
  }

  hexDistance(a: HexCoord, b: HexCoord) {
    return hexDistance(a, b);
  }

  getTerrainDiagnostics() {
    return this.terrainProvider.getDiagnostics();
  }

  getHexCorners(q: number, r: number, inset = 1) {
    const center = this.cellToWorld(q, r);
    const radius = this.hexSize * inset;
    const corners: { x: number; z: number }[] = [];

    for (let index = 0; index < 6; index += 1) {
      const angle = Math.PI / 6 + (Math.PI / 3) * index;
      corners.push({
        x: center.x + Math.cos(angle) * radius,
        z: center.z + Math.sin(angle) * radius,
      });
    }

    return corners;
  }

  cellsOnLine(from: HexCoord, to: HexCoord) {
    const distance = this.hexDistance(from, to);
    const cells: HexCoord[] = [];
    let previousKey = "";

    for (let step = 0; step <= distance; step += 1) {
      const amount = distance === 0 ? 0 : step / distance;
      const rounded = roundAxial(
        lerp(from.q, to.q, amount),
        lerp(from.r, to.r, amount),
      );
      const key = this.cellKey(rounded.q, rounded.r);
      if (key !== previousKey) {
        cells.push(rounded);
        previousKey = key;
      }
    }

    return cells;
  }

}

function roundAxial(q: number, r: number): HexCoord {
  let x = Math.round(q);
  let z = Math.round(r);
  let y = Math.round(-q - r);
  const xDelta = Math.abs(x - q);
  const yDelta = Math.abs(y + q + r);
  const zDelta = Math.abs(z - r);

  if (xDelta > yDelta && xDelta > zDelta) {
    x = -y - z;
  } else if (yDelta > zDelta) {
    y = -x - z;
  } else {
    z = -x - y;
  }

  return { q: x, r: z };
}

function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}
