import type { TerrainStructure } from "../types";
import {
  HEX_DIRECTIONS,
  HEX_DIRECTION_ORDER,
  OPPOSITE_HEX_DIRECTIONS,
  hexCellKey,
  hexDistance,
  type HexCoord,
  type HexDirection,
} from "./hexCoordinates";
import { HEX_PATCH_EDGE_CELLS, patchLocalToWorld } from "./HexTerrainPatch";
import type { GeneratedTerrainInspectionSnapshot, GeneratedTerrainPatchInspection } from "./TerrainInspectionSnapshot";

type FeatureStructure = Extract<TerrainStructure, "wall" | "river" | "lake">;

export type TerrainFeatureNode = {
  id: string;
  patch: HexCoord;
  componentId: string;
  structure: FeatureStructure;
  provenance: "authored" | "procedural";
  boundaryPorts: readonly { direction: HexDirection; index: number }[];
  riverTerminal?: "lake" | "cliff";
};

export type TerrainFeatureEdge = {
  id: string;
  kind: "continuation" | "contact" | "river-flow";
  a: string;
  b: string;
  direction?: HexDirection;
  flow?: { from: string; to: string };
};

export type TerrainNetworkIssueKind =
  | "river-flow-mismatch"
  | "river-flow-unknown"
  | "river-cycle"
  | "river-no-source"
  | "river-no-sink"
  | "junction-obligation"
  | "lake-mouth-count"
  | "lake-mouth-review"
  | "disconnected-boundary"
  | "missed-cliff-connection";

export type TerrainNetworkIssue = {
  id: string;
  kind: TerrainNetworkIssueKind;
  severity: "error" | "warning" | "info";
  message: string;
  patches: HexCoord[];
  nodeIds: string[];
};

export type TerrainRiverNetwork = {
  id: string;
  nodeIds: string[];
  sourceCount: number;
  sinkCount: number;
  frontierPortCount: number;
  terminalCount: number;
  junctionCount: number;
};

export type TerrainLakeNetwork = {
  id: string;
  nodeIds: string[];
  mouthCount: number;
};

export type TerrainFeatureNetwork = {
  nodes: TerrainFeatureNode[];
  edges: TerrainFeatureEdge[];
  issues: TerrainNetworkIssue[];
  riverNetworks: TerrainRiverNetwork[];
  lakeNetworks: TerrainLakeNetwork[];
  frontierPortCount: number;
};

export function analyzeTerrainFeatureNetwork(
  snapshot: GeneratedTerrainInspectionSnapshot,
  options: { lakeMouthReviewThreshold?: number } = {},
): TerrainFeatureNetwork {
  const patchByKey = new Map(snapshot.patches.map((patch) => [hexCellKey(patch.q, patch.r), patch]));
  const nodes = createNodes(snapshot.patches);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeByComponent = new Map(nodes.map((node) => [`${hexCellKey(node.patch.q, node.patch.r)}/${node.componentId}`, node]));
  const edges: TerrainFeatureEdge[] = [];
  const issues: TerrainNetworkIssue[] = [];
  const edgeKeys = new Set<string>();
  let frontierPortCount = 0;

  for (const node of nodes) {
    for (const port of node.boundaryPorts) {
      const offset = HEX_DIRECTIONS[port.direction];
      const neighborPatch = patchByKey.get(hexCellKey(node.patch.q + offset.q, node.patch.r + offset.r));
      if (!neighborPatch) {
        frontierPortCount += 1;
        continue;
      }
      const opposite = OPPOSITE_HEX_DIRECTIONS[port.direction];
      const oppositeIndex = HEX_PATCH_EDGE_CELLS[opposite].length - 1 - port.index;
      const neighborComponent = neighborPatch.variant.analysis.components.find((component) =>
        component.structure === node.structure
        && component.boundaryPorts.some((candidate) => candidate.direction === opposite && candidate.index === oppositeIndex),
      );
      if (!neighborComponent) continue;
      const neighborNode = nodeByComponent.get(`${hexCellKey(neighborPatch.q, neighborPatch.r)}/${neighborComponent.id}`);
      if (!neighborNode) continue;
      const pairKey = [node.id, neighborNode.id].sort().join("|");
      if (!edgeKeys.has(`continuation:${pairKey}`)) {
        edges.push({ id: `continuation:${pairKey}`, kind: "continuation", a: node.id, b: neighborNode.id, direction: port.direction });
        edgeKeys.add(`continuation:${pairKey}`);
      }
      if (node.structure === "river") addRiverFlowEdge(node, neighborNode, port.direction, patchByKey, edges, edgeKeys, issues);
    }
  }

  for (const patch of snapshot.patches) {
    for (const contact of patch.variant.analysis.contacts) {
      if (![contact.structureA, contact.structureB].some((structure) => isFeature(structure))) continue;
      const a = nodeByComponent.get(`${hexCellKey(patch.q, patch.r)}/${contact.componentA}`);
      const b = nodeByComponent.get(`${hexCellKey(patch.q, patch.r)}/${contact.componentB}`);
      if (!a || !b) continue;
      const pairKey = [a.id, b.id].sort().join("|");
      if (edgeKeys.has(`contact:${pairKey}`)) continue;
      edges.push({ id: `contact:${pairKey}`, kind: "contact", a: a.id, b: b.id });
      edgeKeys.add(`contact:${pairKey}`);
    }
    for (const structure of patch.variant.analysis.disconnectedBoundaryStructures) {
      if (!isFeature(structure)) continue;
      const affected = nodes.filter((node) => node.patch.q === patch.q && node.patch.r === patch.r && node.structure === structure);
      issues.push(issue("disconnected-boundary", "error", `${structureLabel(structure)} boundary arms are internally disconnected in patch ${patch.q},${patch.r}.`, [patch], affected));
    }
  }

  const riverNetworks = buildRiverNetworks(nodes, edges, patchByKey, issues);
  const lakeNetworks = buildLakeNetworks(nodes, edges, issues, options.lakeMouthReviewThreshold ?? 3);
  issues.push(...findMissedCliffConnections(snapshot, nodes, edges));
  issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { nodes, edges, issues: dedupeIssues(issues), riverNetworks, lakeNetworks, frontierPortCount };
}

