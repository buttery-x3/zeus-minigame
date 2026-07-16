import {
  HEX_DIRECTION_ORDER,
  type HexDirection,
} from "./hexCoordinates";

export type HexPatchRiverPort = "input" | "output";
export type HexPatchRiverPorts = Partial<Record<HexDirection, HexPatchRiverPort>>;
export type AuthoredPatchRiverFlow = {
  inputs: readonly HexDirection[];
  outputs: readonly HexDirection[];
  reversible?: boolean;
};

export function rotateRiverFlow(flow: AuthoredPatchRiverFlow | undefined, step: number): HexPatchRiverPorts {
  if (!flow) {
    return {};
  }
  return Object.fromEntries([
    ...flow.inputs.map((direction) => [rotateDirection(direction, step), "input"] as const),
    ...flow.outputs.map((direction) => [rotateDirection(direction, step), "output"] as const),
  ]);
}

export function reverseRiverPorts(ports: HexPatchRiverPorts): HexPatchRiverPorts {
  return Object.fromEntries(Object.entries(ports).map(([direction, port]) => [
    direction,
    port === "input" ? "output" : "input",
  ]));
}

export function serializeRiverPorts(ports: HexPatchRiverPorts) {
  return HEX_DIRECTION_ORDER.map((direction) => ports[direction]?.[0] ?? "-").join("");
}

function rotateDirection(direction: HexDirection, step: number) {
  const index = HEX_DIRECTION_ORDER.indexOf(direction);
  return HEX_DIRECTION_ORDER[(index + step) % HEX_DIRECTION_ORDER.length];
}
