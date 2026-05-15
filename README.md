# Zeus Minigame

A quick Three.js + TypeScript + Vite proof of concept for an isometric 3D storm-mage arena game.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL, usually `http://127.0.0.1:5173/`.

## Verify

```bash
npm run verify
```

This runs the production build and a headless browser smoke test for rendering, HUD, movement, and the `Q`/`W` spell flow.

## Prototype Controls

- Hold or click the left mouse button to move.
- Quick Cast is on by default: hold `Q` or `W` to aim, then release to cast.
- When Quick Cast is off in the pause menu, press `Q` or `W`, then left-click to cast.
- Allow Max Range Target Snap is on by default: out-of-range spell aims cast at max range.
- Press `Esc` or right-click to cancel targeting.
- Press `R` after defeat to restart.

## Current Shape

- Orthographic isometric camera following the player in a larger grid-based world.
- Three.js mesh player, enemies, terrain cells, obstacle blocks, and lightning effects.
- Procedural terrain cells with a reserved blocker terrain type for future obstacle/pathing work.
- Simple melee chaser enemies that spawn around the player.
- HTML/CSS health, mana, cooldowns, wave counter, kill counter, and grid cell readout.
