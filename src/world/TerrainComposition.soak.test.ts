import { expect, test } from "vitest";
import { analyzeTerrainComposition, formatTerrainCompositionFailure } from "./TerrainCompositionRegression";
import { WfcTerrainProvider } from "./WfcTerrainProvider";

const SOAK_SEEDS = [
  17, 97, 541, 2027, 7919, 104729, 999983, 1597334677,
  20260517, 20260518, 20260601, 20261231, 0x13579bdf, 0x2468ace0, 0x51ed270b, 0x68bc21eb,
  0x7fffffff, 0x80000000, 0x9e3779b1, 0xa5a5a5a5, 0xc001d00d, 0xdeadbeef, 0xf00dcafe, 0xffffffff,
] as const;

test("deterministic terrain composition soak", { timeout: 300_000 }, () => {
  const startedAt = performance.now();
  const snapshots = SOAK_SEEDS.map((seed) => {
    const provider = new WfcTerrainProvider(seed);
    provider.requestGenerationAround(0, 0, 10);
    provider.stepGeneration(Number.POSITIVE_INFINITY);
    return provider.captureGeneratedTerrainSnapshot({ q: 0, r: 0 }, 10);
  });
  const composition = analyzeTerrainComposition(snapshots, 3);
  const diagnostics = formatTerrainCompositionFailure(composition, performance.now() - startedAt);

  if (composition.violations.length > 0) console.error(diagnostics);
  expect(composition.violations, diagnostics).toEqual([]);
});
