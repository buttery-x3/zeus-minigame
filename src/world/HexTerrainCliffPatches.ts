import { HEX_PATCH_LOCAL_CELLS, type AuthoredPatchDefinition } from "./HexTerrainPatch";
import {
  CENTER_RING,
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
  patchCell as c,
} from "./HexTerrainLinearShapes";

export const CLIFF_AUTHORED_PATCHES: readonly AuthoredPatchDefinition[] = [
  {
    id: "patch.rock.island",
    family: "cliff",
    weight: 4,
    topology: "isolated",
    cells: { wall: [c(0, 0)] },
  },
  {
    id: "patch.rock.pair",
    family: "cliff",
    weight: 2,
    topology: "isolated",
    rotations: 6,
    cells: { wall: [c(0, 0), c(1, -1)] },
  },
  {
    id: "patch.cliff.endpoint",
    family: "cliff",
    weight: 3,
    selectionGroup: "cliff.endpoint",
    selectionGroupWeight: 18,
    topology: "endpoint",
    rotations: 6,
    cells: { wall: [c(1, -2), c(1, -1), c(0, 0)] },
  },
  ...straightCliffPatches(),
  ...bendCliffPatches(),
  {
    id: "patch.cliff.junction",
    family: "cliff",
    weight: 1.5,
    topology: "junction",
    rotations: 6,
    cells: { wall: LINE_FORK },
  },
  {
    id: "patch.cliff.mass",
    family: "cliff",
    weight: 2,
    topology: "isolated",
    cells: { wall: CENTER_RING },
  },
  {
    id: "patch.cliff.core",
    family: "cliff",
    weight: 0.5,
    topology: "isolated",
    cells: { wall: HEX_PATCH_LOCAL_CELLS },
  },
];

function straightCliffPatches(): AuthoredPatchDefinition[] {
  const layouts = [
    ["ridge", 6, LINE_STRAIGHT],
    ["ridge.sway", 5, LINE_SWAY],
    ["ridge.sway.mirror", 5, LINE_SWAY_MIRROR],
    ["ridge.dogleg-a", 4, LINE_DOGLEG_A],
    ["ridge.dogleg-b", 4, LINE_DOGLEG_B],
  ] as const;
  return layouts.map(([name, weight, wall]) => ({
    id: `patch.cliff.${name}`,
    family: "cliff",
    weight,
    selectionGroup: "cliff.straight",
    selectionGroupWeight: 30,
    topology: "straight",
    rotations: 6,
    cells: { wall },
  }));
}

function bendCliffPatches(): AuthoredPatchDefinition[] {
  return [
    ["bend", 4, "cliff.tight-bend", 12, "tight-bend", TIGHT_BEND],
    ["bend.alternate", 4, "cliff.tight-bend", 12, "tight-bend", TIGHT_BEND_ALTERNATE],
    ["bend.gentle-a", 5, "cliff.gentle-bend", 15, "gentle-bend", GENTLE_BEND_A],
    ["bend.gentle-b", 5, "cliff.gentle-bend", 15, "gentle-bend", GENTLE_BEND_B],
  ].map(([name, weight, selectionGroup, selectionGroupWeight, topology, wall]) => ({
    id: `patch.cliff.${name}`,
    family: "cliff",
    weight,
    selectionGroup,
    selectionGroupWeight,
    topology,
    rotations: 6,
    cells: { wall },
  })) as AuthoredPatchDefinition[];
}
