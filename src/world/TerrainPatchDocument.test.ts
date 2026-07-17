import { describe, expect, it } from "vitest";
import { hexCellKey } from "./hexCoordinates";
import { createHexPatchCatalogEntries } from "./HexTerrainCatalog";
import {
  createBlankTerrainPatchDocument,
  terrainPatchDocumentIsValid,
  terrainPatchDocumentFromDefinition,
  validateTerrainPatchDocument,
} from "./TerrainPatchDocument";
import { migrateTerrainPatchDocument } from "./TerrainPatchDocumentMigration";
import {
  TerrainPatchHistory,
  floodFillTerrainPatch,
  mirrorTerrainPatchDocument,
  paintTerrainPatchCells,
  rotateTerrainPatchDocument,
} from "./TerrainPatchEditing";
import { compileTerrainPatchPack, parseTerrainPatchPack } from "./TerrainPatchPack";

describe("terrain patch documents", () => {
  it("compiles a complete open patch through the authored variant pipeline", () => {
    const document = createBlankTerrainPatchDocument();
    document.id = "patch.open.editor-test";
    document.displayName = "Editor test";
    document.selectionGroup = document.id;
    const result = validateTerrainPatchDocument(document);
    expect(result.errors).toEqual([]);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].cells.size).toBe(19);
  });

  it("round-trips an existing authored definition into an editable document", () => {
    const definition = createHexPatchCatalogEntries().find((entry) => entry.definition.id === "patch.river.bend")!.definition;
    const document = terrainPatchDocumentFromDefinition(definition);
    const result = validateTerrainPatchDocument(document);
    expect(result.valid).toBe(true);
    expect(result.variants.map((variant) => variant.id)).toEqual(createHexPatchCatalogEntries()
      .find((entry) => entry.definition.id === definition.id)!.variants.map((variant) => variant.id));
  });

  it("flood fills only the contiguous matching region and respects locked cells", () => {
    let document = createBlankTerrainPatchDocument();
    document = paintTerrainPatchCells(document, ["0,0", "1,0"], { structure: "wall", surface: "stone" });
    document.lockedCells = ["1,0"];
    const filled = floodFillTerrainPatch(document, "0,0", { structure: "river", surface: "mud" });
    expect(cell(filled, "0,0").structure).toBe("river");
    expect(cell(filled, "1,0").structure).toBe("wall");
    expect(cell(filled, "-1,0").structure).toBe("open");
  });

  it("rotates and mirrors cells, locks, and river directions together", () => {
    let document = createBlankTerrainPatchDocument("river");
    document = paintTerrainPatchCells(document, ["1,-2"], { structure: "river", surface: "mud" });
    document.lockedCells = ["1,-2"];
    document.riverFlow.inputs = ["ne"];
    const rotated = rotateTerrainPatchDocument(document);
    expect(rotated.lockedCells).toContain("2,-1");
    expect(rotated.riverFlow.inputs).toEqual(["e"]);
    expect(cell(rotated, "2,-1").structure).toBe("river");
    const mirrored = mirrorTerrainPatchDocument(document);
    expect(mirrored.cells.some((candidate) => candidate.structure === "river")).toBe(true);
    expect(mirrored.lockedCells).toHaveLength(1);
  });

  it("keeps a bounded undo and redo history", () => {
    const blank = createBlankTerrainPatchDocument();
    const history = new TerrainPatchHistory(blank, 2);
    history.replace(paintTerrainPatchCells(history.value, ["0,0"], { structure: "wall", surface: "stone" }));
    history.replace(paintTerrainPatchCells(history.value, ["1,0"], { structure: "river", surface: "mud" }));
    history.replace(paintTerrainPatchCells(history.value, ["-1,0"], { structure: "lake", surface: "sand" }));
    expect(cell(history.undo(), "-1,0").structure).toBe("open");
    expect(cell(history.undo(), "1,0").structure).toBe("open");
    expect(cell(history.redo(), "1,0").structure).toBe("river");
  });

  it("validates and compiles a versioned patch pack", () => {
    const document = createBlankTerrainPatchDocument();
    document.id = "patch.open.pack-test";
    document.displayName = "Pack test";
    document.selectionGroup = document.id;
    const pack = { schemaVersion: 1, kind: "zeus-terrain-patch-drafts", patches: [document] } as const;
    expect(parseTerrainPatchPack(pack).patches).toHaveLength(1);
    expect(compileTerrainPatchPack(pack)[0].id).toBe(document.id);
    expect(() => parseTerrainPatchPack({ ...pack, patches: [document, document] })).toThrow("duplicate catalog ID");
  });

  it("rejects malformed imported documents without throwing", () => {
    expect(() => terrainPatchDocumentIsValid({ id: 42, displayName: 7, cells: {} })).not.toThrow();
    expect(terrainPatchDocumentIsValid({ id: 42, displayName: 7, cells: {} })).toBe(false);
  });

  it("migrates retired meadow and rock authoring vocabulary", () => {
    const legacy = structuredClone(createBlankTerrainPatchDocument("cliff")) as unknown as {
      category: string;
      id: string;
      selectionGroup: string;
      cells: Array<{ surface: string }>;
    };
    legacy.category = "rock";
    legacy.id = "patch.rock.island-copy";
    legacy.selectionGroup = legacy.id;
    legacy.cells[0].surface = "meadow";
    const migrated = migrateTerrainPatchDocument(legacy)!;
    expect(migrated.category).toBe("cliff");
    expect(migrated.id).toBe("patch.cliff.island-copy");
    expect(migrated.selectionGroup).toBe(migrated.id);
    expect(migrated.cells[0].surface).toBe("grass");
  });
});

function cell(document: ReturnType<typeof createBlankTerrainPatchDocument>, key: string) {
  return document.cells.find((candidate) => hexCellKey(candidate.q, candidate.r) === key)!;
}
