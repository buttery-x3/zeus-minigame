import type { TerrainStructure, TerrainSurface } from "../types";
import { HEX_DIRECTION_ORDER, hexCellKey, type HexCoord, type HexDirection } from "./hexCoordinates";
import {
  HEX_PATCH_LOCAL_CELLS,
  createAuthoredPatchVariants,
  createBaseCells,
  setPatchCell,
  type AuthoredPatchDefinition,
  type HexPatchAuthorCategory,
  type HexPatchLakeRole,
  type HexPatchRiverTerminal,
  type HexPatchTopology,
  type HexPatchTileVariant,
} from "./HexTerrainPatch";
import { validateHexPatchVariant } from "./HexTerrainPatchValidation";

export const TERRAIN_PATCH_DOCUMENT_SCHEMA_VERSION = 1;
export const TERRAIN_PATCH_DOCUMENT_CATEGORIES: readonly HexPatchAuthorCategory[] = ["open", "cliff", "river", "lake", "transition"];
export const TERRAIN_PATCH_DOCUMENT_TOPOLOGIES: readonly HexPatchTopology[] = ["open", "isolated", "endpoint", "straight", "tight-bend", "gentle-bend", "junction", "mixed"];
export const TERRAIN_PATCH_DOCUMENT_ROTATIONS = [1, 3, 6] as const;

export type TerrainPatchDocumentCell = HexCoord & {
  structure: Extract<TerrainStructure, "open" | "wall" | "river" | "lake">;
  surface: TerrainSurface;
};

export type TerrainPatchDocument = {
  schemaVersion: 1;
  draftId: string;
  id: string;
  displayName: string;
  category: HexPatchAuthorCategory;
  cells: TerrainPatchDocumentCell[];
  weight: number;
  selectionGroup: string;
  selectionGroupWeight: number;
  topology: HexPatchTopology;
  rotations: 1 | 3 | 6;
  riverFlow: {
    inputs: HexDirection[];
    outputs: HexDirection[];
    reversible: boolean;
  };
  riverTerminal?: HexPatchRiverTerminal;
  lakeRole?: HexPatchLakeRole;
  notes: string;
  lockedCells: string[];
  source?: { kind: "blank" | "catalog" | "scenario" | "candidate"; reference?: string };
};

export type TerrainPatchDocumentValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  definition: AuthoredPatchDefinition | null;
  variants: HexPatchTileVariant[];
};

export function createBlankTerrainPatchDocument(category: HexPatchAuthorCategory = "open"): TerrainPatchDocument {
  const id = `patch.${category}.untitled`;
  return {
    schemaVersion: 1,
    draftId: globalThis.crypto?.randomUUID?.() ?? `patch-draft-${Date.now().toString(36)}`,
    id,
    displayName: "Untitled patch",
    category,
    cells: HEX_PATCH_LOCAL_CELLS.map(({ q, r }) => ({ q, r, structure: "open", surface: "grass" })),
    weight: 1,
    selectionGroup: id,
    selectionGroupWeight: 1,
    topology: category === "open" ? "open" : "mixed",
    rotations: 6,
    riverFlow: { inputs: [], outputs: [], reversible: false },
    notes: "",
    lockedCells: [],
    source: { kind: "blank" },
  };
}

export function terrainPatchDocumentFromDefinition(definition: AuthoredPatchDefinition): TerrainPatchDocument {
  const variant = createAuthoredPatchVariants(definition)[0];
  const category = definition.category ?? categoryFromId(definition.id, definition.family);
  return {
    ...createBlankTerrainPatchDocument(category),
    id: definition.id,
    displayName: definition.displayName ?? displayNameFromId(definition.id),
    cells: [...variant.cells.values()].map(({ q, r, structure, surface }) => ({ q, r, structure: editableStructure(structure), surface })),
    weight: definition.weight,
    selectionGroup: definition.selectionGroup ?? definition.id,
    selectionGroupWeight: definition.selectionGroupWeight ?? definition.weight * createAuthoredPatchVariants(definition).length,
    topology: definition.topology ?? "mixed",
    rotations: normalizeRotations(definition.rotations),
    riverFlow: {
      inputs: [...(definition.riverFlow?.inputs ?? [])],
      outputs: [...(definition.riverFlow?.outputs ?? [])],
      reversible: Boolean(definition.riverFlow?.reversible),
    },
    riverTerminal: definition.riverTerminal,
    lakeRole: definition.lakeRole,
    source: { kind: "catalog", reference: definition.id },
  };
}

