# Slice 13 Progress Report: Cluster Discovery Index and Classification

## 1. Environment and Branch Verification
- **Repository Root:** `C:\Users\Umair\Videos\Freelance\Test Task\d2` (`nusRying/d2`)
- **Approved Slice 12 Base SHA:** `829ba5457caf68ce36d424b036ea4f7694efaf06`
- **Starting Reviewed Remote HEAD:** `4cfce9870ad427d05405754ec45aebe004fcba41`
- **Branch:** `tala-js/slice-13-cluster-discovery`
- **Pinned Upstream D2 Reference:** `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## 2. Pinned Upstream Go Files Studied
- `d2layouts/d2talalayout/internal/grouping/cluster.go`
- `d2layouts/d2talalayout/internal/grouping/cluster_discovery.go`
- `d2layouts/d2talalayout/internal/grouping/cluster_test.go`
- `d2layouts/d2talalayout/internal/grouping/resource_test.go`
- `d2layouts/d2talalayout/internal/grouping/lifecycle.go`
- `d2layouts/d2talalayout/internal/layoutgraph/node.go`
- `d2layouts/d2talalayout/internal/layoutgraph/edge.go`
- `d2layouts/d2talalayout/internal/layoutgraph/graph.go`
- `d2layouts/d2talalayout/internal/layoutgraph/hierarchy_access.go`
- `d2layouts/d2talalayout/internal/layoutgraph/sequence.go`
- `d2layouts/d2talalayout/internal/limits/work.go`

## 3. Files Modified and Created
- **Production Source Modified:**
  - `d2layouts/d2talalayout/js/src/graph/graph.js`: Removed scope-creep aliases `AddNewNodeToContainer` and `RemoveNode`.
  - `d2layouts/d2talalayout/js/src/graph/node.js`: Removed scope-creep aliases `isContainerNode` and `IsContainer`.
  - `d2layouts/d2talalayout/js/src/graph/edge.js`: Removed scope-creep alias `IsLoop`. Kept `edge.isLoop()` and direction helper methods (`HasSourceArrow`, `HasTargetArrow`, `IsDirected`, `IsBidirectional`, `IsUndirected`).
  - `d2layouts/d2talalayout/js/src/grouping/cluster-discovery.js`: Preserved approved production structure (`ClusterEdgeSignature`, `ClusterDiscoveryInfo`, `ClusterDiscoveryIndex`, `clusterIsDescendantOfGuarded`, `clusterHasLeakyEdgeGuarded`, `buildClusterDiscoveryIndex`, `clusterIncidentEdges`, `sequenceOriginal`, `refreshNeighbors`, `refreshAfterClusterAbduction`). Removed arrowhead string coercion in `ClusterEdgeSignature.add`.
  - `d2layouts/d2talalayout/js/src/random/go-math-rand.js`: Added `Int31()`, `Int31n(n)`, `Intn(n)` to match Go standard library `math/rand` (essential for 0..99 corpus parity).
- **Go Oracle Bridge Implemented:**
  - `d2layouts/d2talalayout/internal/grouping/cluster_oracle_bridge.go`: Real thin bridge holding `*clusterDiscoveryIndex` under build tag `tala_cluster_discovery_oracle`. Directly delegates to private Go methods without reconstructing DTOs.
- **Go Reference Oracle Created:**
  - `d2layouts/d2talalayout/js/test/reference/go_cluster_discovery_oracle.go`: Builds full test matrix under build tag `tala_cluster_discovery_oracle`.
- **Reference Fixture Generated:**
  - `d2layouts/d2talalayout/js/test/fixtures/go-cluster-discovery-reference.json` (1,471,971 bytes). Verified with repeatable SHA256 hash.
- **Unit and Oracle Replay Tests:**
  - `d2layouts/d2talalayout/js/test/unit/cluster-discovery.test.js`: 46 tests covering core cluster discovery functionality.
  - `d2layouts/d2talalayout/js/test/unit/cluster-discovery-oracle.test.js`: 15 comprehensive oracle replay tests with 30,167 `expect()` assertions.
- **Documentation Updated and Created:**
  - `d2layouts/d2talalayout/js/docs/ADR-013-SEQUENCE-MUTATION.md`: Updated status to `Accepted`.
  - `d2layouts/d2talalayout/js/docs/MIGRATION.md`: Updated roadmap (Slice 12 complete, Slice 13 implemented).
  - `d2layouts/d2talalayout/js/docs/ADR-014-CLUSTER-DISCOVERY.md`: Documented architecture, directed-count quirk, WorkGuard bounds, and non-goals.
  - `d2layouts/d2talalayout/js/docs/SLICE-13-PROGRESS.md`: This comprehensive report.

## 4. Thin Go Oracle Bridge Details
`internal/grouping/cluster_oracle_bridge.go` uses `//go:build tala_cluster_discovery_oracle`:
- `ClusterDiscoveryIndexBridge`: Holds the unexported `*clusterDiscoveryIndex`.
- `BuildClusterDiscoveryIndexBridge(g, nodes, guard)`: Invokes private Go `buildClusterDiscoveryIndex(g, nodes, guard)`.
- `GetInfoDTO(node)`: Extracts fields (`Neighbors`, `Signatures`, `ToTableColumn`, `NoClustering`) into clean JSON-serializable DTOs, preserving empty string `""` for nil neighbors.
- `SequenceOriginalBridge(sequence, edge, guard)`: Directly calls `index.sequenceOriginal(sequence, edge, guard)`.
- `RefreshNeighborsBridge(g, node, guard)`: Directly calls `index.refreshNeighbors(g, node, guard)`.
- `RefreshAfterClusterAbductionBridge(g, cluster, guard)`: Directly calls `index.refreshAfterClusterAbduction(g, cluster, guard)`.
- `ClusterIncidentEdgesBridge(nodes, guard)`: Directly calls `clusterIncidentEdges(index, nodes, guard)`.
- `ClusterIsDescendantOfGuardedBridge(g, descendant, ancestor, guard)`: Directly calls `clusterIsDescendantOfGuarded`.
- `ClusterHasLeakyEdgeGuardedBridge(g, node, guard)`: Directly calls `clusterHasLeakyEdgeGuarded`.

