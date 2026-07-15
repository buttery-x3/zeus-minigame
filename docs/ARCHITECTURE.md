# Architecture

The prototype is intentionally small, but the code is split by responsibility so new features do not pile into one file.

## Runtime Flow

1. `src/main.ts` imports CSS and boots `ZeusGame`.
2. `ZeusGame` owns the Three.js scene, camera, input loop, high-level gameplay state, and system update order.
3. The fixed-step simulation updates gameplay state, then one frame-level navigation scheduler advances player routes, enemy flow rebuilding, and fallback paths within a shared time budget.
4. The game loop records performance timings while updating camera, rolling terrain generation, player movement, ground interactions, spell recovery, terrain visuals, targeting, HUD, enemies, spawning, and effects.
5. Normal and Potato modes both present every animation frame. Potato keeps the same simulation and presentation cadence while using a half-resolution shadowless Three.js profile.
6. Three.js renders the scene; HUD, pause, and diagnostics are regular DOM windows over the canvas.

## Module Map

- `src/config.ts`: global tuning constants and spell definitions.
- `src/types.ts`: shared TypeScript types for gameplay and effects.
- `src/game/ZeusGame.ts`: composition root, shared runtime state, and update order.
- `src/game/audio`: decoded/pooled SFX playback, streamed looping music, separate gain buses, persisted preferences, and audio diagnostics.
- `src/game/camera/CameraRig.ts`: orthographic camera follow and resize behavior.
- `src/game/collision`: hex occupancy, resumable hex linecasts, incremental Theta* individual pathfinding, destination resolution, and movement collision helpers.
- `src/game/diagnostics/GameDiagnostics.ts`: dev/test diagnostics snapshot and world-to-screen probes.
- `src/game/enemies/EnemySystem.ts`: enemy spawning, movement, contact damage, kill handling, and wave spawn timing.
- `src/game/enemies/EnemyMovement.ts`: obstacle-aware choice between crowd-avoidance steering and the navigation-preferred enemy move.
- `src/game/enemies/EnemyHealthBars.ts`: in-world enemy health bar lifecycle, visibility modes, and diagnostics.
- `src/game/enemies/navigation`: hybrid enemy navigation with direct chase, incrementally rebuilt weighted flow fields, acquisition steering, typed future intents, and a resumable fallback path queue.
- `src/game/navigation/NavigationScheduler.ts`: frame-level round-robin budget shared by player paths, flow-field work, and enemy fallbacks.
- `src/game/hud/HudPresenter.ts`: maps gameplay state into the DOM HUD.
- `src/game/input/GameInput.ts`: pointer/keyboard input and ground-plane raycasting.
- `src/game/perf/Profiler.ts`: rolling frame, subsystem, render, pathfinding, flow-build, and navigation-scheduler timing metrics.
- `src/game/perf/RuntimePerformanceMonitor.ts`: fixed-capacity animation-frame pacing history, feature-detected approximate JS heap sampling, GC-correlated hitch counts, and renderer/world resource counters.
- `src/game/player/PlayerController.ts`: player mesh, movement target, immediate request marker, resumable route request/application policy, and player visual state.
- `src/game/scene/GameScene.ts`: Three.js renderer, scene, lights, shadow rig, and ground setup.
- `src/game/spells/SpellSystem.ts`: spell targeting state, cooldowns, mana checks, and cast behavior.
- `src/game/spells/TargetingRenderer.ts`: range ring and reticle rendering.
- `src/game/terrain/TerrainSystem.ts`: visible hex terrain window rendering through shared material/geometry instance batches.
- `src/game/terrain/GroundEffectSystem.ts`: per-run charged capacity, cursed cleansing, recovery modifiers, and runtime terrain-state overrides.
- `src/game/upgrades/UpgradeSystem.ts`: run-local upgrade stacks, randomized offers, derived stats, offer deadlines, and shield lifecycle.
- `src/game/upgrades/upgradeCatalog.ts`: upgrade presentation metadata and repeatability rules; card price is deliberately not stored in the catalog.
- `src/world/GridWorld.ts`: unbounded axial hex-to-world mapping, cached terrain cell access, neighbor lookup, rings, ranges, and hex line sampling.
- `src/world/HexTerrainPatch.ts`: radius-2 patch types, authored-layout construction, rotations, edge derivation, and micro/patch coordinate mapping.
- `src/world/HexTerrainPatchGeometry.ts`: canonical patch cells/edges and patch-to-micro coordinate conversion.
- `src/world/HexTerrainCatalog.ts`: explicit authored patch layouts and their topology-group weights, rotations, and terrain families.
- `src/world/HexTerrainCliffPatches.ts`: authored cliff endpoints, lines, sways, dog-legs, bends, junctions, and masses.
- `src/world/HexTerrainRiverPatches.ts`: authored river sources, lines, sways, dog-legs, bends, and forks.
- `src/world/HexTerrainLinearShapes.ts`: shared radius-2 linear feature cell paths used by cliff and river authored patches.
- `src/world/HexTerrainPatchValidation.ts`: authored and procedural patch structural validation.
- `src/world/ProceduralTerrainPatch.ts`: deterministic seven-cell interior solver used only when no safe authored patch fits accumulated boundary constraints.
- `src/world/ProceduralTerrainPatchScoring.ts`: procedural fill connectivity constraints and coherence scoring.
- `src/world/TerrainPatchLoopPolicy.ts`: patch-feature connectivity graphs and bounded river/cliff short-loop detection.
- `src/world/HexTerrainRules.ts`: patch edge compatibility, diagnostics validation, and surface/blocking helper rules.
- `src/world/HexTerrainWfcSolver.ts`: finite axial patch WFC solver kept as a reference for patch solving experiments.
- `src/world/TerrainProvider.ts`: terrain provider interface and shared `TerrainCell` construction helpers.
- `src/world/WfcTerrainProvider.ts`: default terrain provider that wraps the grammar/WFC pipeline.
- `src/world/RollingTerrainPatchSelection.ts`: authored-first compatibility, frontier-safety, topology-budgeted selection, and short-loop avoidance.
- `src/world/SeedTerrainProvider.ts`: cheap deterministic hash terrain provider for fallback/debug use.
- `src/world/hexCoordinates.ts`: shared axial hex coordinate types, directions, keys, and distance helpers.
- `src/render/GameEffects.ts`: short-lived lightning and shockwave effects.
- `src/render/NavigationDebugRenderer.ts`: session-only per-enemy navigation capture, lack-of-progress detection, and five-second stalled-state latching.
- `src/render/NavigationDebugPainter.ts`: one pooled dynamic line buffer used for all navigation debug vectors and geometry.
- `src/render/SpecialGroundEffects.ts`: low-cost charged/cursed glyph animation and the single occupied-tile particle system.
- `src/render/materials.ts`: shared Three.js material creation.
- `src/render/meshes.ts`: player, enemy, and terrain glyph mesh factories.
- `src/render/primitives.ts`: reusable Three.js line/ring/lightning helper primitives.
- `src/render/ShadowRig.ts`: player-following directional shadow camera with texel-snapped focus to reduce shimmer.
- `src/ui/window`: small DOM window manager with movable, closable, modal, and lockable windows.
- `src/ui/Hud.ts`: DOM HUD window creation and updates.
- `src/ui/GameUi.ts`: composition root for HUD windows, pause menu, diagnostics, and toolbar controls.
- `src/ui/UpgradeChoiceMenu.ts`: timed three-card Cursed Energy modal, affordability state, and save-energy action.
- `src/lib/math.ts`: numeric helpers.
- `src/lib/dom.ts`: DOM query helper.
- `scripts/verify-render.mjs`: headless browser smoke test for rendering, HUD, and core interactions.

