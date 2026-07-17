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
- `src/game/perf/Profiler.ts`: rolling frame, subsystem, render, pathfinding, flow-build, navigation-scheduler, and single-phase terrain-generation timing metrics.
- `src/game/perf/RuntimePerformanceMonitor.ts`: fixed-capacity animation-frame pacing history, feature-detected approximate JS heap sampling, GC-correlated hitch counts, and renderer/world resource counters.
- `src/game/player/PlayerController.ts`: player mesh, movement target, immediate request marker, resumable route request/application policy, and player visual state.
- `src/game/scene/GameScene.ts`: Three.js renderer, scene, lights, shadow rig, and ground setup.
- `src/game/spells/SpellSystem.ts`: spell targeting state, cooldowns, mana checks, and cast behavior.
- `src/game/spells/TargetingRenderer.ts`: range ring and reticle rendering.
- `src/game/terrain/TerrainSystem.ts`: visible hex terrain window rendering through shared material/geometry instance batches, plus Terrain Debug patch-boundary composition. Rolling rendering consumes committed cells without synchronously expanding the generator.
- `src/game/terrain/GroundEffectSystem.ts`: per-run charged capacity, cursed cleansing, recovery modifiers, and runtime terrain-state overrides.
- `src/game/upgrades/UpgradeSystem.ts`: run-local upgrade stacks, randomized offers, derived stats, offer deadlines, and shield lifecycle.
- `src/game/upgrades/upgradeCatalog.ts`: upgrade presentation metadata and repeatability rules; card price is deliberately not stored in the catalog.
- `src/world/GridWorld.ts`: unbounded axial hex-to-world mapping, cached terrain cell access, neighbor lookup, rings, ranges, and hex line sampling.
- `src/world/HexTerrainPatch.ts`: radius-2 patch types, authored-layout construction, rotations, edge derivation, and micro/patch coordinate mapping.
- `src/world/HexTerrainPatchGeometry.ts`: canonical patch cells/edges and patch-to-micro coordinate conversion.
- `src/world/HexTerrainCatalog.ts`: explicit authored patch layouts and their topology-group weights, rotations, and terrain families.
- `src/world/HexTerrainCliffPatches.ts`: authored cliff endpoints, lines, sways, dog-legs, bends, junctions, and masses, with cliff definition weights tuned directly rather than through a runtime family multiplier.
- `src/world/HexTerrainHydrologyPatches.ts`: authored grouped coves, narrow-to-broad lake flares, mirrored shores, river-mouth angle/profile variants, and river terminal transitions. Isolated all-open lake basins are deliberately excluded.
- `src/world/HexTerrainRiverPatches.ts`: authored river lines, sways, dog-legs, bends, and forks.
- `src/world/HexTerrainRiverPorts.ts`: rotatable authored input/output metadata and reversible continuation-port expansion.
- `src/world/HexTerrainLinearShapes.ts`: shared radius-2 linear feature cell paths used by cliff and river authored patches.
- `src/world/HexTerrainPatchValidation.ts`: authored and procedural patch structural validation.
- `src/world/HexTerrainPatchAnalysis.ts`: read-only cell-derived components, boundary ports, feature contacts, and clear metadata contradictions for terrain tooling.
- `src/world/TerrainInspectionSnapshot.ts`: detached serializable views of authored and dynamically generated procedural patch interiors.
- `src/world/ProceduralTerrainPatch.ts`: deterministic seven-cell interior solver used only when no safe authored patch fits accumulated boundary constraints.
- `src/world/ProceduralTerrainPatchScoring.ts`: procedural fill connectivity constraints and coherence scoring.
- `src/world/TerrainPatchLoopPolicy.ts`: patch-feature connectivity graphs and bounded river/cliff short-loop detection.
- `src/world/TerrainHydrologyPolicy.ts`: candidate-level hydrology evaluation, existing-feature connection preference, and integration of clearance and lake-shape rules.
- `src/world/TerrainHydrologyClearance.ts`: hard/soft river-to-lake near-edge clearance scoring and procedural boundary-edge derivation.
- `src/world/TerrainLakePolicy.ts`: semantic rejection and committed-world auditing of directly meeting cove endpoints.
- `src/world/TerrainRiverFlowPolicy.ts`: authored upstream/downstream port matching, directed-cycle rejection, and committed-world flow auditing.
- `src/world/TerrainPatchBoundaries.ts`: framework-neutral extraction of shared micro-edges between generated radius-2 patch owners.
- `src/world/TerrainEnclosurePolicy.ts`: exact micro-cell topology audit for bounded walkable regions enclosed by any mixture of movement blockers.
- `src/world/TerrainTopologyContext.ts`: incrementally maintained blocker components, edges, and vertices used for constant-size candidate topology checks.
- `src/world/HexTerrainRules.ts`: patch edge compatibility, diagnostics validation, and surface/blocking helper rules.
- `src/world/HexTerrainWfcSolver.ts`: finite axial patch WFC solver kept as a reference for patch solving experiments.
- `src/world/TerrainProvider.ts`: terrain provider interface and shared `TerrainCell` construction helpers.
- `src/world/WfcTerrainProvider.ts`: default terrain provider that wraps the grammar/WFC pipeline.
- `src/world/RollingTerrainPatchSelection.ts`: authored-first physical and river-flow compatibility, frontier-safety, topology-budgeted selection, directed-cycle and short-loop avoidance, and bounded procedural one-ring hydrology checks when no authored frontier candidate exists.
- `src/world/SeedTerrainProvider.ts`: cheap deterministic hash terrain provider for fallback/debug use.
- `src/world/hexCoordinates.ts`: shared axial hex coordinate types, directions, keys, and distance helpers.
- `src/render/GameEffects.ts`: short-lived lightning and shockwave effects.
- `src/render/NavigationDebugRenderer.ts`: session-only per-enemy navigation capture, lack-of-progress detection, and five-second stalled-state latching.
- `src/render/NavigationDebugPainter.ts`: one pooled dynamic line buffer used for all navigation debug vectors and geometry.
- `src/render/SpecialGroundEffects.ts`: low-cost charged/cursed glyph animation and the single occupied-tile particle system.
- `src/render/TerrainPatchDebugOverlay.ts`: thick, unlit mesh ribbons showing true generated patch ownership boundaries in Terrain Debug.
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
- `tools/terrain-lab`: separate local plain-TypeScript terrain catalog, Connection Lab, decision/coverage matrix, and bounded world explorer, importing the real `src/world` engine without entering the production build.
- `scripts/verify-terrain-lab.mjs`: headless browser smoke test for the local terrain workbench.

