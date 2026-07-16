import { describe, expect, test } from "vitest";
import { createHexPatchTileCatalog, type HexPatchTileVariant } from "./HexTerrainCatalog";
import { hexCellKey, type HexDirection } from "./hexCoordinates";
import {
  authoredRiverFlowsCanNeighbor,
  createsCommittedAuthoredRiverCycle,
  findCommittedRiverFlowViolation,
} from "./TerrainRiverFlowPolicy";

describe("authored river flow policy", () => {
  const variants = createHexPatchTileCatalog();

  test("rejects output-to-output river joins", () => {
    const westOutput = variantWithPorts("ne", "e");
    const eastOutput = variantWithPorts("sw", "w");

    expect(authoredRiverFlowsCanNeighbor(westOutput, "e", eastOutput)).toBe(false);
  });

  test("accepts output-to-input river joins", () => {
    const upstream = variantWithPorts("ne", "e");
    const downstream = variantWithPorts("w", "sw");

    expect(authoredRiverFlowsCanNeighbor(upstream, "e", downstream)).toBe(true);
  });

  test("detects a directed authored river cycle", () => {
    const a = variantWithPorts("se", "e");
    const b = variantWithPorts("w", "sw");
    const c = variantWithPorts("ne", "nw");
    const committed = new Map([
      [hexCellKey(0, 0), { q: 0, r: 0, variant: a }],
      [hexCellKey(1, 0), { q: 1, r: 0, variant: b }],
    ]);

    expect(createsCommittedAuthoredRiverCycle({ q: 0, r: 1 }, c, committed)).toBe(true);
    expect(findCommittedRiverFlowViolation([
      ...committed.values(),
      { q: 0, r: 1, variant: c },
    ])?.kind).toBe("cycle");
  });

  function variantWithPorts(input: HexDirection, output: HexDirection) {
    const variant = variants.find((candidate) =>
      candidate.family === "river" &&
      candidate.riverPorts[input] === "input" &&
      candidate.riverPorts[output] === "output",
    );
    if (!variant) {
      throw new Error(`Missing river variant with ${input} input and ${output} output`);
    }
    return variant as HexPatchTileVariant;
  }
});
