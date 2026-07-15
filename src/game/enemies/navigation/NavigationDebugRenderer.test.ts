import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { EnemyState } from "../../../types";
import { NavigationDebugRenderer } from "../../../render/NavigationDebugRenderer";
import { GridWorld } from "../../../world/GridWorld";
import { createTerrainCell, type TerrainProvider } from "../../../world/TerrainProvider";

class OpenTerrainProvider implements TerrainProvider {
  getCell(q: number, r: number) {
    return createTerrainCell(q, r, "open", "grass");
  }

  getDiagnostics(): unknown {
    return {};
  }
}

describe("navigation debug renderer", () => {
  it("latches sideways movement without target progress and clears all state when disabled", () => {
    const renderer = new NavigationDebugRenderer(new GridWorld(new OpenTerrainProvider()));
    const enemy = createEnemy();
    const target = new THREE.Vector3(4, 0, 0);
    const velocity = new THREE.Vector3(6, 0, 0);
    const attempted = new THREE.Vector3(0.1, 0, 0);
    const actual = new THREE.Vector3(0, 0, 0.1);

    renderer.setMode("stalled");
    for (let index = 0; index < 3; index += 1) {
      renderer.beginSimulationStep();
      renderer.record(enemy, target, velocity, velocity, attempted, actual, "z", 0, 0.2);
    }
    renderer.update();

    expect(renderer.diagnostics()).toMatchObject({
      mode: "stalled",
      trackedEnemies: 1,
      latchedEnemies: 1,
      displayedEnemies: 1,
      renderedSegments: expect.any(Number),
    });
    expect(renderer.diagnostics().stalled[0]).toMatchObject({ id: 7, collision: "z" });

    renderer.setMode("off");
    expect(renderer.diagnostics()).toMatchObject({
      mode: "off",
      trackedEnemies: 0,
      latchedEnemies: 0,
      displayedEnemies: 0,
      renderedSegments: 0,
    });
    renderer.dispose();
  });
});

function createEnemy() {
  return {
    id: 7,
    group: new THREE.Group(),
    path: [],
    pathQueued: false,
    stallTimer: 0,
    navigationMode: "direct",
  } as unknown as EnemyState;
}
