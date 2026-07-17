# Testing

The project has four verification layers:

```bash
npm run build
npm run test:terrain
npm run test:game
npm run verify:render
```

The local terrain workbench has an additional isolated build and browser check:

```bash
npm run verify:terrain-lab
```

An extensive terrain-only characterization run is available separately through `npm run test:terrain:soak`.

Use the combined command when you want the normal full check:

```bash
npm run verify
```

The combined command includes the terrain-workbench check after the production game checks.

## Terrain Workbench Verification

`npm run verify:terrain-lab` builds the separate `tools/terrain-lab` Vite entry and opens it at 1280×720 and 3440×1440 viewports. It verifies viewport containment, the dirt-free authored-definition inventory, exact cliff-river filtering, derived component display, and the collapsed and explicitly boundary-only procedural comparison. It also constructs and resolves a complete Connection Lab ring, checks authored/procedural topology results and preview containment, persists a draft decision, generates canonical coverage, and reopens a witness. World checks cover one-patch and complete bounded generation, fit/zoom controls, Canvas patch selection, the authored catalog link, and the committed-neighbor handoff back to Connection Lab. Browser console and page errors fail the check.

The production build does not include the workbench. The workbench smoke test uses port `5176`, separate from the normal game and game-verification ports.

## Build Check

`npm run build` runs TypeScript and Vite production bundling. This catches type errors, broken imports, and most module-level problems.

## Render Verification

`npm run verify:render` runs [scripts/verify-render.mjs](../scripts/verify-render.mjs). It:

