import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ENEMY_FALLBACK_QUEUE_TIMEOUT_SECONDS,
  TILE_SIZE,
} from "../../../config";
import type { EnemyState } from "../../../types";
import { GridWorld } from "../../../world/GridWorld";
import { createStaticTerrainProvider } from "../../../world/StaticTerrainProvider.test-support";
import { createTerrainCell } from "../../../world/TerrainProvider";
import { CollisionSystem } from "../../collision/CollisionSystem";
import { Profiler } from "../../perf/Profiler";
import { EnemyNavigation } from "./EnemyNavigation";

function createTestTerrainProvider(blocked = new Set<string>()) {
  return createStaticTerrainProvider((q, r) =>
    createTerrainCell(q, r, blocked.has(`${q},${r}`) ? "wall" : "open", "grass"),
  );
}

describe("enemy navigation recovery", () => {
  it("does not queue Theta* for a direct-mode crowd stall with a populated flow field", () => {
    const { world, navigation } = createNavigation();
    const player = world.cellToWorldPoint({ q: 0, r: 0 });
    buildFlow(navigation, player);
    const enemy = createEnemy(12, world.cellToWorldPoint({ q: 4, r: 0 }));

    navigation.getTarget(enemy, player);
    expect(enemy.navigationMode).toBe("direct");
    navigation.recordMovement(enemy, 0, 0.8, player, true);

    expect(enemy.pathQueued).toBe(false);
    expect(enemy.path).toHaveLength(0);
    expect(navigation.getFallbackDiagnostics().active).toBe(0);
  });

  it("cancels a queued player route when its goal becomes stale", () => {
    const { world, navigation } = createNavigation(new Set(["2,0"]));
    const originalPlayer = world.cellToWorldPoint({ q: 0, r: 0 });
    const movedPlayer = world.cellToWorldPoint({ q: -4, r: 0 });
    const enemy = createEnemy(13, world.cellToWorldPoint({ q: 4, r: 0 }));
    buildFlow(navigation, originalPlayer);

    queueFlowFallback(navigation, enemy, originalPlayer);
    expect(enemy.pathQueued).toBe(true);

    navigation.getTarget(enemy, movedPlayer);
    expect(enemy.pathQueued).toBe(false);
    expect(enemy.path).toHaveLength(0);
    expect(navigation.getFallbackDiagnostics().active).toBe(0);
    expect(enemy.navigationMode).toBe("flow");
  });

  it("releases an enemy that waits too long for the fallback queue", () => {
    const { world, navigation } = createNavigation(new Set(["2,0"]));
    const player = world.cellToWorldPoint({ q: 0, r: 0 });
    const enemy = createEnemy(14, world.cellToWorldPoint({ q: 4, r: 0 }));
    buildFlow(navigation, player);
    queueFlowFallback(navigation, enemy, player);

    const waitingTarget = navigation.getTarget(enemy, player);
    expect(waitingTarget.distanceTo(enemy.group.position)).toBe(0);
    navigation.recordMovement(
      enemy,
      0,
      ENEMY_FALLBACK_QUEUE_TIMEOUT_SECONDS + 0.1,
      player,
      false,
    );

    expect(enemy.pathQueued).toBe(false);
    expect(navigation.getFallbackDiagnostics().active).toBe(0);
    navigation.getTarget(enemy, player);
    expect(enemy.navigationMode).toBe("flow");
  });

  it("returns to the flow after a fallback makes a local detour", () => {
    const { world, navigation } = createNavigation(new Set(["2,0"]));
    const player = world.cellToWorldPoint({ q: 0, r: 0 });
    const enemy = createEnemy(15, world.cellToWorldPoint({ q: 4, r: 0 }));
    buildFlow(navigation, player);
    queueFlowFallback(navigation, enemy, player);
    finishFallbackQueue(navigation);

    expect(enemy.path.at(-1)?.distanceTo(player)).toBeLessThan(0.001);
    navigation.getTarget(enemy, player);
    expect(enemy.navigationMode).toBe("fallback");
    expect(enemy.path.length).toBeGreaterThan(0);
    navigation.recordMovement(enemy, TILE_SIZE * 1.1, 0.1, player, true);
    navigation.getTarget(enemy, player);

    expect(enemy.navigationMode).toBe("flow");
    expect(enemy.path).toHaveLength(0);
    expect(navigation.getFallbackDiagnostics().active).toBe(0);
  });
});

function createNavigation(blocked = new Set<string>()) {
  const world = new GridWorld(createTestTerrainProvider(blocked));
  return {
    world,
    navigation: new EnemyNavigation(world, new CollisionSystem(world), new Profiler()),
  };
}

function buildFlow(navigation: EnemyNavigation, player: THREE.Vector3) {
  navigation.beginFrame(player);
  const flow = navigation.getWorkSources().find((source) => source.id === "flow");
  for (let step = 0; flow?.hasWork() && step < 1000; step += 1) {
    flow.runSlice(Number.POSITIVE_INFINITY);
  }
  expect(navigation.getDiagnostics().flow.visited).toBeGreaterThan(0);
}

function queueFlowFallback(navigation: EnemyNavigation, enemy: EnemyState, player: THREE.Vector3) {
  enemy.navigationMode = "flow";
  navigation.recordMovement(enemy, 0, 0.8, player, true);
}

function finishFallbackQueue(navigation: EnemyNavigation) {
  const fallback = navigation.getWorkSources().find((source) => source.id === "fallback");
  for (let step = 0; fallback?.hasWork() && step < 1000; step += 1) {
    fallback.runSlice(Number.POSITIVE_INFINITY);
  }
}

function createEnemy(id: number, position: THREE.Vector3): EnemyState {
  const group = new THREE.Group();
  group.position.copy(position);
  return {
    id,
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
