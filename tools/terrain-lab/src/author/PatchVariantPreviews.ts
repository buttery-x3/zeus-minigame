import { inspectTerrainVariant } from "../../../../src/world/TerrainInspectionSnapshot";
import { validateTerrainPatchDocument, type TerrainPatchDocument } from "../../../../src/world/TerrainPatchDocument";
import { element } from "../dom";
import { createPatchSvg } from "../patch/PatchSvg";

export function createPatchVariantPreviews(draft: TerrainPatchDocument) {
  const section = element("section", "patch-author-previews");
  section.append(element("h3", undefined, "Generated orientations"));
  const validation = validateTerrainPatchDocument(draft);
  const grid = element("div", "patch-author-preview-grid");
  validation.variants.slice(0, 6).forEach((variant) => {
    const card = element("article", "patch-author-preview-card");
    card.append(element("strong", undefined, variant.id), createPatchSvg(inspectTerrainVariant(variant), { labels: false, components: true }));
    grid.append(card);
  });
  if (!grid.childElementCount) grid.append(element("p", "empty-state", "Valid generated orientations will appear here."));
  section.append(grid);
  return section;
}