- Starts a verification Vite server under the production-style `/zeus/` base path on `http://127.0.0.1:5174/zeus/`, keeping it separate from the normal port `5173` development server.
- Launches a Chromium-based browser through `playwright-core`.
- Loads the supported desktop viewport at 1280x720.
- Checks that the follow camera keeps a stable orientation while click movement changes direction.
- Injects controlled 160–320 ms main-thread stalls and checks that active gameplay catches up through bounded simulation substeps, long stalls remain capped, pause remains frozen, and visibility resets discard hidden-tab time.
- Moves away from origin and checks that the key-light shadow rig follows the active play area.
- Holds left-click on known visible terrain and checks that movement retargets as the follow camera moves.
- Loads the 512px skinned Zeus GLB with forced opaque, depth-writing materials and checks its exact animation inventory, `Idle_8` default, `Run_03` movement, 5x Q/W cast clips facing their resolved targets, pause freeze, `Dead` defeat, and restart back to idle through runtime diagnostics.
- Loads the shared skinned melee-enemy GLB for every spawned enemy, checks its exact animation inventory, verifies `Walking_Woman` is the default loop, triggers `Stylish_Walk_inplace`, and confirms the enemy returns to walking.
- Confirms Normal rendering uses instanced terrain batches, then toggles Potato rendering live and checks its half-resolution buffer, continuous presentation cadence, disabled shadows, primitive player/enemy visuals, unlit terrain rebuild, and persisted preference before restoring Normal mode.
- Preloads the required Web Audio cue catalog from the configured base path, unlocks playback from a user gesture, and checks Chain Lightning, Lightning Bolt, failed-cast, player-hit, minion-death, and new-wave routing through deterministic audio diagnostics rather than speaker output.
- Checks that failed casts preserve distinct cooldown, out-of-mana, hidden-target, and strict out-of-range reasons while sharing the current failure cue.
- Checks the tuned per-cue mix levels and confirms cooldown failures play one octave lower with a subtle random detune range.
- Streams and loops the arena BGM after the first user gesture, confirms it continues through pause and game restart, and checks that its playback position advances without joining the decoded SFX buffer catalog.
- Checks the pause-menu SFX/BGM sliders, live percentage outputs, pause-time SFX suppression, default-off spell-failure toggle, enabled cooldown pitch behavior, and local preference persistence across reload.
- Checks gameplay visibility diagnostics, 2x continuous visibility overlay diagnostics, wall shadow samples, hidden-cast rejection, undiscovered movement rejection, discovered unlit terrain, hidden dark walls, and wall-occluded memory after exploration.
- Checks rolling patch terrain diagnostics, including authored-first selection, budgeted frontier generation timing, expanded bend topology, zero patch-generated banks, active short-loop suppression, zero movement enclosures, zero synthesis failures or emergency patches, ordered patch edge socket agreement, and exact agreement between generated wall cells and rendered blocker instances.
- Checks deterministic special-ground generation, exploring through visible walkable cells when necessary to find reachable charged and cursed samples, and requires cursed ground to remain rarer.
- Exercises charged ground to confirm both cooldown and Power recovery run at `1.75x`, leaving preserves consumed capacity, returning resumes consumption, and the tile depletes after about three cumulative seconds.
- Exercises cursed ground to confirm pause freezes cleansing, leaving resets progress, completion grants exactly one Cursed Energy, and the tile becomes cleansed.
- Confirms each cursed-ground reward immediately opens a paused upgrade offering and that saving the reward resumes play without spending it.
- Opens deterministic upgrade offerings to check three distinct cards, randomly assigned `1`/`2`/`3` costs, affordability, Escape protection, viewport fit, simulation freeze, wall-clock timer progress, explicit saving, exact spending, and ten-second timeout-to-save behavior.
- Applies every upgrade through dev-only verification hooks and checks derived HP, Power, regeneration, movement, spell cooldown/cost/damage, Chain Lightning bounce, and Lightning Bolt multiplier diagnostics.
- Confirms the one-hit shield blocks exactly one damage event, enters its 30-second recharge, replenishes, and exposes ready/recharge state in the HUD build summary.
- Confirms special charged/cursed tile interactions select their matching channeling loop, own at most one loop, suspend it during pause, and stop it after leaving, depletion, or cleansing.
- Confirms the player-owned cell contact drives special-ground activation, dormant glyphs perform no animation work, and exactly one seven-point particle object plus one glyph animation is active only while Zeus occupies charged or cursed ground. The contract also checks the `8x` particle-size multiplier.
- Checks the player outline through diagnostics: golden-orange normally, brighter gold on charged ground, and violet on cursed ground.
- Checks Terrain Debug mode by toggling it on, verifying fog is disabled, camera view is widened with debug framing, HP remains full, committed blockers are retained, thick patch-boundary diagnostics become active only in debug mode, and rolling terrain diagnostics remain valid without increasing the configured generation radius or generating new patches.
- Checks that hidden spell targets do not spend cooldown, default out-of-range spell targets snap to max range, and strict mode rejects out-of-range raw targets.
- Checks that click and held movement commands reject undiscovered terrain.
- Clicks a visible wall blocker and checks that navigation resolves to reachable discovered neighboring hex space.
- Opens the pause menu and diagnostics window, including the diagnostics lock/close controls.
- Checks the pause menu audio controls, enemy health bar visibility options, Quick Cast toggle, Allow Max Range Target Snap toggle, Unlock UI toggle, session-only Navigation Debug options, and confirms the expanded menu fits the supported desktop viewport.
- Confirms gameplay/UI preferences persist across reloads, including Potato rendering and every HUD panel position, while Terrain Debug remains session-only; partial and malformed stored settings must fall back safely.
- Checks enemy local avoidance diagnostics for nearby-unit spacing and bounded movement speed.
- Checks that diagnostics exposes enemy hex flow-field, frame scheduler, 600-frame pacing, heap/resource, and pooled navigation-overlay metrics; exercises `F6` through Stalled/All/Off; confirms active navigation debugging makes the player invulnerable and Off removes that protection; and confirms Off clears tracked enemies and rendered lines. The smoke path must not create a pathfinding call or navigation-slice spike.
- Presses `V` to verify enemy health bars toggle between smart and always visible modes while respecting world visibility.
- Exercises click movement, default Quick Cast key-release casts, right-click targeting cancel, and the toggle-off legacy click-cast flow.
- Re-checks the pathfinding budget after core interactions so fallback enemy navigation stays bounded.
- Checks that core HUD text and ability buttons exist, including the vitals panel below the ability panel, the Unlock UI toggle, default-unlocked edit mode, locked transparent HUD panels, click-through behavior, gated hover reveal, and radial spell cooldown button state.
- Checks that the Currencies panel starts at the bottom-left, displays Cursed Energy, expands upward while keeping its currency row bottom-aligned, and supports the same unlock, drag, relock, transparency, and click-through behavior as the other HUD panels.
Do not add or run screenshot-based canvas verification, pixel sampling, luminance thresholds, color-bucket heuristics, or similar visual image checks. They are intentionally excluded because they are flaky and expensive. Verify render behavior through deterministic runtime diagnostics and DOM state instead.

Mobile layouts and controls are not currently supported or included in render verification. Desktop is the only target until the control scheme is deliberately expanded for mobile play.

## Terrain Function Verification

