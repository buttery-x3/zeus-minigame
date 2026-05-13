# Architecture

The prototype is intentionally small, but the code is split by responsibility so new features do not pile into one file.

## Runtime Flow

1. `src/main.ts` imports CSS and boots `ZeusGame`.
2. `ZeusGame` owns the Three.js scene, camera, input loop, high-level gameplay state, and system update order.
3. The game loop records performance timings while updating camera, terrain window, targeting visuals, HUD, movement, enemies, spawning, and effects.
4. Three.js renders the scene; HUD, pause, and diagnostics are regular DOM windows over the canvas.

## Module Map

- `src/config.ts`: global tuning constants and spell definitions.
- `src/types.ts`: shared TypeScript types for gameplay and effects.
- `src/game/ZeusGame.ts`: composition root, shared runtime state, and update order.
- `src/game/camera/CameraRig.ts`: orthographic camera follow and resize behavior.
- `src/game/collision`: blocker occupancy, grid linecasts, Theta* pathfinding, and movement collision helpers.
- `src/game/diagnostics/GameDiagnostics.ts`: dev/test diagnostics snapshot and world-to-screen probes.
- `src/game/enemies/EnemySystem.ts`: enemy spawning, movement, contact damage, kill handling, and wave spawn timing.
- `src/game/hud/HudPresenter.ts`: maps gameplay state into the DOM HUD.
- `src/game/input/GameInput.ts`: pointer/keyboard input and ground-plane raycasting.
- `src/game/perf/Profiler.ts`: rolling frame, subsystem, render, and pathfinding timing metrics.
- `src/game/player/PlayerController.ts`: player mesh, movement target, move marker, and player visual state.
- `src/game/scene/GameScene.ts`: Three.js renderer, scene, lights, and ground setup.
- `src/game/spells/SpellSystem.ts`: spell targeting state, cooldowns, mana checks, and cast behavior.
- `src/game/spells/TargetingRenderer.ts`: range ring and reticle rendering.
- `src/game/terrain/TerrainSystem.ts`: visible terrain window rendering.
- `src/world/GridWorld.ts`: grid-to-world mapping and deterministic terrain cell generation.
- `src/render/GameEffects.ts`: short-lived lightning and shockwave effects.
- `src/render/materials.ts`: shared Three.js material creation.
- `src/render/meshes.ts`: player, enemy, and terrain glyph mesh factories.
- `src/render/primitives.ts`: reusable Three.js line/ring/lightning helper primitives.
- `src/ui/window`: small DOM window manager with movable, closable, modal, and lockable windows.
- `src/ui/Hud.ts`: DOM HUD window creation and updates.
- `src/ui/GameUi.ts`: composition root for HUD windows, pause menu, diagnostics, and toolbar controls.
- `src/lib/math.ts`: numeric helpers.
- `src/lib/dom.ts`: DOM query helper.
- `scripts/verify-render.mjs`: headless browser smoke test for rendering, HUD, and core interactions.

## Boundaries

- `GridWorld` should not know about meshes, HUD, enemies, or spells.
- `Hud` should not mutate gameplay state; it only renders state passed into `update`.
- UI windows should consume their own pointer events so game movement clicks do not leak through.
- Rendering helpers should create reusable `THREE.Object3D` instances and avoid owning gameplay state.
- `ZeusGame` can coordinate systems, but new large systems should become their own modules.
- Navigation and future vision checks should share the grid linecast helper so blocker semantics stay consistent.

## Future Splits

Good next extractions:

- `src/game/state` if runtime state grows beyond the current simple object.
- `src/game/spells/spellDefinitions.ts` if spell configs gain upgrade trees.
- Enemy crowding or unit-unit separation before dense waves need physical spacing.

## Verification

Use `npm run verify` for the standard project check. It runs the production build and then the browser render verifier. The render verifier should be kept in step with the default playable loop.
