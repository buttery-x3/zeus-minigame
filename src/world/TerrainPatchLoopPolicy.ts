import type { TerrainStructure } from "../types";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
import { HEX_PATCH_EDGE_CELLS, type HexPatchTileVariant } from "./HexTerrainPatch";

export type LoopFeature = "wall" | "river";
export type FeaturePatch = HexCoord & { variant: HexPatchTileVariant };
export type ShortFeatureLoop = { feature: LoopFeature; length: number; kind: "closed" | "frontier" };

export const SHORT_LOOP_LIMITS: Readonly<Record<LoopFeature, number>> = {
  wall: 4,
  river: 6,
};

type FeaturePort = { direction: HexDirection; index: number };
type FeatureComponent = { ports: FeaturePort[] };
type FeatureNode = FeatureComponent & { id: string; patch: HexCoord };
type FeatureGraph = {
  nodes: Map<string, FeatureNode>;
  adjacency: Map<string, Set<string>>;
  nodesByPatch: Map<string, FeatureNode[]>;
};

export type FeatureLoopContext = Record<LoopFeature, FeatureGraph>;

const componentCache = new WeakMap<HexPatchTileVariant, Record<LoopFeature, FeatureComponent[]>>();

export function createFeatureLoopContext(patches: Iterable<FeaturePatch>): FeatureLoopContext {
  const committed = [...patches];
  return {
    wall: createFeatureGraph(committed, "wall"),
    river: createFeatureGraph(committed, "river"),
  };
}

export function findShortFeatureLoops(
  context: FeatureLoopContext,
  patch: HexCoord,
  variant: HexPatchTileVariant,
  limits: Readonly<Record<LoopFeature, number>> = SHORT_LOOP_LIMITS,
) {
  const loops: ShortFeatureLoop[] = [];
  for (const feature of ["wall", "river"] as const) {
    const graph = context[feature];
    for (const component of featureComponents(variant, feature)) {
      const contacts = new Map<string, string>();
      for (const port of component.ports) {
        const offset = HEX_DIRECTIONS[port.direction];
        const neighbor = { q: patch.q + offset.q, r: patch.r + offset.r };
        const opposite = OPPOSITE_HEX_DIRECTIONS[port.direction];
        const oppositeIndex = HEX_PATCH_EDGE_CELLS[opposite].length - 1 - port.index;
        const node = graph.nodesByPatch.get(hexCellKey(neighbor.q, neighbor.r))?.find(
          (candidate) => candidate.ports.some((entry) => entry.direction === opposite && entry.index === oppositeIndex),
        );
        if (node) {
          contacts.set(`${port.direction}:${port.index}`, node.id);
        }
      }

      const contactIds = [...contacts.values()];
      let shortest = Number.POSITIVE_INFINITY;
      for (let left = 0; left < contactIds.length; left += 1) {
        for (let right = left + 1; right < contactIds.length; right += 1) {
          const distance = boundedGraphDistance(graph, contactIds[left], contactIds[right], limits[feature] - 1);
          if (distance !== null) {
            shortest = Math.min(shortest, distance + 2);
          }
        }
      }
      if (Number.isFinite(shortest)) {
        loops.push({ feature, length: shortest, kind: "closed" });
      }
    }
  }
  return loops;
}

export function findFrontierShortFeatureLoops(
  committedPatches: Iterable<FeaturePatch>,
  patch: HexCoord,
  variant: HexPatchTileVariant,
  limits: Readonly<Record<LoopFeature, number>> = SHORT_LOOP_LIMITS,
) {
  const committed = [...committedPatches];
  const occupied = new Set(committed.map((entry) => hexCellKey(entry.q, entry.r)));
  occupied.add(hexCellKey(patch.q, patch.r));
  const context = createFeatureLoopContext([...committed, { ...patch, variant }]);
  const loops: ShortFeatureLoop[] = [];

  for (const frontierDirection of HEX_DIRECTION_ORDER) {
    const frontierOffset = HEX_DIRECTIONS[frontierDirection];
    const frontier = { q: patch.q + frontierOffset.q, r: patch.r + frontierOffset.r };
    if (occupied.has(hexCellKey(frontier.q, frontier.r))) {
      continue;
    }
    for (const feature of ["wall", "river"] as const) {
      const graph = context[feature];
      const candidateNodeIds = new Set(
        (graph.nodesByPatch.get(hexCellKey(patch.q, patch.r)) ?? []).map((node) => node.id),
      );
      const contactIds = collectAdjacentContacts(graph, frontier);
      let shortest = Number.POSITIVE_INFINITY;
      for (let left = 0; left < contactIds.length; left += 1) {
        for (let right = left + 1; right < contactIds.length; right += 1) {
          if (!candidateNodeIds.has(contactIds[left]) && !candidateNodeIds.has(contactIds[right])) {
            continue;
          }
          const distance = boundedGraphDistance(graph, contactIds[left], contactIds[right], limits[feature] - 1);
          if (distance !== null) {
            shortest = Math.min(shortest, distance + 2);
          }
        }
      }
      if (Number.isFinite(shortest)) {
        loops.push({ feature, length: shortest, kind: "frontier" });
      }
    }
  }
  return loops;
}

