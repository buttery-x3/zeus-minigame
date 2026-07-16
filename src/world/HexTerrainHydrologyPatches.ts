import { HEX_PATCH_LOCAL_CELLS, type AuthoredPatchDefinition } from "./HexTerrainPatch";
import { LINE_STRAIGHT, patchCell as c } from "./HexTerrainLinearShapes";

const RIVER_APPROACH = [c(-1, 1), c(-1, 2)] as const;
const BROAD_LAKE_EDGE = [c(0, -2), c(1, -2), c(2, -2)] as const;
const RIVER_LAKE_GROUP = {
  selectionGroup: "transition.river-lake",
  selectionGroupWeight: 1,
} as const;

export const HYDROLOGY_AUTHORED_PATCHES: readonly AuthoredPatchDefinition[] = [
  {
    id: "patch.lake.cove",
    family: "lake",
    weight: 3,
    selectionGroup: "lake.cove",
    selectionGroupWeight: 18,
    topology: "endpoint",
    lakeRole: "cove",
    rotations: 6,
    cells: { lake: [c(1, -2), c(0, -1), c(1, -1), c(0, 0)] },
  },
  {
    id: "patch.lake.shore",
    family: "lake",
    weight: 2.5,
    selectionGroup: "lake.shore",
    selectionGroupWeight: 1,
    topology: "mixed",
    lakeRole: "shore",
    rotations: 6,
    cells: { lake: [...BROAD_LAKE_EDGE, c(0, -1), c(1, -1), c(2, -1)] },
  },
  {
    id: "patch.lake.shore.mirror",
    family: "lake",
    weight: 2.5,
    selectionGroup: "lake.shore",
    selectionGroupWeight: 1,
    topology: "mixed",
    lakeRole: "shore",
    rotations: 6,
    cells: { lake: [...BROAD_LAKE_EDGE, c(-1, -1), c(0, -1), c(1, -1)] },
  },
  {
    id: "patch.lake.flare",
    family: "lake",
    weight: 1,
    selectionGroup: "lake.flare",
    selectionGroupWeight: 8,
    topology: "mixed",
    lakeRole: "shore",
    rotations: 6,
    cells: {
      lake: [c(-1, 2), c(-1, 1), c(0, 0), c(0, -1), ...BROAD_LAKE_EDGE],
    },
  },
  {
    id: "patch.lake.core",
    family: "lake",
    weight: 0.35,
    topology: "mixed",
    lakeRole: "core",
    cells: { lake: HEX_PATCH_LOCAL_CELLS },
  },
  riverLakeMouth("patch.transition.river-lake", [c(1, -2), c(0, -1), c(1, -1), c(0, 0)]),
  riverLakeMouth("patch.transition.river-lake-mouth", [c(0, 0), c(0, -1), ...BROAD_LAKE_EDGE]),
  riverLakeMouth("patch.transition.river-lake-mouth.thick", [
    c(0, 0), c(0, -1), c(1, -1), c(2, -1), ...BROAD_LAKE_EDGE,
  ]),
  riverLakeMouth("patch.transition.river-lake-mouth.thick-mirror", [
    c(0, 0), c(-1, -1), c(0, -1), c(1, -1), ...BROAD_LAKE_EDGE,
  ]),
  riverLakeMouth("patch.transition.river-lake-mouth.tight-left.center", [
    c(0, 0), c(-1, 0), c(-2, 1),
  ]),
  riverLakeMouth("patch.transition.river-lake-mouth.tight-left.inner", [
    c(0, 0), c(-1, 0), c(-2, 1), c(-2, 0),
  ]),
  riverLakeMouth("patch.transition.river-lake-mouth.tight-left.outer", [
    c(0, 0), c(-1, 0), c(-2, 0),
  ]),
  riverLakeMouth("patch.transition.river-lake-mouth.tight-right.center", [
    c(0, 0), c(1, 0), c(1, 1),
  ]),
  riverLakeMouth("patch.transition.river-lake-mouth.tight-right.inner", [
    c(0, 0), c(1, 0), c(1, 1), c(2, 0),
  ]),
  riverLakeMouth("patch.transition.river-lake-mouth.tight-right.outer", [
    c(0, 0), c(1, 0), c(2, 0),
  ]),
  {
    id: "patch.transition.cliff-river",
    family: "transition",
    weight: 1,
    topology: "mixed",
    riverTerminal: "cliff",
    riverFlow: { inputs: [], outputs: ["e"] },
    rotations: 6,
    cells: {
      wall: LINE_STRAIGHT,
      river: [c(2, -1), c(1, 0), c(0, 1)],
    },
  },
];

function riverLakeMouth(id: string, lake: readonly ReturnType<typeof c>[]): AuthoredPatchDefinition {
  return {
    id,
    family: "transition",
    weight: 1.5,
    ...RIVER_LAKE_GROUP,
    topology: "mixed",
    riverTerminal: "lake",
    riverFlow: { inputs: ["sw"], outputs: [] },
    lakeRole: "mouth",
    rotations: 6,
    cells: { river: RIVER_APPROACH, lake },
  };
}
