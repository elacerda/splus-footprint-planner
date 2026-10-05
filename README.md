# S-PLUS Footprint Planner

T80-South pointing & coverage planning, powered by Jasytata. This independent
browser application helps S-PLUS observers extend existing survey coverage,
review proposed tiles and download their centers. Version **0.1.0**.

## Fixed scientific scope

S-PLUS/T80-South is implicit: the protected Schema v2 `t80-south` instrument and
`splus-t80-south` survey supply a 1.4° × 1.4° rectangular footprint, 120 arcsec
effective overlap, the legacy S-PLUS grid, existing inference tolerances and
ICRS coordinates. Export is `RA,DEC,EPOCH`, with epoch 2000. These definitions
and the current corrected Jasytata planning, inference, geometry, coverage and
export algorithms are retained. No instrument or survey setup is needed.

## Official catalogue and resilience

On startup the application requests the current **Official S-PLUS tiles** from
[`splus-collab/splus-utilities`, `plot-footprint/tiles_nc.csv`](https://github.com/splus-collab/splus-utilities/blob/main/plot-footprint/tiles_nc.csv).
The runtime source is the [raw file on upstream main](https://raw.githubusercontent.com/splus-collab/splus-utilities/main/plot-footprint/tiles_nc.csv).
The inherited robust parser reads the catalogue and automatically assigns
T80-South and ordinary S-PLUS inference participation. All STATUS values are
preserved; this product adds no STATUS filtering. The tiles appear on Aladin
and contribute to planning even when their map layer is hidden.

A request failure, an eight-second deadline, or invalid CSV automatically uses
the bundled snapshot. A small message identifies fallback use without blocking
planning. The GitHub file is canonical; the snapshot is only resilience data.
Snapshot provenance, including synchronization time and upstream blob SHA, lives
in [provenance.json](frontend/src/data/official/provenance.json). It was synchronized
on 2026-10-05 from blob `93cee0484834718088934c1217cb90b2102385f0`.

**Load catalogue** accepts experimental or local S-PLUS CSV files. RA/DEC columns
are detected automatically; ambiguous headers expose the existing column mapping
and RA-unit fallback. Loading replaces the working catalogue, so manually loading
the official file does not duplicate it. Accepted proposals remain available;
pending plans and inference diagnostics are invalidated. **Reload official
catalogue** replaces local data with a fresh canonical request (or its fallback).

## Planning

1. Open the application; official tiles load automatically.
2. Navigate to your sky field and choose **Select area**. Click polygon vertices,
   finalize, cancel or redraw using the map controls. Rectangles and reference
   coordinate navigation are also supported.
3. Choose **Complete** to attempt every sampled point, or **Efficient** to use the
   existing S-PLUS coverage floor and marginal efficiency policy. Efficient can
   leave residual gaps; it does not judge their scientific importance.
4. **Generate plan**, inspect coverage metrics, diagnostics, inference anchors and
   candidate lattice, then **Accept proposal** or **Cancel preview**. Existing-grid
   inference extends local S-PLUS coverage; the protected S-PLUS grid supplies the
   existing fallback when inference is unavailable.
5. Inspect individual accepted tiles to enable or disable them. Restore all,
   disable all or clear the proposal. **Single tile** stages a clicked sky center;
   **Import centers** validates pasted RA/DEC pairs before review and acceptance.
6. **Download new_tiles.csv** exports only enabled accepted new tiles, in ICRS
   decimal degrees and epoch 2000. Source rows are never rewritten.

Map layers include the working catalogue, proposed tiles, selected region,
inference anchors and candidate lattice. Visibility affects display only.
**New plan** clears working catalogues, region, pointings and drafts after
confirmation; **Reload official catalogue** remains available. Themes, map
navigation, fullscreen and independently scrollable side panels are retained.

Coverage is sampled, rather than an exact analytic area. Small structures below
the sampling pitch, large fields and extreme polar regimes retain the limitations
of the upstream science engine. This is a coverage planner, not an observing
scheduler or telescope control application.

## Development and deployment

Use Node.js 22.12+ (CI uses Node 24):

```sh
cd frontend
npm ci
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
```

React, TypeScript, Vite and Aladin Lite run entirely in the browser. There is no
backend, database or authentication. Aladin retains its existing external imagery
services; the official catalogue fetch is the only new runtime data dependency.
Catalogue fallback and planning work without GitHub access. A fully offline sky
image renderer is not supplied by this application.

The build uses a **relative Vite base**. Serve the contents of `frontend/dist/`
under any static subpath, for example `/footprint-planner/`, with a trailing slash
(or a redirect to it). No `/jasytata/` path is embedded. The production preview
smoke gate checks emitted JavaScript and CSS bytes. Automated tests mock catalogue
requests and do not depend on GitHub. The snapshot is embedded in the application
bundle, so no additional fallback fetch is needed.

To refresh the fallback reproducibly:

```sh
cd frontend
npm run catalogue:refresh
```

The developer script reads upstream main metadata, fetches the immutable Git blob,
verifies its SHA, validates with the inherited parser and updates CSV/provenance
together. Review and commit both files. Do not manually curate a second catalogue.

For `splus.cloud`, integration still needs the final mount path and the choice of
a standalone route or iframe, plus any host CSP rules for Aladin's existing
imagery services and the raw GitHub catalogue URL. Use a full-height container
for the workspace. No server API or login integration is required.

## Relationship to Jasytata

Derived from [`elacerda/jasytata`](https://github.com/elacerda/jasytata), current
`main` at **`dead6f54f7340f08f7fe3e7eb3c38ff2e5facd65`** (frontend 0.5.0).
This is a pruning of that corrected application, not a reconstruction of an older
release. Useful Git history is retained. `upstream` identifies Jasytata;
`origin` identifies the independent `splus-footprint-planner` repository.
Inherited tags describe Jasytata releases; this product's version history starts
at 0.1.0. No remote repository is created or pushed by local derivation.

The generic survey/instrument selection, Schema v3 library in the runtime,
profile authoring/import/export, PA and sequence controls, generic mosaics,
project placement authoring and Jasytata project manifest UI have been removed.
Generic scientific machinery and historical fixtures remain for regression
coverage, but the production registry installs only the protected S-PLUS pair.
Historical documentation under `docs/` records upstream development and is not a
product authoring guide. MIT licensing and upstream authorship are preserved.
