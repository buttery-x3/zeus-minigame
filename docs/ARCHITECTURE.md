# Architecture

The prototype is intentionally small, but the code is split by responsibility so new features do not pile into one file.

## Runtime Flow

1. `src/main.ts` imports CSS and boots `ZeusGame`.
2. `ZeusGame` owns the Three.js scene, camera, input loop, high-level gameplay state, and system update order.
3. The game loop updates camera, terrain window, targeting visuals, HUD, movement, enemies, spawning, and effects.
4. Three.js renders the scene; the HUD is regular DOM over the canvas.

## Module Map

- `src/config.ts`: global tuning constants and spell definitions.
- `src/types.ts`: shared TypeScript types for gameplay and effects.
- `src/game/ZeusGame.ts`: app orchestration and current gameplay systems.
- `src/world/GridWorld.ts`: grid-to-world mapping and deterministic terrain cell generation.
- `src/render/GameEffects.ts`: short-lived lightning and shockwave effects.
- `src/render/materials.ts`: shared Three.js material creation.
- `src/render/meshes.ts`: player, enemy, and terrain glyph mesh factories.
- `src/render/primitives.ts`: reusable Three.js line/ring/lightning helper primitives.
- `src/ui/Hud.ts`: DOM HUD creation and updates.
- `src/lib/math.ts`: numeric helpers.
- `src/lib/dom.ts`: DOM query helper.

## Boundaries

- `GridWorld` should not know about meshes, HUD, enemies, or spells.
- `Hud` should not mutate gameplay state; it only renders state passed into `update`.
- Rendering helpers should create reusable `THREE.Object3D` instances and avoid owning gameplay state.
- `ZeusGame` can coordinate systems, but new large systems should become their own modules.

## Future Splits

Good next extractions:

- `src/game/enemies.ts` for enemy spawning, updating, and damage reactions.
- `src/game/spells.ts` for spell casting rules and configs.
- `src/game/input.ts` if input grows beyond pointer/key basics.