## 5. Fixture Repeatability Proof
The oracle fixture was generated multiple times and checked with SHA256:
- Output path: `js/test/fixtures/go-cluster-discovery-reference.json`
- File size: 1,471,971 bytes
- Deterministic repeat SHA256:
  `DB96227913AFB918C08A85E204A7BD0CFB42B43F01A8363B4E22295E2886FAC3`

## 6. Parity Verification Results

### Oracle Replay Scenarios (`cluster-discovery-oracle.test.js` - 15/15 Passed)
1. `fixture metadata matches pinned contract`
2. `arrowhead and edge classification matches Go oracle`
3. `Node.adjacent matches Go oracle including malformed fallback`
4. `ClusterEdgeSignature counts and matching match Go oracle`
5. `ClusterEdgeSignature directed-count quirk matches Go oracle` (matches `true` between `sigA` directed=2 and `sigC` directed=1)
6. `sequence neighbor recovery and WorkGuard deltas match Go oracle` (delta=0 on cached lookup)
7. `legacy/index parity corpus seeds 0..99 match Go oracle` (100 pseudo-random graph seeds comparing discovery infos, signatures, and match matrix)
8. `leaky container detection matches Go oracle`
9. `refreshAfterClusterAbduction matches Go oracle`
10. `clusterIncidentEdges matches Go oracle and preserves graph-edge order`
11. `exact WorkGuard Used counts match Go oracle` (11 exact operational test cases matching Go units)
12. `WorkGuard low-limit boundary tests: limit=exact succeeds, limit=exact-1 fails`
13. `genuine mid-operation cancellation throws WorkCanceledError and preserves graph topology`
14. `buildClusterDiscoveryIndex guarantees read-only graph topology across success and failure`
15. `Graph.allDescendantNodesWithWorkGuard matches Go oracle exactly`

### Unit Tests (`cluster-discovery.test.js` - 46/46 Passed)
- Edge direction and arrowhead properties
- Node adjacency fallback
- ClusterEdgeSignature counting and matching constraints
- Descent and ancestry cycle detection
- Leaky container boundary detection
- Unique neighbor ordering and deduplication
- Table column incident flagging
- Incident edge collection and sorting

### Full Suite Regression Status
- `bun test`: 585 pass, 0 fail (39,866 expect() calls across 27 files).
- `go test ./internal/grouping/...`: ok (cached, 0 errors).
- `go test -tags tala_cluster_discovery_oracle ./internal/grouping/...`: ok (cached, 0 errors).
- `git diff --check`: 0 whitespace or formatting issues.
- `Math.random` scan in `js/src`: 0 occurrences.
- Node built-in imports (`fs`, `path`, `crypto`, etc.) in `js/src`: 0 occurrences.
- Prohibited Slice 14 methods (`AddClusters`, `AssignArrangement`, `CreateVessel`, `AddCluster`, `abductClusterEdges`, `Cleanup`, `Join`) in `js/src`: 0 occurrences.
- Public exports in `js/src/index.js`: grouping is NOT exported.

## 7. Status and Next Steps
Slice 13 is complete, fully tested against the Go reference oracle, and ready for review.
Do NOT start Slice 14. Do NOT merge into main.
