# S-PLUS Footprint Planner 0.1.0 implementation evidence

Derived repository: `splus-footprint-planner`, independent main branch and Git history.
Source: `elacerda/jasytata`, main at `dead6f54f7340f08f7fe3e7eb3c38ff2e5facd65`
(frontend 0.5.0). The specialization commit has this baseline as its parent.
No source repository branch, tag or remote was modified. No push/publication occurred.
`origin` is configured as `git@github.com:elacerda/splus-footprint-planner.git`;
`upstream` is `git@github.com:elacerda/jasytata.git`. Configuring origin does not
create the remote GitHub repository. Existing tags remain historical Jasytata tags.

## Scientific and product changes

The protected Schema v2 JSON and scientific implementation files are unchanged.
The runtime registry installs only `t80-south` and `splus-t80-south`. Generic
profile data moved into historical science fixtures, outside the application
composition. The production smoke gate rejects generic instrument/strategy IDs
in every emitted JavaScript chunk, including the planning worker.

Removed product features: instrument/survey selection; Schema v3 library;
profile creation/import/JSON export; standalone instrument output; generic
footprint, PA and observing sequence configuration; catalogue instrument and
inference selectors; project placement/mosaic authoring; project manifest
import/export; and automatic inherited GitHub Pages deployment. Unreachable
editors, manifest helpers and tests for removed generic product controls were
deleted. Generic scientific regression tests retain their original library through
a fixture registry; no scientific expected values were changed.

Retained workflows: automatic catalogue; manual CSV with coordinate mapping;
official catalogue reload; region draw/finalize/cancel/redraw/clear; Complete and
Efficient planning; ordinary S-PLUS grid inference and protected-grid fallback;
proposal preview/accept/cancel; individual enable/disable and bulk restore/disable/
clear; Single tile; Import centers; coverage and inference diagnostics; all five
map layers; navigation/fullscreen; fixed RA,DEC,EPOCH=2000 new_tiles.csv export;
fresh state; themes; responsive and independently scrollable panels. Existing
Aladin code and fullscreen/scroll containment regression coverage remain intact.

## Catalogue

Canonical repository: `splus-collab/splus-utilities`.
Canonical path: `plot-footprint/tiles_nc.csv`, branch `main`.
Runtime URL: https://raw.githubusercontent.com/splus-collab/splus-utilities/main/plot-footprint/tiles_nc.csv
Bundled blob SHA: `93cee0484834718088934c1217cb90b2102385f0`.
Synchronized on 2026-10-05; exact UTC timestamp is in provenance.json.
Snapshot: 4,774 parsed rows, without a new STATUS filter.

Startup first fetches upstream, including an eight-second body deadline. HTTP,
network, timeout, malformed CSV, missing official columns or invalid coordinates
activate the inline bundled snapshot. A small role=status warning remains
nonblocking. All source data automatically use T80-South and ordinary auto
inference participation. Manual uploads replace the working catalogue, preventing
duplication; official reload replaces manual data. Revision/abort guards prevent
late startup responses from replacing manual files or fresh state. Selected-region
viewport priority is preserved when automatic data arrive late. Failed manual
uploads cannot lock official reload in a cancelled loading state.

`npm run catalogue:refresh` was executed successfully against upstream. It fetches
an immutable blob, verifies Git SHA-1, validates through the inherited parser and
writes the snapshot/provenance pair. Automated tests do not use live GitHub.

## Validation

- Full Vitest suite: **803 passed, 53 files passed**, zero failures.
- Focused product/catalogue/provenance tests: **26 passed**, including automatic
  existing-grid inference against the frozen historical holdout.
- Existing S-PLUS holdout, coverage, exact response fingerprints and export order
  regressions passed; scientific constants and expectations remain unchanged.
- ESLint: passed with zero errors and zero warnings.
- TypeScript: passed (`tsc -b --pretty`).
- Production build: passed (`tsc -b`, Vite and production preview smoke).
- Portable mount smoke: passed at `/splus-cloud/tools/footprint-planner/`, checking
  exact emitted bytes and MIME types for two JavaScript chunks and one CSS file.
- Generic profile IDs: absent from the emitted production chunks.
- Snapshot SHA verification: passed.
- `git diff --check`: passed.

Vite emits its existing large-chunk advisory for the main bundle. No limit was
raised or advisory suppressed. A live visual review could not run: the computer
use tool reported no available browser. Fullscreen/navigation/panel accessibility
remain covered by the automated suite; no visual inspection is claimed.
The Impeccable detector reported only the inherited Inter font choice; the
existing visual identity was retained while simplifying the product controls.

## Production artifact sizes

