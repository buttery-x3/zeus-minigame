# Gameplay

## Current Loop

The player controls a Zeus-inspired storm caster in an isometric 3D arena. Melee enemies spawn around the player, chase directly, and deal contact damage. The player survives by moving and casting targeted lightning spells.

## Controls

- Hold or click left mouse to move.
- Quick Cast is on by default: hold `Q` or `W` to target, then release the key to cast.
- When Quick Cast is off in the pause menu, press `Q` or `W`, then left-click a target area to cast.
- Allow Max Range Target Snap is on by default: out-of-range spell aims cast at the spell's max range.
- Press `Esc` or right-click to cancel targeting. `Esc` also pauses or resumes depending on the current state.
- Press backtick or `F3` to toggle diagnostics.
- Press `V` to toggle enemy health bars between smart and always visible.
- Press `R` after defeat to restart.
- Use the top-right controls to pause or open diagnostics.

## Player

- Health starts at `120`.
- Mana starts at `100`.
- Mana regenerates over time and gains a small bump from kills.
- Movement is click/hold-to-move on the `X/Z` ground plane.
- Movement commands require known terrain: Zeus can move to previously discovered walkable ground even when it is no longer currently visible.
- Vitals, game, status, abilities, and diagnostics are DOM windows. The pause menu's Unlock UI toggle enables their lock controls and movement; it defaults off so transparent HUD panels stay quiet and click-through.

## Spells

- Chain Lightning targets an enemy near the clicked area, then jumps to nearby enemies with decaying damage.
- Lightning Bolt strikes near the clicked area, deals high single-target damage, and splashes nearby enemies.
- Spells require current visibility and light at the resolved target point. Casts into blocker shadows, undiscovered terrain, or remembered darkness are rejected before spending mana or cooldown.
- When Allow Max Range Target Snap is off, raw out-of-range spell targets are rejected instead of snapping to max range.
- Spells use explicit mana costs, cooldowns, and targeting ranges from `src/config.ts`.

## Enemies

- Melee enemies chase directly when walls do not interrupt line of sight, otherwise they use a shared hex flow field around Zeus.
- If an enemy cannot sample the flow field, it steers toward the field edge and only requests a budgeted fallback path if it stalls.
- Ranged, retreating, special-goal, and future tactical enemy intents are scaffolded but not active yet.
- Waves accelerate spawning over time.
- Enemy health bars default to smart visibility: recently damaged enemies, enemies near the cursor, and wounded enemies close to Zeus are shown. The pause menu and `V` key can switch them to always visible.
- Enemy meshes respect world visibility. Hidden enemies continue simulating, while recently damaged hidden enemies can leave a short health-bar hint.
- Enemy-enemy collision is intentionally out of scope for the current prototype.

## World

- The world is a deterministic axial hex grid over the `X/Z` plane. HUD coordinates are shown as `q,r`.
- Terrain cells have a structural type and a derived surface. Structures are `open`, `wall`, `bank`, `lake`, and `river`; surfaces include `grass`, `dirt`, `sand`, `mud`, `stone`, `scarred`, and `charged`.
- `open` and `bank` are walkable. `wall`, `lake`, and `river` block movement. Water is not a visibility occluder in the first hex pass; only `wall` blocks sight.
- The terrain grammar also reserves future WFC edge/socket kinds: `open`, `closed`, `river`, and `lake`. Future generation should keep surfaces as post-process detail and preserve the wall-water adjacency rule by placing `bank` between `wall` and `lake`/`river`.
- Gameplay visibility is tracked separately from Three.js render lighting. Zeus has a world light radius with wall-aware hex field of view, per-cell light falloff, permanent discovered navigation memory, and void treatment for unlit cells.
- Discovered terrain outside all current light goes dark again. Discovered terrain only remains dimly readable when it is inside the current light radius but hidden by blocker line of sight; active details and actors require direct current visibility.
- Wall blocker objects are hidden when their cells are undiscovered or outside the current light reach, so raised geometry does not remain readable in complete darkness.
