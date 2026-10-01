# ADR 017: ResetClusters Lifecycle Retirement

## Date
2026-10-01

## Status
Accepted

## Context
In TALA's layout grouping pipeline, interchangeable sibling nodes are gathered into clusters and represented by composite "vessel" nodes during layout calculation. After layout completion (or during reset before subsequent passes), clusters must be torn down.

The lifecycle consists of two distinct stages in Go:
1. `ResetClusters`: Synchronous retirement of composite vessels, restoration of abducted edges to original endpoints, detachment of member node ownership pointers, bidirectional cleanup of vessel Near neighbor sets, and removal of retired vessels from graph node lists and container child arrays.
2. `Cleanup`: Post-layout geometric cleanup, which arranges cluster members and sequence steps, syncs geometry, and positions nodes.

`Cleanup` crosses into sequence geometry and node positioning dependencies outside the scope of Slice 16. Therefore, **`ResetClusters` only** is ported in this slice, and `Cleanup` is explicitly deferred.

Pinned Go reference:
- `d2layouts/d2talalayout/internal/grouping/lifecycle.go`
- `d2layouts/d2talalayout/internal/grouping/lifecycle_reset_test.go`

---

## Architectural Decisions

### 1. ResetClusters Only; Cleanup Deferred
- Only `resetClusters` / `ResetClusters` is implemented in `js/src/grouping/lifecycle.js` and exported from `js/src/grouping/index.js`.
- `Cleanup`, `Cluster.ArrangeClusterNodes`, `Cluster.SyncGeometry`, `Cluster.SyncGeometryWithWork`, `Join`, `JoinDistancedClusters`, `AddHubs`, and tree/placement/packing/routing pipeline stages are strictly deferred.
- Grouping is not exported through the root `js/src/index.js`.

### 2. Procedural Mutation Without WorkGuard, Transaction, Context, or RNG
Pinned Go signature:
```go
func ResetClusters(graph *layoutgraph.Graph)
```
- In contrast to `AddClusters` (Slice 15), `ResetClusters` has **no WorkGuard**, no `context`, no `GraphState` snapshots, no rollback capability, no cancellation, and no RNG (`GoRand` / `Math.random`).
- It is a synchronous, non-transactional procedural mutation that returns `void` (no error).

### 3. Entry Condition and Nil-Map Equivalent Behavior
Pinned Go behavior:
```go
if len(graph.Clusters) == 0 {
    return
}
```
- A `nil` or `undefined` `graph` is not guarded; direct property dereference throws a native JavaScript `TypeError`, corresponding directly to Go's nil-pointer runtime panic.
- A valid `Graph` instance with `graph.Clusters == null` is treated as a Go nil map and returns without mutation.
- An existing empty `graph.Clusters` Map returns without mutation, preserving Map identity.
- No custom null-graph validation or explicit error throwing is added.

### 4. Branch Selection Based on Original Clusters Map Size
Pinned Go logic:
```go
bulkFilter := len(graph.Clusters) > 1
```
- The decision whether to use bulk filtering (`bulkFilter = graph.Clusters.size > 1`) is made once upfront using the **original** Map size.
- Skipping nil-valued entries or nil-key entries during iteration does NOT alter this branch decision.

### 5. Nil Cluster Value Semantics
- When iterating `[vessel, cluster]` entries, if `cluster == null`, the entry is skipped (`continue`).
- A nil-valued cluster's key vessel node is **not** detached, **not** unmarked, and **not** filtered from graph node lists or container arrays during the per-entry loop.
- This malformed-state behavior is explicitly tested upstream and strictly preserved.

### 6. Nil Cluster Key Semantics
- If a non-null cluster is stored under a `null` key (`vessel == null`):
  - Its abducted edges are restored.
  - Its pointer-matched member `node.Cluster` pointers are cleared.
  - The `null` sentinel is removed from member `node.Nears` sets.
  - However, because `vessel == null`, no vessel retirement occurs: `retiredVesselCount` is not incremented, no vessel metadata is detached, and no array filtering is performed for this entry.

### 7. Pointer-Matched Member Cluster Ownership
- For every node in `cluster.Nodes`:
  - `node.Cluster` is cleared (`node.Cluster = null`) **iff** `node.Cluster === cluster` (pointer identity match).
  - If `node.Cluster` points to another cluster instance, it remains untouched.
