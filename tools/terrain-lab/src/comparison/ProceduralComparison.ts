import { synthesizeProceduralPatch } from "../../../../src/world/ProceduralTerrainPatch";
import { inspectTerrainVariant } from "../../../../src/world/TerrainInspectionSnapshot";
import type { HexPatchTileVariant } from "../../../../src/world/HexTerrainPatch";
import { element } from "../dom";
import { createPatchSvg } from "../patch/PatchSvg";

export function createProceduralComparison(authored: HexPatchTileVariant, seed: number) {
  const root = element("details", "comparison detail-panel");
  root.dataset.state = "collapsed";
  root.append(element("summary", "comparison-toggle", "Compare procedural fallback for these edges"));
  const content = element("div", "comparison-content");
  content.append(
    element("p", "comparison-explainer",
      "Boundary-only fallback preview: the selected orientation's exact six edge signatures are fixed while the real procedural solver fills its interior.",
    ),
    element("p", "muted",
      "This does not include neighboring patches, committed-world topology, hydrology acceptance, or normal candidate selection. It is not a prediction of World Explorer generation.",
    ),
  );
  const resultHost = element("div", "comparison-result");
  const advanced = element("details", "comparison-advanced");
  advanced.append(element("summary", undefined, "Advanced solver seed"));
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.value = String(seed);
  seedInput.setAttribute("aria-label", "Procedural fallback seed");
  const rerun = element("button", undefined, "Re-run preview");
  rerun.type = "button";
  rerun.addEventListener("click", () => renderResult(authored, Number(seedInput.value) || 0, resultHost));
  advanced.append(seedInput, rerun);
  content.append(advanced, resultHost);
  root.append(content);
  root.addEventListener("toggle", (event) => {
    if (event.target !== root) return;
    root.dataset.state = root.open ? "expanded" : "collapsed";
    if (root.open && !resultHost.childElementCount) renderResult(authored, seed, resultHost);
  });
  return root;
}

function renderResult(authored: HexPatchTileVariant, seed: number, host: HTMLElement) {
  host.replaceChildren();
  const result = synthesizeProceduralPatch(authored.edges, seed, { preferFastTermination: true });
  if (!result.ok) {
    host.append(element("p", "warning", `No procedural realization: ${result.reason}`));
    return;
  }
  const authoredInspection = inspectTerrainVariant(authored);
  const proceduralInspection = inspectTerrainVariant(result.variant);
  const views = element("div", "comparison-grid");
  views.append(
    comparisonPatch("Selected authored interior", authoredInspection),
    comparisonPatch("Boundary-only procedural interior", proceduralInspection),
  );
  host.append(views);
  const authoredFeatures = authoredInspection.analysis.components.filter((component) => component.structure !== "open").length;
  const proceduralFeatures = proceduralInspection.analysis.components.filter((component) => component.structure !== "open").length;
  host.append(element("p", "comparison-summary",
    `${result.attemptedAssignments} assignment${result.attemptedAssignments === 1 ? "" : "s"}; ` +
    `feature components ${authoredFeatures} → ${proceduralFeatures}; ` +
    `feature contacts ${featureContactCount(authoredInspection)} → ${featureContactCount(proceduralInspection)}.`,
  ));
}

function comparisonPatch(title: string, inspection: ReturnType<typeof inspectTerrainVariant>) {
  const article = element("article", "comparison-patch");
  article.append(element("h4", undefined, title), createPatchSvg(inspection, { labels: false, components: true }));
  return article;
}

function featureContactCount(inspection: ReturnType<typeof inspectTerrainVariant>) {
  return inspection.analysis.contacts.filter((contact) => contact.structureA !== "open" && contact.structureB !== "open").length;
}