## Boundaries

- `GridWorld` should not know about meshes, HUD, enemies, or spells.
- Terrain inspection must remain read-only and derive from the same catalog variants, procedural solver, and committed provider state as the game. Tool UI code must not recreate generation rules.
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
- Enemy crowd avoidance is advisory near structural collision: a steered move that makes no target progress is compared with the original navigation move. Direct line-of-sight crowd stalls remain local and never enter Theta*; only flow/acquisition stalls may enqueue a fallback.
- Enemy fallbacks are temporary detours rather than destination commitments. Their source goal, age, queue time, and progress are tracked so stale player goals, changed acquisition edges, queue timeouts, restored line of sight, or a usable flow after local progress can cancel them.
- Flow builds read only already-generated terrain and keep the last complete field active until a replacement is ready. Structural walkability caches are invalidated explicitly if runtime collision ever becomes mutable.

## Hex World

Gameplay grid coordinates are axial hex coordinates named `q/r`. Three.js world space still uses the `X/Z` ground plane and `Y` as vertical height. `GridWorld` owns unbounded coordinate conversion, committed cell access, neighbors, bounded ranges, line samples, and cell keys. Terrain generation is delegated to a `TerrainProvider`; `GridWorld` does not keep a second cell cache.

The default provider is `WfcTerrainProvider`, which uses the explicit patch tile catalog for rolling patch-by-patch terrain generation. `SeedTerrainProvider` is a deterministic hash-based provider kept for fallback/debug use and future generation-mode selection.

