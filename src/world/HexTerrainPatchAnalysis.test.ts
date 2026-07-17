import { describe, expect, test } from "vitest";
import { createHexPatchCatalogEntries, createHexPatchTileCatalog } from "./HexTerrainCatalog";
import { analyzeHexPatchVariant } from "./HexTerrainPatchAnalysis";
import { WfcTerrainProvider } from "./WfcTerrainProvider";

describe("terrain patch inspection", () => {
  test("groups generated variants under their authored definitions without changing the flat catalog", () => {
    const entries = createHexPatchCatalogEntries();
    const flat = createHexPatchTileCatalog();

    expect(entries.length).toBeGreaterThan(10);
    expect(entries.flatMap((entry) => entry.variants.map((variant) => variant.id))).toEqual(flat.map((variant) => variant.id));
    expect(new Set(flat.map((variant) => variant.id)).size).toBe(flat.length);
    expect(entries.every((entry) => entry.variants.length > 0)).toBe(true);
  });

  test("derives components, boundary ports, and mixed feature contacts from cells", () => {
    const variants = createHexPatchTileCatalog();
    const open = variants.find((variant) => variant.id === "patch.open.grass")!;
    const transition = variants.find((variant) => variant.id === "patch.transition.cliff-river.0")!;
    const river = variants.find((variant) => variant.family === "river" && variant.topology === "straight")!;

    const openAnalysis = analyzeHexPatchVariant(open);
    expect(openAnalysis.components).toHaveLength(1);
    expect(openAnalysis.components[0]).toMatchObject({ structure: "open", cells: { length: 19 } });

    const transitionAnalysis = analyzeHexPatchVariant(transition);
    expect(transitionAnalysis.contacts.some((contact) =>
      new Set([contact.structureA, contact.structureB]).has("river") &&
      new Set([contact.structureA, contact.structureB]).has("wall"),
    )).toBe(true);

    const riverComponent = analyzeHexPatchVariant(river).components.find((component) => component.structure === "river")!;
    expect(riverComponent.boundaryDirections).toHaveLength(2);
    expect(riverComponent.cells.length).toBeGreaterThan(2);
  });

  test("captures detailed committed state without advancing generation or retaining mutable variant maps", () => {
    const provider = new WfcTerrainProvider(20260517);
    provider.requestGenerationAround(0, 0, 2);
    provider.stepGeneration(Number.POSITIVE_INFINITY);
    const before = provider.getDiagnostics().wfc;
    const first = provider.captureTerrainInspectionSnapshot({ q: 0, r: 0 }, 2);
    const patch = first.patches[0];
    const originalKind = patch.variant.edges.ne[0];
    (patch.variant.edges.ne as string[])[0] = "tampered";
    const second = provider.captureTerrainInspectionSnapshot({ q: 0, r: 0 }, 2);
    const after = provider.getDiagnostics().wfc;

    expect(first.patches).toHaveLength(19);
    expect(second.patches[0].variant.edges.ne[0]).toBe(originalKind);
    expect(second.patches.every((entry) => entry.variant.cells.length === 19)).toBe(true);
    expect(after.generationStepCount).toBe(before.generationStepCount);
    expect(after.generatedPatchCount).toBe(before.generatedPatchCount);
  });
});
