import {
  terrainPatchDocumentIsValid,
  type TerrainPatchDocument,
  type TerrainPatchDocumentCell,
} from "./TerrainPatchDocument";

export function migrateTerrainPatchDocument(value: unknown): TerrainPatchDocument | null {
  if (!value || typeof value !== "object") return null;
  type LegacyDocument = Omit<Partial<TerrainPatchDocument>, "category" | "cells"> & {
    category?: string;
    cells?: Array<Omit<Partial<TerrainPatchDocumentCell>, "surface"> & { surface?: string }>;
  };
  const migrated = structuredClone(value) as LegacyDocument;
  if (migrated.schemaVersion !== 1) return null;
  if (migrated.category === "rock") {
    const previousId = migrated.id;
    migrated.category = "cliff";
    if (typeof migrated.id === "string") migrated.id = migrated.id.replace(/^patch\.rock\./, "patch.cliff.");
    if (migrated.selectionGroup === previousId && migrated.id) migrated.selectionGroup = migrated.id;
    const source = migrated.source;
    if (source && source.reference === previousId && migrated.id) source.reference = migrated.id;
  }
  if (Array.isArray(migrated.cells)) {
    migrated.cells = migrated.cells.map((cell) => cell?.surface === "meadow" ? { ...cell, surface: "grass" } : cell);
  }
  return terrainPatchDocumentIsValid(migrated) ? migrated : null;
}
