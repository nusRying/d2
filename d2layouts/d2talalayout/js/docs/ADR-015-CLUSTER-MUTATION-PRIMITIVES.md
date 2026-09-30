# ADR 015: Cluster Mutation and Edge Abduction Primitives

## Date
2026-09-30

## Status
Implemented — awaiting Slice 14 review

## Context
In TALA's layout grouping pipeline, interchangeable sibling nodes are gathered into clusters and temporarily replaced by composite "vessel" nodes during layout calculation. This pipeline is divided into:
1. **Cluster Discovery and Classification (Slice 13):** Read-only indexing of nodes, edge signatures, neighbors, and clustering eligibility.
2. **Cluster Mutation and Edge Abduction Primitives (Slice 14):** Low-level mutating helpers that size vessels (`Cluster.Resize`), construct and sort placement vessels (`CreateVessel`), install clusters into layout graphs (`AddCluster`), and abduct incident edges to vessel nodes (`abductClusterEdges`).
3. **Atomic AddClusters Orchestration (Future Slice 15):** Candidate discovery loops, cluster comparison, container estimate updates, and atomic `GraphState` rollback transactions wrapping the mutation primitives.

Slice 14 ports the exact low-level mutation machinery required by the future `AddClusters` stage, matching `internal/grouping/clusters.go` and `internal/layoutgraph/cluster.go`.

---

## Architectural Decisions

### 1. Separation of Low-Level Mutation from Transactional Orchestration
The helpers ported in this slice (`Cluster.Resize`, `CreateVessel`, `AddCluster`, `abductClusterEdges`) are strictly **nontransactional**:
- They do not wrap themselves in `GraphState` or perform self-rollback upon failure.
- In pinned Go, stage atomicity is owned exclusively by the outer `AddClusters` stage function via `defer func() { if !complete { RestoreGraphState(...) } }()`.
- Preserving this boundary ensures that partial mutation semantics on `WorkGuard` budget exhaustion or context cancellation remain observable and testable at the primitive level, and will be faithfully restored by the stage transaction in Slice 15.

### 2. `Cluster.Resize` Member Dimension Normalization
Go's `(*Cluster).Resize(vessel)` operates with unmetered work:
- If `vessel == nil`, it throws `"cluster is missing its vessel"`.
- If `!cluster.FixedSize`:
  - Scans maximum member width and height independently, starting both maxima at `0.0`. Negative member dimensions are effectively clamped by the initial `0.0`.
  - If any member is `nil`, the scan aborts immediately with `"cluster contains a nil node"` before mutating any node dimensions.
  - Sets *every* member's `Width = maxWidth` and `Height = maxHeight`.
- Computes maxima across members again (accommodating `FixedSize=true` where individual member dimensions remain untouched).
- Sizes the vessel according to `Arrangement`:
  - `Row`: `vessel.Width = maxWidth * len(Nodes) + Padding * (len(Nodes) - 1)`, `vessel.Height = maxHeight`.
  - `Column`: `vessel.Width = maxWidth`, `vessel.Height = maxHeight * len(Nodes) + Padding * (len(Nodes) - 1)`.
  - Other arrangements: vessel dimensions remain unmodified.
- Empty clusters (`len == 0`) preserve raw arithmetic: the padding term is multiplied by `-1` (e.g. `vessel.Width = -Padding`). The resulting dimension is not clamped.

### 3. `CreateVessel` Positioning and In-Place Sorting
`CreateVessel(cluster, vesselID)` performs the following steps:
1. Scans member `TopLeft` coordinates for independent minimum X and minimum Y across all positioned members (`node.TopLeft != nil`).
2. Constructs a new vessel `Node(vesselID, 0, 0)` and marks `vessel.isClusterVessel = true`. Note: it does NOT assign `cluster.Vessel = vessel` (the caller assigns that later).
3. Invokes `cluster.Resize(vessel)`.
4. If at least one member was positioned (`minimumX !== Number.POSITIVE_INFINITY && minimumY !== Number.POSITIVE_INFINITY`):
   - For `Row`: sorts `cluster.Nodes` in place ascending by `TopLeft.X` and sets `vessel.TopLeft = Point(minimumX, minimumY)`.
   - For `Column`: sorts `cluster.Nodes` in place ascending by `TopLeft.Y` and sets `vessel.TopLeft = Point(minimumX, minimumY)`.
   - Special coordinates like `-Infinity` and `NaN` pass this gate matching Go's `!math.IsInf(minimumX, 1) && !math.IsInf(minimumY, 1)`.
5. If no member was positioned, `cluster.Nodes` is not sorted and `vessel.TopLeft` remains `null`.

### 4. Go `sort.Slice` Tie Parity
Pinned Go uses unstable `sort.Slice`. Small tie cases may preserve relative order as an implementation artifact because pdqsort uses insertion sort for slices with length <= 12. However, larger tie sets (> 12 elements) undergo pdqsort partitioning, which reorders equal keys. Slice 14 validates larger adversarial tie sets (sizes 13, 20, 32) against the real Go 1.27 oracle.

