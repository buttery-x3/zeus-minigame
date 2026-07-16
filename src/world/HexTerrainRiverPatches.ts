import type { AuthoredPatchDefinition } from "./HexTerrainPatch";
import {
  GENTLE_BEND_A,
  GENTLE_BEND_B,
  LINE_DOGLEG_A,
  LINE_DOGLEG_B,
  LINE_FORK,
  LINE_STRAIGHT,
  LINE_SWAY,
  LINE_SWAY_MIRROR,
  TIGHT_BEND,
  TIGHT_BEND_ALTERNATE,
} from "./HexTerrainLinearShapes";

export const RIVER_AUTHORED_PATCHES: readonly AuthoredPatchDefinition[] = [
  ...straightRiverPatches(),
  ...bendRiverPatches(),
  {
    id: "patch.river.fork",
    family: "river",
    weight: 2,
    selectionGroup: "river.junction",
    selectionGroupWeight: 2,
    topology: "junction",
    riverFlow: { inputs: ["ne", "e"], outputs: ["sw"] },
    rotations: 6,
    cells: { river: LINE_FORK },
  },
];

function straightRiverPatches(): AuthoredPatchDefinition[] {
  const layouts = [
    ["line", 12, LINE_STRAIGHT],
    ["line.sway", 10, LINE_SWAY],
    ["line.sway.mirror", 10, LINE_SWAY_MIRROR],
    ["line.dogleg-a", 8, LINE_DOGLEG_A],
    ["line.dogleg-b", 8, LINE_DOGLEG_B],
  ] as const;
  return layouts.map(([name, weight, river]) => ({
    id: `patch.river.${name}`,
    family: "river",
    weight,
    selectionGroup: "river.straight",
    selectionGroupWeight: 5,
    topology: "straight",
    riverFlow: { inputs: ["ne"], outputs: ["sw"], reversible: true },
    rotations: 6,
    cells: { river },
  }));
}

function bendRiverPatches(): AuthoredPatchDefinition[] {
  return [
    ["bend", "river.tight-bend", "tight-bend", TIGHT_BEND],
    ["bend.alternate", "river.tight-bend", "tight-bend", TIGHT_BEND_ALTERNATE],
    ["bend.gentle-a", "river.gentle-bend", "gentle-bend", GENTLE_BEND_A],
    ["bend.gentle-b", "river.gentle-bend", "gentle-bend", GENTLE_BEND_B],
  ].map(([name, selectionGroup, topology, river]) => ({
    id: `patch.river.${name}`,
    family: "river",
    weight: 8,
    selectionGroup,
    selectionGroupWeight: 15,
    topology,
    riverFlow: {
      inputs: ["ne"],
      outputs: [topology === "tight-bend" ? "e" : "se"],
      reversible: true,
    },
    rotations: 6,
    cells: { river },
  })) as AuthoredPatchDefinition[];
}
