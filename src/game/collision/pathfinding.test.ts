import { describe, expect, it } from "vitest";
import { PLAYER_COLLISION_RADIUS } from "../../config";
import { GridWorld } from "../../world/GridWorld";
import { createTerrainCell, type TerrainProvider } from "../../world/TerrainProvider";
import { LinecastJob } from "./linecast";
import { PathResolutionJob } from "./PathResolutionJob";
import { PathSearchJob } from "./pathfinding";

class TestTerrainProvider implements TerrainProvider {
  constructor(private readonly blocked = new Set<string>()) {}

  getCell(q: number, r: number) {
    return createTerrainCell(q, r, this.blocked.has(`${q},${r}`) ? "wall" : "open", "grass");
  }

  getGeneratedCell(q: number, r: number) {
    return this.getCell(q, r);
  }

  getDiagnostics() {
    return {};
  }
}

describe("scheduled pathfinding", () => {
  it("resumes clear and blocked linecasts across small work units", () => {
    const openWorld = new GridWorld(new TestTerrainProvider());
    const start = openWorld.cellToWorldPoint({ q: 0, r: 0 });
    const goal = openWorld.cellToWorldPoint({ q: 6, r: 0 });
    const clear = new LinecastJob(openWorld, start, goal, PLAYER_COLLISION_RADIUS);
    let clearSteps = 0;
    while (!clear.isComplete() && clearSteps < 20) {
      clear.step(Number.POSITIVE_INFINITY, 1);
      clearSteps += 1;
    }
    expect(clearSteps).toBeGreaterThan(1);
    expect(clear.isClear()).toBe(true);

    const blockedWorld = new GridWorld(new TestTerrainProvider(new Set(["3,0"])));
    const blocked = new LinecastJob(blockedWorld, start, goal, PLAYER_COLLISION_RADIUS);
    while (!blocked.isComplete()) {
      blocked.step(Number.POSITIVE_INFINITY, 1);
    }
    expect(blocked.isClear()).toBe(false);
  });

  it("finds and smooths a route around a blocker incrementally", () => {
    const world = new GridWorld(new TestTerrainProvider(new Set(["1,0", "2,0"])));
    const start = world.cellToWorldPoint({ q: 0, r: 0 });
    const goal = world.cellToWorldPoint({ q: 4, r: 0 });
    const job = new PathSearchJob(world, start, goal, { radius: PLAYER_COLLISION_RADIUS });
    let steps = 0;
    while (!job.isComplete() && steps < 5000) {
      job.step(Number.POSITIVE_INFINITY, 1);
      steps += 1;
    }

    expect(job.isComplete()).toBe(true);
    expect(job.getResult()).not.toBeNull();
    expect(job.getResult()?.waypoints.length).toBeGreaterThan(1);
    expect(job.diagnostics().iterations).toBeGreaterThan(0);
  });

  it("resolves a blocked request to a nearby reachable destination", () => {
    const world = new GridWorld(new TestTerrainProvider(new Set(["3,0"])));
    const start = world.cellToWorldPoint({ q: 0, r: 0 });
    const blockedTarget = world.cellToWorldPoint({ q: 3, r: 0 });
    const job = new PathResolutionJob(world, start, blockedTarget, PLAYER_COLLISION_RADIUS, {
      maxCandidatePathAttempts: 4,
    });
    let steps = 0;
    while (!job.isComplete() && steps < 10000) {
      job.step(Number.POSITIVE_INFINITY);
      steps += 1;
    }

    const result = job.getResult();
    expect(result).not.toBeNull();
    expect(result?.requestedBlocked).toBe(true);
    expect(world.isBlockedWorld(result?.destination.x ?? 0, result?.destination.z ?? 0)).toBe(false);
  });
});
