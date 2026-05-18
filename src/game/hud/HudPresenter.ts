import type { GameRuntimeState, SpellConfig, SpellId } from "../../types";
import type { Hud } from "../../ui/Hud";
import type { GridWorld } from "../../world/GridWorld";

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
    paused: boolean;
  }) {
    const cell = this.gridWorld.worldToCell(params.playerPosition.x, params.playerPosition.z);
    this.hud.update({
      health: params.state.health,
      mana: params.state.mana,
      kills: params.state.kills,
      wave: params.state.wave,
      cellQ: cell.q,
      cellR: cell.r,
      castMode: params.castMode,
      cooldowns: params.cooldowns,
      spells: params.spells,
      gameOver: params.state.gameOver,
      paused: params.paused,
    });
  }
}