Decimal kB; gzip measured locally with Node zlib:

| Artifact | Bytes | Gzip bytes |
| --- | ---: | ---: |
| index.html | 553 | 331 |
| Main JavaScript | 2,943,300 | 974,734 |
| Planning worker | 112,587 | 33,191 |
| CSS | 42,222 | 9,160 |

The bundled snapshot is embedded in the application JavaScript. There is no
extra fallback network dependency. Vite base is relative (`./`) for build and
preview; development uses `/`. Serve the artifact at a trailing-slash mount.

## splus.cloud integration decisions

Remaining host decisions: the final public mount path; standalone route versus
iframe; full-height embedding layout; and host CSP allowance for the canonical
raw catalogue plus Aladin's existing imagery services. No database, backend API
or authentication integration is needed. No deployment was performed.

## Files

Status: A added, M modified, D deleted, R renamed. The CSV retains canonical
CRLF bytes via .gitattributes, preserving the recorded upstream blob SHA.

```text
M	.gitattributes
M	.github/workflows/ci.yml
D	.github/workflows/pages.yml
M	.gitignore
M	AGENTS.md
M	PRODUCT.md
M	README.md
A	docs/SPLUS_SPECIALIZATION_REPORT.md
M	frontend/index.html
M	frontend/package-lock.json
M	frontend/package.json
M	frontend/scripts/production-preview-smoke.mjs
A	frontend/scripts/refresh-official-catalogue.mjs
M	frontend/src/AladinMap.gate8.test.tsx
M	frontend/src/AladinMap.test.tsx
M	frontend/src/App.gate8.test.tsx
D	frontend/src/App.profile-files.test.tsx
D	frontend/src/App.project-manifest.test.tsx
D	frontend/src/App.project-region.test.tsx
D	frontend/src/App.scientific-controls.test.tsx
A	frontend/src/App.splus-product.test.tsx
M	frontend/src/App.test.tsx
M	frontend/src/App.tsx
R050	frontend/src/ScientificReadouts.tsx	frontend/src/CoverageReadout.tsx
D	frontend/src/ProjectLatticeAuthoring.tsx
M	frontend/src/api.test.ts
D	frontend/src/assets/jasytata_logo.png
M	frontend/src/backendless.test.tsx
A	frontend/src/data/official/provenance.json
A	frontend/src/data/official/tiles_nc.csv
A	frontend/src/official-catalogue.test.ts
A	frontend/src/official-catalogue.ts
M	frontend/src/planning-execution.test.ts
D	frontend/src/profiles/InstrumentProfileEditor.test.tsx
D	frontend/src/profiles/InstrumentProfileEditor.tsx
D	frontend/src/profiles/ProfileAuthoring.test.tsx
D	frontend/src/profiles/SurveyProfileEditor.tsx
M	frontend/src/profiles/document.test.ts
D	frontend/src/profiles/numeric-draft.ts
D	frontend/src/profiles/numeric-input.tsx
M	frontend/src/profiles/planning-capabilities.test.ts
M	frontend/src/profiles/registry.test.ts
M	frontend/src/profiles/registry.ts
D	frontend/src/project-manifest.test.ts
D	frontend/src/project-manifest.ts
M	frontend/src/science/coverage-accuracy.test.ts
M	frontend/src/science/coverage-sampling.test.ts
M	frontend/src/science/efficient-policy.test.ts
M	frontend/src/science/export.test.ts
R100	frontend/src/profiles/kcwi-slicers.json	frontend/src/science/fixtures/kcwi-slicers.json
A	frontend/src/science/fixtures/legacy-registry.ts
R100	frontend/src/profiles/production-v3.json	frontend/src/science/fixtures/production-v3.json
M	frontend/src/science/gate4-lattice-validation.test.ts
M	frontend/src/science/gate5-planner-context.test.ts
M	frontend/src/science/gate5-planner-independence.test.ts
M	frontend/src/science/gate6-performance-parity.test.mjs
M	frontend/src/science/gate6b-coverage.test.ts
M	frontend/src/science/gate6c-profile-library.test.ts
M	frontend/src/science/gate8-release-validation.test.ts
M	frontend/src/science/lattice-planner.test.ts
M	frontend/src/science/mixed-profiles.test.ts
M	frontend/src/science/pointing-geometry.test.ts
M	frontend/src/science/polygon-intersection.test.ts
M	frontend/src/science/project-region-planning.test.ts
A	frontend/src/snapshot-provenance.test.mjs
M	frontend/src/styles.css
M	frontend/src/testSetup.ts
M	frontend/src/vite-config.test.ts
M	frontend/vite.config.ts
```
