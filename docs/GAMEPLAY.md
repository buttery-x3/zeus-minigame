# Gameplay

## Current Loop

The player controls a Zeus-inspired storm caster in an isometric 3D arena. Melee enemies spawn around the player, chase directly, and deal contact damage. The player survives by moving and casting targeted lightning spells.

## Controls

- Hold or click left mouse to move.
- Press `Q`, then left-click a target area to cast Chain Lightning.
- Press `W`, then left-click a target area to cast Lightning Bolt.
- Press `Esc` to cancel targeting.
- Press `R` after defeat to restart.

## Player

- Health starts at `120`.
- Mana starts at `100`.
- Mana regenerates over time and gains a small bump from kills.
- Movement is click/hold-to-move on the `X/Z` ground plane.

## Spells

- Chain Lightning targets an enemy near the clicked area, then jumps to nearby enemies with decaying damage.
- Lightning Bolt strikes near the clicked area, deals high single-target damage, and splashes nearby enemies.
- Spells use explicit mana costs, cooldowns, and targeting ranges from `src/config.ts`.

## Enemies

- Enemies are currently simple melee chasers.
- Waves accelerate spawning over time.
- Enemy collision/pathfinding is intentionally simple and should be expanded before obstacle-heavy maps.

## World

- The world is a deterministic grid over the `X/Z` plane.
- Terrain cells currently include floor, scarred, charged, and reserved blocker cells.
- Reserved blockers are the placeholder for future obstacle/pathing and WFC-generated terrain work.
