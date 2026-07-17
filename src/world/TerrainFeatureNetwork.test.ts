import { describe, expect, it } from "vitest";
import { HEX_DIRECTIONS, HEX_DIRECTION_ORDER } from "./hexCoordinates";
import { createHexPatchTileCatalog } from "./HexTerrainCatalog";
import { patchVariantsCanNeighbor } from "./HexTerrainRules";
import { analyzeTerrainFeatureNetwork } from "./TerrainFeatureNetwork";
import { inspectTerrainVariant } from "./TerrainInspectionSnapshot";

describe("terrain feature network", () => {
  it("connects matching river components across patch seams", () => {
    const variants = createHexPatchTileCatalog();
    const source = variants.find((variant) => variant.family === "river" && Object.keys(variant.riverPorts).length > 0)!;
    const direction = HEX_DIRECTION_ORDER.find((candidate) => source.edges[candidate].includes("river"))!;
    const neighbor = variants.find((candidate) => candidate.family === "river" && patchVariantsCanNeighbor(source, direction, candidate))!;
    const offset = HEX_DIRECTIONS[direction];
    const graph = analyzeTerrainFeatureNetwork({ seed: 1, generationVersion: 2, patches: [
      { q: 0, r: 0, emergency: false, variant: inspectTerrainVariant(source) },
      { ...offset, emergency: false, variant: inspectTerrainVariant(neighbor) },
    ] });
    expect(graph.edges.some((edge) => edge.kind === "continuation" && graph.nodes.find((node) => node.id === edge.a)?.structure === "river")).toBe(true);
  });

  it("counts internal river mouths on lake networks", () => {
    const mouth = createHexPatchTileCatalog().find((variant) => variant.id.startsWith("patch.transition.river-lake-mouth."))!;
    const graph = analyzeTerrainFeatureNetwork({ seed: 1, generationVersion: 1, patches: [
      { q: 0, r: 0, emergency: false, variant: inspectTerrainVariant(mouth) },
    ] });
    expect(graph.lakeNetworks).toHaveLength(1);
    expect(graph.lakeNetworks[0].mouthCount).toBeGreaterThan(0);
    expect(graph.issues.some((issue) => issue.kind === "lake-mouth-count")).toBe(true);
  });
});
