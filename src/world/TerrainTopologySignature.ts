import { HEX_DIRECTION_ORDER } from "./hexCoordinates";
import { analyzeHexPatchVariant } from "./HexTerrainPatchAnalysis";
import type { HexPatchTileVariant } from "./HexTerrainPatch";

export type TerrainTopologySignature = {
  key: string;
  componentCount: number;
  contactCount: number;
  disconnectedStructures: readonly string[];
};

export function createTerrainTopologySignature(variant: HexPatchTileVariant): TerrainTopologySignature {
  const analysis = analyzeHexPatchVariant(variant);
  const components = analysis.components
    .filter((component) => component.structure !== "open" && component.structure !== "bank")
    .map((component) => ({
      sourceId: component.id,
      structure: component.structure,
      ports: component.boundaryPorts
        .map((port) => `${HEX_DIRECTION_ORDER.indexOf(port.direction)}:${port.index}`)
        .sort(),
    }))
    .sort((a, b) => `${a.structure}:${a.ports.join(",")}`.localeCompare(`${b.structure}:${b.ports.join(",")}`));
  const componentIndex = new Map(components.map((component, index) => [component.sourceId, index]));
  const contacts = analysis.contacts
    .filter((contact) => componentIndex.has(contact.componentA) && componentIndex.has(contact.componentB))
    .map((contact) => {
      const a = componentIndex.get(contact.componentA)!;
      const b = componentIndex.get(contact.componentB)!;
      return `${Math.min(a, b)}-${Math.max(a, b)}:${contact.edges.length}`;
    })
    .sort();
  const disconnectedStructures = [...analysis.disconnectedBoundaryStructures].sort();
  const key = [
    components.map((component) => `${component.structure}[${component.ports.join(",")}]`).join(";"),
    `contacts:${contacts.join(",")}`,
    `disconnected:${disconnectedStructures.join(",")}`,
  ].join("|");
  return { key, componentCount: components.length, contactCount: contacts.length, disconnectedStructures };
}
