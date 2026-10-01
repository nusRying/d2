# Slice 25 Progress: RDFS Traversal Parity & Graph SyncClusters

## Scope & Objective
Implement Go parity for `Node.rdfsWalk`, `Node.WalkRDFS`, `Graph.syncClusters`, and `Graph.SyncClusters` in accordance with pinned upstream Go commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Deliverables
1. **Production Code**:
   - `src/graph/node.js`: Corrected `rdfsWalk` to follow pinned Go natural failure parity (dereferencing `Graph`, eliminating artificial null guards, supporting missing container key, throwing on missing cluster entry for marked vessels, distinguishing missing vs null sequence entry, and calling callback after descendants).
   - `src/graph/graph.js`: Implemented `syncClusters()` and `SyncClusters()`.
2. **Oracle & Fixtures**:
   - `test/reference/go_sync_clusters_oracle.go`: Real Go oracle compiling and running against `d2lang/d2@01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`. Generates 17 RDFS scenarios and 12 SyncClusters scenarios.
   - `test/fixtures/go-sync-clusters-reference.json`: Deterministic JSON fixture (14,826 bytes, identical SHA-256 across runs).
3. **Tests**:
   - `test/unit/sync-clusters-oracle.test.js`: Full oracle replay suite across all 29 scenarios.
   - `test/unit/sync-clusters.test.js`: Direct unit tests covering boundaries, natural failure semantics, source-order traversal, repeated roots, outer-graph lookup, and sequence nesting.
4. **Documentation**:
   - `docs/ADR-025-CLUSTER-GEOMETRY.md`: Status updated to `Accepted`.
   - `docs/ADR-026-RDFS-SYNC-CLUSTERS.md`: Documented design and invariants.
   - `docs/MIGRATION.md`: Updated roadmap ledger.

## Verification
- Fixture determinism: SHA-256 `D09A1118A9E1FC038037679DD6142E02A4258670FAEF3C119BC5282D67875AF1` verified across multiple generator executions.
- Unit & Oracle tests: 1266 tests passing across 51 files.
- Go tests: layoutgraph and grouping packages passing without errors.
- Static audit: 0 violations across 48 source files (0 `Math.random`, 0 Node imports, 0 forbidden identifiers).
