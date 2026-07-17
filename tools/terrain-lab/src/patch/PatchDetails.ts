import { HEX_DIRECTION_ORDER } from "../../../../src/world/hexCoordinates";
import type { TerrainVariantInspection } from "../../../../src/world/TerrainInspectionSnapshot";
import { element } from "../dom";

export function createPatchDetails(variant: TerrainVariantInspection) {
  const root = element("div", "details-stack");
  root.append(metadata(variant), edges(variant), components(variant), contacts(variant), warnings(variant));
  return root;
}

function metadata(variant: TerrainVariantInspection) {
  const section = panel("Metadata");
  const grid = element("dl", "metadata-grid");
  const entries = [
    ["ID", variant.id], ["Family", variant.family], ["Provenance", variant.provenance],
    ["Topology", variant.topology], ["Weight", String(variant.weight)],
    ["Selection group", `${variant.selectionGroup} (${variant.selectionGroupWeight})`],
    ["River terminal", variant.riverTerminal ?? "—"], ["Lake role", variant.lakeRole ?? "—"],
    ["River flow", Object.entries(variant.riverPorts).map(([direction, port]) => `${direction} ${port}`).join(", ") || "—"],
  ];
  for (const [term, value] of entries) grid.append(element("dt", undefined, term), element("dd", undefined, value));
  section.append(grid);
  return section;
}

function edges(variant: TerrainVariantInspection) {
  const section = panel("Six edge signatures");
  const list = element("div", "edge-list");
  for (const direction of HEX_DIRECTION_ORDER) {
    const row = element("div", "edge-row");
    row.append(element("strong", undefined, direction.toUpperCase()));
    for (const kind of variant.edges[direction]) row.append(element("span", `socket socket-${kind}`, kind[0].toUpperCase()));
    list.append(row);
  }
  section.append(list);
  return section;
}

function components(variant: TerrainVariantInspection) {
  const section = disclosure(`Components (${variant.analysis.components.length})`);
  for (const component of variant.analysis.components) {
    const row = element("div", "fact-row");
    row.append(element("strong", undefined, component.id));
    row.append(element("span", undefined, `${component.cells.length} cells`));
    row.append(element("span", undefined, component.boundaryDirections.length
      ? `ports: ${component.boundaryDirections.join(", ")}` : "internal only"));
    section.append(row);
  }
  if (variant.analysis.disconnectedBoundaryStructures.length) {
    section.append(element("p", "warning", `Disconnected boundary arms: ${variant.analysis.disconnectedBoundaryStructures.join(", ")}`));
  }
  return section;
}

function contacts(variant: TerrainVariantInspection) {
  const section = disclosure(`Internal contacts (${variant.analysis.contacts.length})`);
  const featureContacts = variant.analysis.contacts.filter((contact) => contact.structureA !== "open" && contact.structureB !== "open");
  section.append(element("p", featureContacts.length ? undefined : "muted", featureContacts.length
    ? featureContacts.map((contact) => `${contact.componentA} ↔ ${contact.componentB} (${contact.edges.length})`).join("; ")
    : "No contacts between non-open features."));
  return section;
}

function warnings(variant: TerrainVariantInspection) {
  const section = disclosure(`Warnings (${variant.analysis.warnings.length})`, variant.analysis.warnings.length > 0);
  if (!variant.analysis.warnings.length) section.append(element("p", "good", "Metadata agrees with current structural checks."));
  for (const warning of variant.analysis.warnings) section.append(element("p", "warning", warning));
  return section;
}

function panel(title: string) {
  const section = element("section", "detail-panel");
  section.append(element("h3", undefined, title));
  return section;
}

function disclosure(title: string, open = false) {
  const section = element("details", "detail-panel detail-disclosure");
  section.open = open;
  section.append(element("summary", undefined, title));
  return section;
}
