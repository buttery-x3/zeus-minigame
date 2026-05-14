import * as THREE from "three";
import type { EnemyHealthBarVisibilityMode, EnemyState } from "../../types";
import { EnemyHealthBar } from "./EnemyHealthBar";

type EnemyHealthBarsUpdate = {
  camera: THREE.Camera;
  dt: number;
  mode: EnemyHealthBarVisibilityMode;
  revealAll: boolean;
};

export class EnemyHealthBars {
  private readonly bars = new Map<number, EnemyHealthBar>();
  private visibleCount = 0;

  constructor(private readonly group: THREE.Group) {}

  add(enemy: EnemyState) {
    const bar = new EnemyHealthBar();
    bar.setHealth(enemy.hp, enemy.maxHp);
    this.bars.set(enemy.id, bar);
    this.group.add(bar.object);
  }

  updateHealth(enemy: EnemyState) {
    const bar = this.bars.get(enemy.id);
    bar?.setHealth(enemy.hp, enemy.maxHp);
    bar?.markDamaged();
  }

  update(enemies: readonly EnemyState[], params: EnemyHealthBarsUpdate) {
    let visibleCount = 0;

    for (const enemy of enemies) {
      const bar = this.bars.get(enemy.id);
      if (!bar) {
        continue;
      }
      bar.setHealth(enemy.hp, enemy.maxHp);
      if (bar.update(enemy, params)) {
        visibleCount += 1;
      }
    }

    this.visibleCount = visibleCount;
  }

  remove(enemy: EnemyState) {
    const bar = this.bars.get(enemy.id);
    if (!bar) {
      return;
    }

    bar.object.removeFromParent();
    bar.dispose();
    this.bars.delete(enemy.id);
  }

  clear() {
    for (const bar of this.bars.values()) {
      bar.object.removeFromParent();
      bar.dispose();
    }
    this.bars.clear();
    this.visibleCount = 0;
  }

  diagnostics() {
    return {
      total: this.bars.size,
      visible: this.visibleCount,
    };
  }
}
