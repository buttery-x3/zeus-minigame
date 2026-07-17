import { describe, expect, it } from "vitest";
import { createHexPatchTileCatalog } from "./HexTerrainCatalog";
import { HEX_DIRECTION_ORDER } from "./hexCoordinates";
import { analyzeHexPatchVariant } from "./HexTerrainPatchAnalysis";
import { canonicalizeTopologyRecipe, createTopologyRecipe, evaluateTopologyRecipe, transformTopologyRecipe } from "./TerrainTopologyRecipe";

describe("terrain topology recipes", () => {
  it("accepts connected ports and rejects impossible component requirements", () => {
    const river = createHexPatchTileCatalog().find((variant) => variant.id.startsWith("patch.river.line."))!;
    const component = analyzeHexPatchVariant(river).components.find((candidate) => candidate.structure === "river")!;
    const recipe = createTopologyRecipe("river connection");
    recipe.allowDisconnected = true;
    recipe.components.push({
      id: "river-main",
      structure: "river",
      ports: component.boundaryPorts.slice(0, 2).map((port) => ({ direction: port.direction, index: port.index, structure: "river" })),
    });
    expect(evaluateTopologyRecipe(river, recipe).accepted).toBe(true);
    const absentDirection = HEX_DIRECTION_ORDER.find((direction) => !component.boundaryDirections.includes(direction))!;
    recipe.components[0].ports.push({ direction: absentDirection, index: 0, structure: "river" });
    expect(evaluateTopologyRecipe(river, recipe).accepted).toBe(false);
  });

  it("canonicalizes rotated and mirrored recipe forms", () => {
    const recipe = createTopologyRecipe("wall bend");
    recipe.components.push({ id: "wall", structure: "wall", ports: [
      { direction: "ne", index: 1, structure: "wall" },
      { direction: "e", index: 1, structure: "wall" },
    ] });
    expect(canonicalizeTopologyRecipe(recipe)).toBe(canonicalizeTopologyRecipe(transformTopologyRecipe(recipe, 3, true)));
  });
});