Terrain starts with a declarative patch grammar. A micro hex is an actual gameplay terrain cell. A patch tile is a non-overlapping radius-2 group of 19 micro hexes used as one generation unit. A patch edge signature is an ordered list of socket values along one patch side. Authored patches explicitly define their internal micro-cell layout; rotations are generated from the authored canonical layout instead of routing every feature through the patch center.

`WfcTerrainProvider` commits terrain one patch at a time as the player moves. It keeps committed patch variants by patch coordinate and expanded micro cells by micro coordinate. The active generation radius is measured in patch coordinates around the player's current patch. Missing patches are generated in deterministic ring order, filtered against already-committed neighbor edge signatures, then committed permanently. Existing patches are never regenerated.

Terrain reads, generation requests, and generation steps are separate operations. `readCommittedCell` returns a committed immutable cell or `null`; it never caches, schedules, or generates. `requestGenerationAround` replaces the bounded rolling request without committing, and `stepGeneration` is the only rolling commit operation. Runtime generation commits at most three missing frontier patches per frame, allowing a newly required seven-patch outer arc to fill over several frames without monopolizing one frame. The movement-topology context is updated incrementally after each commit, so testing an authored or procedural candidate examines only that radius-2 candidate rather than rebuilding topology for the explored world. Procedural repair first tries a constant-work terminating-arm/open-core layout and retains exhaustive interior search as a correctness fallback.

Authored variants are always preferred and remain the weighted WFC vocabulary. Visual alternatives share topology-group budgets so adding another authored realization does not automatically increase that feature's global selection weight. Before selection, every candidate is expanded to micro cells and evaluated against the committed world. Frontier lookahead uses a cached edge-signature index so it examines only physically matching neighbor domains instead of rescanning the complete authored catalog for every side. The combined wall, river, and lake blocker set may not contain a hole, so neither same-feature nor mixed-feature barriers can enclose walkable or ungenerated terrain. This is a hard eligibility rule and runs before weighting. Bounded wall and river feature graphs remain as a secondary aesthetic policy that suppresses avoidable short loops and near-closures among otherwise topology-safe candidates.

If no authored variant can safely satisfy the accumulated neighbor boundary, `ProceduralTerrainPatch` treats the 12 boundary cells as fixed and solves the seven-cell interior. Open boundaries receive a connected open core; blocker arms may terminate independently when joining them would close a barrier. Homogeneous boundaries still fill inward rather than inventing unreachable grass. Procedural results have zero selection weight and exist only to make the authored grammar closed. Multiple interiors may be cached per boundary signature, and every cached layout is revalidated against current world topology before reuse. A synthesis failure is a real contradiction and must remain at zero in verification.

## Run Progression and Pause Ownership

`UpgradeSystem` stores only run-local stacks and derives effective player and spell values from immutable base configuration. Percentage modifiers compose multiplicatively, so repeated cooldown and spell-cost reductions remain positive without mutating the shared `SPELLS` definitions. Restart resets the system before the player, spells, HUD, and enemies are restored.

Manual pause and upgrade-choice pause are distinct reasons coordinated by `ZeusGame`. Either reason freezes the fixed-step simulation and suspends SFX, but only manual pause opens `PauseMenu`. An active upgrade offer owns the modal UI and blocks pause shortcuts until selection, saving, or timeout. Its ten-second deadline is read from presentation-time `performance.now()`, allowing the timer to continue while simulation time remains at zero.

The origin starts with a small open safe patch radius. `ZeusGame` performs that fixed-size bootstrap explicitly before initial visibility and enemy setup. Runtime patch selection uses local edge compatibility rather than solving a precomputed finite island. If a gameplay query reaches an uncommitted micro hex, collision and navigation treat it as unavailable, visibility treats it as opaque and undiscovered, ground effects return a neutral state, and rendering omits it. No consumer may synchronously commit the containing patch.

