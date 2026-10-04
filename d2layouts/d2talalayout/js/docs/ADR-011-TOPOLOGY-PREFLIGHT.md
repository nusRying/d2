# ADR 011: Topology Preflight and Guarded Container Traversal

## Date
2026-09-30

## Status
Accepted

## Context
TALA engine mutations across all layout stages (most immediately `grouping.AddSequences`, and subsequently cluster formation, tree discovery, herding, and routing) operate on complex hierarchical graphs. An untrusted, cyclic, or maliciously oversized input graph could cause infinite loops, stack overflow, or memory exhaustion if allowed into mutation or speculative snapshot stages.

In Go TALA, `layoutgraph.Validate` (`internal/layoutgraph/topology_preflight.go`) provides a bounded, read-only preflight validation pass. It executes at the very beginning of `AddSequences` and other key engine entrypoints to guarantee that:
```text
unsafe / cyclic / oversized runtime graph
→ rejected BEFORE GraphState snapshot or stage mutation
```
Furthermore, `AddSequences` relies on `graph.ContainerRDFSOrder(nil, guard)` to traverse nested containers in reverse depth-first search (RDFS) order under WorkGuard limits.

### Why Validation Precedes AddSequences
Pinned upstream `AddSequences` (`internal/grouping/sequences.go`) begins with:
```go
if err := layoutgraph.Validate(ctx, "AddSequences", graph); err != nil {
    return err
}
```
If topology validation is omitted or bypassed, invalid graphs (such as container cycles, runaway depths > 256, or nil pointers in child lists) can corrupt speculative `GraphState` snapshots or cause uncontrolled recursion during sequence discovery.

### Why This is Its Own Slice
Separating topology preflight from sequence discovery allows thorough verification of:
1. Bounded resource accounting (topology references, route points, WorkGuard budget).
2. All cycle and depth limit detections across four distinct parent/descendant models (container parent, effective container parent, ancestry parent, descendant ownership graph).
3. Complex tree forest consistency and alias coverage rules.
4. WorkGuard-metered container traversal without coupling to sequence discovery algorithms.

## Decisions

### 1. WorkGuard Integration and Budgeting
`validateEngineGraph` constructs a `WorkGuard` scoped to the operation and location:
```javascript
const guard = new WorkGuard(context, location, MAX_ENGINE_WORK_UNITS);
guard.SetLimit(MAX_PREFLIGHT_WORK); // 8_000_000n
```
All reference visits, route points, and traversal steps charge this WorkGuard, ensuring both cooperative cancellation and work limits are strictly enforced. At the end of successful validation, `guard.Finish()` is called to ensure any pending cancellation boundary is honored.

### 2. Go Slice Capacity vs JavaScript Array Semantics
In Go, `accountSpareCapacity(slice)` accounts for hidden backing array capacity:
```go
spare := cap(slice) - len(slice)
// charges spare to topology references and checks cancellation
```
JavaScript `Array` objects expose `.length` but have no observable backing-store capacity or `cap()` equivalent.
- **Decision:** In JavaScript, represented capacity equals `Array.length`, meaning spare capacity is always 0.
- **No synthetic counters:** We do not invent fake properties like `__capacity` or artificial padding.
- **Preserved cancellation boundaries:** Even though spare capacity is 0, the cancellation check boundary (`guard.Check()`) is preserved at every accounting point where Go calls `accountSpareCapacity`.

### 3. Topology Reference and Route Point Accounting
- `referenceCount` tracks every visited runtime topology reference against `MAX_TOPOLOGY_REFERENCES` (1,000,000). Exceeding this limit throws:
  `TALA engine topology references exceed limit 1000000 while visiting <kind>`
- `routePointCount` tracks visible edge route points across all edges against `MAX_ROUTE_POINTS` (1,000,000). Exceeding this limit throws:
  `TALA engine edge route points exceed limit 1000000`
- Every non-nil route point also charges 1 work unit via `guard.Step()`. Visible null points are rejected with:
  `TALA engine topology contains nil edge route point`

### 4. Runtime Identity Inventory
Validation tracks unique runtime instances using `Set` identity (`Set.has(object)`), not EntityID:
- `nodes` (limit: `MAX_ENGINE_NODES` = 10,000)
- `edges` (limit: `MAX_ENGINE_EDGES` = 50,000)
- `clusters`, `sequences`, `trees`, `edgeAbductions`, `herds`, `hierarchies`

Distinct JS object instances with identical IDs remain distinct runtime records during validation.

### 5. Parent-Chain Validation Models
Validation executes three separate iterative parent-chain checks over all reachable nodes:
1. **Direct Container Parent (`node.Container`):**
   - Cycle: `TALA engine container parent cycle detected at node <id>`
   - Depth (> 256): `TALA engine container parent depth exceeds limit 256`
2. **Effective Container Parent (`node.container()` / `node.OwningContainer()`):**
   - Resolves effective container taking into account active cluster vessel precedence.
   - Cycle: `TALA engine effective container parent cycle detected at node <id>`
   - Depth (> 256): `TALA engine effective container parent depth exceeds limit 256`
3. **Ancestry Parent (`ancestryParent(node)`):**
   - Uses exact pinned precedence:
     - `node.Container` if non-nil
     - else `node.Cluster.Vessel` if non-nil
     - else `node.Sequence.Vessel` if non-nil
     - else `null`
   - Cycle: `TALA engine ancestry parent cycle detected at node <id>`
   - Depth (> 256): `TALA engine ancestry parent depth exceeds limit 256`

