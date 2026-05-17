import * as THREE from "three";
import { TILE_SIZE, WORLD_CELLS, WORLD_HALF, WORLD_HEX_RADIUS, WORLD_SIZE } from "../config";
import { clamp } from "../lib/math";
import type { HexEdgeKind, HexTileSignature, TerrainCell, TerrainStructure, TerrainSurface } from "../types";

export type HexCoord = {
  q: number;
  r: number;
};

export type HexDirection = keyof HexTileSignature;

export const HEX_DIRECTIONS: Record<HexDirection, HexCoord> = {
  ne: { q: 1, r: -1 },
  e: { q: 1, r: 0 },
  se: { q: 0, r: 1 },
  sw: { q: -1, r: 1 },
  w: { q: -1, r: 0 },
  nw: { q: 0, r: -1 },
};

const HEX_DIRECTION_ORDER: HexDirection[] = ["ne", "e", "se", "sw", "w", "nw"];
const HEX_RING_ORDER: HexDirection[] = ["e", "ne", "nw", "w", "sw", "se"];
const WATER_STRUCTURES = new Set<TerrainStructure>(["lake", "river"]);

export class GridWorld {
  readonly tileSize = TILE_SIZE;
  readonly hexSize = TILE_SIZE / Math.sqrt(3);
  readonly hexHeight = this.hexSize * 2;
  readonly hexVerticalSpacing = this.hexSize * 1.5;
  readonly worldCells = WORLD_CELLS;
  readonly worldRadius = WORLD_HEX_RADIUS;
  readonly worldSize = WORLD_SIZE;
  readonly half = WORLD_HALF;

  private cells = new Map<string, TerrainCell>();

  worldToCell(worldX: number, worldZ: number): HexCoord {
    const r = worldZ / this.hexVerticalSpacing;
    const q = worldX / this.tileSize - r / 2;
    return this.clampCell(roundAxial(q, r));
  }

  cellToWorld(q: number, r: number) {
    return {
      x: this.tileSize * (q + r / 2),
      z: this.hexVerticalSpacing * r,
    };
  }

  getCell(q: number, r: number): TerrainCell {
    if (!this.isInBounds(q, r)) {
      return this.createOutOfBoundsCell(q, r);
    }

    const key = this.cellKey(q, r);
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }

