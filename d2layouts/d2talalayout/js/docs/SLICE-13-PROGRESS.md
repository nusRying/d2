# Slice 13 Progress Report: Cluster Discovery Index and Classification

## 1. Environment and Branch Verification
- **Repository Root:** `C:\Users\Umair\Videos\Freelance\Test Task\d2` (`nusRying/d2`)
- **Approved Slice 12 Base SHA:** `829ba5457caf68ce36d424b036ea4f7694efaf06`
- **Reviewed Remote HEAD:** `010eb34040435fae75e417a9bf0739f04f07b801`
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
- **Production Source Cleaned & Preserved:**
  - `d2layouts/d2talalayout/js/src/graph/graph.js`: Removed scope-creep aliases `AddNewNodeToContainer` and `RemoveNode`.
  - `d2layouts/d2talalayout/js/src/graph/node.js`: Removed scope-creep aliases `isContainerNode` and `IsContainer`. Preserved `node.isContainer`.
  - `d2layouts/d2talalayout/js/src/graph/edge.js`: Removed scope-creep alias `IsLoop`. Preserved `edge.isLoop()` and direction helper methods (`HasSourceArrow`, `HasTargetArrow`, `IsDirected`, `IsBidirectional`, `IsUndirected`).
  - `d2layouts/d2talalayout/js/src/grouping/cluster-discovery.js`: Preserved approved production structure without redesign. Raw Arrowhead identifiers preserved without string coercion.
  - `d2layouts/d2talalayout/js/src/random/go-math-rand.js`: Reverted to approved Slice 12 state (removed temporary `Int31`, `Int31n`, `Intn` additions; diff against Slice 12 base is 0).
- **Go Oracle Bridge:**
  - `d2layouts/d2talalayout/internal/grouping/cluster_oracle_bridge.go`: Real thin bridge holding `*clusterDiscoveryIndex` under build tag `tala_cluster_discovery_oracle`. Directly delegates to unexported Go private methods without DTO duplication.
- **Go Reference Oracle Generator:**
  - `d2layouts/d2talalayout/js/test/reference/go_cluster_discovery_oracle.go`:
    - Extended `legacyCorpus` with explicit `edgeRecipes` (from, to, arrowheads, removed To incident edge, table-column index).
    - Extended `exactWorkGuard` with representative real topologies for `buildClusterDiscoveryIndex_*`.
- **Reference Fixture Generated:**
  - `d2layouts/d2talalayout/js/test/fixtures/go-cluster-discovery-reference.json` (2,523,923 bytes). Verified with repeatable SHA256 hash.
- **Unit and Oracle Replay Tests:**
  - `d2layouts/d2talalayout/js/test/unit/cluster-discovery.test.js`: 46 tests covering core cluster discovery functionality.
  - `d2layouts/d2talalayout/js/test/unit/cluster-discovery-oracle.test.js`: 15 comprehensive oracle replay tests with 30,234 `expect()` assertions.
- **Documentation Updated and Created:**
  - `d2layouts/d2talalayout/js/docs/ADR-013-SEQUENCE-MUTATION.md`: Status updated to `Accepted`.
  - `d2layouts/d2talalayout/js/docs/MIGRATION.md`: Updated roadmap (Slice 12 complete, Slice 13 implemented).
  - `d2layouts/d2talalayout/js/docs/ADR-014-CLUSTER-DISCOVERY.md`: Documented architecture, semantics, WorkGuard bounds, quirk parity, and non-goals.
  - `d2layouts/d2talalayout/js/docs/SLICE-13-PROGRESS.md`: This comprehensive report.

## 4. Fixture Repeatability Proof
- **Output path:** `js/test/fixtures/go-cluster-discovery-reference.json`
- **File size:** 2,523,923 bytes
- **Deterministic repeat SHA256:**
  `03050B8974BF298082AB44C7217BC24A03B9D92057F4E1E933433FA59AB22E11`

## 5. Mid-Operation Cancellation Calibration

1. **`allDescendantNodesWithWorkGuard`:**
   - Root container with 45 direct children (> 40 children).
   - Initial push charges 45 steps. While loop pops children up to step 64.
   - At step 64 (`(64n & 63n) === 0n`), `doneAvailable = false` polls `isCancelled()` and throws `WorkCanceledError`.
   - `guard.Used() == 64n`, `location == "cancel desc"`, traversal incomplete (only 19 children popped), graph untouched.

2. **`sequenceOriginal`:**
   - Sequence with 70 abductions (>= 64).
   - Fresh index with no cached entry.
   - Loop charges 1 step per abduction. At step 64, cancels mid-scan.
   - `guard.Used() == 64n`, `location == "cancel seqOriginal"`, `index.sequenceEdges.has(seq) === false` (cache entry was NOT completed), graph untouched.

3. **`clusterIncidentEdges`:**
   - 1 cluster node with 16 unique incident edges.
   - Member & edge collection work: 1 + 16 = 17 steps (< 64).
   - Merge-sort approximation charges: width=1 (16 steps), width=2 (16 steps), width=4 (crosses 64 at i=14).
   - Cancels inside the sort loop before `guard.Finish()`.
   - `guard.Used() == 64n`, `location == "cancel incident"`, graph untouched.

