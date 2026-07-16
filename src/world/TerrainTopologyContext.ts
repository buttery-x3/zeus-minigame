import { terrainBlocksMovement } from "./HexTerrainRules";
import { patchLocalToWorld, type HexPatchCell, type HexPatchTileVariant } from "./HexTerrainPatch";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, type HexCoord } from "./hexCoordinates";
import type { TopologyPatch } from "./TerrainEnclosurePolicy";

type CandidateCells = ReadonlyMap<string, Pick<HexPatchCell, "q" | "r" | "structure">>;

export class MovementTopologyContext {
  evaluationCount = 0;

  private readonly blocked = new Map<string, HexCoord>();
  private readonly parent = new Map<string, string>();
  private readonly vertices = new Set<string>();
  private faces = 0;
  private edges = 0;
  private components = 0;

  constructor(patches: Iterable<TopologyPatch>) {
    for (const patch of patches) {
      this.commitVariant(patch, patch.variant);
    }
  }

  get committedBlockedCellCount() {
    return this.blocked.size;
  }

  evaluateVariant(patch: HexCoord, variant: HexPatchTileVariant) {
    return this.evaluateCells(patch, variant.cells);
  }

  evaluateCells(patch: HexCoord, cells: CandidateCells) {
    this.evaluationCount += 1;
    const candidate = collectCandidateBlockedCells(patch, cells, this.blocked);
    if (candidate.size === 0) {
      return { safe: true, holeCount: this.baseHoleCount() } as const;
    }

    let sharedCandidateEdges = 0;
    let sharedCommittedEdges = 0;
    const candidateVertices = new Set<string>();
    for (const cell of candidate.values()) {
      for (const direction of ["ne", "e", "se"] as const) {
        const offset = HEX_DIRECTIONS[direction];
        if (candidate.has(hexCellKey(cell.q + offset.q, cell.r + offset.r))) {
          sharedCandidateEdges += 1;
        }
      }
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        if (this.blocked.has(hexCellKey(cell.q + offset.q, cell.r + offset.r))) {
          sharedCommittedEdges += 1;
        }
      }
      addCellVertices(candidateVertices, cell);
    }

    let addedVertices = 0;
    for (const vertex of candidateVertices) {
      if (!this.vertices.has(vertex)) {
        addedVertices += 1;
      }
    }

    const faces = this.faces + candidate.size;
    const edges = this.edges + candidate.size * 6 - sharedCandidateEdges - sharedCommittedEdges;
    const vertices = this.vertices.size + addedVertices;
    const components = this.components + componentDelta(candidate, (key) => this.committedRoot(key));
    const holeCount = components - vertices + edges - faces;
    return { safe: holeCount <= this.baseHoleCount(), holeCount } as const;
  }

  commitVariant(patch: HexCoord, variant: HexPatchTileVariant) {
    const candidate = collectCandidateBlockedCells(patch, variant.cells, this.blocked);
    if (candidate.size === 0) {
      return;
    }

    let sharedEdges = 0;
    for (const cell of candidate.values()) {
      for (const direction of ["ne", "e", "se"] as const) {
        const offset = HEX_DIRECTIONS[direction];
        if (candidate.has(hexCellKey(cell.q + offset.q, cell.r + offset.r))) {
          sharedEdges += 1;
        }
      }
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        if (this.blocked.has(hexCellKey(cell.q + offset.q, cell.r + offset.r))) {
          sharedEdges += 1;
        }
      }
      addCellVertices(this.vertices, cell);
      const key = hexCellKey(cell.q, cell.r);
      this.blocked.set(key, cell);
      this.parent.set(key, key);
    }

    this.faces += candidate.size;
    this.edges += candidate.size * 6 - sharedEdges;
    this.components += candidate.size;
    for (const cell of candidate.values()) {
      const key = hexCellKey(cell.q, cell.r);
      for (const direction of ["ne", "e", "se"] as const) {
        const offset = HEX_DIRECTIONS[direction];
        const neighborKey = hexCellKey(cell.q + offset.q, cell.r + offset.r);
        if (this.blocked.has(neighborKey) && this.union(key, neighborKey)) {
          this.components -= 1;
        }
      }
      for (const direction of ["sw", "w", "nw"] as const) {
        const offset = HEX_DIRECTIONS[direction];
        const neighborKey = hexCellKey(cell.q + offset.q, cell.r + offset.r);
        if (this.blocked.has(neighborKey) && this.union(key, neighborKey)) {
          this.components -= 1;
        }
      }
    }
  }

  private baseHoleCount() {
    return this.components - this.vertices.size + this.edges - this.faces;
  }

  private committedRoot(key: string) {
    return this.parent.has(key) ? this.find(key) : null;
  }

  private find(key: string): string {
    const current = this.parent.get(key) ?? key;
    if (current === key) {
      return key;
    }
    const root = this.find(current);
    this.parent.set(key, root);
    return root;
  }

  private union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) {
      return false;
    }
    this.parent.set(rootB, rootA);
    return true;
  }
}

export function createMovementTopologyContext(patches: Iterable<TopologyPatch>) {
  return new MovementTopologyContext(patches);
}

function collectCandidateBlockedCells(
  patch: HexCoord,
  cells: CandidateCells,
  committed: ReadonlyMap<string, HexCoord>,
) {
  const blocked = new Map<string, HexCoord>();
  for (const local of cells.values()) {
    if (!terrainBlocksMovement(local.structure)) {
      continue;
    }
    const world = patchLocalToWorld(patch, local);
    const key = hexCellKey(world.q, world.r);
    if (!committed.has(key)) {
      blocked.set(key, world);
    }
  }
  return blocked;
}

function addCellVertices(vertices: Set<string>, cell: HexCoord) {
  for (let index = 0; index < HEX_DIRECTION_ORDER.length; index += 1) {
    const first = HEX_DIRECTIONS[HEX_DIRECTION_ORDER[index]];
    const second = HEX_DIRECTIONS[HEX_DIRECTION_ORDER[(index + 1) % HEX_DIRECTION_ORDER.length]];
    vertices.add([
      hexCellKey(cell.q, cell.r),
      hexCellKey(cell.q + first.q, cell.r + first.r),
      hexCellKey(cell.q + second.q, cell.r + second.r),
    ].sort().join("|"));
  }
}

function componentDelta(candidate: ReadonlyMap<string, HexCoord>, committedRoot: (key: string) => string | null) {
  const remaining = new Set(candidate.keys());
  const candidateContacts: Set<string>[] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const queue = [candidate.get(first)!];
    const contacts = new Set<string>();
    remaining.delete(first);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const key = hexCellKey(current.q + offset.q, current.r + offset.r);
        const committedComponent = committedRoot(key);
        if (committedComponent !== null) {
          contacts.add(committedComponent);
        }
        if (remaining.delete(key)) {
          queue.push(candidate.get(key)!);
        }
      }
    }
    candidateContacts.push(contacts);
  }

  const parent = new Map<string, string>();
  const find = (node: string): string => {
    const current = parent.get(node) ?? node;
    if (current === node) {
      parent.set(node, node);
      return node;
    }
    const root = find(current);
    parent.set(node, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  const contactedCommitted = new Set<string>();
  candidateContacts.forEach((contacts, index) => {
    const candidateNode = `c:${index}`;
    find(candidateNode);
    for (const component of contacts) {
      contactedCommitted.add(component);
      union(candidateNode, `b:${component}`);
    }
  });
  const resultingGroups = new Set([...parent.keys()].map(find)).size;
  return resultingGroups - contactedCommitted.size;
}
