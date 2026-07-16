import type { HexPatchTileVariant } from "./HexTerrainPatch";
import {
  HEX_DIRECTIONS,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";

type RiverFlowPatch = HexCoord & { variant: HexPatchTileVariant };

export type RiverFlowViolation = {
  kind: "mismatch" | "cycle";
  patch: HexCoord & { variantId: string };
  direction: HexDirection;
  neighbor: HexCoord & { variantId: string };
};

export function authoredRiverFlowsCanNeighbor(
  variant: HexPatchTileVariant,
  direction: HexDirection,
  neighbor: HexPatchTileVariant,
) {
  if (variant.provenance === "procedural" || neighbor.provenance === "procedural") {
    return true;
  }
  if (!hasRiverConnection(variant, direction, neighbor)) {
    return true;
  }

  const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
  const port = variant.riverPorts[direction];
  const neighborPort = neighbor.riverPorts[opposite];
  return Boolean(port && neighborPort && port !== neighborPort);
}

export function createsCommittedAuthoredRiverCycle(
  patch: HexCoord,
  variant: HexPatchTileVariant,
  committedPatches: ReadonlyMap<string, RiverFlowPatch>,
) {
  if (variant.provenance === "procedural") {
    return false;
  }
  const upstreamKeys = connectedNeighbors(patch, variant, "input", committedPatches)
    .map(({ neighbor }) => hexCellKey(neighbor.q, neighbor.r));
  const downstream = connectedNeighbors(patch, variant, "output", committedPatches)[0]?.neighbor;
  if (!downstream || upstreamKeys.length === 0) {
    return false;
  }

  const targets = new Set(upstreamKeys);
  const visited = new Set<string>();
  let current: RiverFlowPatch | undefined = downstream;
  while (current) {
    const key = hexCellKey(current.q, current.r);
    if (targets.has(key) || visited.has(key)) {
      return true;
    }
    visited.add(key);
    current = outgoingEdges(current, committedPatches)[0]?.neighbor;
  }
  return false;
}

export function findCommittedRiverFlowViolation(patches: Iterable<RiverFlowPatch>): RiverFlowViolation | null {
  const byKey = new Map<string, RiverFlowPatch>();
  for (const patch of patches) {
    byKey.set(hexCellKey(patch.q, patch.r), patch);
  }

  for (const patch of byKey.values()) {
    for (const direction of ["ne", "e", "se"] as const) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = byKey.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
      if (
        neighbor &&
        hasRiverConnection(patch.variant, direction, neighbor.variant) &&
        !authoredRiverFlowsCanNeighbor(patch.variant, direction, neighbor.variant)
      ) {
        return violation("mismatch", patch, direction, neighbor);
      }
    }
  }
  return findCycle(byKey);
}

function findCycle(patches: ReadonlyMap<string, RiverFlowPatch>): RiverFlowViolation | null {
  const state = new Map<string, "visiting" | "visited">();
  const visit = (patch: RiverFlowPatch): RiverFlowViolation | null => {
    const key = hexCellKey(patch.q, patch.r);
    state.set(key, "visiting");
    for (const edge of outgoingEdges(patch, patches)) {
      const neighborKey = hexCellKey(edge.neighbor.q, edge.neighbor.r);
      if (state.get(neighborKey) === "visiting") {
        return violation("cycle", patch, edge.direction, edge.neighbor);
      }
      if (state.get(neighborKey) !== "visited") {
        const nested = visit(edge.neighbor);
        if (nested) {
          return nested;
        }
      }
    }
    state.set(key, "visited");
    return null;
  };

  for (const patch of patches.values()) {
    if (patch.variant.provenance === "authored" && !state.has(hexCellKey(patch.q, patch.r))) {
      const cycle = visit(patch);
      if (cycle) {
        return cycle;
      }
    }
  }
  return null;
}

function outgoingEdges(patch: RiverFlowPatch, patches: ReadonlyMap<string, RiverFlowPatch>) {
  const edges: { direction: HexDirection; neighbor: RiverFlowPatch }[] = [];
  for (const [direction, port] of Object.entries(patch.variant.riverPorts) as [HexDirection, string][]) {
    if (port !== "output") {
      continue;
    }
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = patches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
    if (
      neighbor?.variant.provenance === "authored" &&
      neighbor.variant.riverPorts[OPPOSITE_HEX_DIRECTIONS[direction]] === "input" &&
      hasRiverConnection(patch.variant, direction, neighbor.variant)
    ) {
      edges.push({ direction, neighbor });
    }
  }
  return edges;
}

function connectedNeighbors(
  patch: HexCoord,
  variant: HexPatchTileVariant,
  portKind: "input" | "output",
  patches: ReadonlyMap<string, RiverFlowPatch>,
) {
  const matches: { direction: HexDirection; neighbor: RiverFlowPatch }[] = [];
  for (const [direction, port] of Object.entries(variant.riverPorts) as [HexDirection, string][]) {
    if (port !== portKind) {
      continue;
    }
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = patches.get(hexCellKey(patch.q + offset.q, patch.r + offset.r));
    const requiredNeighborPort = portKind === "input" ? "output" : "input";
    if (
      neighbor?.variant.provenance === "authored" &&
      neighbor.variant.riverPorts[OPPOSITE_HEX_DIRECTIONS[direction]] === requiredNeighborPort &&
      hasRiverConnection(variant, direction, neighbor.variant)
    ) {
      matches.push({ direction, neighbor });
    }
  }
  return matches;
}

function hasRiverConnection(variant: HexPatchTileVariant, direction: HexDirection, neighbor: HexPatchTileVariant) {
  const edge = variant.edges[direction];
  const neighborEdge = neighbor.edges[OPPOSITE_HEX_DIRECTIONS[direction]];
  return edge.some((kind, index) => kind === "river" && neighborEdge[neighborEdge.length - 1 - index] === "river");
}

function violation(
  kind: RiverFlowViolation["kind"],
  patch: RiverFlowPatch,
  direction: HexDirection,
  neighbor: RiverFlowPatch,
): RiverFlowViolation {
  return {
    kind,
    patch: { q: patch.q, r: patch.r, variantId: patch.variant.id },
    direction,
    neighbor: { q: neighbor.q, r: neighbor.r, variantId: neighbor.variant.id },
  };
}