    const structure = this.resolveStructure(q, r);
    const surface = this.resolveSurface(q, r, structure);
    const cell: TerrainCell = {
      q,
      r,
      structure,
      surface,
      blocked: structure === "wall" || structure === "lake" || structure === "river",
      opaque: structure === "wall",
      edges: this.resolveEdges(structure),
    };
    this.cells.set(key, cell);
    return cell;
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
    } else {
      point.x = clamp(point.x, -this.half + margin, this.half - margin);
      point.z = clamp(point.z, -this.half + margin, this.half - margin);
    }

    return point;
  }

  cellToWorldPoint(cell: HexCoord) {
    const world = this.cellToWorld(cell.q, cell.r);
    return new THREE.Vector3(world.x, 0, world.z);
  }

  cellKey(q: number, r: number) {
    return `${q},${r}`;
  }

  isInBounds(q: number, r: number) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= this.worldRadius;
  }

  indexIfInBounds(q: number, r: number) {
    if (!this.isInBounds(q, r)) {
      return -1;
    }

    return (r + this.worldRadius) * this.worldCells + q + this.worldRadius;
  }

  getNeighbors(q: number, r: number): HexCoord[] {
    return HEX_DIRECTION_ORDER.map((direction) => {
      const offset = HEX_DIRECTIONS[direction];
      return { q: q + offset.q, r: r + offset.r };
    }).filter((cell) => this.isInBounds(cell.q, cell.r));
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
        if (this.isInBounds(q, r)) {
          visit(q, r);
        }
      }
    }
  }

  ring(center: HexCoord, radius: number) {
    if (radius === 0) {
      return this.isInBounds(center.q, center.r) ? [center] : [];
    }

    const cells: HexCoord[] = [];
    let q = center.q + HEX_DIRECTIONS.sw.q * radius;
    let r = center.r + HEX_DIRECTIONS.sw.r * radius;

    for (const direction of HEX_RING_ORDER) {
      const offset = HEX_DIRECTIONS[direction];
      for (let step = 0; step < radius; step += 1) {
        if (this.isInBounds(q, r)) {
          cells.push({ q, r });
        }
        q += offset.q;
        r += offset.r;
      }
    }

    return cells;
  }

  hexDistance(a: HexCoord, b: HexCoord) {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(-a.q - a.r + b.q + b.r));
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
      if (key !== previousKey && this.isInBounds(rounded.q, rounded.r)) {
        cells.push(rounded);
        previousKey = key;
      }
    }

    return cells;
  }

  private clampCell(cell: HexCoord): HexCoord {
    if (this.isInBounds(cell.q, cell.r)) {
      return cell;
    }

    let x = cell.q;
    let z = cell.r;
    let y = -x - z;
    const clampedX = clamp(x, -this.worldRadius, this.worldRadius);
    const clampedY = clamp(y, -this.worldRadius, this.worldRadius);
    const clampedZ = clamp(z, -this.worldRadius, this.worldRadius);
    const xDelta = Math.abs(clampedX - x);
    const yDelta = Math.abs(clampedY - y);
    const zDelta = Math.abs(clampedZ - z);

    x = clampedX;
    y = clampedY;
    z = clampedZ;

    if (x + y + z !== 0) {
      if (xDelta >= yDelta && xDelta >= zDelta) {
        x = -y - z;
      } else if (yDelta >= zDelta) {
        y = -x - z;
      } else {
        z = -x - y;
      }
    }

    return { q: x, r: z };
  }

  private resolveStructure(q: number, r: number): TerrainStructure {
    if (this.hexDistance({ q, r }, { q: 0, r: 0 }) <= 4) {
      return "open";
    }

    if (this.isLakeSeed(q, r)) {
      return "lake";
    }

    if (this.isRiverSeed(q, r)) {
      return "river";
    }

    if (this.isAdjacentToWaterSeed(q, r)) {
      return "bank";
    }

    if (this.isWallSeed(q, r)) {
      return "wall";
    }

    return "open";
  }

  private resolveSurface(q: number, r: number, structure: TerrainStructure): TerrainSurface {
    if (structure === "wall") {
      return "stone";
    }
    if (structure === "lake") {
      return "sand";
    }
    if (structure === "river") {
      return "mud";
    }
    if (structure === "bank") {
      return this.isAdjacentToRiverSeed(q, r) ? "mud" : "sand";
    }

    const h = this.hash(q + 31, r - 17);
    if (h > 0.962) {
      return "charged";
    }
    if (h < 0.07) {
      return "scarred";
    }
    if (this.isAdjacentToWallSeed(q, r)) {
      return "stone";
    }
    if (h > 0.58) {
      return "dirt";
    }
    return "grass";
  }

  private resolveEdges(structure: TerrainStructure): HexTileSignature {
    const kind: HexEdgeKind =
      structure === "wall" ? "closed" : structure === "lake" ? "lake" : structure === "river" ? "river" : "open";

    return {
      ne: kind,
      e: kind,
      se: kind,
      sw: kind,
      w: kind,
      nw: kind,
    };
  }

  private isAdjacentToWaterSeed(q: number, r: number) {
    return this.getDirectionOffsets().some((offset) => WATER_STRUCTURES.has(this.waterSeedStructure(q + offset.q, r + offset.r)));
  }

  private isAdjacentToRiverSeed(q: number, r: number) {
    return this.getDirectionOffsets().some((offset) => this.isRiverSeed(q + offset.q, r + offset.r));
  }

  private isAdjacentToWallSeed(q: number, r: number) {
    return this.getDirectionOffsets().some((offset) => this.isWallSeed(q + offset.q, r + offset.r));
  }

  private waterSeedStructure(q: number, r: number): TerrainStructure {
    if (this.isLakeSeed(q, r)) {
      return "lake";
    }
    if (this.isRiverSeed(q, r)) {
      return "river";
    }
    return "open";
  }

  private isLakeSeed(q: number, r: number) {
    if (this.hexDistance({ q, r }, { q: 0, r: 0 }) < 18) {
      return false;
    }

    const centerA = this.hexDistance({ q, r }, { q: -34, r: 24 }) <= 5;
    const centerB = this.hexDistance({ q, r }, { q: 42, r: -19 }) <= 4;
    return centerA || centerB || this.hash(q - 101, r + 73) > 0.9975;
  }

  private isRiverSeed(q: number, r: number) {
    if (this.hexDistance({ q, r }, { q: 0, r: 0 }) < 15) {
      return false;
    }

    const channel = Math.round(Math.sin(r * 0.18) * 4 + Math.sin(r * 0.047) * 7);
    return Math.abs(q - channel - 18) <= 0 && r > -70 && r < 72;
  }

  private isWallSeed(q: number, r: number) {
    if (this.hexDistance({ q, r }, { q: 0, r: 0 }) <= 7) {
      return false;
    }

    return this.hash(q, r) > 0.985;
  }

  private createOutOfBoundsCell(q: number, r: number): TerrainCell {
    return {
      q,
      r,
      structure: "wall",
      surface: "stone",
      blocked: true,
      opaque: true,
      edges: this.resolveEdges("wall"),
    };
  }

  private hash(q: number, r: number) {
    const n = Math.sin(q * 127.1 + r * 311.7) * 43758.5453123;
    return n - Math.floor(n);
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
