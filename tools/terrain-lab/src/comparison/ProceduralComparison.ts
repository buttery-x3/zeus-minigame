import { synthesizeProceduralPatch } from "../../../../src/world/ProceduralTerrainPatch";
import { inspectTerrainVariant } from "../../../../src/world/TerrainInspectionSnapshot";
import type { HexPatchTileVariant } from "../../../../src/world/HexTerrainPatch";
import { element } from "../dom";
import { createPatchSvg } from "../patch/PatchSvg";

export function createProceduralComparison(authored: HexPatchTileVariant, seed: number) {
  const root = element("section", "comparison detail-panel");
  root.append(element("h3", undefined, "Authored vs current procedural result"));
  root.append(element("p", "muted", "Exact six-edge boundary comparison only. Committed-world topology and hydrology checks are not applied."));
  const result = synthesizeProceduralPatch(authored.edges, seed, { preferFastTermination: true });
  if (!result.ok) {
    root.append(element("p", "warning", `No procedural realization: ${result.reason}`));
    return root;
  }
  const authoredInspection = inspectTerrainVariant(authored);
  const proceduralInspection = inspectTerrainVariant(result.variant);
  const views = element("div", "comparison-grid");
  views.append(comparisonPatch("Authored", authoredInspection), comparisonPatch("Procedural", proceduralInspection));
  root.append(views);
  const authoredFeatures = authoredInspection.analysis.components.filter((component) => component.structure !== "open").length;
  const proceduralFeatures = proceduralInspection.analysis.components.filter((component) => component.structure !== "open").length;
  root.append(element("p", "comparison-summary",
    `${result.attemptedAssignments} assignment${result.attemptedAssignments === 1 ? "" : "s"}; ` +
    `feature components ${authoredFeatures} → ${proceduralFeatures}; ` +
    `feature contacts ${featureContactCount(authoredInspection)} → ${featureContactCount(proceduralInspection)}.`,
  ));
  return root;
}

function comparisonPatch(title: string, inspection: ReturnType<typeof inspectTerrainVariant>) {
  const article = element("article", "comparison-patch");
  article.append(element("h4", undefined, title), createPatchSvg(inspection, { labels: false, components: true }));
  return article;
}

function featureContactCount(inspection: ReturnType<typeof inspectTerrainVariant>) {
  return inspection.analysis.contacts.filter((contact) => contact.structureA !== "open" && contact.structureB !== "open").length;
}
