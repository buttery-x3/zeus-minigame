import type { TerrainStructure } from "../types";
import {
  TERRAIN_CONTENT_BUCKETS,
  TERRAIN_FAMILY_BUCKETS,
  TERRAIN_STRUCTURE_BUCKETS,
  createTerrainCompositionReport,
  type CompositionBreakdown,
  type GeneratedTerrainSnapshot,
  type TerrainCompositionReport,
  type TerrainCompositionWindow,
  type TerrainContentBucket,
  type TerrainFamilyBucket,
} from "./TerrainCompositionReport";

export type TerrainCompositionAnalysis = {
  reports: TerrainCompositionReport[];
  families: CompositionBreakdown<TerrainFamilyBucket>;
  contents: CompositionBreakdown<TerrainContentBucket>;
  structures: CompositionBreakdown<TerrainStructure>;
  patchesContaining: Record<"wall" | "river" | "lake", number>;
  violations: string[];
};

const DOMINANCE_LIMIT_PERCENT = 95;
const LOCAL_FEATURELESS_LIMIT_PERCENT = 95;

export function analyzeTerrainComposition(
  snapshots: readonly GeneratedTerrainSnapshot[],
  localPatchRadius: number,
): TerrainCompositionAnalysis {
  const reports = snapshots.map((snapshot) => createTerrainCompositionReport(snapshot, { localPatchRadius }));
  const families = sumBreakdowns(TERRAIN_FAMILY_BUCKETS, reports.map((report) => report.families));
  const contents = sumBreakdowns(TERRAIN_CONTENT_BUCKETS, reports.map((report) => report.contents));
  const structures = sumBreakdowns(TERRAIN_STRUCTURE_BUCKETS, reports.map((report) => report.structures));
  const patchesContaining = sumContaining(reports);
  const violations: string[] = [];

  requirePresent(violations, "selected family", families.counts, TERRAIN_FAMILY_BUCKETS);
  requirePresent(violations, "patch content", contents.counts, TERRAIN_CONTENT_BUCKETS);
  requirePresent(violations, "patch feature", patchesContaining, ["wall", "river", "lake"]);
  requirePresent(violations, "final structure", structures.counts, ["open", "wall", "river", "lake"]);
  if (families.counts.cliff === 0) {
    violations.push("ordinary authored cliff patches disappeared from the complete sample");
  }
  rejectDominance(violations, "selected family", families.percentages);
  rejectDominance(violations, "patch content", contents.percentages);

  for (const report of reports) {
    if (report.windows.length === 0) {
      violations.push(`seed ${report.seed} produced no complete radius-${localPatchRadius} local windows`);
    }
    for (const window of report.windows) {
      const label = `seed ${report.seed} window ${window.q},${window.r}`;
      if (window.contents.percentages.featureless > LOCAL_FEATURELESS_LIMIT_PERCENT) {
        violations.push(`${label} was ${formatPercent(window.contents.percentages.featureless)} featureless (limit ${LOCAL_FEATURELESS_LIMIT_PERCENT}%)`);
      }
      if (window.structures.percentages.open >= 100) {
        violations.push(`${label} contained only open final microcells`);
      }
    }
  }

  return { reports, families, contents, structures, patchesContaining, violations };
}

export function formatTerrainCompositionFailure(analysis: TerrainCompositionAnalysis, elapsedMs: number) {
  const windows = analysis.reports.flatMap((report) => report.windows.map((window) => ({ seed: report.seed, window })));
  const lines = [
    "Terrain composition catastrophe report",
    `seeds=${analysis.reports.map((report) => report.seed).join(",")} elapsed=${elapsedMs.toFixed(1)}ms ` +
      `patches=${analysis.families.total} microcells=${analysis.structures.total} windows=${windows.length}`,
    `violations=${analysis.violations.join(" | ") || "none"}`,
    formatBreakdown("aggregate families", analysis.families),
    formatBreakdown("aggregate contents", analysis.contents),
    formatBreakdown("aggregate structures", analysis.structures),
    `aggregate patches containing=${JSON.stringify(analysis.patchesContaining)}`,
    ...analysis.reports.flatMap((report) => [
      `seed ${report.seed}: patches=${report.families.total} microcells=${report.structures.total} windows=${report.windows.length}`,
      formatBreakdown("  families", report.families),
      formatBreakdown("  contents", report.contents),
      formatBreakdown("  structures", report.structures),
    ]),
    ...formatVariance(analysis.reports, "families", TERRAIN_FAMILY_BUCKETS),
    ...formatVariance(analysis.reports, "contents", TERRAIN_CONTENT_BUCKETS),
    ...formatVariance(analysis.reports, "structures", TERRAIN_STRUCTURE_BUCKETS),
    "worst local windows:",
    ...formatWorstWindows(windows),
  ];
  return lines.join("\n");
}