The world no longer has a gameplay boundary. The old finite-world `WORLD_CELLS`, `WORLD_SIZE`, and related constants have been removed from runtime config; if future diagnostics need fixed windows, they should define local active-window sizes instead of gameplay bounds. Visibility state is sparse-map backed so discovered memory can grow with generated terrain instead of being limited to a fixed array.

Terrain is split into structural cells and derived surfaces:

- Structures: `open`, `wall`, `bank`, `lake`, `river`; `bank` is reserved for a future water-adjacency post-pass and is not emitted by patch generation.
- Surfaces: `grass`, `meadow`, `sand`, `mud`, `stone`, `scarred`, `charged`, `cursed`.
- Edge/socket vocabulary: `open`, `closed`, `river`, `lake`.

`open` and `bank` are walkable. `wall`, `lake`, and `river` block movement. Only `wall` blocks visibility; water is a movement obstacle but not an occluder. The authored catalog includes open basins, isolated rocks, lower-frequency cliff endpoints/ridges/mirrored sways/dog-legs/tight and gentle bends/junctions/masses, bend-weighted river continuations, grouped lake coves, narrow-to-broad lake flares, mirrored shores/cores, broad river mouths, and river/lake/cliff transitions. It deliberately omits an all-open isolated lake basin. Authored river exits carry semantic input/output ports in addition to their physical sockets: cliff terminals expose one output, lake mouths consume one input, continuations carry one of each, and the rare junction is a two-input/one-output confluence. Validation requires those roles and physical terminal contact. Procedural open-core repair remains exempt because it is the grammar-closing safety fallback. Bank placement and its eventual movement-speed modifier are deferred to a post-generation terrain-decoration pass.

River mouths cover every current lake-edge profile and all five non-zero approach-angle classes through authored rotations and mirrored/tight variants. Every patch derives river, lake, and cliff influence cells for each edge. When two physically open `open/open/open` edges meet, river/lake or river/cliff features at micro-distance three or less are ineligible; distance four remains legal but is suppressed when an equally safe candidate avoids it. This prevents water from hiding beside and tracking a neighboring ridgeline merely because their shared patch edge is open. Two cove endpoints may sit beside one another across open edges but may not connect lake ports directly; a flare, shore, core, or mouth must mediate the lake body. If a candidate can join both an already committed river socket and lake socket, that semantic connection is preferred before loop policy and selection-group weights. Frontier-domain checks apply the same hydrology compatibility, including a bounded procedural one-ring trial when no authored physical candidate exists, so a committed patch cannot leave an ungenerated neighbor with only hydrologically invalid fills. Procedural synthesis retains open-core arm termination and is checked against committed feature clearance without changing its interior solver.

`ZeusGame` is the single frame-lifecycle owner of rolling terrain generation. Once per animation frame, before camera, input, simulation, visibility, and rendering, it submits the current player-centered request and profiles one bounded generation step. Startup bootstrap has its own `terrainBootstrap` attribution. There is no demand-generation timing path, and Player timing contains no terrain work. `TerrainSystem`, collision, visibility, navigation, ground effects, development painters, and `GameDiagnostics` receive committed reads only. Provider diagnostics retain incremental invariant samples, bounded count snapshots, and detached samples instead of rerunning whole-world audits or exposing mutable provider state. Composition snapshots require an explicit bounded patch region.

The current cliff edge vocabulary deliberately has centered `open/closed/open` ridgeline sockets and solid `closed/closed/closed` cores, but no asymmetric `closed/closed/open` and `open/closed/closed` shoulder pair. As a result, authored cliffs read primarily as one-cell ridges and cannot taper naturally into a solid cliff core. Add the paired asymmetric shoulders and centered-to-solid adapters if broader cliff masses become desirable.

River flow is semantic rather than encoded in the physical socket vocabulary. Authored output ports connect only to authored input ports, directed cycles are rejected, cliff transitions are sources, and lake mouths are sinks. Generation may still place a sink before its upstream neighbors because rolling commit order is independent of water direction. Procedural patches intentionally bypass port matching so the grammar-closing fallback can terminate an otherwise unsatisfied arm. Future elevation can build on these ports without changing physical `river` sockets.

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
