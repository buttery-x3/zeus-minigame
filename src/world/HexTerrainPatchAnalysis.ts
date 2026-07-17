import type { TerrainStructure } from "../types";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, type HexCoord, type HexDirection } from "./hexCoordinates";
import { HEX_PATCH_EDGE_CELLS, type HexPatchTileVariant } from "./HexTerrainPatch";
import { validateHexPatchVariant } from "./HexTerrainPatchValidation";

export type TerrainPatchBoundaryPort = {
  direction: HexDirection;
  index: number;
  cell: HexCoord;
};

export type TerrainPatchComponent = {
  id: string;
  structure: TerrainStructure;
  cells: readonly HexCoord[];
  boundaryPorts: readonly TerrainPatchBoundaryPort[];
  boundaryDirections: readonly HexDirection[];
};

export type TerrainPatchContact = {
  componentA: string;
  componentB: string;
  structureA: TerrainStructure;
  structureB: TerrainStructure;
  edges: readonly { a: HexCoord; b: HexCoord }[];
};

export type TerrainPatchAnalysis = {
  components: readonly TerrainPatchComponent[];
  contacts: readonly TerrainPatchContact[];
  disconnectedBoundaryStructures: readonly TerrainStructure[];
  warnings: readonly string[];
};

export function analyzeHexPatchVariant(variant: HexPatchTileVariant): TerrainPatchAnalysis {
  const components = deriveComponents(variant);
  const contacts = deriveContacts(variant, components);
  const disconnectedBoundaryStructures = [...new Set(
    components
      .filter((component) => component.boundaryPorts.length > 0)
      .map((component) => component.structure)
      .filter((structure, _index, structures) => structures.filter((entry) => entry === structure).length > 1),
  )];
  return {
    components,
    contacts,
    disconnectedBoundaryStructures,
    warnings: deriveWarnings(variant, components),
  };
}

function deriveComponents(variant: HexPatchTileVariant) {
  const remaining = new Set(variant.cells.keys());
  const components: TerrainPatchComponent[] = [];
  const counts = new Map<TerrainStructure, number>();

  while (remaining.size > 0) {
    const firstKey = remaining.values().next().value as string;
    const first = variant.cells.get(firstKey)!;
    const queue = [first];
    const cells: HexCoord[] = [];
    remaining.delete(firstKey);
    for (let index = 0; index < queue.length; index += 1) {
      const cell = queue[index];
      cells.push({ q: cell.q, r: cell.r });
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const key = hexCellKey(cell.q + offset.q, cell.r + offset.r);
        const neighbor = variant.cells.get(key);
        if (neighbor?.structure === first.structure && remaining.delete(key)) {
          queue.push(neighbor);
        }
      }
    }
    cells.sort((a, b) => a.q - b.q || a.r - b.r);
    const sequence = (counts.get(first.structure) ?? 0) + 1;
    counts.set(first.structure, sequence);
    const boundaryPorts = findBoundaryPorts(cells);
    components.push({
      id: `${first.structure}-${sequence}`,
      structure: first.structure,
      cells,
      boundaryPorts,
      boundaryDirections: HEX_DIRECTION_ORDER.filter((direction) =>
        boundaryPorts.some((port) => port.direction === direction),
      ),
    });
  }

  return components.sort((a, b) => a.structure.localeCompare(b.structure) || a.id.localeCompare(b.id));
}

function findBoundaryPorts(cells: readonly HexCoord[]) {
  const keys = new Set(cells.map((cell) => hexCellKey(cell.q, cell.r)));
  return HEX_DIRECTION_ORDER.flatMap((direction) =>
    HEX_PATCH_EDGE_CELLS[direction].flatMap((cell, index) =>
      keys.has(hexCellKey(cell.q, cell.r)) ? [{ direction, index, cell: { ...cell } }] : [],
    ),
  );
}

function deriveContacts(variant: HexPatchTileVariant, components: readonly TerrainPatchComponent[]) {
  const componentByCell = new Map<string, TerrainPatchComponent>();
  for (const component of components) {
    for (const cell of component.cells) componentByCell.set(hexCellKey(cell.q, cell.r), component);
  }
  const contacts = new Map<string, TerrainPatchContact>();
  for (const cell of variant.cells.values()) {
    const component = componentByCell.get(hexCellKey(cell.q, cell.r))!;
    for (const direction of ["ne", "e", "se"] as const) {
      const offset = HEX_DIRECTIONS[direction];
      const neighbor = variant.cells.get(hexCellKey(cell.q + offset.q, cell.r + offset.r));
      if (!neighbor || neighbor.structure === cell.structure) continue;
      const other = componentByCell.get(hexCellKey(neighbor.q, neighbor.r))!;
      const [left, right] = component.id.localeCompare(other.id) <= 0 ? [component, other] : [other, component];
      const key = `${left.id}|${right.id}`;
      const existing = contacts.get(key) ?? {
        componentA: left.id,
        componentB: right.id,
        structureA: left.structure,
        structureB: right.structure,
        edges: [],
      };
      (existing.edges as { a: HexCoord; b: HexCoord }[]).push({
        a: { q: cell.q, r: cell.r },
        b: { q: neighbor.q, r: neighbor.r },
      });
      contacts.set(key, existing);
    }
  }
  return [...contacts.values()];
}

function deriveWarnings(variant: HexPatchTileVariant, components: readonly TerrainPatchComponent[]) {
  const warnings = [...validateHexPatchVariant(variant).errors];
  const featureComponents = components.filter((component) => !["open", "bank"].includes(component.structure));
  const structures = new Set(featureComponents.map((component) => component.structure));
  if (variant.family === "open" && structures.size > 0) warnings.push("open family contains blocking or water features");
  if (variant.family === "cliff" && !structures.has("wall")) warnings.push("cliff family contains no wall cells");
  if (variant.family === "river" && !structures.has("river")) warnings.push("river family contains no river cells");
  if (variant.family === "lake" && !structures.has("lake")) warnings.push("lake family contains no lake cells");
  if (variant.family === "transition" && structures.size < 2) warnings.push("transition family contains fewer than two feature structures");

  const exits = featureComponents.map((component) => component.boundaryDirections.length);
  if (variant.topology === "open" && featureComponents.length > 0) warnings.push("open topology contains feature components");
  if (variant.topology === "isolated" && exits.some((count) => count > 0)) warnings.push("isolated topology reaches a patch boundary");
  if (variant.topology === "endpoint" && !exits.some((count) => count === 1)) warnings.push("endpoint topology has no one-exit feature component");
  if (["straight", "tight-bend", "gentle-bend"].includes(variant.topology) && !exits.some((count) => count === 2)) {
    warnings.push(`${variant.topology} topology has no two-exit feature component`);
  }
  if (variant.topology === "junction" && !exits.some((count) => count >= 3)) warnings.push("junction topology has no three-exit feature component");
  return [...new Set(warnings)];
}
