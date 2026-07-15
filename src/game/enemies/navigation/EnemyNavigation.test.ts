import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { EnemyState } from "../../../types";
import { GridWorld } from "../../../world/GridWorld";
import { createTerrainCell, type TerrainProvider } from "../../../world/TerrainProvider";
import { CollisionSystem } from "../../collision/CollisionSystem";
import { Profiler } from "../../perf/Profiler";
import { EnemyNavigation } from "./EnemyNavigation";

class OpenTerrainProvider implements TerrainProvider {
  getCell(q: number, r: number) {
    return createTerrainCell(q, r, "open", "grass");
  }

  getDiagnostics() {
    return {};
  }
}

describe("enemy navigation recovery", () => {
  it("keeps a direct-mode fallback alive after movement stalls", () => {
    const world = new GridWorld(new OpenTerrainProvider());
    const navigation = new EnemyNavigation(world, new CollisionSystem(world), new Profiler());
    const enemy = createEnemy();
    const player = world.cellToWorldPoint({ q: 4, r: 0 });

    navigation.getTarget(enemy, player);
    expect(enemy.navigationMode).toBe("direct");
    navigation.recordMovement(enemy, 0, 0.8, player, true);
    expect(enemy.pathQueued).toBe(true);

    const waitingTarget = navigation.getTarget(enemy, player);
    expect(enemy.navigationMode).toBe("waiting");
    expect(waitingTarget.distanceTo(enemy.group.position)).toBe(0);

    const fallback = navigation.getWorkSources().find((source) => source.id === "fallback");
    for (let step = 0; fallback?.hasWork() && step < 50; step += 1) {
      fallback.runSlice(Number.POSITIVE_INFINITY);
    }

    expect(enemy.pathQueued).toBe(false);
    expect(enemy.path.length).toBeGreaterThan(0);
    navigation.getTarget(enemy, player);
    expect(enemy.navigationMode).toBe("fallback");
  });
});

function createEnemy(): EnemyState {
  const group = new THREE.Group();
  return {
    id: 12,
    group,
    character: {} as EnemyState["character"],
    path: [],
    pathQueued: false,
    hp: 1,
    maxHp: 1,
    speed: 6,
    touchCooldown: 0,
    flashTimer: 0,
    visibilityHintTimer: 0,
    stallTimer: 0,
    navigationMode: "waiting",
  };
}
