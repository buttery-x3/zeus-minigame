import type { HexEdgeKind, HexTileSignature, TerrainStructure, TerrainSurface } from "../types";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  hexCellKey,
  hexDistance,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";

export const HEX_PATCH_RADIUS = 2;
export const HEX_PATCH_EDGE_LENGTH = HEX_PATCH_RADIUS + 1;

export type HexPatchEdgeSignature = HexEdgeKind[];

export type HexPatchCell = HexCoord & {
  structure: TerrainStructure;
  surface: TerrainSurface;
  edges: HexTileSignature;
};

export type HexPatchTileVariant = {
  id: string;
  cells: Map<string, HexPatchCell>;
  edges: Record<HexDirection, HexPatchEdgeSignature>;
  weight: number;
  diagnostics: {
    kind: "open" | "wall" | "river";
    riverExitCount: number;
    closedExitCount: number;
  };
};

const PATCH_E_VECTOR: HexCoord = { q: 5, r: -2 };
const PATCH_SE_VECTOR: HexCoord = { q: 2, r: 3 };

export const HEX_PATCH_LOCAL_CELLS: HexCoord[] = createPatchLocalCells();

export const HEX_PATCH_EDGE_CELLS: Record<HexDirection, HexCoord[]> = {
  ne: [
    { q: 0, r: -2 },
    { q: 1, r: -2 },
    { q: 2, r: -2 },
  ],
  e: [
    { q: 2, r: -2 },
    { q: 2, r: -1 },
    { q: 2, r: 0 },
  ],
  se: [
    { q: 2, r: 0 },
    { q: 1, r: 1 },
    { q: 0, r: 2 },
  ],
  sw: [
    { q: 0, r: 2 },
    { q: -1, r: 2 },
    { q: -2, r: 2 },
  ],
  w: [
    { q: -2, r: 2 },
    { q: -2, r: 1 },
    { q: -2, r: 0 },
  ],
  nw: [
    { q: -2, r: 0 },
    { q: -1, r: -1 },
    { q: 0, r: -2 },
  ],
};

export function createHexPatchTileCatalog(): readonly HexPatchTileVariant[] {
  const variants: HexPatchTileVariant[] = [
    createPatchVariant("patch.open.grass", allPatchEdges("open"), 28),
    createPatchVariant("patch.open.dirt", allPatchEdges("open"), 10, "dirt"),
    createPatchVariant("patch.wall.core", allPatchEdges("closed"), 2),
  ];

  addRotations(variants, "patch.wall.edge", withPatchEdges("open", { ne: edgeWithCenter("closed") }), 3);
  addRotations(
    variants,
    "patch.wall.corner",
    withPatchEdges("open", { ne: edgeWithCenter("closed"), e: edgeWithCenter("closed") }),
    2,
  );
  addRotations(
    variants,
    "patch.river.source",
    withPatchEdges("open", { ne: edgeWithCenter("river") }),
    4,
  );
  addRotations(
    variants,
    "patch.river.line",
    withPatchEdges("open", { ne: edgeWithCenter("river"), sw: edgeWithCenter("river") }),
    14,
  );
  addRotations(
    variants,
    "patch.river.bend",
    withPatchEdges("open", { ne: edgeWithCenter("river"), e: edgeWithCenter("river") }),
    10,
  );
  addRotations(
    variants,
    "patch.river.fork",
    withPatchEdges("open", { ne: edgeWithCenter("river"), e: edgeWithCenter("river"), sw: edgeWithCenter("river") }),
    3,
  );

  return variants;
}

export function patchCoordToWorld(patch: HexCoord): HexCoord {
  return {
    q: patch.q * PATCH_E_VECTOR.q + patch.r * PATCH_SE_VECTOR.q,
    r: patch.q * PATCH_E_VECTOR.r + patch.r * PATCH_SE_VECTOR.r,
  };
}

export function patchLocalToWorld(patch: HexCoord, local: HexCoord): HexCoord {
  const origin = patchCoordToWorld(patch);
  return { q: origin.q + local.q, r: origin.r + local.r };
}

