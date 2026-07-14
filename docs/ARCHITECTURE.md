# Architecture

The prototype is intentionally small, but the code is split by responsibility so new features do not pile into one file.

## Runtime Flow

1. `src/main.ts` imports CSS and boots `ZeusGame`.
2. `ZeusGame` owns the Three.js scene, camera, input loop, high-level gameplay state, and system update order.
3. The game loop records performance timings while updating camera, rolling terrain generation, player movement, ground interactions, spell recovery, terrain visuals, targeting, HUD, enemies, spawning, and effects.
4. Three.js renders the scene; HUD, pause, and diagnostics are regular DOM windows over the canvas.

## Module Map

- `src/config.ts`: global tuning constants and spell definitions.
- `src/types.ts`: shared TypeScript types for gameplay and effects.
- `src/game/ZeusGame.ts`: composition root, shared runtime state, and update order.
- `src/game/audio`: decoded/pooled SFX playback, streamed looping music, separate gain buses, persisted preferences, and audio diagnostics.
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
- `src/game/terrain/GroundEffectSystem.ts`: per-run charged capacity, cursed cleansing, recovery modifiers, and runtime terrain-state overrides.
- `src/world/GridWorld.ts`: unbounded axial hex-to-world mapping, cached terrain cell access, neighbor lookup, rings, ranges, and hex line sampling.
- `src/world/HexTerrainCatalog.ts`: patch tile catalog, canonical patch micro-hex coordinates, and patch edge ordering.
- `src/world/HexTerrainRules.ts`: patch edge compatibility, diagnostics validation, and surface/blocking helper rules.
- `src/world/HexTerrainWfcSolver.ts`: finite axial patch WFC solver kept as a reference for patch solving experiments.
- `src/world/TerrainProvider.ts`: terrain provider interface and shared `TerrainCell` construction helpers.
- `src/world/WfcTerrainProvider.ts`: default terrain provider that wraps the grammar/WFC pipeline.
- `src/world/SeedTerrainProvider.ts`: cheap deterministic hash terrain provider for fallback/debug use.
- `src/world/hexCoordinates.ts`: shared axial hex coordinate types, directions, keys, and distance helpers.
- `src/render/GameEffects.ts`: short-lived lightning and shockwave effects.
- `src/render/SpecialGroundEffects.ts`: low-cost charged/cursed glyph animation and the single occupied-tile particle system.
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

Gameplay grid coordinates are axial hex coordinates named `q/r`. Three.js world space still uses the `X/Z` ground plane and `Y` as vertical height. `GridWorld` owns unbounded coordinate conversion, cached cell access, neighbors, rings, ranges, line samples, and cell keys. Terrain generation is delegated to a `TerrainProvider`.

The default provider is `WfcTerrainProvider`, which uses the explicit patch tile catalog for rolling patch-by-patch terrain generation. `SeedTerrainProvider` is a deterministic hash-based provider kept for fallback/debug use and future generation-mode selection.

Terrain starts with a declarative patch grammar. A micro hex is an actual gameplay terrain cell. A patch tile is a non-overlapping radius-2 group of micro hexes used as one generation unit. A patch edge signature is an ordered list of socket values along one patch side. The patch generator creates internally valid patch variants before runtime selection; the world is not stamped or mutated after selection.

`WfcTerrainProvider` commits terrain one patch at a time as the player moves. It keeps committed patch variants by patch coordinate and expanded micro cells by micro coordinate. The active generation radius is measured in patch coordinates around the player's current patch. Missing patches are generated in deterministic ring order, filtered against already-committed neighbor edge signatures, then committed permanently. Existing patches are never regenerated.

The origin starts with a small open safe patch radius. Runtime patch selection uses local edge compatibility rather than solving a precomputed finite island. If a requested micro hex belongs to an uncommitted patch, the provider lazily commits that containing patch before returning the terrain cell.

The world no longer has a gameplay boundary. The old finite-world `WORLD_CELLS`, `WORLD_SIZE`, and related constants have been removed from runtime config; if future diagnostics need fixed windows, they should define local active-window sizes instead of gameplay bounds. Visibility state is sparse-map backed so discovered memory can grow with generated terrain instead of being limited to a fixed array.

Terrain is split into structural cells and derived surfaces:

- Structures: `open`, `wall`, `bank`, `lake`, `river`; the active rolling catalog currently emits `open`, `wall`, and `river`.
- Surfaces: `grass`, `dirt`, `sand`, `mud`, `stone`, `scarred`, `charged`, `cursed`.
- Edge/socket vocabulary: `open`, `closed`, `river`, `lake`.

`open` and `bank` are walkable. `wall`, `lake`, and `river` block movement. Only `wall` blocks visibility; water is a movement obstacle but not an occluder. The current rolling catalog includes open patches, blocker patches, and river lines/bends/forks/sources. Bank and lake variants remain reserved for a later pass.

Charged and cursed surfaces are assigned deterministically to a small share of open micro cells as patches are expanded. They are surface decorations rather than patch socket types, so they do not affect WFC compatibility or structural generation. `GroundEffectSystem` keeps mutable per-run state separate from the immutable procedural cells: charged usage accumulates per coordinate, while cleansed cursed coordinates are recorded as scarred display overrides. `TerrainSystem` reads these runtime states when rebuilding its rolling render window.

Special-ground rendering deliberately avoids per-tile particles and ambient animation. `PlayerController` caches the one hex Zeus currently occupies; `GroundEffectSystem` consumes that player-owned contact, and `SpecialGroundEffects` performs one keyed lookup instead of asking every rendered tile whether it is occupied. Dormant runes are initialized directly in their subdued state, including after terrain-window rebuilds. Only the occupied tile animates. It creates at most one `THREE.Points` particle object rendered in one draw call, which is removed as soon as Zeus leaves or the interaction completes. Charged activation brightens only that glyph's line colors and opacity; the shared tile material is never modified.

The HUD's Currencies window uses a reusable currency-row layout. It participates in the same lock, hover-reveal, click-through, and movement system as the other minimal HUD windows so later currencies can be added without creating additional panels.

## Future Splits

Good next extractions:

- `src/game/state` if runtime state grows beyond the current simple object.
- `src/game/spells/spellDefinitions.ts` if spell configs gain upgrade trees.
- Enemy crowding or unit-unit separation before dense waves need physical spacing.

## Verification

Use `npm run verify` for the standard project check. It runs the production build and then the browser render verifier. The render verifier should be kept in step with the default playable loop.
