# Gameplay

## Current Loop

The player controls a Zeus-inspired storm caster in an isometric 3D arena. Melee enemies spawn around the player, chase directly, and deal contact damage. The player survives by moving and casting targeted lightning spells.

## Controls

- Hold or click left mouse to move.
- Press `Q`, then left-click a target area to cast Chain Lightning.
- Press `W`, then left-click a target area to cast Lightning Bolt.
- Press `Esc` to cancel targeting, pause, or resume depending on the current state.
- Press backtick or `F3` to toggle diagnostics.
- Press `V` to toggle enemy health bars between smart and always visible.
- Press `R` after defeat to restart.
- Use the top-right controls to pause or open diagnostics.

## Player

- Health starts at `120`.
- Mana starts at `100`.
- Mana regenerates over time and gains a small bump from kills.
- Movement is click/hold-to-move on the `X/Z` ground plane.
- Vitals, position, status, abilities, and diagnostics are DOM windows that can be moved when unlocked.

## Spells

- Chain Lightning targets an enemy near the clicked area, then jumps to nearby enemies with decaying damage.
- Lightning Bolt strikes near the clicked area, deals high single-target damage, and splashes nearby enemies.
- Spells use explicit mana costs, cooldowns, and targeting ranges from `src/config.ts`.

## Enemies

- Melee enemies chase directly when blockers do not interrupt line of sight, otherwise they use a shared flow field around Zeus.
- If an enemy cannot sample the flow field, it steers toward the field edge and only requests a budgeted fallback path if it stalls.
- Ranged, retreating, special-goal, and future tactical enemy intents are scaffolded but not active yet.
- Waves accelerate spawning over time.
- Enemy health bars default to smart visibility: recently damaged enemies, enemies near the cursor, and wounded enemies close to Zeus are shown. The pause menu and `V` key can switch them to always visible.
- Enemy-enemy collision is intentionally out of scope for the current prototype.

## World

- The world is a deterministic grid over the `X/Z` plane.
- Terrain cells currently include floor, scarred, charged, and reserved blocker cells.
- Reserved blockers block movement and are used by player/enemy pathfinding.
