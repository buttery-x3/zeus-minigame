import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER, hexCellKey, type HexCoord } from "./hexCoordinates";
import {
  HEX_PATCH_EDGE_CELLS,
  HEX_PATCH_EDGE_LENGTH,
  HEX_PATCH_LOCAL_CELLS,
  derivePatchEdges,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";

export type HexPatchValidationResult = {
  valid: boolean;
  errors: string[];
};

export function validateHexPatchVariant(variant: HexPatchTileVariant): HexPatchValidationResult {
  const errors: string[] = [];
  if (!variant.id) {
    errors.push("missing patch id");
  }
  if (variant.provenance === "authored" && variant.weight <= 0) {
    errors.push("authored patch weight must be positive");
  }
  if (variant.provenance === "authored" && (!variant.selectionGroup || variant.selectionGroupWeight <= 0)) {
    errors.push("authored patch selection group and weight must be defined");
  }
  if (variant.provenance === "procedural" && variant.weight !== 0) {
    errors.push("procedural patch weight must be zero");
  }
  if (variant.cells.size !== HEX_PATCH_LOCAL_CELLS.length) {
    errors.push(`expected ${HEX_PATCH_LOCAL_CELLS.length} cells, received ${variant.cells.size}`);
  }

  for (const coord of HEX_PATCH_LOCAL_CELLS) {
    if (!variant.cells.has(hexCellKey(coord.q, coord.r))) {
      errors.push(`missing cell ${hexCellKey(coord.q, coord.r)}`);
    }
  }

  const derivedEdges = derivePatchEdges(variant.cells);
  for (const direction of HEX_DIRECTION_ORDER) {
    const edge = variant.edges[direction];
    if (edge.length !== HEX_PATCH_EDGE_LENGTH) {
      errors.push(`${direction} edge has length ${edge.length}`);
      continue;
    }
    if (edge.some((kind, index) => kind !== derivedEdges[direction][index])) {
      errors.push(`${direction} edge does not match its boundary cells`);
    }
  }

  validateAuthoredRiverTerminals(variant, errors);
  validateAuthoredRiverFlow(variant, errors);
  validateAuthoredLakeRole(variant, errors);

  return { valid: errors.length === 0, errors };
}

function validateAuthoredRiverFlow(variant: HexPatchTileVariant, errors: string[]) {
  if (variant.provenance !== "authored") {
    return;
  }

  const exits = HEX_DIRECTION_ORDER.filter((direction) => variant.edges[direction].includes("river"));
  const ports = HEX_DIRECTION_ORDER.filter((direction) => variant.riverPorts[direction]);
  for (const direction of exits) {
    if (!variant.riverPorts[direction]) {
      errors.push(`authored river exit ${direction} requires input or output flow metadata`);
    }
  }
  for (const direction of ports) {
    if (!exits.includes(direction)) {
      errors.push(`river flow port ${direction} requires a physical river exit`);
    }
  }
  if (exits.length === 0) {
    return;
  }

  const inputCount = ports.filter((direction) => variant.riverPorts[direction] === "input").length;
  const outputCount = ports.filter((direction) => variant.riverPorts[direction] === "output").length;
  if (variant.riverTerminal === "cliff" && (inputCount !== 0 || outputCount !== 1)) {
    errors.push("cliff river source requires zero inputs and exactly one output");
  } else if (variant.riverTerminal === "lake" && (inputCount !== 1 || outputCount !== 0)) {
    errors.push("lake river mouth requires exactly one input and zero outputs");
  } else if (!variant.riverTerminal && variant.topology === "junction" && (inputCount !== 2 || outputCount !== 1)) {
    errors.push("river junction requires two inputs and exactly one output");
  } else if (!variant.riverTerminal && variant.topology !== "junction" && (inputCount !== 1 || outputCount !== 1)) {
    errors.push("river continuation requires exactly one input and one output");
  }
}

function validateAuthoredLakeRole(variant: HexPatchTileVariant, errors: string[]) {
  if (variant.provenance !== "authored" || !variant.lakeRole) {
    return;
  }
  if (![...variant.cells.values()].some((cell) => cell.structure === "lake")) {
    errors.push(`lake role ${variant.lakeRole} requires authored lake cells`);
  }
  if (variant.lakeRole === "cove" && (variant.topology !== "endpoint" || variant.diagnostics.lakeExitCount !== 1)) {
    errors.push("lake cove role requires endpoint topology with exactly one lake exit");
  }
}

function validateAuthoredRiverTerminals(variant: HexPatchTileVariant, errors: string[]) {
  if (variant.provenance !== "authored") {
    return;
  }

  const riverComponents = findRiverComponents(variant);
  const terminalComponents = riverComponents.filter((component) => countComponentExits(variant, component) === 1);
  if (riverComponents.some((component) => countComponentExits(variant, component) === 0)) {
    errors.push("authored river components must expose at least one river exit");
  }
  if (terminalComponents.length > 0 && !variant.riverTerminal) {
    errors.push("authored one-exit river components require lake or cliff terminal metadata");
  }
  if (variant.riverTerminal && terminalComponents.length === 0) {
    errors.push("river terminal metadata requires a one-exit river component");
  }
  if (!variant.riverTerminal) {
    return;
  }

  const terminalStructure = variant.riverTerminal === "lake" ? "lake" : "wall";
  for (const component of terminalComponents) {
    const touchesTerminal = component.some((cell) => HEX_DIRECTION_ORDER.some((direction) => {
      const offset = HEX_DIRECTIONS[direction];
      return variant.cells.get(hexCellKey(cell.q + offset.q, cell.r + offset.r))?.structure === terminalStructure;
    }));
    if (!touchesTerminal) {
      errors.push(`river terminal marked ${variant.riverTerminal} must touch ${terminalStructure}`);
      return;
    }
  }
}

function findRiverComponents(variant: HexPatchTileVariant) {
  const remaining = new Set(
    [...variant.cells.values()]
      .filter((cell) => cell.structure === "river")
      .map((cell) => hexCellKey(cell.q, cell.r)),
  );
  const components: HexCoord[][] = [];

  while (remaining.size > 0) {
    const firstKey = remaining.values().next().value as string;
    const first = variant.cells.get(firstKey)!;
    const component: HexCoord[] = [];
    const queue: HexCoord[] = [first];
    remaining.delete(firstKey);
    for (let index = 0; index < queue.length; index += 1) {
      const cell = queue[index];
      component.push(cell);
      for (const direction of HEX_DIRECTION_ORDER) {
        const offset = HEX_DIRECTIONS[direction];
        const key = hexCellKey(cell.q + offset.q, cell.r + offset.r);
        if (remaining.delete(key)) {
          queue.push(variant.cells.get(key)!);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function countComponentExits(variant: HexPatchTileVariant, component: readonly HexCoord[]) {
  const keys = new Set(component.map((cell) => hexCellKey(cell.q, cell.r)));
  return HEX_DIRECTION_ORDER.filter((direction) => HEX_PATCH_EDGE_CELLS[direction].some(
    (cell) => keys.has(hexCellKey(cell.q, cell.r)) && variant.cells.get(hexCellKey(cell.q, cell.r))?.structure === "river",
  )).length;
}

export function assertValidHexPatchVariant(variant: HexPatchTileVariant) {
  const result = validateHexPatchVariant(variant);
  if (!result.valid) {
    throw new Error(`Invalid patch ${variant.id}: ${result.errors.join("; ")}`);
  }
  return variant;
}
