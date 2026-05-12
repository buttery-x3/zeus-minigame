# Zeus Minigame Agent Notes

This project is a personal proof-of-concept for an isometric 3D storm-mage arena game.

## Stack

- Use Three.js, TypeScript, Vite, and plain HTML/CSS.
- Do not reintroduce Phaser or a second rendering/game framework without an explicit user request.
- Keep the first screen as the playable game, not a landing page.

## Commands

```bash
npm install
npm run dev
npm run build
npm run verify
```

The dev server normally runs at `http://127.0.0.1:5173/`.

Run `npm run verify` after changing gameplay, HUD, camera, input, scene setup, rendering, or core styles. If behavior changes intentionally, update `scripts/verify-render.mjs` and `docs/TESTING.md` in the same patch.

## Coordinate Conventions

- Gameplay uses the Three.js `X/Z` ground plane.
- `Y` is vertical height.
- Grid cells map to world `x/z`, not screen pixels.
- Use `distance2D` for ground-plane distances.

## Architecture Rules

- Keep `src/main.ts` as bootstrapping only.
- Put durable gameplay systems under `src/game`.
- Put world/grid/procedural terrain concerns under `src/world`.
- Put Three.js rendering helpers under `src/render`.
- Put DOM HUD code under `src/ui`.
- Put small framework-neutral helpers under `src/lib`.
- Prefer files below roughly 250 lines. A larger file is acceptable only while actively splitting a feature.
- Keep render verification current as new default gameplay functionality is added.

## Gameplay Direction

- The core feel is Dota-like targeted spellcasting in an isometric arena.
- Movement is click or hold-to-move only, no WASD by default.
- `Q` is Chain Lightning and `W` is Lightning Bolt.
- Enemies are simple melee chasers until a specific feature expands them.
- Preserve the grid/world foundation for future obstacle generation and WFC experiments.
