# Terrain Workbench

The Terrain Workbench is a local development application for inspecting and classifying the exact terrain grammar used by the game. It is not part of the production build, a level editor, or a source-file authoring tool. Drafts and decisions are browser-local until deliberately exported; the app never writes terrain source files.

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

Open cells are colored by their actual surface. The green `meadow` and `clearing` definitions preserve the former open-vocabulary weights and rotations without retaining the retired dirt surface or `patch.open.dirt` ID.

The collapsed **Compare procedural fallback for these edges** section sends the authored orientation's complete six-edge boundary through the real procedural solver. It is a boundary-only comparison: neighboring patches, rolling-world topology, hydrology acceptance, and normal candidate selection are deliberately not simulated. It is useful for comparing interiors, not predicting World Explorer output.

## Connection Lab

The Connection Lab places zero to six exact authored or generated variants around an empty center patch. An empty slot is unconstrained for authored matching; it is not an authored open patch. The current procedural fallback continues to apply its real missing-boundary behavior, which the result copy calls out explicitly.

Resolve reports exact ring seams, every physically compatible authored orientation, policy-safe and policy-rejected candidates, the current procedural fallback, and an exhaustive enumeration of bounded procedural interiors grouped by cell-derived internal topology. Topology groups use feature components, ordered boundary ports, internal contacts, and disconnected boundary structures rather than family metadata.

Scenarios can be saved as local drafts. A generated World Explorer patch can send its currently committed neighbor ring into the lab, including procedural variants that do not exist in the authored catalog.

## Decisions and Coverage

A resolved scenario can be classified as `accepted`, `rejected`, `needs-recipe`, or `intentionally-impossible`, with a separate authored/procedural resolution policy. Saving a decision also saves its scenario draft.

The coverage matrix enumerates a deterministic sample of mutually compatible authored neighbor rings. It collapses equivalent center boundaries across all six rotations and their mirrored forms, retains one witness ring per canonical class, and reports authored coverage, procedural fallback coverage, internal-topology multiplicity, and any matching saved decision. Rows reopen their witness directly in the Connection Lab.

Decision export produces stable, versioned JSON containing the scenario, exact and canonical boundary keys, decision, allowed authored IDs, and procedural topology keys. Import validates the schema before adding scenarios and decisions to local storage. Export and import are explicit file operations; neither operation edits `src/world`.

## World Explorer

The explorer creates a fresh `WfcTerrainProvider` for the selected seed and bounded patch radius. `Advance one patch` exposes commit order; `Generate all` schedules small batches until the requested region is complete.

The Canvas view fits the complete generated region to the visible workspace by default. Use the zoom buttons, mouse wheel, `+`/`-` keys, or `F`/`0` to change or restore the view; drag to pan while zoomed. It can show exact patch ownership boundaries, patch-coordinate IDs, and procedural provenance. Clicking a patch opens the complete committed variant, including dynamically synthesized procedural interiors. Authored variants can be opened in the catalog at their exact orientation.

An actual procedural patch in World Explorer is a committed runtime fallback used because no safe authored candidate resolved that location. This differs from the catalog's boundary-only comparison.

The workbench does not alter committed generated terrain or authored catalog definitions.
