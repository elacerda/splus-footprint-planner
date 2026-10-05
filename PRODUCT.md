# S-PLUS Footprint Planner

An independent browser-only S-PLUS/T80-South coverage planner derived from current
Jasytata main at dead6f54f7340f08f7fe3e7eb3c38ff2e5facd65. Version 0.1.0.

The operating flow begins with automatically loaded official S-PLUS tiles, then
region selection, Complete/Efficient planning, proposal review and new_tiles.csv
export. Local catalogues replace the working catalogue; reloading restores the
canonical official data. Network failure uses the bundled official snapshot with
a nonblocking warning. All catalogues have fixed T80-South association and ordinary
S-PLUS inference participation. Source rows and STATUS values are preserved.

The protected Schema v2 definitions and corrected science algorithms are unchanged.
Only S-PLUS/T80-South is registered at runtime. The interface has no profile,
instrument, PA, sequence or generic placement configuration. Proposal cancellation,
acceptance and enabled state remain reversible; only enabled accepted centers export.

React/TypeScript/Vite and Aladin Lite remain static and backendless. The workspace
retains theme support, fullscreen navigation and short-screen panel scrolling.
See README.md for workflows, limitations, catalogue provenance and development.