export function terrainPatchDocumentFromVariant(variant: HexPatchTileVariant): TerrainPatchDocument {
  const category = categoryFromId(variant.id.replace(/\.\d+(?:\.reverse)?$/, ""), variant.family);
  const document = createBlankTerrainPatchDocument(category);
  document.id = `${variant.id.replace(/\.reverse$/, "")}.variant`;
  document.displayName = `${displayNameFromId(variant.id)} variant`;
  document.cells = [...variant.cells.values()].map(({ q, r, structure, surface }) => ({ q, r, structure: editableStructure(structure), surface }));
  document.weight = Math.max(1, variant.weight);
  document.selectionGroup = document.id;
  document.selectionGroupWeight = document.weight;
  document.topology = variant.topology;
  document.rotations = 6;
  document.riverFlow.inputs = HEX_DIRECTION_ORDER.filter((direction) => variant.riverPorts[direction] === "input");
  document.riverFlow.outputs = HEX_DIRECTION_ORDER.filter((direction) => variant.riverPorts[direction] === "output");
  document.riverTerminal = variant.riverTerminal;
  document.lakeRole = variant.lakeRole;
  document.source = { kind: "candidate", reference: variant.id };
  return document;
}

export function compileTerrainPatchDocument(document: TerrainPatchDocument): AuthoredPatchDefinition {
  const openCells = document.cells.filter((cell) => cell.structure === "open");
  const baseSurface = mostCommonSurface(openCells.map((cell) => cell.surface));
  const openSurfaceCells: Partial<Record<TerrainSurface, HexCoord[]>> = {};
  for (const cell of openCells) {
    if (cell.surface === baseSurface) continue;
    (openSurfaceCells[cell.surface] ??= []).push({ q: cell.q, r: cell.r });
  }
  const cells: AuthoredPatchDefinition["cells"] = {};
  for (const structure of ["wall", "river", "lake"] as const) {
    const coords = document.cells.filter((cell) => cell.structure === structure).map(({ q, r }) => ({ q, r }));
    if (coords.length > 0) cells[structure] = coords;
  }
  const hasRiverFlow = document.riverFlow.inputs.length > 0 || document.riverFlow.outputs.length > 0;
  return {
    id: document.id.trim(),
    displayName: document.displayName.trim(),
    category: document.category,
    family: document.category,
    weight: document.weight,
    selectionGroup: document.selectionGroup.trim() || document.id.trim(),
    selectionGroupWeight: document.selectionGroupWeight,
    topology: document.topology,
    riverTerminal: document.riverTerminal,
    riverFlow: hasRiverFlow ? {
      inputs: [...document.riverFlow.inputs],
      outputs: [...document.riverFlow.outputs],
      reversible: document.riverFlow.reversible || undefined,
    } : undefined,
    lakeRole: document.lakeRole,
    baseSurface,
    rotations: document.rotations,
    cells,
    openSurfaceCells,
  };
}

export function validateTerrainPatchDocument(document: TerrainPatchDocument): TerrainPatchDocumentValidation {
  const errors = validateDocumentShape(document);
  const warnings: string[] = [];
  if (errors.length > 0) return { valid: false, errors, warnings, definition: null, variants: [] };
  const definition = compileTerrainPatchDocument(document);
  const variants = createAuthoredPatchVariants(definition);
  for (const variant of variants) {
    const result = validateHexPatchVariant(variant);
    result.errors.forEach((error) => errors.push(`${variant.id}: ${error}`));
  }
  if (variants.length < document.rotations) warnings.push(`Only ${variants.length} unique variants result from ${document.rotations} requested rotations.`);
  if (document.category === "transition" && new Set(document.cells.map((cell) => cell.structure)).size < 2) warnings.push("Transition category contains only one structure type.");
  return { valid: errors.length === 0, errors, warnings, definition, variants };
}

export function terrainPatchDocumentIsValid(value: unknown): value is TerrainPatchDocument {
  return Boolean(value && typeof value === "object" && validateDocumentShape(value as TerrainPatchDocument).length === 0);
}