## Boundaries

- `GridWorld` should not know about meshes, HUD, enemies, or spells.
- `Hud` should not mutate gameplay state; it only renders state passed into `update`.
- UI windows should consume their own pointer events so game movement clicks do not leak through, except locked transparent HUD panels while Unlock UI is off; those are intentionally click-through.
- Rendering helpers should create reusable `THREE.Object3D` instances and avoid owning gameplay state.
- Navigation debugging uses fixed-capacity typed-array geometry while enabled and clears its per-enemy state when disabled; it is diagnostic state and must not affect movement decisions or persisted preferences.
- Repeated terrain and blocker geometry should remain instanced in every render mode. Quality profiles may change materials and cadence without changing generated cells, collision, visibility, or simulation state.
- `ZeusGame` can coordinate systems, but new large systems should become their own modules.
- Navigation and future vision checks should share the hex linecast helper so blocker semantics stay consistent.
- Normal melee enemies should not call Theta* directly during frame update; shared flow fields handle swarm chase and the path queue handles rare fallback paths.
- Navigation work that can traverse many cells must be resumable. The scheduler owns the frame budget; callers enqueue or coalesce requests instead of running long searches inside input or simulation updates.
- Completed player routes are rebased against the player's current position before application. A superseded result may establish an initial route, but it does not replace a route that is already usable while the newest held request remains queued.
- Enemy crowd avoidance is advisory near structural collision: a steered move that makes no target progress is compared with the original navigation move, and sustained lack of progress forces the shared fallback queue even when direct line of sight exists.
- Flow builds read only already-generated terrain and keep the last complete field active until a replacement is ready. Structural walkability caches are invalidated explicitly if runtime collision ever becomes mutable.

