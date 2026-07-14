import type { GameRuntimeState, SpellConfig, SpellId } from "../../types";
import type { Hud } from "../../ui/Hud";
import type { GridWorld } from "../../world/GridWorld";
import type { GroundEffectSnapshot } from "../terrain/GroundEffectSystem";
import type { DerivedRunStats, ShieldSnapshot, UpgradeStacks } from "../upgrades/upgradeTypes";

export class HudPresenter {
  constructor(
    private readonly hud: Hud,
    private readonly gridWorld: GridWorld,
  ) {}

  update(params: {
    state: GameRuntimeState;
    playerPosition: { x: number; z: number };
    castMode: SpellId | null;
    cooldowns: Record<SpellId, number>;
    spells: Record<SpellId, SpellConfig>;
    ground: GroundEffectSnapshot;
    paused: boolean;
    runStats: DerivedRunStats;
    upgradeStacks: UpgradeStacks;
    shield: ShieldSnapshot;
  }) {
    const cell = this.gridWorld.worldToCell(params.playerPosition.x, params.playerPosition.z);
    this.hud.update({
      health: params.state.health,
      mana: params.state.mana,
      maxHealth: params.runStats.maxHealth,
      maxMana: params.runStats.maxMana,
      kills: params.state.kills,
      wave: params.state.wave,
      cellQ: cell.q,
      cellR: cell.r,
      castMode: params.castMode,
      cooldowns: params.cooldowns,
      spells: params.spells,
      cursedEnergy: params.state.cursedEnergy,
      groundPhase: params.ground.phase,
      cooldownRecoveryMultiplier: params.ground.cooldownRecoveryMultiplier,
      energyRecoveryMultiplier: params.ground.energyRecoveryMultiplier,
      chargedRemainingSeconds: params.ground.chargedRemainingSeconds,
      curseProgress: params.ground.curseProgress,
      rewardFeedbackVisible: params.ground.rewardFeedbackVisible,
      gameOver: params.state.gameOver,
      paused: params.paused,
      upgradeStacks: params.upgradeStacks,
      shield: params.shield,
    });
  }
}
