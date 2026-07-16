import type { HexEdgeKind, HexTileSignature, TerrainStructure, TerrainSurface } from "../types";
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
  HEX_PATCH_LOCAL_CELL_KEYS,
  HEX_PATCH_RADIUS,
} from "./HexTerrainPatchGeometry";
import {
  reverseRiverPorts,
  rotateRiverFlow,
  serializeRiverPorts,
  type AuthoredPatchRiverFlow,
  type HexPatchRiverPorts,
} from "./HexTerrainRiverPorts";

export * from "./HexTerrainPatchGeometry";
export type { AuthoredPatchRiverFlow, HexPatchRiverPort, HexPatchRiverPorts } from "./HexTerrainRiverPorts";

export type HexPatchEdgeSignature = HexEdgeKind[];
export type HexPatchFamily = "open" | "cliff" | "river" | "lake" | "transition";
export type HexPatchProvenance = "authored" | "procedural";
export type HexPatchTopology = "open" | "isolated" | "endpoint" | "straight" | "tight-bend" | "gentle-bend" | "junction" | "mixed";
export type HexPatchRiverTerminal = "lake" | "cliff";
export type HexPatchLakeRole = "cove" | "shore" | "core" | "mouth";
export type HexPatchHydrologyEdgeInfluence = {
  river: readonly HexCoord[];
  lake: readonly HexCoord[];
  cliff: readonly HexCoord[];
};

export type HexPatchCell = HexCoord & {
  structure: TerrainStructure;
  surface: TerrainSurface;
  edges: HexTileSignature;
};

export type HexPatchTileVariant = {
  id: string;
  family: HexPatchFamily;
  provenance: HexPatchProvenance;
  cells: Map<string, HexPatchCell>;
  edges: Record<HexDirection, HexPatchEdgeSignature>;
  weight: number;
  selectionGroup: string;
  selectionGroupWeight: number;
  topology: HexPatchTopology;
  riverTerminal?: HexPatchRiverTerminal;
  riverPorts: HexPatchRiverPorts;
  lakeRole?: HexPatchLakeRole;
  hydrologyEdges: Record<HexDirection, HexPatchHydrologyEdgeInfluence>;
  diagnostics: {
    kind: "open" | "wall" | "river" | "lake" | "mixed";
    riverExitCount: number;
    lakeExitCount: number;
    closedExitCount: number;
  };
  procedural?: {
    boundaryKey: string;
    fillMode: "open-core" | "enclosed" | "mixed-enclosure";
  };
};

export type AuthoredPatchDefinition = {
  id: string;
  family: HexPatchFamily;
  weight: number;
  selectionGroup?: string;
  selectionGroupWeight?: number;
  topology?: HexPatchTopology;
  riverTerminal?: HexPatchRiverTerminal;
  riverFlow?: AuthoredPatchRiverFlow;
  lakeRole?: HexPatchLakeRole;
  baseSurface?: TerrainSurface;
  rotations?: number;
  cells?: Partial<Record<Exclude<TerrainStructure, "open">, readonly HexCoord[]>>;
  openSurfaceCells?: Partial<Record<TerrainSurface, readonly HexCoord[]>>;
};

