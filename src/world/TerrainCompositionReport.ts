import type { TerrainStructure } from "../types";
import { createTerrainStructureCounts } from "./HexTerrainRules";
import { createHexPatchRegion, microToPatchLocal, type HexPatchFamily, type HexPatchProvenance } from "./HexTerrainPatch";
import { hexCellKey, type HexCoord } from "./hexCoordinates";

export const TERRAIN_FAMILY_BUCKETS = ["open", "cliff", "river", "lake", "transition", "procedural"] as const;
export const TERRAIN_CONTENT_BUCKETS = ["featureless", "wall-bearing", "river-bearing", "lake-bearing", "mixed"] as const;
export const TERRAIN_STRUCTURE_BUCKETS = ["open", "wall", "river", "lake", "bank"] as const;

export type TerrainFamilyBucket = typeof TERRAIN_FAMILY_BUCKETS[number];
export type TerrainContentBucket = typeof TERRAIN_CONTENT_BUCKETS[number];

export type GeneratedTerrainPatchSnapshot = HexCoord & {
  variantId: string;
  provenance: HexPatchProvenance;
  family: HexPatchFamily;
  structureCounts: Record<TerrainStructure, number>;
};

export type GeneratedTerrainCellSnapshot = HexCoord & {
  structure: TerrainStructure;
};

export type GeneratedTerrainSnapshot = {
  seed: number;
  generationVersion: number;
  patches: readonly GeneratedTerrainPatchSnapshot[];
  cells: readonly GeneratedTerrainCellSnapshot[];
};

export type CompositionBreakdown<K extends string> = {
  total: number;
  counts: Record<K, number>;
  percentages: Record<K, number>;
};

export type TerrainCompositionSummary = {
  families: CompositionBreakdown<TerrainFamilyBucket>;
  contents: CompositionBreakdown<TerrainContentBucket>;
  structures: CompositionBreakdown<TerrainStructure>;
  patchesContaining: Record<"wall" | "river" | "lake", number>;
  variantCounts: Record<string, number>;
};

export type TerrainCompositionWindow = HexCoord & TerrainCompositionSummary;

export type TerrainCompositionReport = TerrainCompositionSummary & {
  seed: number;
  generationVersion: number;
  localPatchRadius: number;
  windows: TerrainCompositionWindow[];
};

export function createTerrainCompositionReport(
  snapshot: GeneratedTerrainSnapshot,
  options: { localPatchRadius: number },
): TerrainCompositionReport {
  const cellsByPatch = groupCellsByPatch(snapshot.cells);
  const summary = summarizeTerrainComposition(snapshot.patches, snapshot.cells);
  const patchesByKey = new Map(snapshot.patches.map((patch) => [hexCellKey(patch.q, patch.r), patch]));
  const windowOffsets = createHexPatchRegion(options.localPatchRadius);
  const windows: TerrainCompositionWindow[] = [];

  for (const center of snapshot.patches) {
    const patches = windowOffsets.map((offset) =>
      patchesByKey.get(hexCellKey(center.q + offset.q, center.r + offset.r)),
    );
    if (patches.some((patch) => !patch)) {
      continue;
    }
    const completePatches = patches as GeneratedTerrainPatchSnapshot[];
    const cells = completePatches.flatMap((patch) => cellsByPatch.get(hexCellKey(patch.q, patch.r)) ?? []);
    windows.push({ q: center.q, r: center.r, ...summarizeTerrainComposition(completePatches, cells) });
  }

  windows.sort((a, b) => a.q - b.q || a.r - b.r);
  return {
    seed: snapshot.seed,
    generationVersion: snapshot.generationVersion,
    localPatchRadius: options.localPatchRadius,
    ...summary,
    windows,
  };
}

export function summarizeTerrainStructures(cells: readonly Pick<GeneratedTerrainCellSnapshot, "structure">[]) {
  const counts = createTerrainStructureCounts();
  for (const cell of cells) {
    counts[cell.structure] += 1;
  }
  return createBreakdown(TERRAIN_STRUCTURE_BUCKETS, counts);
}

function summarizeTerrainComposition(
  patches: readonly GeneratedTerrainPatchSnapshot[],
  cells: readonly GeneratedTerrainCellSnapshot[],
): TerrainCompositionSummary {
  const familyCounts = createCounts(TERRAIN_FAMILY_BUCKETS);
  const contentCounts = createCounts(TERRAIN_CONTENT_BUCKETS);
  const patchesContaining = { wall: 0, river: 0, lake: 0 };
  const variantCounts: Record<string, number> = {};

  for (const patch of patches) {
    familyCounts[patch.provenance === "procedural" ? "procedural" : patch.family] += 1;
    contentCounts[classifyPatchContent(patch.structureCounts)] += 1;
    variantCounts[patch.variantId] = (variantCounts[patch.variantId] ?? 0) + 1;
    patchesContaining.wall += Number(patch.structureCounts.wall > 0);
    patchesContaining.river += Number(patch.structureCounts.river > 0);
    patchesContaining.lake += Number(patch.structureCounts.lake > 0);
  }

  return {
    families: createBreakdown(TERRAIN_FAMILY_BUCKETS, familyCounts),
    contents: createBreakdown(TERRAIN_CONTENT_BUCKETS, contentCounts),
    structures: summarizeTerrainStructures(cells),
    patchesContaining,
    variantCounts,
  };
}

function classifyPatchContent(counts: Record<TerrainStructure, number>): TerrainContentBucket {
  const hasWall = counts.wall > 0;
  const hasRiver = counts.river > 0;
  const hasLake = counts.lake > 0;
  const hasBank = counts.bank > 0;
  if (!hasWall && !hasRiver && !hasLake && !hasBank) return "featureless";
  if (hasWall && !hasRiver && !hasLake && !hasBank) return "wall-bearing";
  if (hasRiver && !hasWall && !hasLake) return "river-bearing";
  if (hasLake && !hasWall && !hasRiver) return "lake-bearing";
  return "mixed";
}

function groupCellsByPatch(cells: readonly GeneratedTerrainCellSnapshot[]) {
  const grouped = new Map<string, GeneratedTerrainCellSnapshot[]>();
  for (const cell of cells) {
    const patch = microToPatchLocal(cell).patch;
    const key = hexCellKey(patch.q, patch.r);
    const entries = grouped.get(key) ?? [];
    entries.push(cell);
    grouped.set(key, entries);
  }
  return grouped;
}

function createCounts<K extends string>(keys: readonly K[]) {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function createBreakdown<K extends string>(keys: readonly K[], counts: Record<K, number>): CompositionBreakdown<K> {
  const total = keys.reduce((sum, key) => sum + counts[key], 0);
  const percentages = Object.fromEntries(keys.map((key) => [key, total === 0 ? 0 : counts[key] / total * 100])) as Record<K, number>;
  return { total, counts: { ...counts }, percentages };
}
