# Zeus Minigame

A quick Phaser + TypeScript + Vite proof of concept for a top-down storm-mage arena game.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL, usually `http://127.0.0.1:5173/`.

## Prototype Controls

- Hold or click the left mouse button to move.
- Press `Q`, then left-click a target area to cast Chain Lightning.
- Press `W`, then left-click a target area to cast Lightning Bolt.
- Press `Esc` to cancel targeting.
- Press `R` after defeat to restart.

## Current Shape

- Camera-follow player in a larger grid-based world.
- Procedural terrain cells with a reserved blocker terrain type for future obstacle/pathing work.
- Simple melee chaser enemies that spawn around the player.
- Health, mana, cooldowns, wave counter, kill counter, and grid cell readout.
