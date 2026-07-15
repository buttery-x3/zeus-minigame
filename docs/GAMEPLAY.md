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
- Press `F4` or use the pause menu to toggle Terrain Debug, which removes fog, zooms the camera out 3x with debug framing, renders a wider window of already-generated terrain, bypasses visibility-gated movement/cast checks, and keeps Zeus at full HP for terrain inspection.

## Audio

- Arena music begins after the first mouse or keyboard interaction and loops continuously, including while the pause menu is open.
- The pause menu provides independent SFX and BGM volume sliders. SFX is silenced while paused so BGM changes can be previewed cleanly.
- Spell-failure audio is off by default for cooldown, mana, visibility, and range failures. It can be enabled from the pause menu; visual failure feedback remains active either way.
- Audio preferences persist in the browser across reloads. Hidden tabs pause both BGM and SFX until play resumes.
- Use the top-right controls to pause or open diagnostics.

## Player

- Health starts at `120`.
- Mana starts at `100`.
- Mana regenerates over time and gains a small bump from kills.
- Health regeneration starts at zero and can be added through Cursed Energy upgrades.
- Active charged ground accelerates both mana regeneration and spell cooldown recovery by `1.75x`.
- Movement is click/hold-to-move on the `X/Z` ground plane.
- Movement commands require known terrain: Zeus can move to previously discovered walkable ground even when it is no longer currently visible.
- If pathfinding cannot resolve a full route to a movement command, Zeus falls back to moving in a straight visible line toward the command until terrain blocks the path.
- Vitals, game, status, abilities, and diagnostics are DOM windows. The pause menu's Unlock UI toggle enables their lock controls and movement; it defaults off so transparent HUD panels stay quiet and click-through.

## Spells

- Chain Lightning targets an enemy near the clicked area, then jumps to nearby enemies with decaying damage.
- Lightning Bolt strikes near the clicked area, deals high single-target damage, and splashes nearby enemies.
- Spells require current visibility and light at the resolved target point. Casts into blocker shadows, undiscovered terrain, or remembered darkness are rejected before spending mana or cooldown.
- When Allow Max Range Target Snap is off, raw out-of-range spell targets are rejected instead of snapping to max range.
- Spells use explicit mana costs, cooldowns, and targeting ranges from `src/config.ts`.

## Special Ground

- Charged and cursed ground are deterministic decorations on walkable open hexes. They do not change collision, sight, or WFC edge compatibility.
- Charged ground glows cyan and grants `1.75x` spell cooldown recovery and `1.75x` Power regeneration while Zeus stands on it.
- Each charged hex contains about `3` seconds of cumulative energy. Leaving pauses its consumption, returning resumes it, and an exhausted tile stays depleted until the run restarts.
- Cursed ground appears less often than charged ground and glows violet.
- Standing on cursed ground for about `2.25` uninterrupted seconds cleanses it. Leaving the hex resets cleanse progress.
- Cleansing grants `1` Cursed Energy, changes the hex to scarred ground, and cannot reward the player again during that run.
- Cursed Energy is run-local and resets on restart. Every newly earned point opens a three-card upgrade offering and pauses gameplay.
- Each offering contains three distinct upgrades. Their costs are always `1`, `2`, and `3` Cursed Energy, randomly assigned with no fixed relationship between an upgrade and its price.
- Unaffordable cards remain visible. The player can select an affordable card, explicitly save their energy, or allow the ten-second timer to expire; saving and timeout spend nothing.
- The offer timer uses wall-clock time while movement, enemies, spawning, regeneration, cooldowns, effects, and shield recharge remain frozen.
- Percentage upgrades stack multiplicatively. Flat regeneration and Chain Lightning bounces stack additively. The maximum-vitals upgrade preserves current HP and Power percentages.
- Available upgrades add HP regeneration, Power regeneration, maximum HP and Power, cooldown recovery, spell efficiency, movement speed, a recharging one-hit shield, global spell damage, Chain Lightning bounces, or Lightning Bolt damage.
- Aegis of Storms blocks one complete damage event, starts ready, and replenishes after `30` seconds of active gameplay. It is removed from future offerings after acquisition.
- Acquired upgrades and shield readiness appear beneath Cursed Energy in the Currencies HUD.
- Special-ground runes stay static and subdued at a distance and do not emit ambient particles. The occupied charged or cursed hex becomes animated and receives a focused particle effect with points eight times the original size. Charged ground keeps its subdued tile color but brightens its active green rune and ring; cursed ground keeps its existing violet charging color.
- Zeus's normal and charged outline ring is golden-orange so it stays distinct from charged ground's green feedback. The outline changes to violet while cleansing cursed ground.
- The dedicated Currencies HUD window starts locked and transparent at the bottom-left. The pause menu's Unlock UI setting exposes its lock control and allows it to be moved like the Vitals and Abilities windows.

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
- The world has no gameplay boundary; rolling patch terrain is generated as needed around Zeus.
- Terrain cells are supplied by the default WFC terrain provider. It generates rolling patch-by-patch terrain around the player over explicit patch tile variants. A micro hex is a gameplay terrain cell; a patch tile is a non-overlapping radius-2 group of micro hexes selected as one generation unit.
- Terrain cells have a structural type and a derived surface. The active authored catalog emits `open`, `wall`, `bank`, `lake`, and `river`. Surfaces include `grass`, `dirt`, `sand`, `mud`, `stone`, `scarred`, `charged`, and `cursed`.
- `open` and `bank` are walkable. `wall`, `lake`, and `river` block movement. Water is not a visibility occluder in the first hex pass; only `wall` blocks sight.
- Rivers use authored sources, varied lines, sways, bends, forks, and river/lake transitions instead of routing every waterway through the patch center. Lakes use authored coves, shores, basins, cores, and transitions. Authored bank cells appear around some water features and remain absent around others; they are currently walkable without a speed penalty.
- Patch edge signatures are ordered lists of `open`, `closed`, `river`, and `lake` sockets. Patch WFC matches each edge against the reversed opposite edge of its neighbor. Authored patches are selected first; a deterministic procedural interior solver supplies a zero-weight closure patch only when no safe authored variant fits the accumulated boundary.
- The active terrain radius is measured in patch coordinates around the player's current patch. Missing patches are committed as needed and existing patches are never overwritten.
- Gameplay visibility is tracked separately from Three.js render lighting. Zeus has a circular world light radius with wall-aware hex field of view, per-cell light falloff, permanent discovered navigation memory, and void treatment for unlit cells. The rendered fog overlay follows Zeus continuously with a smooth world-distance edge, while gameplay visibility remains hex-cell authoritative.
- Discovered terrain outside all current light goes dark again. Discovered terrain only remains dimly readable when it is inside the current light radius but hidden by blocker line of sight; active details and actors require direct current visibility.
- Wall blocker objects are hidden when their cells are undiscovered or outside the current light reach, so raised geometry does not remain readable in complete darkness.
