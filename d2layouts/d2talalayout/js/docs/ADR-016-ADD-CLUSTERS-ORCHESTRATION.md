# ADR 016: Atomic AddClusters Orchestration

## Date
2026-10-01

## Status
Implemented (awaiting Slice 15 review)

## Context
In TALA's layout grouping pipeline, interchangeable sibling nodes are gathered into clusters and temporarily replaced by composite "vessel" nodes during layout calculation. Slices 13 and 14 ported read-only cluster discovery indexing and the low-level cluster mutation primitives (`Cluster.Resize`, `CreateVessel`, `AddCluster`, `abductClusterEdges`).

Slice 15 delivers the complete, top-level transactional orchestration function: `AddClusters`, alongside its supporting helper primitives (`averageClusterDimensions`, `assignArrangement`, `paddingBetween`, `Graph.containerPadding`, `Node.distanceTo`, `Node.sameShape`, and transaction WorkGuard helpers).

Pinned Go reference:
- `d2layouts/d2talalayout/internal/grouping/clusters.go`
- `d2layouts/d2talalayout/internal/layoutgraph/transaction.go`
- `d2layouts/d2talalayout/internal/layoutgraph/hierarchy_access.go`

---

## Architectural Decisions

### 1. Transactional Rollback & GraphState Snapshot
`AddClusters` is fully transactional:
- Before any mutation, a graph state snapshot is captured using `newGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true })` and updated with the transaction work guard.
- A completion flag `let complete = false;` controls the rollback lifecycle.
- Wrapped in a `try ... finally` block:
  - If execution completes normally without error or cancellation, `complete = true`.
  - If any error is thrown (including `WorkLimitError`, `WorkCanceledError`, or unexpected exceptions), `if (!complete) restoreGraphState(graph, stageState);` completely restores the graph to its pre-orchestration topology and edge routes.
- The `graph.Clusters` Map identity is preserved on success and restored on rollback.

### 2. Transaction WorkGuard Context Propagation
To prevent candidate exploration from prematurely exhausting the primary engine budget, TALA provides an aggregate transaction guard mechanism:
- `MAX_TRANSACTION_WORK_UNITS = 1_000_000_000n`.
- `ensureTransactionWorkGuard(ctx, location)` retrieves an existing transaction guard from the context or creates an aggregate guard and derives a child `TransactionWorkContext`.
- All loop iterations, indexing calls, candidate evaluations, and mutations step this transaction guard.
- When the transaction guard limit is exhausted, `WorkLimitError` is thrown, triggering full rollback.

### 3. Pre-Mutation Graph Validation
`addClusters` requires both a valid context, graph, and external random generator:
- If `context == null`, throws `"TALA AddClusters requires a context"`.
- If `graph == null`, throws `"TALA AddClusters requires a graph"`.
- If `random == null`, throws `"TALA AddClusters requires a random generator"`.
- Before taking any snapshot or charging work, `validateEngineGraph(context, "AddClusters", graph)` is invoked to verify structural graph integrity.

### 4. Deterministic Randomness & RNG Isolation
- **External Random Generator (`random`):**
  - Passed by caller to provide vessel entity IDs via `random.Int63()`.
  - Consumed during `assignArrangement` only when breaking ties for square clusters (`random.Float64() > 0.5`).
  - Consumed draws are irreversible: if a transaction rolls back, the external RNG state remains at its advanced position matching Go's exact behavior.
- **Internal Container Shuffling (`randomSeed`):**
  - For each container traversed, a local generator is instantiated: `new GoRand(randomSeed)`.
  - This ensures that candidate evaluation order within a container is completely decoupled from external RNG draws and stays reproducible across runs.

### 5. Reserved Entity ID Inventory
When allocating new vessel node IDs:
- All existing IDs from `graph.Nodes`, `graph.Sequences` (vessel and member nodes), and `graph.Trees` (root sentinel and tree nodes via LIFO stack traversal) are collected into a `reservedIDs` Set.
- If a candidate ID drawn from `random.Int63()` collides with an existing ID, it linearly increments (wrapping around from `INT64_MAX` to `0n`) until an unreserved ID is located, charging `guard.Step()` on each collision step.

### 6. Cluster Geometry & Arrangement Rules
- `averageClusterDimensions(cluster)`: Calculates rounded integer averages for node widths and heights. An empty cluster produces `[NaN, NaN]`.
- `assignArrangement(cluster, isConnectedToSequence, random)`:
  - If `isConnectedToSequence` is true, forces `Row`.
  - If `width > height`, selects `Column`.
  - If `width < height`, selects `Row`.
  - If `width === height`, draws `random.Float64() > 0.5 ? Column : Row`.
- `paddingBetween(cluster, considerPositions)`:
  - Base spacing is `Math.max(20, Math.ceil(dim) * 0.1)`.
  - If any cluster node has an icon, increases spacing to accommodate label and padding.
  - If `considerPositions` is true, computes average distance between adjacent members.
- `Node.sameShape(other)`:
  - Raw shape string equality (`this._shapeType === other._shapeType`). Default `""` does NOT equal `"Square"`, reproducing Go layout semantics.
- `Graph.containerPadding(container, considerChildren)`:
  - Accounts for container labels, icons, shapes (circle divides by 4), and child margins/icons.

### 7. Strict Stop Boundary
This slice does NOT include:
- Cluster cleanup (`Cleanup`, `ResetClusters`)
- Cluster joining (`Join`, `JoinDistancedClusters`)
- Hub discovery or creation (`AddHubs`)
- Cluster internal layout (`Cluster.ArrangeClusterNodes`, `Cluster.SyncGeometryWithWork`)
- Tree, placement, or routing layout orchestration.
