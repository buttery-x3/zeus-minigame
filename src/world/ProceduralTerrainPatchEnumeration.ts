import type { TerrainStructure } from "../types";
import { HEX_DIRECTION_ORDER, hexCellKey, hexDistance, type HexCoord } from "./hexCoordinates";
import {
  HEX_PATCH_EDGE_CELLS,
  HEX_PATCH_LOCAL_CELLS,
  createBaseCells,
  createPatchVariant,
  setPatchCell,
  structureForEdge,
  type HexPatchCell,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";
import {
  resolveProceduralBoundaryEdges,
  type HexPatchBoundaryConstraints,
  type ProceduralPatchOptions,
} from "./ProceduralTerrainPatch";
import { satisfiesProceduralConnectivity, scoreProceduralCells } from "./ProceduralTerrainPatchScoring";

export type EnumeratedProceduralPatch = {
  variant: HexPatchTileVariant;
  score: number;
};

export type ProceduralPatchEnumeration =
  | { ok: true; boundaryKey: string; attemptedAssignments: number; candidates: EnumeratedProceduralPatch[] }
  | { ok: false; boundaryKey: string; attemptedAssignments: number; reason: string; candidates: [] };

const INTERIOR_CELLS = HEX_PATCH_LOCAL_CELLS.filter((cell) => hexDistance(cell, { q: 0, r: 0 }) < 2);
const CENTER_KEY = hexCellKey(0, 0);

export function enumerateProceduralPatches(
  constraints: HexPatchBoundaryConstraints,
  options: Omit<ProceduralPatchOptions, "preferFastTermination"> = {},
): ProceduralPatchEnumeration {
  const resolution = resolveProceduralBoundaryEdges(constraints);
  if (!resolution.ok) {
    return { ok: false, boundaryKey: resolution.boundaryKey, attemptedAssignments: 0, reason: resolution.reason, candidates: [] };
  }
  const boundary = new Map<string, { coord: HexCoord; structure: TerrainStructure }>();
  for (const direction of HEX_DIRECTION_ORDER) {
    resolution.edges[direction].forEach((kind, index) => {
      const coord = HEX_PATCH_EDGE_CELLS[direction][index];
      boundary.set(hexCellKey(coord.q, coord.r), { coord, structure: structureForEdge(kind) });
    });
  }
  const structures = new Set([...boundary.values()].map((entry) => entry.structure));
  const hasOpenBoundary = structures.has("open") || structures.has("bank");
  const candidateStructures = [...structures].filter((structure) => structure !== "bank");
  if (hasOpenBoundary && !candidateStructures.includes("open")) candidateStructures.unshift("open");
  if (!hasOpenBoundary) {
    const index = candidateStructures.indexOf("open");
    if (index >= 0) candidateStructures.splice(index, 1);
  }
  const mutable = INTERIOR_CELLS.filter((cell) => !hasOpenBoundary || hexCellKey(cell.q, cell.r) !== CENTER_KEY);
  const assignment = new Map<string, TerrainStructure>();
  if (hasOpenBoundary) assignment.set(CENTER_KEY, "open");
  let attemptedAssignments = 0;
  const candidates: EnumeratedProceduralPatch[] = [];

  const visit = (index: number) => {
    if (index < mutable.length) {
      const coord = mutable[index];
      for (const structure of candidateStructures) {
        assignment.set(hexCellKey(coord.q, coord.r), structure);
        visit(index + 1);
      }
      return;
    }
    attemptedAssignments += 1;
    const cells = createBaseCells();
    for (const entry of boundary.values()) setPatchCell(cells, entry.coord, entry.structure);
    for (const coord of INTERIOR_CELLS) {
      const structure = assignment.get(hexCellKey(coord.q, coord.r));
      if (structure) setPatchCell(cells, coord, structure);
    }
    if (!satisfiesProceduralConnectivity(cells, boundary, hasOpenBoundary) || (options.acceptsCells && !options.acceptsCells(cells))) return;
    const layoutKey = serializeLayout(cells);
    const variant = createPatchVariant(
      `${options.idPrefix ?? "patch.procedural.option"}.${hashString(`${resolution.boundaryKey}|${layoutKey}`).toString(16).padStart(8, "0")}`,
      familyForStructures(structures),
      "procedural",
      0,
      cells,
      { boundaryKey: resolution.boundaryKey, fillMode: hasOpenBoundary ? "open-core" : structures.size === 1 ? "enclosed" : "mixed-enclosure" },
    );
    candidates.push({ variant, score: scoreProceduralCells(cells, boundary, hasOpenBoundary) });
  };

  visit(0);
  candidates.sort((a, b) => a.score - b.score || a.variant.id.localeCompare(b.variant.id));
  return { ok: true, boundaryKey: resolution.boundaryKey, attemptedAssignments, candidates };
}

function serializeLayout(cells: ReadonlyMap<string, HexPatchCell>) {
  return HEX_PATCH_LOCAL_CELLS.map((coord) => cells.get(hexCellKey(coord.q, coord.r))?.structure ?? "missing").join("|");
}

function familyForStructures(structures: ReadonlySet<TerrainStructure>) {
  const nonOpen = [...structures].filter((structure) => structure !== "open" && structure !== "bank");
  if (nonOpen.length !== 1) return nonOpen.length === 0 ? "open" : "transition";
  return nonOpen[0] === "wall" ? "cliff" : nonOpen[0] === "river" ? "river" : "lake";
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
