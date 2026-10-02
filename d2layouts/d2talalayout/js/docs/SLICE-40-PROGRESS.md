# Slice 40 Progress: Placement Foundations Bundle

## Summary
- **Slice**: 40 — Placement Foundations Bundle
- **Status**: Implemented — awaiting Slice 40 review
- **Base Commit**: `fb10ad9b065e83df888e941f13ce2b6630fae065` (Slice 39 approved HEAD)
- **Target Branch**: `tala-js/slice-40-placement-foundations`
- **Pinned Upstream Reference**: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Scope of Implementation
1. **`src/placement/axis.js`**:
   - `LayoutAxis` (Invalid: 0, Horizontal: 1, Vertical: 2) & `TraversalDirection` (Invalid: 0, Forward: 1, Backward: 2).
   - Functions: `axisValid`, `axisIsHorizontal`, `oppositeAxis`, `axisForArrangement`, `directionValid`, `directionIsForward`, `oppositeDirection`.
   - `axisForArrangement` returns Horizontal strictly for `Column`; Vertical for all other inputs.
2. **`src/graph/graph.js`**:
   - Added `fixedNodes()`, `FixedNodes()`, `hasFixedNode()`, `HasFixedNode()`.
   - Preserves source-order and node object identity without cloning or sorting.
3. **`src/placement/validation.js`**:
   - `validateCellSize`: rejects < 1, non-integers, NaN, +/-Inf with exact Go error formatting.
   - `validatePlacedNodes`: verifies all nodes have `TopLeft != null`; first unplaced node reports violation with container ID (or container 0 for nil root).
   - `validateGridAlignment`: checks cell size, skips fixed nodes, checks non-fixed TopLeft non-null, verifies modulo alignment.
4. **`src/placement/stress-initialize.js`**:
   - `initializeByGraphDistance`: validates topology, checks eligibility gates (4..64 nodes, <=256 edges, no fixed nodes), computes Floyd-Warshall distance, performs circular embedding, executes 48 relaxation sweeps with cancellation checks, and assigns integer grid cells via ring search.
   - Preserves atomicity: no geometry is mutated until final cancellation check passes.
5. **`src/placement/stage-geometry.js`**:
   - `normalize` / `Normalize`: finds geometric minimum (or hardcodes (1000, 1000) if any fixed node exists) and translates nodes and edge points.
   - `pad` / `Pad`: translates node TopLeft by (+1000, +1000); leaves edge points, labels, and FixedTopLeft untouched.
   - `placementPadding`: exported constant (1000.0).
6. **`src/placement/cluster-connections.js`**:
   - `clusterExternalConnectedNodes` / `ClusterExternalConnectedNodes`: discovers external nodes connected to cluster via edge abductions, deduplicating candidates in first-seen order.
7. **Barrels preserved**:
   - Neither `src/placement/index.js` nor `src/index.js` were modified. All Slice 40 helpers are internal / direct-module only.

## Test & Verification Results
- **Go Reference Fixtures & Oracle**:
  - `test/reference/go_placement_foundations_oracle.go`
  - `test/fixtures/go-placement-foundations-reference.json`
  - `test/unit/placement-foundations-oracle.test.js`: 69/69 PASS across 10 fixture groups.
- **Direct Unit Tests**:
  - `test/unit/placement-axis.test.js`: 10/10 PASS
  - `test/unit/placement-validation.test.js`: 17/17 PASS
  - `test/unit/graph-distance-initialize.test.js`: 9/9 PASS
  - `test/unit/placement-stage-geometry.test.js`: 10/10 PASS
  - `test/unit/cluster-connections.test.js`: 9/9 PASS
  - Total Slice 40 unit + oracle tests: 124/124 PASS (285 expect() assertions).
- **Targeted JS Regressions**:
  - 871/871 PASS across 28 files (1917 expect() calls).
- **Full JS Suite (`npm run test`)**:
  - 2211 pass, 0 fail, 49942 expect() calls across 85 files.
- **Go Regression Packages**:
  - `d2layouts/d2talalayout/internal/placement`: PASS (including all 5 named tests)
  - `d2layouts/d2talalayout/internal/layoutgraph`: PASS
  - `d2layouts/d2talalayout/internal/proximity`: PASS
  - `d2layouts/d2talalayout/internal/grouping`: PASS