function createNodes(patches: readonly GeneratedTerrainPatchInspection[]) {
  return patches.flatMap((patch) => patch.variant.analysis.components
    .filter((component) => isFeature(component.structure))
    .map((component): TerrainFeatureNode => ({
      id: `${patch.q},${patch.r}/${component.id}`,
      patch: { q: patch.q, r: patch.r },
      componentId: component.id,
      structure: component.structure as FeatureStructure,
      provenance: patch.variant.provenance,
      boundaryPorts: component.boundaryPorts.map((port) => ({ direction: port.direction, index: port.index })),
      riverTerminal: component.structure === "river" ? patch.variant.riverTerminal : undefined,
    })));
}

function addRiverFlowEdge(
  node: TerrainFeatureNode,
  neighbor: TerrainFeatureNode,
  direction: HexDirection,
  patches: ReadonlyMap<string, GeneratedTerrainPatchInspection>,
  edges: TerrainFeatureEdge[],
  edgeKeys: Set<string>,
  issues: TerrainNetworkIssue[],
) {
  const patch = patches.get(hexCellKey(node.patch.q, node.patch.r))!;
  const neighborPatch = patches.get(hexCellKey(neighbor.patch.q, neighbor.patch.r))!;
  const aRole = patch.variant.riverPorts[direction];
  const bRole = neighborPatch.variant.riverPorts[OPPOSITE_HEX_DIRECTIONS[direction]];
  const pairKey = [node.id, neighbor.id].sort().join("|");
  if (!aRole || !bRole) {
    if (node.provenance === "procedural" || neighbor.provenance === "procedural") {
      issues.push(issue("river-flow-unknown", "info", `River flow is unspecified across ${node.patch.q},${node.patch.r} and ${neighbor.patch.q},${neighbor.patch.r}.`, [node.patch, neighbor.patch], [node, neighbor]));
    }
    return;
  }
  if (aRole === bRole) {
    issues.push(issue("river-flow-mismatch", "error", `River seam joins two ${aRole} ports between ${node.patch.q},${node.patch.r} and ${neighbor.patch.q},${neighbor.patch.r}.`, [node.patch, neighbor.patch], [node, neighbor]));
    return;
  }
  if (edgeKeys.has(`river-flow:${pairKey}`)) return;
  const from = aRole === "output" ? node.id : neighbor.id;
  const to = aRole === "output" ? neighbor.id : node.id;
  edges.push({ id: `river-flow:${pairKey}`, kind: "river-flow", a: node.id, b: neighbor.id, direction, flow: { from, to } });
  edgeKeys.add(`river-flow:${pairKey}`);
}

