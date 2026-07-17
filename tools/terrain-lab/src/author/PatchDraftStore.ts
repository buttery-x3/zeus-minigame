import type { TerrainPatchDocument } from "../../../../src/world/TerrainPatchDocument";
import { migrateTerrainPatchDocument } from "../../../../src/world/TerrainPatchDocumentMigration";

const PATCH_DRAFT_KEY = "zeus.terrain-lab.patch-drafts.v1";

export type TerrainPatchDraftBundle = {
  schemaVersion: 1;
  kind: "zeus-terrain-patch-drafts";
  patches: TerrainPatchDocument[];
};

export class PatchDraftStore {
  private drafts = readDrafts();

  getAll() {
    return structuredClone(this.drafts).sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  }

  get(draftId: string) {
    const draft = this.drafts.find((candidate) => candidate.draftId === draftId);
    return draft ? structuredClone(draft) : null;
  }

  save(document: TerrainPatchDocument) {
    const saved = structuredClone(document);
    const index = this.drafts.findIndex((candidate) => candidate.draftId === saved.draftId);
    if (index >= 0) this.drafts[index] = saved;
    else this.drafts.push(saved);
    this.persist();
    return structuredClone(saved);
  }

  delete(draftId: string) {
    this.drafts = this.drafts.filter((draft) => draft.draftId !== draftId);
    this.persist();
  }

  import(value: unknown) {
    const patches = parseBundle(value);
    for (const patch of patches) {
      const existing = this.drafts.find((candidate) => candidate.draftId === patch.draftId);
      const saved = existing ? { ...structuredClone(patch), draftId: crypto.randomUUID(), id: uniqueImportedId(patch.id, this.drafts) } : structuredClone(patch);
      this.drafts.push(saved);
    }
    this.persist();
    return patches.length;
  }

  bundle(documents = this.getAll()): TerrainPatchDraftBundle {
    return { schemaVersion: 1, kind: "zeus-terrain-patch-drafts", patches: structuredClone(documents) };
  }

  private persist() {
    localStorage.setItem(PATCH_DRAFT_KEY, JSON.stringify(this.drafts));
  }
}

function parseBundle(value: unknown) {
  const candidates = value && typeof value === "object" && "patches" in value
    ? (value as { patches?: unknown }).patches
    : [value];
  if (!Array.isArray(candidates)) throw new Error("Unsupported or invalid terrain patch draft file");
  const patches = candidates.map(migrateTerrainPatchDocument);
  if (patches.some((patch) => !patch)) throw new Error("Unsupported or invalid terrain patch draft file");
  return patches as TerrainPatchDocument[];
}

function readDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PATCH_DRAFT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(migrateTerrainPatchDocument).filter((patch): patch is TerrainPatchDocument => Boolean(patch)) : [];
  } catch {
    return [];
  }
}

function uniqueImportedId(id: string, drafts: readonly TerrainPatchDocument[]) {
  let index = 2;
  let candidate = `${id}.imported`;
  const ids = new Set(drafts.map((draft) => draft.id));
  while (ids.has(candidate)) candidate = `${id}.imported-${index++}`;
  return candidate;
}
