import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CollisionMoveTrace } from "../collision/CollisionSystem";
import { chooseEnemyMove } from "./EnemyMovement";

describe("enemy movement choice", () => {
  it("falls back to preferred navigation when avoidance pushes into a blocker", () => {
    const collision = {
      moveWithCollision(position: THREE.Vector3, delta: THREE.Vector3, _radius: number, trace?: CollisionMoveTrace) {
        const blocked = delta.x > 0.01;
        if (trace) trace.resolution = blocked ? "rejected" : "full";
        return blocked ? position.clone() : position.clone().add(delta);
      },
    };
    const trace: CollisionMoveTrace = { resolution: "rejected" };
    const result = chooseEnemyMove(
      collision,
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, 2),
      new THREE.Vector3(2, 0, 0),
      0.1,
      trace,
    );

    expect(result.avoidanceFallbackAttempted).toBe(true);
    expect(result.usedPreferredFallback).toBe(true);
    expect(result.targetProgress).toBeGreaterThan(0);
    expect(result.nextPosition.z).toBeGreaterThan(0);
    expect(trace.resolution).toBe("full");
  });
});
