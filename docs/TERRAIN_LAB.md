# Terrain Workbench

The Terrain Workbench is a read-only local development application for inspecting the exact terrain grammar used by the game. It is not part of the production build, a level editor, or a source-file authoring tool.

## Run

```bash
npm run terrain:lab
```

Open `http://127.0.0.1:5175/`.

The separate local build can be checked with:

```bash
npm run terrain:lab:build
npm run verify:terrain-lab
```

## Patch Catalog

The catalog groups generated rotations and reversible river-flow orientations under their authored definition. Search accepts IDs, families, topology names, selection groups, and compact edge signatures.

Selecting an orientation shows its exact 19 cells, ordered six-edge sockets, river flow, metadata, derived connected components, boundary ports, internal contacts, and structural warnings. Component and contact facts are derived from cells rather than copied from declared topology metadata.

The authored/procedural comparison sends the authored orientation's complete six-edge boundary through the real procedural solver. It is a boundary-only comparison: rolling-world topology and hydrology acceptance callbacks are deliberately not simulated.

## World Explorer

The explorer creates a fresh `WfcTerrainProvider` for the selected seed and bounded patch radius. `Advance one patch` exposes commit order; `Generate all` schedules small batches until the requested region is complete.

The Canvas view can show exact patch ownership boundaries, patch-coordinate IDs, and procedural provenance. Clicking a patch opens the complete committed variant, including dynamically synthesized procedural interiors. Authored variants can be opened in the catalog at their exact orientation.

No decisions are persisted, exported, or written back to terrain source in Phase 1.
