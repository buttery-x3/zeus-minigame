# Terrain Workbench

The Terrain Workbench is a local development application for inspecting, classifying, and authoring the exact terrain grammar used by the game. It is not part of the production build or a world/map editor. Drafts and decisions are browser-local until deliberately exported; the app never writes terrain source files directly.

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

Open cells use one ordinary grass surface. The retired dirt, meadow, and clearing definitions are not part of the grammar; visual ground decoration should not masquerade as WFC topology vocabulary.

The collapsed **Compare procedural fallback for these edges** section sends the authored orientation's complete six-edge boundary through the real procedural solver. It is a boundary-only comparison: neighboring patches, rolling-world topology, hydrology acceptance, and normal candidate selection are deliberately not simulated. It is useful for comparing interiors, not predicting World Explorer output.

## Patch Author

Patch Author edits one complete radius-two, 19-cell authored definition. Brush painting supports click-and-drag, while Bucket fills a contiguous matching region, Eyedropper selects an existing cell's paint, and Reset returns cells to open ground. The paint palette contains only runtime structures: open ground, wall/cliff, river, and lake. Transition remains a patch-level category for deliberately mixed structures rather than a cell paint.

Undo and redo retain the latest 100 document states. Rotate and Mirror transform the cells, locked boundary, and river-flow metadata together. Boundary locking protects the outer socket cells supplied by a Connection Lab scenario, while **Unlock boundary** deliberately makes them editable. Cell coordinates, zoom, generated rotations, live structural validation, river-flow roles, WFC selection weights, topology metadata, and exact installed-shape duplicate warnings are visible in the workspace.

Drafts autosave in browser storage and can be named, cloned, deleted, imported, and exported. **New patch** in the catalog starts empty, **Clone in Patch Author** creates a new definition and catalog ID, **Edit in Patch Author** preserves an installed definition's ID for an explicit override, **Author resolution** starts from a Connection Lab boundary, and **Promote to draft** starts from any candidate realization. These paths all create the same versioned editable document; none silently changes the game catalog. Imports automatically migrate retired meadow cells to open grass and legacy rock-category drafts to cliff.

To install reviewed exported definitions into the game, run:

```bash
npm run terrain:patches:install -- path/to/exported-patches.json
```

The installer validates every document, compiles it to the existing authored definition format, refuses duplicate built-in or custom IDs by default, and writes the dedicated `src/world/authored-patches/custom-patches.json` pack. Use `--replace` only when intentionally installing an edited definition as a catalog override. Custom definitions replace matching built-in IDs without creating duplicate WFC candidates, and otherwise join the normal catalog with the same generated rotations, validation, weighting, and selection path as hand-written definitions.

## Connection Lab

The Connection Lab places zero to six exact authored or generated variants around an empty center patch. An empty slot is unconstrained for authored matching; it is not an authored open patch. The current procedural fallback continues to apply its real missing-boundary behavior, which the result copy calls out explicitly.

Resolve reports exact ring seams, every physically compatible authored orientation, policy-safe and policy-rejected candidates, the current procedural fallback, and an exhaustive enumeration of bounded procedural interiors grouped by cell-derived internal topology. Topology groups use feature components, ordered boundary ports, internal contacts, and disconnected boundary structures rather than family metadata.

Scenarios can be saved as local drafts. A generated World Explorer patch can send its currently committed neighbor ring into the lab, including procedural variants that do not exist in the authored catalog.

### Topology recipe experiments

After resolving a ring that exposes wall, river, or lake ports, the recipe panel can describe a small internal-topology contract without editing JSON. A recipe can connect two ports, keep them separate, require an exact terminal, require or forbid a cross-feature contact, allow otherwise disconnected boundary structures, or require an open center.

Running an experiment filters the already-enumerated procedural layouts against that contract and compares the surviving topology with the current procedural fallback. Rejection reason counts explain why candidates failed. Recipes are browser-local, can be reused on another scenario, and can be run across every saved scenario as a regression batch. They do not modify the production solver or authored catalog.

## Decisions and Coverage

A resolved scenario can be classified as `accepted`, `rejected`, `needs-recipe`, or `intentionally-impossible`, with a separate authored/procedural resolution policy. Saving a decision also saves its scenario draft.

The coverage matrix enumerates a deterministic sample of mutually compatible authored neighbor rings. It collapses equivalent center boundaries across all six rotations and their mirrored forms, retains one witness ring per canonical class, and reports authored coverage, procedural fallback coverage, internal-topology multiplicity, and any matching saved decision. Rows reopen their witness directly in the Connection Lab.

Decision export produces stable, versioned JSON containing the scenario, exact and canonical boundary keys, decision, allowed authored IDs, procedural topology keys, and saved topology recipes with canonical rotation/mirror keys. Import validates the schema before adding scenarios, decisions, and recipes to local storage. Export and import are explicit file operations; neither operation edits `src/world`.

## Network Analysis

Generate a bounded region in World Explorer, then use **Scan current region** to construct read-only river, lake, and cliff component graphs from the exact committed patch interiors. Seam continuations and cell-derived contacts form graph edges; incomplete ports on the requested region's frontier are counted separately so a bounded sample is not mistaken for a complete world.

The rollup reports connected river and lake networks, sources, sinks, terminals, junctions, river mouths, and frontier exposure. The issue queue detects flow-role mismatches and unknown flow, missing source/sink obligations, cycles, unsupported junctions, unusual lake-mouth counts, disconnected boundary structures, and nearby cliff components that could plausibly have connected. Severity and issue-type filters keep the default queue focused on actionable review items.

Each issue lists its involved patch coordinates. **Focus in World Explorer** centers that patch and retains issue overlays; **Open local scenario** sends its committed neighbor ring to Connection Lab for candidate and recipe investigation. Analysis and overlays never change generated terrain.

## World Explorer

The explorer creates a fresh `WfcTerrainProvider` for the selected seed and bounded patch radius. `Advance one patch` exposes commit order; `Generate all` schedules small batches until the requested region is complete.

The Canvas view fits the complete generated region to the visible workspace by default. Use the zoom buttons, mouse wheel, `+`/`-` keys, or `F`/`0` to change or restore the view; drag to pan while zoomed. It can show exact patch ownership boundaries, patch-coordinate IDs, and procedural provenance. Clicking a patch opens the complete committed variant, including dynamically synthesized procedural interiors. Authored variants can be opened in the catalog at their exact orientation.

An actual procedural patch in World Explorer is a committed runtime fallback used because no safe authored candidate resolved that location. This differs from the catalog's boundary-only comparison.

The workbench does not alter committed generated terrain or authored catalog definitions.
