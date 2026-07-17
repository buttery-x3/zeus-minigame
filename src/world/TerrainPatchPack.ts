import type { AuthoredPatchDefinition } from "./HexTerrainPatch";
import {
  compileTerrainPatchDocument,
  validateTerrainPatchDocument,
  type TerrainPatchDocument,
} from "./TerrainPatchDocument";
import { migrateTerrainPatchDocument } from "./TerrainPatchDocumentMigration";

export type TerrainPatchPack = {
  schemaVersion: 1;
  kind: "zeus-terrain-patch-drafts";
  patches: TerrainPatchDocument[];
};

export function parseTerrainPatchPack(value: unknown): TerrainPatchPack {
  if (!value || typeof value !== "object") throw new Error("Patch pack must be an object");
  const candidate = value as { schemaVersion?: unknown; kind?: unknown; patches?: unknown };
  if (candidate.schemaVersion !== 1 || candidate.kind !== "zeus-terrain-patch-drafts" || !Array.isArray(candidate.patches)) {
    throw new Error("Unsupported terrain patch pack schema");
  }
  const patches = candidate.patches.map(migrateTerrainPatchDocument);
  if (patches.some((patch) => !patch)) throw new Error("Patch pack contains an invalid document");
  const migratedPatches = patches as TerrainPatchDocument[];
  const ids = new Set<string>();
  for (const patch of migratedPatches) {
    if (ids.has(patch.id)) throw new Error(`Patch pack contains duplicate catalog ID ${patch.id}`);
    ids.add(patch.id);
  }
  return { schemaVersion: 1, kind: "zeus-terrain-patch-drafts", patches: structuredClone(migratedPatches) };
}

export function compileTerrainPatchPack(value: unknown): AuthoredPatchDefinition[] {
  const pack = parseTerrainPatchPack(value);
  return pack.patches.map((document) => {
    const result = validateTerrainPatchDocument(document);
    if (!result.valid) throw new Error(`Invalid authored patch ${document.id}: ${result.errors.join("; ")}`);
    return compileTerrainPatchDocument(document);
  });
}