function validateDocumentShape(document: TerrainPatchDocument) {
  const errors: string[] = [];
  const id = typeof document.id === "string" ? document.id : "";
  const cells = Array.isArray(document.cells) ? document.cells : [];
  if (document.schemaVersion !== 1) errors.push("unsupported patch document schema");
  if (!document.draftId || typeof document.draftId !== "string") errors.push("missing draft id");
  if (!/^patch\.(open|cliff|river|lake|transition)\.[a-z0-9][a-z0-9.-]*$/.test(id)) errors.push("catalog id must use patch.<category>.<slug>");
  if (typeof document.displayName !== "string" || !document.displayName.trim()) errors.push("display name is required");
  if (!TERRAIN_PATCH_DOCUMENT_CATEGORIES.includes(document.category)) errors.push("unsupported patch category");
  if (id.split(".")[1] !== document.category) errors.push("catalog ID category must match the selected category");
  if (!TERRAIN_PATCH_DOCUMENT_TOPOLOGIES.includes(document.topology)) errors.push("unsupported topology");
  if (!TERRAIN_PATCH_DOCUMENT_ROTATIONS.includes(document.rotations)) errors.push("rotations must be 1, 3, or 6");
  if (!(document.weight > 0)) errors.push("weight must be positive");
  if (!(document.selectionGroupWeight > 0)) errors.push("selection group weight must be positive");
  if (typeof document.selectionGroup !== "string" || !document.selectionGroup.trim()) errors.push("selection group is required");
  if (typeof document.notes !== "string") errors.push("notes must be text");
  if (cells.length !== HEX_PATCH_LOCAL_CELLS.length) errors.push(`expected ${HEX_PATCH_LOCAL_CELLS.length} cells`);
  const expected = new Set(HEX_PATCH_LOCAL_CELLS.map((cell) => hexCellKey(cell.q, cell.r)));
  const actual = new Set<string>();
  for (const cell of cells) {
    if (!cell || typeof cell !== "object") {
      errors.push("patch cells must be objects");
      continue;
    }
    const key = hexCellKey(cell.q, cell.r);
    if (!expected.has(key)) errors.push(`cell ${key} is outside the patch`);
    if (actual.has(key)) errors.push(`duplicate cell ${key}`);
    actual.add(key);
    if (!["open", "wall", "river", "lake"].includes(cell.structure)) errors.push(`unsupported structure at ${key}`);
    if (cell.structure === "open" ? cell.surface !== "grass" : cell.surface !== expectedEditableSurface(cell.structure)) {
      errors.push(`unsupported ${cell.structure}/${cell.surface} paint at ${key}`);
    }
  }
  if (!document.riverFlow || !Array.isArray(document.riverFlow.inputs) || !Array.isArray(document.riverFlow.outputs)
    || typeof document.riverFlow.reversible !== "boolean") errors.push("invalid river flow metadata");
  for (const direction of [...(document.riverFlow?.inputs ?? []), ...(document.riverFlow?.outputs ?? [])]) {
    if (!HEX_DIRECTION_ORDER.includes(direction)) errors.push(`invalid river direction ${direction}`);
  }
  if (new Set([...(document.riverFlow?.inputs ?? []), ...(document.riverFlow?.outputs ?? [])]).size
    !== (document.riverFlow?.inputs.length ?? 0) + (document.riverFlow?.outputs.length ?? 0)) errors.push("river directions must be unique");
  if (!Array.isArray(document.lockedCells) || document.lockedCells.some((key) => !expected.has(key))) errors.push("invalid locked cells");
  return [...new Set(errors)];
}

function categoryFromId(id: string, family: AuthoredPatchDefinition["family"]): HexPatchAuthorCategory {
  const segment = id.split(".")[1];
  return TERRAIN_PATCH_DOCUMENT_CATEGORIES.includes(segment as HexPatchAuthorCategory) ? segment as HexPatchAuthorCategory : family;
}

function displayNameFromId(id: string) {
  return id.replace(/^patch\./, "").replaceAll(/[.-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeRotations(rotations = 1): 1 | 3 | 6 {
  return rotations >= 6 ? 6 : rotations >= 3 ? 3 : 1;
}

function editableStructure(structure: TerrainStructure): TerrainPatchDocumentCell["structure"] {
  return structure === "bank" ? "open" : structure;
}

function mostCommonSurface(surfaces: readonly TerrainSurface[]) {
  if (surfaces.length === 0) return "grass" as const;
  const counts = new Map<TerrainSurface, number>();
  surfaces.forEach((surface) => counts.set(surface, (counts.get(surface) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function expectedEditableSurface(structure: TerrainPatchDocumentCell["structure"]): TerrainSurface {
  return structure === "wall" ? "stone" : structure === "river" ? "mud" : structure === "lake" ? "sand" : "grass";
}
