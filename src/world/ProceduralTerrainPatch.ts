import type { HexEdgeKind, TerrainStructure } from "../types";
import {
  HEX_DIRECTION_ORDER,
  hexCellKey,
  hexDistance,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
import {
  HEX_PATCH_EDGE_CELLS,
  HEX_PATCH_LOCAL_CELLS,
  createBaseCells,
  createPatchVariant,
  setPatchCell,
  structureForEdge,
  type HexPatchEdgeSignature,
  type HexPatchFamily,
  type HexPatchCell,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";
import { validateHexPatchVariant } from "./HexTerrainPatchValidation";
import { satisfiesProceduralConnectivity, scoreProceduralCells } from "./ProceduralTerrainPatchScoring";

export type HexPatchBoundaryConstraints = Partial<Record<HexDirection, readonly HexEdgeKind[]>>;

export type ProceduralPatchResult =
  | { ok: true; variant: HexPatchTileVariant; attemptedAssignments: number }
  | { ok: false; boundaryKey: string; reason: string; attemptedAssignments: number };

export type ProceduralPatchOptions = {
  idPrefix?: string;
  acceptsCells?: (cells: ReadonlyMap<string, HexPatchCell>) => boolean;
};

const INTERIOR_CELLS = HEX_PATCH_LOCAL_CELLS.filter((cell) => hexDistance(cell, { q: 0, r: 0 }) < 2);
const CENTER_KEY = hexCellKey(0, 0);

export function synthesizeProceduralPatch(
  constraints: HexPatchBoundaryConstraints,
  seed: number,
  options: ProceduralPatchOptions = {},
): ProceduralPatchResult {
  const resolution = resolveBoundaryEdges(constraints);
  if (!resolution.ok) {
    return { ok: false, boundaryKey: resolution.boundaryKey, reason: resolution.reason, attemptedAssignments: 0 };
  }
  const { edges, boundaryKey } = resolution;
  const boundary = new Map<string, { coord: HexCoord; structure: TerrainStructure }>();

  for (const direction of HEX_DIRECTION_ORDER) {
    for (let index = 0; index < HEX_PATCH_EDGE_CELLS[direction].length; index += 1) {
      const coord = HEX_PATCH_EDGE_CELLS[direction][index];
      const structure = structureForEdge(edges[direction][index]);
      const key = hexCellKey(coord.q, coord.r);
      const existing = boundary.get(key);
      if (existing && existing.structure !== structure) {
        return {
          ok: false,
          boundaryKey,
          reason: `conflicting boundary structures at ${key}: ${existing.structure}/${structure}`,
          attemptedAssignments: 0,
        };
      }
      boundary.set(key, { coord, structure });
    }
  }

  const boundaryStructures = new Set([...boundary.values()].map((entry) => entry.structure));
  const hasOpenBoundary = boundaryStructures.has("open") || boundaryStructures.has("bank");
  const candidateStructures = [...boundaryStructures].filter((structure) => structure !== "bank");
  if (hasOpenBoundary && !candidateStructures.includes("open")) {
    candidateStructures.unshift("open");
  }
  if (!hasOpenBoundary) {
    const openIndex = candidateStructures.indexOf("open");
    if (openIndex >= 0) {
      candidateStructures.splice(openIndex, 1);
    }
  }

  const mutableCells = INTERIOR_CELLS.filter((cell) => !hasOpenBoundary || hexCellKey(cell.q, cell.r) !== CENTER_KEY);
  let attemptedAssignments = 0;
  let bestCells: Map<string, HexPatchCell> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestTie = Number.POSITIVE_INFINITY;
  const assignment = new Map<string, TerrainStructure>();
  if (hasOpenBoundary) {
    assignment.set(CENTER_KEY, "open");
  }

  const search = (index: number) => {
    if (index < mutableCells.length) {
      const coord = mutableCells[index];
      for (const structure of candidateStructures) {
        assignment.set(hexCellKey(coord.q, coord.r), structure);
        search(index + 1);
      }
      return;
    }

    attemptedAssignments += 1;
    const cells = createBaseCells();
    for (const entry of boundary.values()) {
      setPatchCell(cells, entry.coord, entry.structure);
    }
    for (const coord of INTERIOR_CELLS) {
      const structure = assignment.get(hexCellKey(coord.q, coord.r));
      if (structure) {
        setPatchCell(cells, coord, structure);
      }
    }

    if (!satisfiesProceduralConnectivity(cells, boundary, hasOpenBoundary)) {
      return;
    }
    if (options.acceptsCells && !options.acceptsCells(cells)) {
      return;
    }
    const score = scoreProceduralCells(cells, boundary, hasOpenBoundary);
    const tie = seededTie(seed, boundaryKey, assignment);
    if (score < bestScore || (score === bestScore && tie < bestTie)) {
      bestCells = cells;
      bestScore = score;
      bestTie = tie;
    }
  };

  search(0);
  if (!bestCells) {
    return { ok: false, boundaryKey, reason: "no interior assignment satisfied connectivity", attemptedAssignments };
  }

  const fillMode = hasOpenBoundary
    ? "open-core"
    : boundaryStructures.size === 1
      ? "enclosed"
      : "mixed-enclosure";
  const family = familyForStructures(boundaryStructures);
  const selectedCells = bestCells as Map<string, HexPatchCell>;
  const layoutKey = [...selectedCells.values()]
    .sort((a, b) => a.q - b.q || a.r - b.r)
    .map((cell) => `${cell.q},${cell.r}:${cell.structure}`)
    .join("|");
  const idPrefix = options.idPrefix ?? "patch.procedural";
  const id = `${idPrefix}.${hashString(`${boundaryKey}|${layoutKey}`).toString(16).padStart(8, "0")}`;
  const variant = createPatchVariant(id, family, "procedural", 0, selectedCells, { boundaryKey, fillMode });
  const validation = validateHexPatchVariant(variant);
  if (!validation.valid) {
    return { ok: false, boundaryKey, reason: validation.errors.join("; "), attemptedAssignments };
  }
  return { ok: true, variant, attemptedAssignments };
}

export function serializeBoundaryConstraints(constraints: HexPatchBoundaryConstraints) {
  return resolveBoundaryEdges(constraints).boundaryKey;
}

export function proceduralBoundaryConstraintsAreConsistent(constraints: HexPatchBoundaryConstraints) {
  return resolveBoundaryEdges(constraints).ok;
}

function resolveBoundaryEdges(constraints: HexPatchBoundaryConstraints):
  | { ok: true; edges: Record<HexDirection, HexPatchEdgeSignature>; boundaryKey: string }
  | { ok: false; boundaryKey: string; reason: string } {
  const edges = {} as Record<HexDirection, HexPatchEdgeSignature>;
  const boundaryKinds = new Map<string, HexEdgeKind>();

  for (const direction of HEX_DIRECTION_ORDER) {
    const constraint = constraints[direction];
    if (!constraint) {
      continue;
    }
    edges[direction] = [...constraint];
    for (let index = 0; index < HEX_PATCH_EDGE_CELLS[direction].length; index += 1) {
      const coord = HEX_PATCH_EDGE_CELLS[direction][index];
      const key = hexCellKey(coord.q, coord.r);
      const existing = boundaryKinds.get(key);
      const kind = constraint[index];
      if (existing && existing !== kind) {
        const boundaryKey = serializeRawConstraints(constraints);
        return { ok: false, boundaryKey, reason: `conflicting boundary edges at ${key}: ${existing}/${kind}` };
      }
      boundaryKinds.set(key, kind);
    }
  }

  for (const direction of HEX_DIRECTION_ORDER) {
    if (edges[direction]) {
      continue;
    }
    edges[direction] = HEX_PATCH_EDGE_CELLS[direction].map((coord) => boundaryKinds.get(hexCellKey(coord.q, coord.r)) ?? "open");
  }
  return { ok: true, edges, boundaryKey: serializeBoundaryEdges(edges) };
}

function serializeBoundaryEdges(edges: Record<HexDirection, HexPatchEdgeSignature>) {
  return HEX_DIRECTION_ORDER.map((direction) => `${direction}:${edges[direction].join(",")}`).join("|");
}

function serializeRawConstraints(constraints: HexPatchBoundaryConstraints) {
  return HEX_DIRECTION_ORDER.map((direction) => `${direction}:${constraints[direction]?.join(",") ?? "*"}`).join("|");
}

function familyForStructures(structures: ReadonlySet<TerrainStructure>): HexPatchFamily {
  const nonOpen = [...structures].filter((structure) => structure !== "open" && structure !== "bank");
  if (nonOpen.length !== 1) {
    return nonOpen.length === 0 ? "open" : "transition";
  }
  return nonOpen[0] === "wall" ? "cliff" : nonOpen[0] === "river" ? "river" : "lake";
}

function seededTie(seed: number, boundaryKey: string, assignment: ReadonlyMap<string, TerrainStructure>) {
  const assignmentKey = [...assignment.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}`).join("|");
  return (hashString(`${seed}|${boundaryKey}|${assignmentKey}`) >>> 0) / 0x100000000;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