4. **`buildClusterDiscoveryIndex`:**
   - 75 root nodes in container.
   - Iterates root children in `addNode`: charges 1 step per child.
   - Cancels at 64th child during inventory.
   - `guard.Used() == 64n`, `location == "cancel build"`, graph untouched.

## 6. Complete Exact WorkGuard Replay & Low-Limit Boundary Results

### Exact WorkGuard Counts Replayed Against Go
- **Descendant:**
  - `descendant_self`: 1
  - `descendant_null_null`: 1
  - `descendant_null_non_null`: 1
  - `descendant_parent`: 2
  - `descendant_nested`: 3
  - `descendant_unrelated`: 2
  - `descendant_cycle`: 2
- **AllDescendants:**
  - `allDesc_empty`: 1
  - `allDesc_nested_container`: 6
- **SequenceOriginal:**
  - `sequenceOriginal_empty`: 0
  - `sequenceOriginal_first_cached_build`: 2
  - `sequenceOriginal_second_cached_lookup`: 0
- **RefreshNeighbors:**
  - `refreshNeighbors_no_edge`: 1
  - `refreshNeighbors_one_edge`: 2
  - `refreshNeighbors_duplicate_neighbor`: 2
- **ClusterIncidentEdges:**
  - `clusterIncidentEdges_empty`: 1
  - `clusterIncidentEdges_1_edge`: 2
  - `clusterIncidentEdges_2_edges`: 5
  - `clusterIncidentEdges_4_edges`: 13
- **BuildClusterDiscoveryIndex (Representative Topologies):**
  - `buildClusterDiscoveryIndex_root_only`: 5
  - `buildClusterDiscoveryIndex_nested`: 7
  - `buildClusterDiscoveryIndex_malformed_adjacency`: 7
  - `buildClusterDiscoveryIndex_sequence_recovery`: 6
  - `buildClusterDiscoveryIndex_leaky_container`: 16

### Low-Limit Boundary Checks (`limit = exact` -> pass, `limit = exact - 1` -> `WorkLimitError`)
- `clusterIsDescendantOfGuarded` (descendant_nested, limit=3 succeeds, limit=2 fails)
- `clusterIncidentEdges` (1_edge, limit=2 succeeds, limit=1 fails)
- `sequenceOriginal` (first_cached_build, limit=2 succeeds, limit=1 fails)
- `refreshNeighbors` (one_edge, limit=2 succeeds, limit=1 fails)
- `buildClusterDiscoveryIndex` (root_only, limit=5 succeeds, limit=4 fails)

## 7. Full Graph Read-Only Alias Proof
Verified on graph with non-null geometry/routes (`Box`, `TopLeft`, `Points` array with `Point` instances, `Clusters`, `Sequences`).
All references captured before discovery:
- `graph.Nodes`, `graph.Edges`, `graph.Containers`, `graph.Clusters`, `graph.Sequences`, `graph.Trees`
- Container child arrays: `Containers.get(null)`, `Containers.get(root)`
- Node properties: `Edges`, `Container`, `Cluster`, `Sequence`, `Graph`, `Box`, `TopLeft`
- Edge properties: `From`, `To`, `Points`, `Points[0]`, `Points[1]`
Asserted exact reference equality (`toBe`) and unchanged contents:
1. After successful `buildClusterDiscoveryIndex`.
2. After genuinely mid-operation cancelled `buildClusterDiscoveryIndex`.

## 8. Verification & Test Execution Results
- `bun test test/unit/cluster-discovery.test.js`: 46 pass, 0 fail (84 expect calls).
- `bun test test/unit/cluster-discovery-oracle.test.js`: 15 pass, 0 fail (30,234 expect calls).
- `bun test test/unit/random.test.js`: 8 pass, 0 fail (478 expect calls).
- `bun test`: 585 pass, 0 fail (39,933 expect calls across 27 files).
- `go test ./internal/grouping/...`: ok (cached, 0 errors).
- `go test -tags tala_cluster_discovery_oracle ./internal/grouping/...`: ok (cached, 0 errors).
- `git diff --check`: 0 whitespace or formatting warnings.
- `Math.random` scan in `js/src`: 0 occurrences.
- Node built-in imports (`fs`, `path`, `crypto`, etc.) in `js/src`: 0 occurrences.
- Forbidden Slice 14 methods (`AddClusters`, `AssignArrangement`, `CreateVessel`, `AddCluster`, `abductClusterEdges`, `Cleanup`, `Join`) in `js/src`: 0 occurrences.
- `js/src/index.js` does NOT export grouping.

## 9. Non-Goals Explicit Statement
No `AddClusters`, `AssignArrangement`, `CreateVessel`, `AddCluster`, `abductClusterEdges`, `Cleanup`, `Join`, cluster topology mutation, or later grouping-stage functionality was implemented.
