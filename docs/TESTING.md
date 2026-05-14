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
- Loads desktop and mobile viewports.
- Checks that the follow camera keeps a stable orientation while click movement changes direction.
- Moves away from origin and checks that the key-light shadow rig follows the active play area.
- Clicks a visible blocker and checks that navigation resolves to reachable edge space.
- Opens the pause menu and diagnostics window, including the diagnostics lock/close controls.
- Checks the pause menu enemy health bar visibility options.
- Checks that diagnostics exposes enemy flow-field metrics and that the smoke path does not create a pathfinding call spike.
- Holds `Alt` to verify enemy health bars reveal every spawned enemy in the default smart mode.
- Exercises click movement plus `Q` and `W` targeted casts.
- Checks that the WebGL canvas is not blank or visually flat.
- Checks that core HUD text and ability buttons exist.
- Saves screenshots into `verify/`.

`verify/` is ignored by git.

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
- New required HUD elements.
- New default spells or ability keys.
- Camera behavior that changes framing.
- Rendering that changes the canvas baseline significantly.
- Game states that should be smoke-tested, such as pause, death, restart, upgrades, or menus.

Keep the verifier focused on smoke coverage. It should prove the playable scene boots, renders, responds to core input, and exposes expected HUD state; it should not become a full gameplay simulation.
