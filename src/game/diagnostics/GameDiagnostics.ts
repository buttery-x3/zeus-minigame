import * as THREE from "three";
import { PLAYER_COLLISION_RADIUS, SPELLS, TILE_SIZE, VISIBILITY_LIGHT_EPSILON } from "../../config";
import type { GameRuntimeState } from "../../types";
import type { GridWorld } from "../../world/GridWorld";
import type { CollisionSystem } from "../collision/CollisionSystem";
import type { Profiler } from "../perf/Profiler";
import type { PlayerController } from "../player/PlayerController";
import type { GameScene } from "../scene/GameScene";
import type { GroundEffectSystem } from "../terrain/GroundEffectSystem";
import type { VisibilitySystem } from "../visibility/VisibilitySystem";

export class GameDiagnostics {
  constructor(
    private readonly scene: GameScene,
    private readonly gridWorld: GridWorld,
    private readonly collision: CollisionSystem,
    private readonly player: PlayerController,
    private readonly visibility: VisibilitySystem,
    private readonly groundEffects: GroundEffectSystem,
    private readonly profiler: Profiler,
  ) {}

  get(state: GameRuntimeState) {
    const cameraForward = new THREE.Vector3();
    this.scene.camera.getWorldDirection(cameraForward);
    const visibilityDiagnostics = this.visibility.getDiagnostics();

    return {
      camera: {
        position: this.scene.camera.position.toArray(),
        quaternion: this.scene.camera.quaternion.toArray(),
        forward: cameraForward.toArray(),
        projection: {
          left: this.scene.camera.left,
          right: this.scene.camera.right,
          top: this.scene.camera.top,
          bottom: this.scene.camera.bottom,
        },
      },
      lighting: this.scene.getLightingDiagnostics(),
      player: {
        health: state.health,
        position: this.player.object.position.toArray(),
        rotationY: this.player.object.rotation.y,
        animation: this.player.getAnimationDiagnostics(),
        navigation: {
          ...this.player.getNavigationDiagnostics(),
          destinationBlocked: !this.collision.canOccupy(this.player.moveTarget.x, this.player.moveTarget.z, PLAYER_COLLISION_RADIUS),
          destinationDiscovered: this.visibility.isDiscoveredWorld(this.player.moveTarget.x, this.player.moveTarget.z),
          occupiesBlocked: !this.collision.canOccupy(
            this.player.object.position.x,
            this.player.object.position.z,
            PLAYER_COLLISION_RADIUS,
          ),
        },
      },
      nearestBlockedCell: this.findNearestBlockedCell(this.player.object.position, 18),
      groundSamples: {
        partiallyChargedCell: this.findNearestVisibilityCell(
          this.player.object.position,
          18,
          (q, r) => {
            const cell = this.gridWorld.readCommittedCell(q, r);
            if (!cell) return false;
            const visual = this.groundEffects.getCellVisualState(cell);
            return cell.surface === "charged" && visual.phase === "charged" && visual.progress > 0 && this.isDirectVisibleMoveCell(q, r);
          },
        ),
        nearestChargedCell: this.findNearestVisibilityCell(
          this.player.object.position,
          18,
          (q, r) => {
            const cell = this.gridWorld.readCommittedCell(q, r);
            if (!cell) return false;
            return cell.surface === "charged" && this.groundEffects.getCellVisualState(cell).phase === "charged" && this.isDirectVisibleMoveCell(q, r);
          },
        ),
        nearestCursedCell: this.findNearestVisibilityCell(
          this.player.object.position,
          18,
          (q, r) => {
            const cell = this.gridWorld.readCommittedCell(q, r);
            if (!cell) return false;
            return cell.surface === "cursed" && this.groundEffects.getCellVisualState(cell).phase === "cursed" && this.isVisibleWalkableCell(q, r);
          },
        ),
      },
      visibility: visibilityDiagnostics,
      visibilitySamples: {
        shadowedCell: visibilityDiagnostics.shadowSample
          ? this.visibilitySampleToScreen(visibilityDiagnostics.shadowSample.shadow)
          : null,
        visibleMoveCell: this.findNearestVisibilityCell(
          this.player.object.position,
          12,
          (q, r) => this.isDirectVisibleMoveCell(q, r),
          5,
        ),
        visibleEastCell: this.findDirectionalVisibilityCell(this.player.object.position, 1, 0),
        visibleWestCell: this.findDirectionalVisibilityCell(this.player.object.position, -1, 0),
        nearestUndiscoveredCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (q, r) => !this.visibility.isDiscoveredCell(q, r),
        ),
        visibleOutOfChainRangeCell: this.findNearestVisibilityCell(
          this.player.object.position,
          this.visibility.outerRadiusCells,
          (q, r) => {
            const world = this.gridWorld.cellToWorld(q, r);
            return (
              this.isDirectVisibleMoveCell(q, r) &&
              Math.hypot(world.x - this.player.object.position.x, world.z - this.player.object.position.z) > SPELLS.chain.range + TILE_SIZE
            );
          },
          Math.ceil(SPELLS.chain.range / TILE_SIZE) + 1,
        ),
        farUndiscoveredCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (q, r) => !this.visibility.isDiscoveredCell(q, r),
          this.visibility.outerRadiusCells + 2,
        ),
        nearestDiscoveredHiddenCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (q, r) => this.visibility.isDiscoveredCell(q, r) && !this.visibility.isVisibleCell(q, r),
        ),
        blockedMemoryCell: this.findNearestVisibilityCell(
          this.player.object.position,
          28,
          (q, r) =>
            this.visibility.isDiscoveredCell(q, r) &&
            !this.visibility.isVisibleCell(q, r) &&
            this.visibility.getLightReachCell(q, r) > VISIBILITY_LIGHT_EPSILON,
          1,
          false,
        ),
        discoveredUnlitCell: this.findNearestVisibilityCell(
          this.player.object.position,
          36,
          (q, r) => this.visibility.isDiscoveredCell(q, r) && this.visibility.getLightReachCell(q, r) <= VISIBILITY_LIGHT_EPSILON,
        ),
      },
      terrainGrammar: this.gridWorld.getTerrainDiagnostics(),
      gameOver: state.gameOver,
      paused: state.paused,
      profiler: this.profiler.snapshot(),
    };
  }

  private projectGroundToScreen(x: number, z: number) {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    const projected = new THREE.Vector3(x, 0, z).project(this.scene.camera);

    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
      visible: projected.z >= -1 && projected.z <= 1 && projected.x >= -1 && projected.x <= 1 && projected.y >= -1 && projected.y <= 1,
    };
  }

  private findNearestBlockedCell(position: THREE.Vector3, maxRadius: number) {
    const center = this.gridWorld.worldToCell(position.x, position.z);
    let nearestFallback: ReturnType<typeof this.blockedCellSample> | null = null;

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      for (const cell of this.gridWorld.ring(center, radius)) {
        const terrainCell = this.gridWorld.readCommittedCell(cell.q, cell.r);
        if (!terrainCell?.blocked || !this.visibility.isVisibleCell(cell.q, cell.r)) {
          continue;
        }

        const world = this.gridWorld.cellToWorld(cell.q, cell.r);
        const screen = this.projectGroundToScreen(world.x, world.z);
        if (!screen.visible) {
          continue;
        }

        const sample = this.blockedCellSample(cell, terrainCell.structure, world, screen);
        if (this.hasSingleBlockedCellApproach(cell)) {
          return sample;
        }
        nearestFallback ??= sample;
      }
    }

    return nearestFallback;
  }

  private hasSingleBlockedCellApproach(cell: { q: number; r: number }) {
    const openNeighbors = this.gridWorld.ring(cell, 1).filter((neighbor) => {
      const terrain = this.gridWorld.readCommittedCell(neighbor.q, neighbor.r);
      return Boolean(terrain && !terrain.blocked);
    });
    if (openNeighbors.length === 0) {
      return false;
    }

    const connected = new Set<string>([this.gridWorld.cellKey(openNeighbors[0].q, openNeighbors[0].r)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of openNeighbors) {
        const key = this.gridWorld.cellKey(candidate.q, candidate.r);
        if (connected.has(key)) {
          continue;
        }
        if (openNeighbors.some((neighbor) => connected.has(this.gridWorld.cellKey(neighbor.q, neighbor.r)) && this.gridWorld.hexDistance(neighbor, candidate) === 1)) {
          connected.add(key);
          changed = true;
        }
      }
    }
    return connected.size === openNeighbors.length;
  }

  private blockedCellSample(
    cell: { q: number; r: number },
    structure: "wall" | "lake" | "river" | "open" | "bank",
    world: { x: number; z: number },
    screen: ReturnType<GameDiagnostics["projectGroundToScreen"]>,
  ) {
    return {
      cell,
      structure,
      world: [world.x, 0, world.z] as [number, number, number],
      screen,
      visibility: this.visibility.getCell(cell.q, cell.r),
    };
  }

  private findDirectionalVisibilityCell(position: THREE.Vector3, dirX: number, dirZ: number) {
    const center = this.gridWorld.worldToCell(position.x, position.z);

    for (let radius = 8; radius >= 5; radius -= 1) {
      for (let lateral = 0; lateral <= 2; lateral += 1) {
        for (const side of lateral === 0 ? [0] : [-lateral, lateral]) {
          const q = center.q + dirX * radius + (dirZ === 0 ? 0 : side);
          const r = center.r + dirZ * radius + (dirX === 0 ? 0 : side);
          if (!this.gridWorld.isInBounds(q, r)) {
            continue;
          }
          if (!this.isDirectVisibleMoveCell(q, r)) {
            continue;
          }

          const world = this.gridWorld.cellToWorld(q, r);
          const screen = this.projectGroundToScreen(world.x, world.z);
          if (!screen.visible) {
            continue;
          }

          return {
            cell: { q, r },
            world: [world.x, 0, world.z],
            screen,
            visibility: this.visibility.getCell(q, r),
          };
        }
      }
    }

    return null;
  }

  private isDirectVisibleMoveCell(q: number, r: number) {
    if (!this.isVisibleWalkableCell(q, r)) {
      return false;
    }

    const world = this.gridWorld.cellToWorld(q, r);
    return this.collision.hasLineOfSight(this.player.object.position, new THREE.Vector3(world.x, 0, world.z), PLAYER_COLLISION_RADIUS);
  }

  private isVisibleWalkableCell(q: number, r: number) {
    if (!this.visibility.isVisibleCell(q, r) || (this.gridWorld.readCommittedCell(q, r)?.blocked ?? true)) {
      return false;
    }

    const world = this.gridWorld.cellToWorld(q, r);
    return this.collision.canOccupy(world.x, world.z, PLAYER_COLLISION_RADIUS);
  }

  private visibilitySampleToScreen(cell: { q: number; r: number }) {
    const world = this.gridWorld.cellToWorld(cell.q, cell.r);
    const screen = this.projectGroundToScreen(world.x, world.z);
    return {
      cell,
      world: [world.x, 0, world.z],
      screen,
      visibility: this.visibility.getCell(cell.q, cell.r),
    };
  }

  private findNearestVisibilityCell(
    position: THREE.Vector3,
    maxRadius: number,
    predicate: (q: number, r: number) => boolean,
    minRadius = 1,
    requireScreenVisible = true,
  ) {
    const center = this.gridWorld.worldToCell(position.x, position.z);

    for (let radius = minRadius; radius <= maxRadius; radius += 1) {
      for (const cell of this.gridWorld.ring(center, radius)) {
        if (!predicate(cell.q, cell.r)) {
          continue;
        }

        const world = this.gridWorld.cellToWorld(cell.q, cell.r);
        const screen = this.projectGroundToScreen(world.x, world.z);
        if (requireScreenVisible && !screen.visible) {
          continue;
        }

        return {
          cell,
          world: [world.x, 0, world.z],
          screen,
          visibility: this.visibility.getCell(cell.q, cell.r),
        };
      }
    }

    return null;
  }
}