function buildRiverNetworks(
  nodes: readonly TerrainFeatureNode[],
  edges: readonly TerrainFeatureEdge[],
  patches: ReadonlyMap<string, GeneratedTerrainPatchInspection>,
  issues: TerrainNetworkIssue[],
) {
  const riverNodes = nodes.filter((node) => node.structure === "river");
  const groups = connectedGroups(riverNodes, edges.filter((edge) => edge.kind === "continuation"));
  return groups.map((group, index): TerrainRiverNetwork => {
    const ids = new Set(group.map((node) => node.id));
    const flowEdges = edges.filter((edge) => edge.kind === "river-flow" && edge.flow && ids.has(edge.flow.from) && ids.has(edge.flow.to));
    const incoming = new Map(group.map((node) => [node.id, 0]));
    const outgoing = new Map(group.map((node) => [node.id, 0]));
    flowEdges.forEach((edge) => {
      outgoing.set(edge.flow!.from, (outgoing.get(edge.flow!.from) ?? 0) + 1);
      incoming.set(edge.flow!.to, (incoming.get(edge.flow!.to) ?? 0) + 1);
    });
    const sourceCount = group.filter((node) => (outgoing.get(node.id) ?? 0) > 0 && (incoming.get(node.id) ?? 0) === 0).length;
    const sinkCount = group.filter((node) => (incoming.get(node.id) ?? 0) > 0 && (outgoing.get(node.id) ?? 0) === 0).length;
    const terminalCount = group.filter((node) => Boolean(node.riverTerminal)).length;
    const junctionCount = group.filter((node) => node.boundaryPorts.length >= 3).length;
    const frontierPortCount = group.reduce((count, node) => count + node.boundaryPorts.filter((port) => {
      const offset = HEX_DIRECTIONS[port.direction];
      return !patches.has(hexCellKey(node.patch.q + offset.q, node.patch.r + offset.r));
    }).length, 0);
    if (flowEdges.length > 0 && sourceCount === 0 && frontierPortCount === 0) issues.push(issue("river-no-source", "error", `River network ${index + 1} has no source.`, group.map((node) => node.patch), group));
    if (flowEdges.length > 0 && sinkCount === 0 && terminalCount === 0 && frontierPortCount === 0) issues.push(issue("river-no-sink", "error", `River network ${index + 1} has no sink or valid terminal.`, group.map((node) => node.patch), group));
    const cycle = findDirectedCycle(group, flowEdges);
    if (cycle.length > 0) issues.push(issue("river-cycle", "error", `River network ${index + 1} contains a directed cycle.`, cycle.map((id) => nodePatch(nodes, id)), cycle.map((id) => nodes.find((node) => node.id === id)!).filter(Boolean)));
    for (const node of group.filter((candidate) => candidate.boundaryPorts.length >= 3)) {
      if ((outgoing.get(node.id) ?? 0) === 0 && !node.riverTerminal) issues.push(issue("junction-obligation", "warning", `River junction at ${node.patch.q},${node.patch.r} has no resolved output.`, [node.patch], [node]));
    }
    return { id: `river-network-${index + 1}`, nodeIds: [...ids], sourceCount, sinkCount, frontierPortCount, terminalCount, junctionCount };
  });
}

function buildLakeNetworks(nodes: readonly TerrainFeatureNode[], edges: readonly TerrainFeatureEdge[], issues: TerrainNetworkIssue[], threshold: number) {
  const lakeNodes = nodes.filter((node) => node.structure === "lake");
  const groups = connectedGroups(lakeNodes, edges.filter((edge) => edge.kind === "continuation"));
  return groups.map((group, index): TerrainLakeNetwork => {
    const ids = new Set(group.map((node) => node.id));
    const riverContacts = new Set(edges.filter((edge) => edge.kind === "contact" && (ids.has(edge.a) || ids.has(edge.b)))
      .map((edge) => ids.has(edge.a) ? edge.b : edge.a)
      .filter((id) => nodes.find((node) => node.id === id)?.structure === "river"));
    const mouthCount = riverContacts.size;
    issues.push(issue("lake-mouth-count", "info", `Lake network ${index + 1} has ${mouthCount} river mouth${mouthCount === 1 ? "" : "s"}.`, group.map((node) => node.patch), group));
    if (mouthCount > threshold) issues.push(issue("lake-mouth-review", "warning", `Lake network ${index + 1} exceeds the review threshold with ${mouthCount} mouths.`, group.map((node) => node.patch), group));
    return { id: `lake-network-${index + 1}`, nodeIds: [...ids], mouthCount };
  });
}

