# Testing

The project has two verification layers:

```bash
npm run build
npm run verify:render
```

Use the combined command when you want the normal full check:

```bash
npm run verify
```

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
- Preloads the required Web Audio cue catalog from the configured base path, unlocks playback from a user gesture, and checks Chain Lightning, Lightning Bolt, failed-cast, player-hit, minion-death, and new-wave routing through deterministic audio diagnostics rather than speaker output.
- Checks that failed casts preserve distinct cooldown, out-of-mana, hidden-target, and strict out-of-range reasons while sharing the current failure cue.
- Checks the tuned per-cue mix levels and confirms cooldown failures play one octave lower with a subtle random detune range.
- Streams and loops the arena BGM after the first user gesture, confirms it continues through pause and game restart, and checks that its playback position advances without joining the decoded SFX buffer catalog.
- Checks the pause-menu SFX/BGM sliders, live percentage outputs, pause-time SFX suppression, default-off spell-failure toggle, enabled cooldown pitch behavior, and local preference persistence across reload.
- Checks gameplay visibility diagnostics, 2x continuous visibility overlay diagnostics, wall shadow samples, hidden-cast rejection, undiscovered movement rejection, discovered unlit terrain, hidden dark walls, and wall-occluded memory after exploration.
- Checks rolling patch terrain diagnostics, including active patch-radius generation, at least one river micro hex, no emergency patches, and ordered patch edge socket agreement.
- Checks deterministic special-ground generation, including reachable charged and cursed cells and the requirement that cursed ground remains rarer.
- Exercises charged ground to confirm both cooldown and Power recovery run at `1.75x`, leaving preserves consumed capacity, returning resumes consumption, and the tile depletes after about three cumulative seconds.
- Exercises cursed ground to confirm pause freezes cleansing, leaving resets progress, completion grants exactly one Cursed Energy, and the tile becomes cleansed.
- Confirms each cursed-ground reward immediately opens a paused upgrade offering and that saving the reward resumes play without spending it.
- Opens deterministic upgrade offerings to check three distinct cards, randomly assigned `1`/`2`/`3` costs, affordability, Escape protection, viewport fit, simulation freeze, wall-clock timer progress, explicit saving, exact spending, and ten-second timeout-to-save behavior.
- Applies every upgrade through dev-only verification hooks and checks derived HP, Power, regeneration, movement, spell cooldown/cost/damage, Chain Lightning bounce, and Lightning Bolt multiplier diagnostics.
- Confirms the one-hit shield blocks exactly one damage event, enters its 30-second recharge, replenishes, and exposes ready/recharge state in the HUD build summary.
- Confirms special charged/cursed tile interactions select their matching channeling loop, own at most one loop, suspend it during pause, and stop it after leaving, depletion, or cleansing.
- Confirms the player-owned cell contact drives special-ground activation, dormant glyphs perform no animation work, and exactly one seven-point particle object plus one glyph animation is active only while Zeus occupies charged or cursed ground. The contract also checks the `8x` particle-size multiplier.
- Checks the player outline through diagnostics: golden-orange normally, brighter gold on charged ground, and violet on cursed ground.
- Checks Terrain Debug mode by toggling it on, verifying fog is disabled, camera view is widened with debug framing, HP remains full, the rendered terrain window expands, and rolling terrain diagnostics remain valid without increasing the configured generation radius or generating new patches.
- Checks that hidden spell targets do not spend cooldown, default out-of-range spell targets snap to max range, and strict mode rejects out-of-range raw targets.
- Checks that click and held movement commands reject undiscovered terrain.
- Clicks a visible wall blocker and checks that navigation resolves to reachable discovered neighboring hex space.
- Opens the pause menu and diagnostics window, including the diagnostics lock/close controls.
- Checks the pause menu audio controls, enemy health bar visibility options, Quick Cast toggle, and Allow Max Range Target Snap toggle, and confirms the expanded menu fits the supported desktop viewport.
- Checks enemy local avoidance diagnostics for nearby-unit spacing and bounded movement speed.
- Checks that diagnostics exposes enemy hex flow-field metrics and that the smoke path does not create a pathfinding call spike.
- Presses `V` to verify enemy health bars toggle between smart and always visible modes while respecting world visibility.
- Exercises click movement, default Quick Cast key-release casts, right-click targeting cancel, and the toggle-off legacy click-cast flow.
- Re-checks the pathfinding budget after core interactions so fallback enemy navigation stays bounded.
- Checks that core HUD text and ability buttons exist, including the vitals panel below the ability panel, the Unlock UI toggle, default-unlocked edit mode, locked transparent HUD panels, click-through behavior, gated hover reveal, and radial spell cooldown button state.
- Checks that the Currencies panel starts at the bottom-left, displays Cursed Energy, expands upward while keeping its currency row bottom-aligned, and supports the same unlock, drag, relock, transparency, and click-through behavior as the other HUD panels.
Do not add or run screenshot-based canvas verification, pixel sampling, luminance thresholds, color-bucket heuristics, or similar visual image checks. They are intentionally excluded because they are flaky and expensive. Verify render behavior through deterministic runtime diagnostics and DOM state instead.

Mobile layouts and controls are not currently supported or included in render verification. Desktop is the only target until the control scheme is deliberately expanded for mobile play.

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