To guarantee exact tie permutation parity with pinned Go 1.27 across all sizes without inventing arbitrary tie-breakers or introducing non-deterministic behavior, `CreateVessel` employs a localized Go 1.27 pdqsort compatibility sorter. This helper faithfully ports Go's pdqsort algorithm (insertion sort, heap sort fallback, pivot selection, 64-bit xorshift pattern breaker, and partitioning).

For mixed positioned/unpositioned members, Go's comparator dereferences `TopLeft.X` without a nil check, triggering a panic. JS mirrors this by accessing `a.TopLeft.X`, throwing a `TypeError`.

### 5. `AddCluster` Container Filtering Quirk and Duplicate Node Removal
In `AddCluster(graph, cluster)`:
1. Adds `cluster.Vessel` to the container via `graph.addNewNodeToContainer(cluster.Container, cluster.Vessel)`.
2. Marks each member's `Cluster = cluster`.
3. Filters `graph.Containers[cluster.Container]`:
   - Keeps children where `child.Cluster !== cluster`.
   - **Quirk:** This filter checks `child.Cluster !== cluster`, NOT `cluster.Nodes.includes(child)`. Any existing container child that already carried a matching `Cluster` pointer is filtered out even if absent from `cluster.Nodes`.
4. Removes each cluster member from `graph.Nodes` via `graph.removeNode(node)` and sets `node.Container = null`. Notice that `node.Graph` remains pointing to `graph`.
5. To match Go's `Graph.RemoveNode` (which removes all pointer-equal instances of `node` from `graph.Nodes`), JS `graph.removeNode` filters `this.Nodes = this.Nodes.filter(n => n !== node)`.
6. Sets `graph.Clusters[cluster.Vessel] = cluster`.
7. `AddCluster` does NOT touch edges or edge lists.

### 6. Dynamic Edge Abduction Work Charging and Two Abductions for Internal Edges
`abductClusterEdges(cluster, edges, guard)` iterates over supplied edges in order:
1. Calls `guard.Step()` for each outer edge iteration (even for irrelevant edges).
2. If `edge.From.Cluster === cluster`:
   - Charges `len(edge.From.Edges) + len(cluster.Vessel.Edges)` individual `guard.Step()` calls.
   - Appends an `EdgeAbduction` with `OriginallyFrom = edge.From`, `CurrentFrom = cluster.Vessel`, `CurrentTo = edge.To`.
   - Reconnects edge source: `edge.reconnect(cluster.Vessel, false)`. This adds `edge` to `cluster.Vessel.Edges` and removes it from `edge.From.Edges`.
3. If `edge.To.Cluster === cluster` (evaluated against CURRENT edge state):
   - Charges `len(edge.To.Edges) + len(cluster.Vessel.Edges)` using the *new* dynamic length of `cluster.Vessel.Edges`.
   - Appends an `EdgeAbduction` with `OriginallyTo = edge.To`, `CurrentTo = cluster.Vessel`, `CurrentFrom = edge.From`.
   - Reconnects edge target: `edge.reconnect(cluster.Vessel, true)`.
4. For an **internal member-to-member edge**:
   - Both `From` and `To` branches execute.
   - The edge produces **two** abduction records.
   - The vessel edges length increments between the `From` charge and the `To` charge, altering the step count dynamically.
   - The edge ends as `cluster.Vessel -> cluster.Vessel`.

### 7. Delayed Publication of `cluster.EdgeAbductions` and Partial Failure
- The local abductions array is assigned to `cluster.EdgeAbductions` ONLY after the entire edge loop completes successfully.
- If `guard.Step()` fails midway (due to work limit or context cancellation):
  - Prior reconnects remain in place on the graph and incident node edge lists.
  - Later edges remain untouched.
  - `cluster.EdgeAbductions` retains its pre-call value (e.g., existing sentinel array remains untouched).
  - No rollback is attempted by `abductClusterEdges`.

### 8. Route Preservation
Edge abduction reconnects endpoints and alters incident edge lists on nodes, but strictly preserves:
- `edge.Points` array reference and length.
- Individual `Point` object instances and coordinates.
- Edge ID, arrowheads, labels, and style metadata.

### 9. EdgeAbductions Zero Representation
Do not change the JS slice representation convention merely because Go uses a nil slice. The already-approved JS migration convention throughout the engine uses `[]` (empty array) for collections with zero elements. EdgeAbductions uses `[]` for zero successful abductions rather than claiming pointer-level Go nil parity.

### 10. Real-Go Oracle Strategy
A dedicated, build-tagged Go bridge (`internal/grouping/cluster_mutation_oracle_bridge.go` with `//go:build tala_cluster_mutation_oracle`) exposes private `abductClusterEdges`. The oracle generator (`js/test/reference/go_cluster_mutation_oracle.go`) generates `js/test/fixtures/go-cluster-mutation-reference.json`, capturing 49 comprehensive scenarios across `Cluster.Resize`, `CreateVessel` (including large adversarial tie sets of size 13, 20, 32 and special non-finite coordinates `-Infinity` and `NaN`), `AddCluster`, `abductClusterEdges`, boundary conditions, mid-operation cancellation with `errors.Is(err, context.Canceled)` / location wrapping, and final-Finish cancellation. Deterministic generation is verified via repeatable SHA256 hashing.
