import { describe, expect, it } from "vitest";
import { GridWorld } from "../../../world/GridWorld";
import { SeedTerrainProvider } from "../../../world/SeedTerrainProvider";
import { EnemyFlowField } from "./EnemyFlowField";

describe("EnemyFlowField", () => {
  it("keeps the active weighted field while a replacement is built", () => {
    const world = new GridWorld(new SeedTerrainProvider());
    const field = new EnemyFlowField(world, 8);
    const firstRoot = world.cellToWorldPoint({ q: 0, r: 0 });
    field.request(firstRoot);
    let slices = 0;
    while (field.hasWork() && slices < 1000) {
      field.step(Number.POSITIVE_INFINITY, 5);
      slices += 1;
    }

    expect(slices).toBeGreaterThan(1);
    expect(field.diagnostics().playerCell).toEqual({ q: 0, r: 0 });
    expect(field.sample(world.cellToWorldPoint({ q: 2, r: 0 }))).not.toBeNull();

    const secondRoot = world.cellToWorldPoint({ q: 1, r: 0 });
    field.request(secondRoot);
    field.step(Number.POSITIVE_INFINITY, 1);
    expect(field.diagnostics().building).toBe(true);
    expect(field.diagnostics().playerCell).toEqual({ q: 0, r: 0 });

    while (field.hasWork()) {
      field.step(Number.POSITIVE_INFINITY, 5);
    }
    expect(field.diagnostics().playerCell).toEqual({ q: 1, r: 0 });
    expect(field.diagnostics().completedBuilds).toBe(2);
    expect(field.diagnostics().walkableCacheSize).toBeGreaterThan(0);
  });

  it("coalesces moving roots without discarding the active build", () => {
    const world = new GridWorld(new SeedTerrainProvider());
    const field = new EnemyFlowField(world, 6);
    field.request(world.cellToWorldPoint({ q: 0, r: 0 }));
    field.step(Number.POSITIVE_INFINITY, 1);
    field.request(world.cellToWorldPoint({ q: 1, r: 0 }));
    field.request(world.cellToWorldPoint({ q: 2, r: 0 }));

    while (field.hasWork()) {
      field.step(Number.POSITIVE_INFINITY, 8);
    }
    expect(field.diagnostics().playerCell).toEqual({ q: 2, r: 0 });
    expect(field.diagnostics().coalescedRequests).toBeGreaterThan(0);
  });
});