function createFeatureGraph(patches: readonly FeaturePatch[], feature: LoopFeature): FeatureGraph {
  const graph: FeatureGraph = {
    nodes: new Map(),
    adjacency: new Map(),
    nodesByPatch: new Map(),
  };

  for (const patch of patches) {
    const patchKey = hexCellKey(patch.q, patch.r);
    const nodes = featureComponents(patch.variant, feature).map((component, index): FeatureNode => ({
      ...component,
      id: `${feature}:${patchKey}:${index}`,
      patch: { q: patch.q, r: patch.r },
    }));
    graph.nodesByPatch.set(patchKey, nodes);
    for (const node of nodes) {
      graph.nodes.set(node.id, node);
      graph.adjacency.set(node.id, new Set());
    }
  }

  for (const node of graph.nodes.values()) {
    for (const port of node.ports) {
      const offset = HEX_DIRECTIONS[port.direction];
      const neighbor = { q: node.patch.q + offset.q, r: node.patch.r + offset.r };
      const opposite = OPPOSITE_HEX_DIRECTIONS[port.direction];
      const oppositeIndex = HEX_PATCH_EDGE_CELLS[opposite].length - 1 - port.index;
      const neighborNode = graph.nodesByPatch.get(hexCellKey(neighbor.q, neighbor.r))?.find(
        (candidate) => candidate.ports.some((entry) => entry.direction === opposite && entry.index === oppositeIndex),
      );
      if (!neighborNode) {
        continue;
      }
      graph.adjacency.get(node.id)?.add(neighborNode.id);
      graph.adjacency.get(neighborNode.id)?.add(node.id);
    }
  }
  return graph;
}

function collectAdjacentContacts(graph: FeatureGraph, patch: HexCoord) {
  const contacts = new Map<string, string>();
  for (const direction of HEX_DIRECTION_ORDER) {
    const offset = HEX_DIRECTIONS[direction];
    const neighbor = { q: patch.q + offset.q, r: patch.r + offset.r };
    const opposite = OPPOSITE_HEX_DIRECTIONS[direction];
    for (let index = 0; index < HEX_PATCH_EDGE_CELLS[direction].length; index += 1) {
      const oppositeIndex = HEX_PATCH_EDGE_CELLS[opposite].length - 1 - index;
      const node = graph.nodesByPatch.get(hexCellKey(neighbor.q, neighbor.r))?.find(
        (candidate) => candidate.ports.some((entry) => entry.direction === opposite && entry.index === oppositeIndex),
      );
      if (node) {
        contacts.set(`${direction}:${index}`, node.id);
      }
    }
  }
  return [...contacts.values()];
}

function featureComponents(variant: HexPatchTileVariant, feature: LoopFeature) {
  let cached = componentCache.get(variant);
  if (!cached) {
    cached = {
      wall: deriveFeatureComponents(variant, "wall"),
      river: deriveFeatureComponents(variant, "river"),
    };
    componentCache.set(variant, cached);
  }
  return cached[feature];
}

function deriveFeatureComponents(variant: HexPatchTileVariant, feature: LoopFeature) {
  const remaining = new Set(
    [...variant.cells.values()]
      .filter((cell) => cell.structure === feature)
      .map((cell) => hexCellKey(cell.q, cell.r)),
  );
  const components: FeatureComponent[] = [];

  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const memberKeys = new Set([first]);
    const queue = [variant.cells.get(first)!];
    remaining.delete(first);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const key = hexCellKey(current.q + offset.q, current.r + offset.r);
        if (!remaining.has(key)) {
          continue;
        }
        remaining.delete(key);
        memberKeys.add(key);
        queue.push(variant.cells.get(key)!);
      }
    }
    components.push({ ports: boundaryPorts(memberKeys, feature, variant) });
  }
  return components;
}

function boundaryPorts(memberKeys: ReadonlySet<string>, feature: TerrainStructure, variant: HexPatchTileVariant) {
  const ports: FeaturePort[] = [];
  for (const direction of HEX_DIRECTION_ORDER) {
    HEX_PATCH_EDGE_CELLS[direction].forEach((coord, index) => {
      const key = hexCellKey(coord.q, coord.r);
      if (memberKeys.has(key) && variant.cells.get(key)?.structure === feature) {
        ports.push({ direction, index });
      }
    });
  }
  return ports;
}

function boundedGraphDistance(graph: FeatureGraph, start: string, goal: string, limit: number) {
  if (start === goal) {
    return 0;
  }
  const visited = new Set([start]);
  const queue = [{ id: start, distance: 0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.distance >= limit) {
      continue;
    }
    for (const neighbor of graph.adjacency.get(current.id) ?? []) {
      if (neighbor === goal) {
        return current.distance + 1;
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, distance: current.distance + 1 });
      }
    }
  }
  return null;
}
