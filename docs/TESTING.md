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

- Starts the Vite dev server if `http://127.0.0.1:5173/` is not already reachable.
- Launches a Chromium-based browser through `playwright-core`.
- Loads the supported desktop viewport at 1280x720.
- Checks that the follow camera keeps a stable orientation while click movement changes direction.
- Moves away from origin and checks that the key-light shadow rig follows the active play area.
- Holds left-click on known visible terrain and checks that movement retargets as the follow camera moves.
- Checks gameplay visibility diagnostics, 2x continuous visibility overlay diagnostics, wall shadow samples, hidden-cast rejection, undiscovered movement rejection, discovered unlit terrain, hidden dark walls, and wall-occluded memory after exploration.
- Checks rolling patch terrain diagnostics, including active patch-radius generation, at least one river micro hex, no emergency patches, and ordered patch edge socket agreement.
- Checks deterministic special-ground generation, including reachable charged and cursed cells and the requirement that cursed ground remains rarer.
- Exercises charged ground to confirm both cooldown and Power recovery run at `1.75x`, leaving preserves consumed capacity, returning resumes consumption, and the tile depletes after about three cumulative seconds.
- Exercises cursed ground to confirm pause freezes cleansing, leaving resets progress, completion grants exactly one Cursed Energy, and the tile becomes cleansed.
- Checks Terrain Debug mode by toggling it on, verifying fog is disabled, camera view is widened with debug framing, HP remains full, the rendered terrain window expands, and rolling terrain diagnostics remain valid without increasing the configured generation radius or generating new patches.
- Checks that hidden spell targets do not spend cooldown, default out-of-range spell targets snap to max range, and strict mode rejects out-of-range raw targets.
- Checks that click and held movement commands reject undiscovered terrain.
- Clicks a visible wall blocker and checks that navigation resolves to reachable discovered neighboring hex space.
- Opens the pause menu and diagnostics window, including the diagnostics lock/close controls.
- Checks the pause menu enemy health bar visibility options, Quick Cast toggle, and Allow Max Range Target Snap toggle.
- Checks enemy local avoidance diagnostics for nearby-unit spacing and bounded movement speed.
- Checks that diagnostics exposes enemy hex flow-field metrics and that the smoke path does not create a pathfinding call spike.
- Presses `V` to verify enemy health bars toggle between smart and always visible modes while respecting world visibility.
- Exercises click movement, default Quick Cast key-release casts, right-click targeting cancel, and the toggle-off legacy click-cast flow.
- Re-checks the pathfinding budget after core interactions so fallback enemy navigation stays bounded.
- Checks that the WebGL canvas is not blank or visually flat.
- Checks that core HUD text and ability buttons exist, including the Unlock UI toggle, locked transparent HUD panels, click-through behavior, gated hover reveal, and radial spell cooldown button state.
- Checks that the Currencies panel starts at the bottom-left, displays Cursed Energy, and supports the same unlock, drag, relock, transparency, and click-through behavior as the other HUD panels.
- Saves screenshots into `verify/`.

`verify/` is ignored by git.

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
