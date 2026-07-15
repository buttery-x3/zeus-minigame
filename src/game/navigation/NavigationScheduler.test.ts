import { describe, expect, it } from "vitest";
import { NavigationScheduler, type NavigationWorkSource, type NavigationWorkSourceId } from "./NavigationScheduler";

describe("NavigationScheduler", () => {
  it("services player, flow, and fallback work without multiplying budgets", () => {
    const calls: NavigationWorkSourceId[] = [];
    const remaining = { player: 3, flow: 2, fallback: 1 };
    const source = (id: NavigationWorkSourceId): NavigationWorkSource => ({
      id,
      hasWork: () => remaining[id] > 0,
      runSlice: () => {
        calls.push(id);
        remaining[id] -= 1;
      },
    });
    const scheduler = new NavigationScheduler(100, 10);
    const diagnostics = scheduler.run([source("player"), source("flow"), source("fallback")]);

    expect(remaining).toEqual({ player: 0, flow: 0, fallback: 0 });
    expect(calls[0]).toBe("player");
    expect(diagnostics.slices.flow).toBeGreaterThan(0);
    expect(diagnostics.slices.fallback).toBeGreaterThan(0);
    expect(diagnostics.usedMs).toBeLessThan(diagnostics.budgetMs);
  });
});
