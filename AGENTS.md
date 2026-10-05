# Jasytata agent instructions

## Code navigation

Use `code-review-graph` as the default code-navigation layer.

For implementation, debugging, refactoring, or review:

1. Start with `get_minimal_context_tool`.
2. Use `semantic_search_nodes_tool` or `query_graph_tool` to locate the relevant symbols and relationships.
3. Use `get_impact_radius_tool` when changing existing code.
4. Read source files directly only after the graph has identified the relevant files, symbols, tests, or callers.
5. Do not preload broad fixed lists of source files.
6. After implementation, use `detect_changes_tool` or `get_review_context_tool` to inspect the affected surface before final validation.
7. Update the graph with `build_or_update_graph_tool` when it may be stale.

The graph is a navigation and context-reduction aid, not a source of scientific truth. Exact source code, tests, contracts, and explicitly authoritative project documentation take precedence over graph summaries.

## Product and scientific compatibility

This independent repository is S-PLUS Footprint Planner, derived from Jasytata
main dead6f54f7340f08f7fe3e7eb3c38ff2e5facd65. The product starts at 0.1.0.
Keep the protected Schema v2 T80-South/S-PLUS pair and scientific regressions
unchanged. Production registers only this pair; generic fixtures exist solely for
historical regression tests. GitHub splus-collab/splus-utilities main,
plot-footprint/tiles_nc.csv, is canonical; bundled data are resilience only.
Never modify the source Jasytata repository or its branches/tags through this repo.

## Validation

Use the smallest relevant tests while developing, then run the repository validation required by the current gate.

Do not modify, move, recreate, stage, or delete the local untracked `.codex/`
directory or `poly.txt` file.