export function createAuthoredPatchVariants(definition: AuthoredPatchDefinition) {
  const baseCells = createBaseCells(definition.baseSurface ?? "grass");

  for (const [surface, coords] of Object.entries(definition.openSurfaceCells ?? {}) as [TerrainSurface, readonly HexCoord[]][]) {
    for (const coord of coords) {
      setPatchCell(baseCells, coord, "open", surface);
    }
  }
  for (const [structure, coords] of Object.entries(definition.cells ?? {}) as [Exclude<TerrainStructure, "open">, readonly HexCoord[]][]) {
    for (const coord of coords) {
      setPatchCell(baseCells, coord, structure, surfaceForStructure(structure));
    }
  }

  const rotations = Math.max(1, Math.min(6, definition.rotations ?? 1));
  const variants: HexPatchTileVariant[] = [];
  const seen = new Set<string>();
  for (let step = 0; step < rotations; step += 1) {
    const cells = rotateCells(baseCells, step);
    const riverPorts = rotateRiverFlow(definition.riverFlow, step);
    const flowOrientations = definition.riverFlow?.reversible
      ? [riverPorts, reverseRiverPorts(riverPorts)]
      : [riverPorts];
    for (let flowIndex = 0; flowIndex < flowOrientations.length; flowIndex += 1) {
      const orientedPorts = flowOrientations[flowIndex];
      const signature = `${serializeCells(cells)}|${serializeRiverPorts(orientedPorts)}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      const rotationId = rotations === 1 ? definition.id : `${definition.id}.${step}`;
      variants.push(createPatchVariant(
        flowIndex === 0 ? rotationId : `${rotationId}.reverse`,
        definition.family,
        "authored",
        definition.weight,
        cells,
        undefined,
        definition,
        orientedPorts,
      ));
    }
  }
  const groupWeight = definition.selectionGroupWeight ?? definition.weight * variants.length;
  for (const variant of variants) {
    variant.selectionGroupWeight = groupWeight;
  }
  return variants;
}

export function createPatchVariant(
  id: string,
  family: HexPatchFamily,
  provenance: HexPatchProvenance,
  weight: number,
  cells: Map<string, HexPatchCell>,
  procedural?: HexPatchTileVariant["procedural"],
  authored?: Pick<AuthoredPatchDefinition, "selectionGroup" | "selectionGroupWeight" | "topology" | "riverTerminal" | "lakeRole">,
  riverPorts: HexPatchRiverPorts = {},
): HexPatchTileVariant {
  const edges = derivePatchEdges(cells);
  const hydrologyEdges = deriveHydrologyEdgeInfluence(cells);
  const riverExitCount = countEdgesContaining(edges, "river");
  const lakeExitCount = countEdgesContaining(edges, "lake");
  const closedExitCount = countEdgesContaining(edges, "closed");
  const kinds = [riverExitCount > 0 && "river", lakeExitCount > 0 && "lake", closedExitCount > 0 && "wall"].filter(Boolean);

  return {
    id,
    family,
    provenance,
    cells,
    edges,
    weight,
    selectionGroup: authored?.selectionGroup ?? id,
    selectionGroupWeight: authored?.selectionGroupWeight ?? weight,
    topology: authored?.topology ?? "mixed",
    riverTerminal: authored?.riverTerminal,
    riverPorts,
    lakeRole: authored?.lakeRole,
    hydrologyEdges,
    diagnostics: {
      kind: kinds.length > 1 ? "mixed" : kinds[0] === "river" ? "river" : kinds[0] === "lake" ? "lake" : kinds[0] === "wall" ? "wall" : "open",
      riverExitCount,
      lakeExitCount,
      closedExitCount,
    },
    procedural,
  };
}

export function createBaseCells(surface: TerrainSurface = "grass") {
  const cells = new Map<string, HexPatchCell>();
  for (const local of HEX_PATCH_LOCAL_CELLS) {
    cells.set(hexCellKey(local.q, local.r), {
      ...local,
      structure: "open",
      surface,
      edges: microEdges("open"),
    });
  }
  return cells;
}

export function setPatchCell(
  cells: Map<string, HexPatchCell>,
  coord: HexCoord,
  structure: TerrainStructure,
  surface = surfaceForStructure(structure),
) {
  const key = hexCellKey(coord.q, coord.r);
  if (!HEX_PATCH_LOCAL_CELL_KEYS.has(key)) {
    throw new Error(`Patch cell ${key} is outside radius ${HEX_PATCH_RADIUS}`);
  }
  cells.set(key, { ...coord, structure, surface, edges: microEdges(edgeForStructure(structure)) });
}

export function derivePatchEdges(cells: ReadonlyMap<string, HexPatchCell>) {
  const edges = {} as Record<HexDirection, HexPatchEdgeSignature>;
  for (const direction of HEX_DIRECTION_ORDER) {
    edges[direction] = HEX_PATCH_EDGE_CELLS[direction].map((coord) => {
      const cell = cells.get(hexCellKey(coord.q, coord.r));
      return edgeForStructure(cell?.structure ?? "open");
    });
  }
  return edges;
}

export function deriveHydrologyEdgeInfluence(cells: ReadonlyMap<string, Pick<HexPatchCell, "q" | "r" | "structure">>) {
  const influence = {} as Record<HexDirection, HexPatchHydrologyEdgeInfluence>;
  for (const direction of HEX_DIRECTION_ORDER) {
    const nearEdge = [...cells.values()].filter((cell) =>
      HEX_PATCH_EDGE_CELLS[direction].some((edgeCell) => hexDistance(cell, edgeCell) <= 3),
    );
    influence[direction] = {
      river: nearEdge.filter((cell) => cell.structure === "river").map(({ q, r }) => ({ q, r })),
      lake: nearEdge.filter((cell) => cell.structure === "lake").map(({ q, r }) => ({ q, r })),
      cliff: nearEdge.filter((cell) => cell.structure === "wall").map(({ q, r }) => ({ q, r })),
    };
  }
  return influence;
}

export function edgeForStructure(structure: TerrainStructure): HexEdgeKind {
  return structure === "wall" ? "closed" : structure === "river" ? "river" : structure === "lake" ? "lake" : "open";
}

export function structureForEdge(edge: HexEdgeKind): TerrainStructure {
  return edge === "closed" ? "wall" : edge === "river" ? "river" : edge === "lake" ? "lake" : "open";
}

export function surfaceForStructure(structure: TerrainStructure): TerrainSurface {
  return structure === "wall" ? "stone" : structure === "river" ? "mud" : structure === "lake" ? "sand" : structure === "bank" ? "mud" : "grass";
}

function rotateCells(source: ReadonlyMap<string, HexPatchCell>, step: number) {
  const cells = new Map<string, HexPatchCell>();
  for (const cell of source.values()) {
    let q = cell.q;
    let r = cell.r;
    for (let index = 0; index < step; index += 1) {
      [q, r] = [-r, q + r];
    }
    setPatchCell(cells, { q, r }, cell.structure, cell.surface);
  }
  return cells;
}

function serializeCells(cells: ReadonlyMap<string, HexPatchCell>) {
  return HEX_PATCH_LOCAL_CELLS.map((coord) => {
    const cell = cells.get(hexCellKey(coord.q, coord.r));
    return cell ? `${cell.structure}/${cell.surface}` : "missing";
  }).join("|");
}

function countEdgesContaining(edges: Record<HexDirection, HexPatchEdgeSignature>, kind: HexEdgeKind) {
  return HEX_DIRECTION_ORDER.filter((direction) => edges[direction].includes(kind)).length;
}

function microEdges(kind: HexEdgeKind): HexTileSignature {
  return { ne: kind, e: kind, se: kind, sw: kind, w: kind, nw: kind };
}