## Hex World

Gameplay grid coordinates are axial hex coordinates named `q/r`. Three.js world space still uses the `X/Z` ground plane and `Y` as vertical height. `GridWorld` owns unbounded coordinate conversion, cached cell access, neighbors, rings, ranges, line samples, and cell keys. Terrain generation is delegated to a `TerrainProvider`.

The default provider is `WfcTerrainProvider`, which uses the explicit patch tile catalog for rolling patch-by-patch terrain generation. `SeedTerrainProvider` is a deterministic hash-based provider kept for fallback/debug use and future generation-mode selection.

Terrain starts with a declarative patch grammar. A micro hex is an actual gameplay terrain cell. A patch tile is a non-overlapping radius-2 group of 19 micro hexes used as one generation unit. A patch edge signature is an ordered list of socket values along one patch side. Authored patches explicitly define their internal micro-cell layout; rotations are generated from the authored canonical layout instead of routing every feature through the patch center.

`WfcTerrainProvider` commits terrain one patch at a time as the player moves. It keeps committed patch variants by patch coordinate and expanded micro cells by micro coordinate. The active generation radius is measured in patch coordinates around the player's current patch. Missing patches are generated in deterministic ring order, filtered against already-committed neighbor edge signatures, then committed permanently. Existing patches are never regenerated.

Authored variants are always preferred and remain the weighted WFC vocabulary. Visual alternatives share topology-group budgets so adding another authored realization does not automatically increase that feature's global selection weight. Before selection, bounded wall and river feature graphs suppress candidates that would create an avoidable short loop now or force one in an adjacent frontier patch. If every compatible authored candidate carries the same risk, the authored set remains available so aesthetic policy cannot manufacture a contradiction.

If no authored variant can safely satisfy the accumulated neighbor boundary, `ProceduralTerrainPatch` treats the 12 boundary cells as fixed and solves the seven-cell interior. Open boundaries receive a connected open core; homogeneous enclosures fill inward with their enclosing structure; compatible mixed enclosures grow their structures inward until they meet. Procedural results have zero selection weight, are cached by normalized boundary signature, and exist only to make the authored grammar closed. A synthesis failure is a real contradiction and must remain at zero in verification.

## Run Progression and Pause Ownership

`UpgradeSystem` stores only run-local stacks and derives effective player and spell values from immutable base configuration. Percentage modifiers compose multiplicatively, so repeated cooldown and spell-cost reductions remain positive without mutating the shared `SPELLS` definitions. Restart resets the system before the player, spells, HUD, and enemies are restored.

Manual pause and upgrade-choice pause are distinct reasons coordinated by `ZeusGame`. Either reason freezes the fixed-step simulation and suspends SFX, but only manual pause opens `PauseMenu`. An active upgrade offer owns the modal UI and blocks pause shortcuts until selection, saving, or timeout. Its ten-second deadline is read from presentation-time `performance.now()`, allowing the timer to continue while simulation time remains at zero.

The origin starts with a small open safe patch radius. Runtime patch selection uses local edge compatibility rather than solving a precomputed finite island. If a requested micro hex belongs to an uncommitted patch, the provider lazily commits that containing patch before returning the terrain cell.

The world no longer has a gameplay boundary. The old finite-world `WORLD_CELLS`, `WORLD_SIZE`, and related constants have been removed from runtime config; if future diagnostics need fixed windows, they should define local active-window sizes instead of gameplay bounds. Visibility state is sparse-map backed so discovered memory can grow with generated terrain instead of being limited to a fixed array.

Terrain is split into structural cells and derived surfaces:

- Structures: `open`, `wall`, `bank`, `lake`, `river`; `bank` is reserved for a future water-adjacency post-pass and is not emitted by patch generation.
- Surfaces: `grass`, `dirt`, `sand`, `mud`, `stone`, `scarred`, `charged`, `cursed`.
- Edge/socket vocabulary: `open`, `closed`, `river`, `lake`.

`open` and `bank` are walkable. `wall`, `lake`, and `river` block movement. Only `wall` blocks visibility; water is a movement obstacle but not an occluder. The authored catalog includes open basins, isolated rocks, cliff endpoints/ridges/mirrored sways/dog-legs/tight and gentle bends/junctions/masses, equivalent expanded river shapes, lake coves/shores/basins/cores, and river/lake/cliff transitions. Bank placement and its eventual movement-speed modifier are deferred to a post-generation terrain-decoration pass.

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
