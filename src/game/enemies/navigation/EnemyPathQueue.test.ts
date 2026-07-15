import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { EnemyState } from "../../../types";
import { GridWorld } from "../../../world/GridWorld";
import { createTerrainCell, type TerrainProvider } from "../../../world/TerrainProvider";
import { CollisionSystem } from "../../collision/CollisionSystem";
import { EnemyPathQueue } from "./EnemyPathQueue";

class OpenTerrainProvider implements TerrainProvider {
  getCell(q: number, r: number) {
    return createTerrainCell(q, r, "open", "grass");
  }

  getGeneratedCell(q: number, r: number) {
    return this.getCell(q, r);
  }

  getDiagnostics() {
    return {};
  }
}

describe("EnemyPathQueue", () => {
  it("keeps simultaneous results with their owning enemies", () => {
    const world = new GridWorld(new OpenTerrainProvider());
    const queue = new EnemyPathQueue(new CollisionSystem(world));
    const first = createEnemy(21, world.cellToWorldPoint({ q: 0, r: 0 }));
    const second = createEnemy(22, world.cellToWorldPoint({ q: 10, r: 0 }));
    const firstGoal = world.cellToWorldPoint({ q: 4, r: 0 });
    const secondGoal = world.cellToWorldPoint({ q: 14, r: 0 });

    queue.request(first, firstGoal);
    queue.request(second, secondGoal);
    finishQueue(queue);

    expect(first.path.at(-1)?.distanceTo(firstGoal)).toBeLessThan(0.001);
    expect(second.path.at(-1)?.distanceTo(secondGoal)).toBeLessThan(0.001);
  });

  it("restarts an active request when that enemy receives a newer goal", () => {
    const world = new GridWorld(new OpenTerrainProvider());
    const queue = new EnemyPathQueue(new CollisionSystem(world));
    const enemy = createEnemy(23, world.cellToWorldPoint({ q: 0, r: 0 }));
    const oldGoal = world.cellToWorldPoint({ q: 20, r: 0 });
    const latestGoal = world.cellToWorldPoint({ q: 5, r: 0 });

    queue.request(enemy, oldGoal);
    queue.update(performance.now() - 1);
    queue.request(enemy, latestGoal);
    finishQueue(queue);

    expect(enemy.path.at(-1)?.distanceTo(latestGoal)).toBeLessThan(0.001);
    expect(enemy.path.at(-1)?.distanceTo(oldGoal)).toBeGreaterThan(1);
  });
});

function finishQueue(queue: EnemyPathQueue) {
  for (let step = 0; queue.hasWork() && step < 1000; step += 1) {
    queue.update(Number.POSITIVE_INFINITY);
  }
  expect(queue.hasWork()).toBe(false);
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