- Independently, if `node.Nears != null`, `node.Nears.delete(vessel)` is called (even if `vessel` is null). Existing `Nears` Set identity is preserved, and a `null` member `Nears` remains `null`.

### 8. Edge Abduction Restoration: FROM Before TO, Always Reconnecting
- For each abduction in `cluster.EdgeAbductions` (in original array order):
  - If `abduction == null` or `abduction.Edge == null`, skip.
  - If `abduction.OriginallyFrom != null`, call `abduction.Edge.reconnect(abduction.OriginallyFrom, false)`.
  - If `abduction.OriginallyTo != null`, call `abduction.Edge.reconnect(abduction.OriginallyTo, true)`.
- Reconnection is executed **unconditionally**, without checking if `edge.From` or `edge.To` already equals the original endpoint. Because `reconnect` removes the edge from `node.Edges` and appends it to the end, calling it on an already-restored endpoint observably moves the edge to the end of `node.Edges`. This regression behavior is strictly preserved.
- The abduction object, `cluster.EdgeAbductions`, and `edge.Points` are not mutated.

### 9. Vessel Near Cleanup Semantics
For a non-null vessel being retired:
- If `vessel.Nears != null`, iterate each neighbor:
  - If `near != null && near.Nears != null`, remove `vessel` from `near.Nears`.
- Always assign a fresh, non-null empty `Set` to the retired vessel:
  ```js
  vessel.Nears = new Set();
  ```
- This applies whether `vessel.Nears` was initially null, non-empty, or contained null. Neighbor `Nears` Set identities are preserved; the vessel's `Nears` identity is always refreshed.

### 10. Non-Bulk Branch (`bulkFilter === false`)
When original `graph.Clusters.size <= 1`:
- If a non-null cluster and non-null vessel are encountered:
  - Immediately filter that exact vessel from `graph.Nodes`.
  - Immediately filter that exact vessel from every non-null child array in `graph.Containers`.
  - Detach vessel metadata in exact order:
    ```js
    vessel.Container = null;
    vessel.Graph = null;
    vessel.unmarkClusterVessel();
    ```

### 11. Bulk Branch Bookkeeping and Sub-Branches
When original `graph.Clusters.size > 1`:
- During iteration over map entries, graph and container arrays are **not** filtered.
- For each non-null cluster with a non-null vessel:
  - Vessel Near cleanup is performed.
  - `retiredVesselCount++`.
  - If `retiredVesselCount === 1`, record `singleRetiredVessel = vessel`.
  - Vessel metadata is detached (`Container = null`, `Graph = null`, `unmarkClusterVessel()`).
- After the entry loop:
  - **Zero retired vessels (`retiredVesselCount === 0`)**: No filtering on `graph.Nodes` or `graph.Containers`. `graph.Clusters.clear()`, return.
  - **One retired vessel (`retiredVesselCount === 1`)**: Stable-filter only `singleRetiredVessel` from `graph.Nodes` and every non-null container child array. `graph.Clusters.clear()`, return.
  - **Two or more retired vessels (`retiredVesselCount > 1`)**: Single-pass stable filtering using predicate:
    ```js
    node != null && node.Graph == null && graph.Clusters.get(node) != null
    ```
    This removes retired vessels while retaining null entries, ordinary survivors, and nil-valued cluster keys (since `graph.Clusters.get(staleKey)` returns null/undefined). `graph.Clusters.clear()` is called **after** this pass because the map is part of the predicate.

### 12. Stable In-Place Array Compaction
- In Go, filtering uses `slice[:0]` backing-storage reuse:
  ```go
  filtered := slice[:0]
  for _, item := range slice {
      if keep(item) { filtered = append(filtered, item) }
  }
  slice = filtered
  ```
- To mirror this in JavaScript without returning new Array allocations, `filterInPlace(arr, predicate)` modifies the existing array in-place, shifting kept elements forward and truncating `arr.length`.
- Existing `Array` object references are retained for `graph.Nodes` and all container child arrays.

### 13. Container Child Array Null vs Non-Null Empty Invariance
- If `graph.Containers.get(container) == null`, it remains `null`.
- If it was a pre-existing non-null empty `[]`, it remains the same empty Array object.
- No `null -> []` or `[] -> null` conversions occur.

### 14. Clusters Map Identity Preservation
- At the end of `resetClusters`, `graph.Clusters.clear()` is called.
- The Map instance identity is preserved (`graph.Clusters` is never reassigned).
