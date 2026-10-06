# S-PLUS Footprint Planner

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

S-PLUS observers planning extensions of existing survey coverage, reviewing
proposed tiles and exporting their centers. This audience and purpose were
confirmed during Impeccable initialization.

## Product Purpose

An independent, browser-only S-PLUS/T80-South pointing and coverage planner,
derived from Jasytata at `dead6f54f7340f08f7fe3e7eb3c38ff2e5facd65`.
The independent product starts at version 0.1.0.

Success means selecting a sky region, reviewing a coverage proposal and
downloading the enabled, accepted new tile centers. This is a coverage planner;
observing scheduling and telescope control are outside its scope.

## Positioning

The planner specializes the corrected Jasytata science engine for the protected
S-PLUS/T80-South pair. Official survey tiles load automatically; existing-grid
inference extends local S-PLUS coverage, with the protected S-PLUS grid as fallback.
Observers need no instrument or survey setup.

## Operating Context

The operating flow begins with automatically loaded official S-PLUS tiles, then
region selection, Complete/Efficient planning, proposal review and
`new_tiles.csv` export. Region drawing, rectangle selection and coordinate
navigation support choosing the target field. Single tile placement and pasted
RA/DEC centers also pass through proposal review and acceptance.

Local CSV catalogues replace the working catalogue; reloading restores the
canonical official data. Network failure uses the bundled official snapshot with
a nonblocking warning. Aladin Lite supplies sky navigation and imagery; a fully
offline sky image renderer is not supplied.

The principal usage context is preparation and analysis on desktop before
observations, as confirmed during Impeccable initialization.

## Capabilities and Constraints

- Production registers only the protected Schema v2 `t80-south` instrument and
  `splus-t80-south` survey. Their definitions and the corrected planning,
  inference, geometry, coverage and export algorithms must remain unchanged.
- The fixed footprint is 1.4° × 1.4°, with 120 arcsec effective overlap, the
  legacy S-PLUS grid, existing inference tolerances and ICRS coordinates.
- Complete attempts coverage of every sampled point. Efficient uses the existing
  coverage floor and marginal efficiency policy and can leave residual gaps;
  it does not evaluate their scientific importance. Coverage is sampled rather
  than an exact analytic area, retaining the engine's small-structure,
  large-field and extreme-polar limitations.
- All catalogues have fixed T80-South association and ordinary S-PLUS inference
  participation. Source rows and STATUS values are preserved, without added
  STATUS filtering. Map-layer visibility changes display only.
- Proposal cancellation, acceptance and enabled state remain reversible.
  `new_tiles.csv` exports only enabled, accepted new centers as `RA,DEC,EPOCH`,
  using ICRS decimal degrees and epoch 2000.
- The interface has no profile, instrument, PA, sequence or generic placement
  configuration. Generic fixtures exist solely for historical regression tests.
- React, TypeScript, Vite and Aladin Lite run as a static, backendless application
  with no database or authentication. Theme support, fullscreen navigation and
  independently scrollable panels on short screens are retained.
- The independent repository must not modify the source Jasytata repository or
  its branches or tags.

## Brand Commitments

The product name is S-PLUS Footprint Planner. Its existing description is
“T80-South pointing & coverage planning, powered by Jasytata.” Preserve the
upstream attribution and MIT licensing.

## Evidence on Hand

- `README.md`: current product workflows, scientific scope, limitations,
  development and deployment instructions.
- Canonical catalogue: `splus-collab/splus-utilities`, branch `main`,
  `plot-footprint/tiles_nc.csv`. The GitHub source is authoritative; bundled
  data are resilience only.
- `frontend/src/data/official/tiles_nc.csv` and accompanying `provenance.json`:
  bundled official snapshot and recorded provenance. Snapshot metadata is
  maintained together with the CSV by the catalogue refresh workflow.
- `docs/SPLUS_SPECIALIZATION_REPORT.md`: specialization evidence and recorded
  validation at that implementation stage; it is a historical report, not a
  guarantee of the current worktree's validation status.
- Historical documentation under `docs/` and scientific regression fixtures
  record upstream development; they do not expand this product's runtime scope.

## Product Principles

1. Preserve scientific compatibility: interface changes must respect the
   protected S-PLUS/T80-South definitions and scientific regressions.
2. Begin with canonical survey data and retain clear provenance when a resilience
   snapshot is used.
3. Keep planning reviewable and reversible, with explicit acceptance and
   enabled-state control before export.
4. Communicate sampled coverage and residual gaps without implying scientific
   completeness or scheduling capability.
5. Keep the workflow focused on S-PLUS coverage planning in the browser, without
   introducing generic instrument setup.