export function createHexPatchRegion(radius: number): HexCoord[] {
  const cells: HexCoord[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    const minR = Math.max(-radius, -q - radius);
    const maxR = Math.min(radius, -q + radius);
    for (let r = minR; r <= maxR; r += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
}

function addRotations(
  variants: HexPatchTileVariant[],
  id: string,
  edges: Record<HexDirection, HexPatchEdgeSignature>,
  weight: number,
) {
  for (let step = 0; step < HEX_DIRECTION_ORDER.length; step += 1) {
    variants.push(createPatchVariant(`${id}.${step}`, rotatePatchEdges(edges, step), weight));
  }
}

function createPatchVariant(
  id: string,
  edges: Record<HexDirection, HexPatchEdgeSignature>,
  weight: number,
  openSurface: TerrainSurface = "grass",
): HexPatchTileVariant {
  const cells = new Map<string, HexPatchCell>();
  for (const local of HEX_PATCH_LOCAL_CELLS) {
    cells.set(hexCellKey(local.q, local.r), {
      ...local,
      structure: "open",
      surface: openSurface,
      edges: microEdges("open"),
    });
  }

  const closedExitCount = countEdgeKind(edges, "closed");
  if (closedExitCount >= HEX_DIRECTION_ORDER.length * HEX_PATCH_EDGE_LENGTH) {
    for (const local of HEX_PATCH_LOCAL_CELLS) {
      cells.set(hexCellKey(local.q, local.r), {
        ...local,
        structure: "wall",
        surface: "stone",
        edges: microEdges("closed"),
      });
    }
  } else {
    applyClosedEdges(cells, edges);
    applyRiverEdges(cells, edges);
  }

  const riverExitCount = HEX_DIRECTION_ORDER.filter((direction) => edges[direction].includes("river")).length;
  return {
    id,
    cells,
    edges,
    weight,
    diagnostics: {
      kind: riverExitCount > 0 ? "river" : closedExitCount > 0 ? "wall" : "open",
      riverExitCount,
      closedExitCount,
    },
  };
}

function applyClosedEdges(cells: Map<string, HexPatchCell>, edges: Record<HexDirection, HexPatchEdgeSignature>) {
  for (const direction of HEX_DIRECTION_ORDER) {
    edges[direction].forEach((kind, index) => {
      if (kind !== "closed") {
        return;
      }
      const local = HEX_PATCH_EDGE_CELLS[direction][index];
      cells.set(hexCellKey(local.q, local.r), {
        ...local,
        structure: "wall",
        surface: "stone",
        edges: microEdges("closed"),
      });
    });
  }
}

function applyRiverEdges(cells: Map<string, HexPatchCell>, edges: Record<HexDirection, HexPatchEdgeSignature>) {
  const exits = HEX_DIRECTION_ORDER.flatMap((direction) =>
    edges[direction].map((kind, index) => ({ direction, index, kind })).filter((entry) => entry.kind === "river"),
  ).slice(0, 3);

  if (exits.length === 0) {
    return;
  }

  const center = { q: 0, r: 0 };
  markRiver(cells, center);
  for (const exit of exits) {
    const edgeCell = HEX_PATCH_EDGE_CELLS[exit.direction][exit.index];
    for (const local of lineLocalCells(center, edgeCell)) {
      markRiver(cells, local);
    }
  }
}

function markRiver(cells: Map<string, HexPatchCell>, local: HexCoord) {
  cells.set(hexCellKey(local.q, local.r), {
    ...local,
    structure: "river",
    surface: "mud",
    edges: microEdges("river"),
  });
}

function lineLocalCells(from: HexCoord, to: HexCoord) {
  const distance = hexDistance(from, to);
  const cells: HexCoord[] = [];
  let previousKey = "";
  for (let step = 0; step <= distance; step += 1) {
    const amount = distance === 0 ? 0 : step / distance;
    const rounded = roundAxial(lerp(from.q, to.q, amount), lerp(from.r, to.r, amount));
    const key = hexCellKey(rounded.q, rounded.r);
    if (key !== previousKey) {
      cells.push(rounded);
      previousKey = key;
    }
  }
  return cells;
}

function allPatchEdges(kind: HexEdgeKind): Record<HexDirection, HexPatchEdgeSignature> {
  return {
    ne: edge(kind),
    e: edge(kind),
    se: edge(kind),
    sw: edge(kind),
    w: edge(kind),
    nw: edge(kind),
  };
}

function withPatchEdges(
  kind: HexEdgeKind,
  overrides: Partial<Record<HexDirection, HexPatchEdgeSignature>>,
): Record<HexDirection, HexPatchEdgeSignature> {
  return { ...allPatchEdges(kind), ...overrides };
}

function edge(kind: HexEdgeKind): HexPatchEdgeSignature {
  return Array.from({ length: HEX_PATCH_EDGE_LENGTH }, () => kind);
}

function edgeWithCenter(kind: HexEdgeKind): HexPatchEdgeSignature {
  return ["open", kind, "open"];
}

function rotatePatchEdges(edges: Record<HexDirection, HexPatchEdgeSignature>, step: number) {
  const rotated = allPatchEdges("open");
  for (let index = 0; index < HEX_DIRECTION_ORDER.length; index += 1) {
    const from = HEX_DIRECTION_ORDER[index];
    const to = HEX_DIRECTION_ORDER[(index + step) % HEX_DIRECTION_ORDER.length];
    rotated[to] = edges[from];
  }
  return rotated;
}

function microEdges(kind: HexEdgeKind): HexTileSignature {
  return {
    ne: kind,
    e: kind,
    se: kind,
    sw: kind,
    w: kind,
    nw: kind,
  };
}

function countEdgeKind(edges: Record<HexDirection, HexPatchEdgeSignature>, kind: HexEdgeKind) {
  return HEX_DIRECTION_ORDER.reduce((sum, direction) => sum + edges[direction].filter((edgeKind) => edgeKind === kind).length, 0);
}

function createPatchLocalCells() {
  const cells: HexCoord[] = [];
  for (let q = -HEX_PATCH_RADIUS; q <= HEX_PATCH_RADIUS; q += 1) {
    const minR = Math.max(-HEX_PATCH_RADIUS, -q - HEX_PATCH_RADIUS);
    const maxR = Math.min(HEX_PATCH_RADIUS, -q + HEX_PATCH_RADIUS);
    for (let r = minR; r <= maxR; r += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
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
