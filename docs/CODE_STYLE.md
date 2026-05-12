# Code Style

## TypeScript

- Use strict TypeScript and avoid `any`.
- Prefer explicit exported types for cross-module contracts.
- Keep framework-neutral helpers pure where practical.
- Keep comments rare and useful. A comment should explain non-obvious intent, not restate code.

## Files

- `src/main.ts` is boot only.
- Keep most files under roughly 250 lines.
- Split by responsibility before adding a second feature to an already-large file.
- Prefer named exports.

## Three.js

- Gameplay positions live on the `X/Z` plane.
- `Y` means height.
- Mesh factory/helper code belongs in `src/render`.
- Long-lived materials can be shared; per-effect geometries/materials should be short-lived and removed from the scene when their TTL ends.
- When adding persistent geometry or render targets, add disposal paths.

## Gameplay Code

- Use constants in `src/config.ts` for tuning values that designers will tweak.
- Use `SpellId` instead of stringly-typed spell names.
- Keep movement and spell targeting deterministic and easy to read before optimizing.
- Do not add WASD movement unless the user explicitly asks.

## CSS

- HUD is a functional game overlay, not a landing page.
- Keep text compact and legible at desktop and mobile sizes.
- Avoid explanatory in-app copy unless it is part of the HUD state.