function sumBreakdowns<K extends string>(keys: readonly K[], breakdowns: readonly CompositionBreakdown<K>[]) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const breakdown of breakdowns) {
    for (const key of keys) counts[key] += breakdown.counts[key];
  }
  const total = keys.reduce((sum, key) => sum + counts[key], 0);
  const percentages = Object.fromEntries(keys.map((key) => [key, total === 0 ? 0 : counts[key] / total * 100])) as Record<K, number>;
  return { total, counts, percentages };
}

function sumContaining(reports: readonly TerrainCompositionReport[]) {
  return reports.reduce((sum, report) => ({
    wall: sum.wall + report.patchesContaining.wall,
    river: sum.river + report.patchesContaining.river,
    lake: sum.lake + report.patchesContaining.lake,
  }), { wall: 0, river: 0, lake: 0 });
}

function requirePresent<K extends string>(violations: string[], label: string, counts: Record<K, number>, keys: readonly K[]) {
  for (const key of keys) {
    if (counts[key] === 0) violations.push(`${label} ${key} was never selected or generated`);
  }
}

function rejectDominance<K extends string>(violations: string[], label: string, percentages: Record<K, number>) {
  for (const [key, percentage] of Object.entries(percentages) as [K, number][]) {
    if (percentage > DOMINANCE_LIMIT_PERCENT) {
      violations.push(`${label} ${key} reached ${formatPercent(percentage)} (limit ${DOMINANCE_LIMIT_PERCENT}%)`);
    }
  }
}

function formatBreakdown<K extends string>(label: string, breakdown: CompositionBreakdown<K>) {
  const values = Object.keys(breakdown.counts).map((key) =>
    `${key}=${breakdown.counts[key as K]} (${formatPercent(breakdown.percentages[key as K])})`,
  );
  return `${label}: ${values.join(", ")}`;
}

function formatVariance<K extends string>(reports: readonly TerrainCompositionReport[], level: "families" | "contents" | "structures", keys: readonly K[]) {
  return keys.map((key) => {
    const values = reports.map((report) => (report[level] as CompositionBreakdown<K>).percentages[key]);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
    return `per-seed ${level}.${key}: mean=${formatPercent(mean)} min=${formatPercent(Math.min(...values))} ` +
      `max=${formatPercent(Math.max(...values))} variance=${variance.toFixed(4)} stddev=${Math.sqrt(variance).toFixed(2)}`;
  });
}

function formatWorstWindows(entries: readonly { seed: number; window: TerrainCompositionWindow }[]) {
  const featureless = [...entries].sort((a, b) => b.window.contents.percentages.featureless - a.window.contents.percentages.featureless).slice(0, 3);
  const open = [...entries].sort((a, b) => b.window.structures.percentages.open - a.window.structures.percentages.open).slice(0, 3);
  const familyMinima = TERRAIN_FAMILY_BUCKETS.map((family) => ({
    family,
    entry: [...entries].sort((a, b) => a.window.families.percentages[family] - b.window.families.percentages[family])[0],
  })).filter((item) => item.entry);
  return [
    ...featureless.map((entry) => formatWindow("featureless", entry)),
    ...open.map((entry) => formatWindow("open", entry)),
    ...familyMinima.map((item) => formatWindow(`lowest-${item.family}`, item.entry)),
  ];
}

function formatWindow(reason: string, entry: { seed: number; window: TerrainCompositionWindow }) {
  const variants = Object.entries(entry.window.variantCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const percentages = {
    families: entry.window.families.percentages,
    contents: entry.window.contents.percentages,
    structures: entry.window.structures.percentages,
  };
  return `  ${reason} seed=${entry.seed} center=${entry.window.q},${entry.window.r} ` +
    `families=${JSON.stringify(entry.window.families.counts)} contents=${JSON.stringify(entry.window.contents.counts)} ` +
    `structures=${JSON.stringify(entry.window.structures.counts)} percentages=${JSON.stringify(percentages)} ` +
    `variants=${JSON.stringify(variants)}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}
