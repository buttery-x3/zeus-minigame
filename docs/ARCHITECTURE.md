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
- `src/game/collision`: hex occupancy, hex linecasts, Theta* individual pathfinding, and movement collision helpers.
- `src/game/diagnostics/GameDiagnostics.ts`: dev/test diagnostics snapshot and world-to-screen probes.
- `src/game/enemies/EnemySystem.ts`: enemy spawning, movement, contact damage, kill handling, and wave spawn timing.
- `src/game/enemies/EnemyHealthBars.ts`: in-world enemy health bar lifecycle, visibility modes, and diagnostics.
- `src/game/enemies/navigation`: hybrid enemy navigation with direct chase, shared flow fields, acquisition steering, typed future intents, and a budgeted fallback path queue.
- `src/game/hud/HudPresenter.ts`: maps gameplay state into the DOM HUD.
- `src/game/input/GameInput.ts`: pointer/keyboard input and ground-plane raycasting.
- `src/game/perf/Profiler.ts`: rolling frame, subsystem, render, and pathfinding timing metrics.
- `src/game/player/PlayerController.ts`: player mesh, movement target, move marker, and player visual state.
- `src/game/scene/GameScene.ts`: Three.js renderer, scene, lights, shadow rig, and ground setup.
- `src/game/spells/SpellSystem.ts`: spell targeting state, cooldowns, mana checks, and cast behavior.
- `src/game/spells/TargetingRenderer.ts`: range ring and reticle rendering.
- `src/game/terrain/TerrainSystem.ts`: visible hex terrain window rendering.
- `src/world/GridWorld.ts`: axial hex-to-world mapping, cached terrain cell access, neighbor lookup, rings, ranges, and hex line sampling.
- `src/world/HexTerrainCatalog.ts`: patch tile catalog, canonical patch micro-hex coordinates, and patch edge ordering.
- `src/world/HexTerrainRules.ts`: patch edge compatibility, diagnostics validation, and surface/blocking helper rules.
- `src/world/HexTerrainWfcSolver.ts`: finite axial patch WFC solver that arranges patch tiles and expands them to micro hexes.
- `src/world/TerrainProvider.ts`: terrain provider interface and shared `TerrainCell` construction helpers.
- `src/world/WfcTerrainProvider.ts`: default terrain provider that wraps the grammar/WFC pipeline.
- `src/world/SeedTerrainProvider.ts`: cheap deterministic hash terrain provider for fallback/debug use.
- `src/world/hexCoordinates.ts`: shared axial hex coordinate types, directions, keys, and distance helpers.
- `src/render/GameEffects.ts`: short-lived lightning and shockwave effects.
- `src/render/materials.ts`: shared Three.js material creation.
- `src/render/meshes.ts`: player, enemy, and terrain glyph mesh factories.
- `src/render/primitives.ts`: reusable Three.js line/ring/lightning helper primitives.
- `src/render/ShadowRig.ts`: player-following directional shadow camera with texel-snapped focus to reduce shimmer.
- `src/ui/window`: small DOM window manager with movable, closable, modal, and lockable windows.
- `src/ui/Hud.ts`: DOM HUD window creation and updates.
- `src/ui/GameUi.ts`: composition root for HUD windows, pause menu, diagnostics, and toolbar controls.
- `src/lib/math.ts`: numeric helpers.
- `src/lib/dom.ts`: DOM query helper.
- `scripts/verify-render.mjs`: headless browser smoke test for rendering, HUD, and core interactions.

## Boundaries

- `GridWorld` should not know about meshes, HUD, enemies, or spells.
- `Hud` should not mutate gameplay state; it only renders state passed into `update`.
- UI windows should consume their own pointer events so game movement clicks do not leak through, except locked transparent HUD panels while Unlock UI is off; those are intentionally click-through.
- Rendering helpers should create reusable `THREE.Object3D` instances and avoid owning gameplay state.
- `ZeusGame` can coordinate systems, but new large systems should become their own modules.
- Navigation and future vision checks should share the hex linecast helper so blocker semantics stay consistent.
- Normal melee enemies should not call Theta* directly during frame update; shared flow fields handle swarm chase and the path queue handles rare fallback paths.

## Hex World

Gameplay grid coordinates are axial hex coordinates named `q/r`. Three.js world space still uses the `X/Z` ground plane and `Y` as vertical height. `GridWorld` owns coordinate conversion, bounds checks, cached cell access, neighbors, rings, ranges, line samples, and cell keys. Terrain generation is delegated to a `TerrainProvider`.

The default provider is `WfcTerrainProvider`, which wraps the explicit patch tile catalog plus finite patch WFC solver. `SeedTerrainProvider` is a deterministic hash-based provider kept for fallback/debug use and future generation-mode selection.

Terrain starts with a declarative patch grammar. A micro hex is an actual gameplay terrain cell. A patch tile is a non-overlapping radius-2 group of micro hexes used as one WFC unit. A patch edge signature is an ordered list of socket values along one patch side. The patch generator creates internally valid patch variants before WFC; the world is not stamped or mutated after selection.

The playable origin region is generated once by patch WFC. Each patch coordinate begins with every patch tile variant; a variant includes local micro-hex terrain cells, six ordered patch edge signatures, weight, and diagnostics metadata. The solver repeatedly collapses a lowest-entropy patch, then propagates edge compatibility to the six axial patch neighbors. Compatibility compares one patch edge to the reversed opposite edge of its neighbor.

The current patch WFC region covers patch radius 8 around the origin with a small open safe start. `WfcTerrainProvider` maps each world micro hex to exactly one selected patch tile and local micro coordinate when the cell is inside the solved patch region. Terrain outside that finite coverage returns open terrain for now.

Terrain is split into structural cells and derived surfaces:

- Structures: `open`, `wall`, `bank`, `lake`, `river`.
- Surfaces: `grass`, `dirt`, `sand`, `mud`, `stone`, `scarred`, `charged`.
- Edge/socket vocabulary: `open`, `closed`, `river`, `lake`.

`open` and `bank` are walkable. `wall`, `lake`, and `river` block movement. Only `wall` blocks visibility; water is a movement obstacle but not an occluder. The grammar includes wall clusters, lake patches, river lines/bends/forks/sources/mouths, and bank adapters. Surfaces stay secondary to structural terrain so the structural vocabulary remains small. The key structural adjacency rule is that wall-water direct adjacency is invalid; use `wall -> bank -> lake/river`.

## Future Splits

Good next extractions:

- `src/game/state` if runtime state grows beyond the current simple object.
- `src/game/spells/spellDefinitions.ts` if spell configs gain upgrade trees.
- Enemy crowding or unit-unit separation before dense waves need physical spacing.

## Verification

Use `npm run verify` for the standard project check. It runs the production build and then the browser render verifier. The render verifier should be kept in step with the default playable loop.