### 6. Descendant Ownership Graph
Validation checks the union of:
- Direct container children (`Graph.Containers.get(node)`)
- Cluster vessel members (`Graph.Clusters.get(node).Nodes`)
- Sequence vessel members (`Graph.Sequences.get(node).Nodes`)

Using an iterative DFS state machine (colors: 0 unvisited, 1 visiting, 2 completed), validation detects:
- Cycle: `TALA engine descendant cycle detected at node <id>`
- Depth (> 256): `TALA engine descendant depth exceeds limit 256`
(The root `null` container contributes 0 to depth, while normal nodes contribute 1).

### 7. Tree Forest and NodeToTree Inverse Validation
Serialized tree validation guarantees:
- Tree child cycles and depths <= 256.
- Tree parent cycles and depths <= 256.
- Forest uniqueness:
  - No tree listed as multiple roots (`TALA engine tree is listed as more than one root`).
  - No tree repeated under the same parent (`TALA engine tree is repeated under one parent`).
  - No tree shared by multiple parents (`TALA engine tree is shared by multiple parents`).
  - No node owned by multiple trees (`TALA engine node <id> is owned by multiple trees`).
  - Child parent consistency: `child.Parent === parent` (`TALA engine tree child has an inconsistent parent`).
  - Placement wrapper parent consistency (`TALA engine tree root also has an installed parent` or `inconsistent placement parent`).
- `NodeToTree` map inverse consistency:
  - `tree.Node === key` (`TALA engine node-to-tree alias does not match the tree node`).
  - Trees referenced in `NodeToTree` must belong to installed forest (`TALA engine node-to-tree alias references a tree outside the installed forest`).
  - If both `NodeToTree` and the installed forest are non-empty, they must have exact 1:1 coverage (`TALA engine node-to-tree aliases do not cover/match the installed forest`).

### 8. Null Collections and Read-Only Guarantee
- Go permits `nil` maps and slices in many fields. JS traversal safely treats `null` Arrays and Maps as empty collections without allocating replacement collections or mutating the input `Graph`.
- Validation is strictly read-only: no objects, properties, maps, or arrays on `Graph` or its elements are created, replaced, reordered, or deleted.

### 9. Guarded Container RDFS Traversal
`Graph.ContainerRDFSOrder(root, guard)` implements WorkGuard-aware nested container ordering:
- Inspects `Graph.Containers.get(root)` in reverse order.
- For each child, calls `guard.Step()`.
- Recurses into direct containers (innermost first, child appended after descendants).
- If a child is a cluster vessel (`Graph.Clusters.get(child)`), iterates `cluster.Nodes` in reverse order, charging `guard.Step()` for each member, and recurses into member containers (without appending the cluster vessel itself).
- Does **not** traverse sequences (matching Go behavior).
- Public API provides:
  - `ContainerRDFSOrder(root, guard)`: strict WorkGuard-metered traversal.
  - `ContainerRDFSOrderUnbounded(root)`: unmetered traversal for callers without a guard.

### 10. Real Go Oracle Verification
`test/reference/go_topology_preflight_oracle.go` compiles against the pinned upstream D2 Go package (`github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph`) and exercises 40 distinct scenarios. The resulting fixture `test/fixtures/go-topology-preflight-reference.json` has a verified reproducible SHA256 checksum and is replayed in `test/unit/topology-preflight-oracle.test.js`.

### 11. Browser Safety and Zero Randomness
The implementation resides entirely in `src/graph/topology-preflight.js` and `src/graph/graph.js` with zero Node.js built-ins (`fs`, `path`, `process`, `Buffer`, etc.) and zero calls to `Math.random()`.

## Review Findings and Resolutions
1. **ContainerRDFSOrder Nil-Guard Early-Return Parity:**
   Removed eager `WorkGuard` validation from `ContainerRDFSOrder(root, guard)`. Pinned Go performs early return for non-container roots (`root != nil && !root.isContainer`) and empty container roots (`Containers[root]` empty) before any `guard.Step()` invocation. The JS implementation now directly delegates to `containerRDFSOrderContext`, returning `[]` without dereferencing a nil guard in these early-return scenarios.
2. **Removal of Untrusted Argument Spreads:**
   Replaced `children.push(...items)` calls in `descendantChildren()` with bounded `for-of` loops. This prevents stack overflow / maximum argument length errors when processing large collections of repeated valid references (e.g. 200,000 children).
3. **Canonical RDFS Work Accounting:**
   Corrected the documented work units used for the canonical upstream fixture (`TestGraphRDFSOrder`) from 15 to 20, matching the authoritative Go oracle fixture.
4. **Fixture Go Runtime Version:**
   Corrected documentation from `go1.24.1` to `go1.27.0`, matching the active Go toolchain recorded in `metadata.runtimeGoVersion`.
5. **Route-Point and Cancellation Error Wording:**
   Aligned documented error strings with the pinned Go implementation:
   - Route points limit: `TALA engine route point count exceeds limit 1000000`.
   - Cancellation: `AddSequences: context canceled` (via `WorkGuard.Finish()`).
6. **Tree Validation Scenario Ordering Clarification:**
   In the standard shared-tree scenario where two parents point to one child, the child's single `Parent` pointer triggers `TALA engine tree child has an inconsistent parent` before ownership duplicate checks occur. An explicit scenario (`tree_shared_by_multiple_parents_explicit`), where a tree is installed both as a root and as a child with a matching `Parent` backlink, was verified against Go to reach the explicit `TALA engine tree is shared by multiple parents` error branch.
