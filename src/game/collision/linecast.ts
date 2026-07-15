import type { GridWorld } from "../../world/GridWorld";
import { canOccupyWorld, capsuleIntersectsHex, isCellBlocked, isCellOpaque } from "./occupancy";
import { NAVIGATION_LINE_MAX_CELLS_PER_SLICE } from "../../config";

type GroundPoint = {
  x: number;
  z: number;
};

export function hasLineOfSight(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint, radius = 0) {
  const job = new LinecastJob(gridWorld, from, to, radius);
  while (!job.isComplete()) {
    job.step(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  }
  return job.isClear();
}

export class LinecastJob {
  private readonly fromCell;
  private readonly toCell;
  private readonly lineCells;
  private readonly checked = new Set<string>();
  private lineIndex = 0;
  private complete = false;
  private clear = false;
  private initialized = false;
  private checkedLineCells = 0;
  private checkedCandidateCells = 0;

  constructor(
    private readonly gridWorld: GridWorld,
    private readonly from: GroundPoint,
    private readonly to: GroundPoint,
    private readonly radius = 0,
  ) {
    this.fromCell = gridWorld.worldToCell(from.x, from.z);
    this.toCell = gridWorld.worldToCell(to.x, to.z);
    this.lineCells = gridWorld.cellsOnLine(this.fromCell, this.toCell);
  }

  step(deadline: number, maxLineCells = NAVIGATION_LINE_MAX_CELLS_PER_SLICE) {
    if (this.complete) {
      return;
    }

    if (!this.initialized) {
      this.initialized = true;
      if (
        !canOccupyWorld(this.gridWorld, this.from.x, this.from.z, this.radius) ||
        !canOccupyWorld(this.gridWorld, this.to.x, this.to.z, this.radius)
      ) {
        this.complete = true;
        this.clear = false;
        return;
      }
    }

    const neighborRadius = Math.max(1, Math.ceil(this.radius / this.gridWorld.tileSize) + 1);
    let processed = 0;
    while (this.lineIndex < this.lineCells.length && processed < maxLineCells && performance.now() < deadline) {
      const lineCell = this.lineCells[this.lineIndex];
      let clear = true;
      this.gridWorld.forEachCellInRange(lineCell, neighborRadius, (q, r) => {
        if (!clear || (q === this.fromCell.q && r === this.fromCell.r) || (q === this.toCell.q && r === this.toCell.r)) {
          return;
        }

        const key = this.gridWorld.cellKey(q, r);
        if (this.checked.has(key)) {
          return;
        }
        this.checked.add(key);
        this.checkedCandidateCells += 1;
        if (
          isCellBlocked(this.gridWorld, q, r) &&
          capsuleIntersectsHex(this.gridWorld, this.from.x, this.from.z, this.to.x, this.to.z, this.radius, q, r)
        ) {
          clear = false;
        }
      });

      this.checkedLineCells += 1;
      this.lineIndex += 1;
      processed += 1;
      if (!clear) {
        this.complete = true;
        this.clear = false;
        return;
      }
    }

    if (this.lineIndex >= this.lineCells.length) {
      this.complete = true;
      this.clear = true;
    }
  }

  isComplete() {
    return this.complete;
  }

  isClear() {
    return this.complete && this.clear;
  }

  diagnostics() {
    return {
      complete: this.complete,
      clear: this.clear,
      checkedLineCells: this.checkedLineCells,
      checkedCandidateCells: this.checkedCandidateCells,
      totalLineCells: this.lineCells.length,
    };
  }
}

export function hasOpaqueLineOfSight(gridWorld: GridWorld, from: GroundPoint, to: GroundPoint) {
  return lineIsClear(gridWorld, from, to, 0, (q, r) => isCellOpaque(gridWorld, q, r));
}

function lineIsClear(
  gridWorld: GridWorld,
  from: GroundPoint,
  to: GroundPoint,
  radius: number,
  blocks: (q: number, r: number) => boolean,
) {
  const fromCell = gridWorld.worldToCell(from.x, from.z);
  const toCell = gridWorld.worldToCell(to.x, to.z);
  const checked = new Set<string>();
  const neighborRadius = Math.max(1, Math.ceil(radius / gridWorld.tileSize) + 1);

  for (const lineCell of gridWorld.cellsOnLine(fromCell, toCell)) {
    let clear = true;
    gridWorld.forEachCellInRange(lineCell, neighborRadius, (q, r) => {
      if (!clear || (q === fromCell.q && r === fromCell.r) || (q === toCell.q && r === toCell.r)) {
        return;
      }

      const key = gridWorld.cellKey(q, r);
      if (checked.has(key)) {
        return;
      }
      checked.add(key);

      if (blocks(q, r) && capsuleIntersectsHex(gridWorld, from.x, from.z, to.x, to.z, radius, q, r)) {
        clear = false;
      }
    });

    if (!clear) {
      return false;
    }
  }

  return true;
}
