# Slice 14 Progress Report: Cluster Mutation and Edge Abduction Primitives

## 1. Branch and Baseline Verification
- **Repository:** `C:\Users\Umair\Videos\Freelance\Test Task\d2`
- **GitHub Remote:** `nusRying/d2`
- **Approved Starting Point (Slice 13):**
  - Branch: `tala-js/slice-13-cluster-discovery`
  - Approved Base SHA: `7a769066a581cac20b86838610aa25a30eb1faf7`
- **Working Branch:** `tala-js/slice-14-cluster-mutation-primitives`
- **Merge Base:** `7a769066a581cac20b86838610aa25a30eb1faf7`

## 2. Implemented Scope
Slice 14 ports the exact low-level cluster mutation and edge abduction primitives required by the future `AddClusters` stage:
- **`Cluster.resize` / `Cluster.Resize`** (`js/src/graph/cluster.js`):
  - Normalized member dimensions when `FixedSize == false`.
  - Left individual dimensions untouched when `FixedSize == true`.
  - Independent maxima scanning starting at `0.0` (effectively clamping negative member dimensions).
  - Exact vessel dimension calculations for `Row` and `Column` arrangements.
  - Raw empty-cluster arithmetic preserved (`padding * -1`).
  - Strict Go invariant errors on missing vessel (`"cluster is missing its vessel"`) and nil member (`"cluster contains a nil node"`).
- **`createVessel` / `CreateVessel`** (`js/src/grouping/clusters-mutation.js`):
  - Minimum X and Y computed independently across positioned members.
  - In-place member sorting for `Row` (ascending by `TopLeft.X`) and `Column` (ascending by `TopLeft.Y`).
  - Stable sort tie behavior matching Go insertion-sort pass in pdqsort.
  - Unpositioned clusters leave `vessel.TopLeft = null` and do not sort.
  - Does NOT assign `cluster.Vessel = vessel` and does not install vessel into graph.
- **`addCluster` / `AddCluster`** (`js/src/grouping/clusters-mutation.js`):
  - Adds vessel to container via `graph.addNewNodeToContainer`.
  - Sets each member's `.Cluster = cluster`.
  - Rebuilds container child list keeping only `child.Cluster !== cluster` (container-filtering quirk preserved).
  - Removes members from `graph.Nodes` via `graph.removeNode` (which removes all matching pointer occurrences) and sets `.Container = null`.
  - Installs cluster into `graph.Clusters[vessel] = cluster`.
  - Does NOT touch edges or edge lists.
- **`abductClusterEdges`** (`js/src/grouping/clusters-mutation.js`):
  - Mutating and nontransactional.
  - Charges 1 step per outer edge loop.
  - For matching `From`, charges `len(From.Edges) + len(Vessel.Edges)` individual steps, appends `EdgeAbduction`, and reconnects source.
  - For matching `To`, charges `len(To.Edges) + len(Vessel.Edges)` using dynamic vessel edge length, appends `EdgeAbduction`, and reconnects target.
  - Internal edges execute both branches, appending 2 abductions and ending as `Vessel -> Vessel`.
  - Delayed publication: `cluster.EdgeAbductions` is assigned only after complete loop success.
  - Partial failure preserves earlier reconnects in place without rollback; prior `EdgeAbductions` untouched.
  - Route geometry, points array identity, point objects, and styles preserved intact.

## 3. Real-Go Oracle and Verification Infrastructure
- **Go Bridge:** `internal/grouping/cluster_mutation_oracle_bridge.go` (`//go:build tala_cluster_mutation_oracle`) exposes private `abductClusterEdges`.
- **Oracle Generator:** `js/test/reference/go_cluster_mutation_oracle.go`
- **Oracle Fixture:** `js/test/fixtures/go-cluster-mutation-reference.json`
  - File Size: `13,359` bytes
  - Deterministic SHA256: `bdde088b573c6e417d8539f0ab9684796af1f95040b7c9d252c3dcf473337df2`
  - Re-generation verified byte-for-byte identical.
- **Oracle Replay Test:** `js/test/unit/cluster-mutation-oracle.test.js` (43 passing tests).
- **Direct JS Unit Test:** `js/test/unit/cluster-mutation.test.js` (18 passing tests).

## 4. Test Results
- **Oracle Replay Suite:** 43 passed, 0 failed.
- **Direct Unit Tests:** 18 passed, 0 failed.
- **Full Bun Test Suite:** 646 passed, 0 failed across 29 test files.
- **Go Grouping Tests:**
  - Standard: `go test ./d2layouts/d2talalayout/internal/grouping/...` -> PASS.
  - Tagged: `go test -tags tala_cluster_mutation_oracle ./d2layouts/d2talalayout/internal/grouping/...` -> PASS.

## 5. Scope Boundary and Safety Audits
- Zero implementation of Slice 15+ symbols: `AddClusters`, `AssignArrangement`, `PaddingBetween`, `averageClusterDimensions`, `Cleanup`, `ResetClusters`, `Join`, `AddHubs`, `ArrangeClusterNodes`, `SyncGeometry`.
- Zero `Math.random` usage in production JS.
- Zero Node-only browser-incompatible imports in production JS (`fs`, `path`, `crypto`, `process`, `Buffer`, `child_process`, `worker_threads`, `node:*`).
- `src/index.js` does NOT export grouping.
- `graph.removeNode` updated to filter all pointer matches matching Go `Graph.RemoveNode`.
- Documentation corrections applied to `docs/SLICE-13-PROGRESS.md` for `descendant_null_*` counts.