`npm run test:terrain` runs deterministic TypeScript function tests through Vitest. It validates every authored patch and rotation, confirms the `5/15/15/2` river topology budgets, directly halved cliff definition weights, and grouped cove budget, excludes the isolated all-open lake basin, and checks that generated banks remain absent. It rejects authored one-exit rivers without a physically adjacent lake or cliff terminal, requires cliff-output/continuation/lake-input flow roles, rejects output-to-output joins and directed river cycles, verifies the required river-mouth profile/angle matrix, and requires an authored reverse match for every lake-shore and mouth socket. Targeted clearance tests reject distance-three river/lake and river/cliff arrangements hidden behind `open/open/open` sockets, retain and score legal distance-four arrangements, reject meeting cove ports while allowing cove-to-shore/mouth connections, and prove that semantic connection preference wins before selection weights. `GridWorld` tests require committed reads and generation requests to leave terrain unchanged until the explicit bounded step runs. Patch-boundary tests require only inter-patch shared edges and deduplicate every rendered segment. The suite also exercises open-core and homogeneous/mixed procedural fills, checks deterministic output, exhaustively enumerates bounded Connection Lab interiors, groups topology alternatives, and verifies rotation/mirror canonical boundary keys. Exact movement-topology tests distinguish an allowed U-shaped mixed barrier and solid obstacle mass from a wall/river/lake ring around walkable terrain. Feature-graph tests continue to distinguish short cliff extensions and near-closures, while a forced closure is now rejected by the hard topology rule. Runtime repair coverage requires the constant-work termination path and the three-patch frame budget. Multi-seed rolling stress requires active hydrology, cove, river/cliff-clearance, and river-flow diagnostics, enclosure rejection, gentle-bend vocabulary, and broad terrain-composition catastrophe guards while committed cove/hydrology/river-flow/enclosure samples, synthesis failures, emergency substitutions, contradictions, and socket mismatches remain at zero.

### Terrain Composition Characterization

The fast terrain suite aggregates four deterministic radius-five samples and inspects complete radius-three local patch windows, matching the normal active generation radius. `npm run test:terrain:soak` is a separate deterministic 24-seed, radius-ten run intended for generator refactors, manual pre-merge checks, or scheduled CI. The soak test is deliberately excluded from `npm run verify` so normal verification does not pay its runtime cost.

Composition is measured at three independent levels: the selected authored family (with procedural selections in their own bucket), the actual feature content of each selected patch, and the final generated microcell structures. Reports are built only from explicitly bounded, already-committed snapshots; reading a snapshot or report must not request cells, advance a generation step, or generate patches. Failures print aggregate and per-seed counts and percentages, per-seed variance, and the worst complete local windows.

These checks are characterization and catastrophe guards, not final terrain-balance targets. They require important vocabulary to be selected, prevent complete family disappearance and extreme featureless local windows, and use only broad runaway-dominance limits. Do not replace them with exact count snapshots or tighten them around current percentages. Change a bound only when the definition of a catastrophic outcome changes, not merely because generation balance changes intentionally.

`patch.transition.cliff-river` is a transition-family river source containing both wall and river cells. Selecting it proves that the cliff-origin river transition remains reachable; it does not prove that an ordinary authored patch whose family is `cliff` was selected. The composition regression therefore counts committed family metadata directly and has a separate ordinary-cliff disappearance guard.

## Navigation Function Verification

`npm run test:game` runs deterministic Vitest coverage for resumable linecasts, incremental Theta* and destination resolution, distinct path completion/failure reasons, long routes around extended barriers, active/staging flow-field swaps, latest-root coalescing, scheduler source fairness, obstacle-aware enemy movement choice, populated-flow direct-stall suppression, stale-goal cancellation, fallback queue timeout/rejoin, multi-enemy path ownership, conservative uncommitted-terrain handling, and single-phase rolling-generation timing attribution. These tests use fixed operation limits in addition to wall-clock deadlines so correctness does not depend on machine speed.

The browser verifier also holds movement while the camera tracks Zeus, checks that the requested reticle updates immediately, requires a route to complete while held requests refresh, and repeats held movement against a blocker to confirm the destination resolves to nearby discovered walkable ground.

## Browser Path

The verifier looks for Chrome or Edge in common OS locations. If it cannot find a browser, set:

```bash
PLAYWRIGHT_BROWSER_PATH=/path/to/chrome npm run verify:render
```

On Windows PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSER_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run verify:render
```

## When To Update The Verifier

Update `scripts/verify-render.mjs` when adding or changing:

- Core controls or input flows.
- Enemy movement, collision, or avoidance behavior.
- New required HUD elements.
- New default spells or ability keys.
- Camera behavior that changes framing.
- Rendering that changes the canvas baseline significantly.
- Game states that should be smoke-tested, such as pause, death, restart, upgrades, or menus.
- Persistent or consumable terrain interactions and currencies.

Keep the verifier focused on smoke coverage. It should prove the playable scene boots, renders, responds to core input, and exposes expected HUD state; it should not become a full gameplay simulation.