function findMissedCliffConnections(snapshot: GeneratedTerrainInspectionSnapshot, nodes: readonly TerrainFeatureNode[], edges: readonly TerrainFeatureEdge[]) {
  const rivers = snapshot.patches.flatMap((patch) => patch.variant.cells.filter((cell) => cell.structure === "river").map((cell) => ({ patch, world: patchLocalToWorld(patch, cell) })));
  const walls = snapshot.patches.flatMap((patch) => patch.variant.cells.filter((cell) => cell.structure === "wall").map((cell) => ({ patch, world: patchLocalToWorld(patch, cell) })));
  const existingContacts = new Set(edges.filter((edge) => edge.kind === "contact").flatMap((edge) => [edge.a, edge.b]));
  const seen = new Set<string>();
  const issues: TerrainNetworkIssue[] = [];
  for (const river of rivers) {
    const nearby = walls.find((wall) => hexDistance(river.world, wall.world) === 2);
    if (!nearby) continue;
    const key = [hexCellKey(river.patch.q, river.patch.r), hexCellKey(nearby.patch.q, nearby.patch.r)].sort().join("|");
    if (seen.has(key)) continue;
    const relevant = nodes.filter((node) => (samePatch(node.patch, river.patch) && node.structure === "river") || (samePatch(node.patch, nearby.patch) && node.structure === "wall"));
    if (relevant.some((node) => existingContacts.has(node.id))) continue;
    seen.add(key);
    issues.push(issue("missed-cliff-connection", "warning", `River near ${river.patch.q},${river.patch.r} passes within two cells of a cliff without a terminal contact.`, [river.patch, nearby.patch], relevant));
  }
  return issues;
}

function connectedGroups(nodes: readonly TerrainFeatureNode[], edges: readonly TerrainFeatureEdge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  edges.forEach((edge) => {
    if (!byId.has(edge.a) || !byId.has(edge.b)) return;
    adjacent.get(edge.a)!.add(edge.b);
    adjacent.get(edge.b)!.add(edge.a);
  });
  const remaining = new Set(byId.keys());
  const groups: TerrainFeatureNode[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const queue = [first];
    const group: TerrainFeatureNode[] = [];
    remaining.delete(first);
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      group.push(byId.get(id)!);
      adjacent.get(id)?.forEach((neighbor) => { if (remaining.delete(neighbor)) queue.push(neighbor); });
    }
    groups.push(group);
  }
  return groups;
}

function findDirectedCycle(nodes: readonly TerrainFeatureNode[], edges: readonly TerrainFeatureEdge[]) {
  const adjacent = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => { if (edge.flow) adjacent.get(edge.flow.from)?.push(edge.flow.to); });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): string[] => {
    if (visiting.has(id)) return stack.slice(stack.indexOf(id));
    if (visited.has(id)) return [];
    visiting.add(id);
    stack.push(id);
    for (const next of adjacent.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle.length > 0) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return [];
  };
  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle.length > 0) return cycle;
  }
  return [];
}

function issue(kind: TerrainNetworkIssueKind, severity: TerrainNetworkIssue["severity"], message: string, patches: readonly Pick<HexCoord, "q" | "r">[], nodes: readonly TerrainFeatureNode[]) {
  const uniquePatches = [...new Map(patches.map((patch) => [hexCellKey(patch.q, patch.r), { q: patch.q, r: patch.r }])).values()];
  const nodeIds = [...new Set(nodes.map((node) => node.id))].sort();
  return { id: `${kind}:${uniquePatches.map((patch) => hexCellKey(patch.q, patch.r)).sort().join(";")}:${nodeIds.join(";")}`, kind, severity, message, patches: uniquePatches, nodeIds } satisfies TerrainNetworkIssue;
}

function dedupeIssues(issues: readonly TerrainNetworkIssue[]) {
  return [...new Map(issues.map((entry) => [entry.id, entry])).values()];
}

function isFeature(structure: TerrainStructure): structure is FeatureStructure {
  return structure === "wall" || structure === "river" || structure === "lake";
}

function structureLabel(structure: FeatureStructure) {
  return structure === "wall" ? "Cliff" : structure[0].toUpperCase() + structure.slice(1);
}

function samePatch(a: HexCoord, b: HexCoord) {
  return a.q === b.q && a.r === b.r;
}

function nodePatch(nodes: readonly TerrainFeatureNode[], id: string) {
  return nodes.find((node) => node.id === id)?.patch ?? { q: 0, r: 0 };
}

function severityRank(severity: TerrainNetworkIssue["severity"]) {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}
