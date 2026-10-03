# Slice 44 Progress — Transactions, Transpose, Cluster Optimization, Gap Reduction, and Spatial Substrate

Status: **Implemented — awaiting review**

Base Commit: `8e880de642f858dbdebf620831ec99246a95d46b` (Slice 43 approved)

Pinned Go: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Implemented
- **Transaction Engine (`src/graph/transaction.js`):**
  - Lifecycle: `AddOp`, `Commit`, `Rollback`, `UpdateState`, `CloneGeometryContext`, `PreservePriorGraphState`, `CapturePlacementCosts`/`RestorePlacementCosts`.
  - Rollback points use the approved `GraphState` port (`graph-state.js`, ADR-010).
  - Candidate errors: `ErrInvalidCandidate`, `ErrNonImprovingCandidate`, `isCandidateRejection` (follows `cause` wrapping like `errors.Is`).
  - Existing-overlap sweep construction, graph-wide structural validation, and post-state overlap sweep with exact WorkGuard charging.
- **Graph validation helpers (`src/graph/graph.js`):** `isBadStateContext`, `isStructurallyBadStateWithFixedOriginContext`, `hasBadOverlapStateContext`, `doesOverlapWithDimensionsContext`, `ancestorsOfGuarded`, lazy `CrossingCost()`.
- **Placement cost (`src/placementcost/graph.js`):** `EdgeLength`, `GraphEdgeCrossings`, `ContainerAlignmentCost`, `segmentsCross`, FNV-1a cache keys.
- **Transpose (`src/placement/transpose.js`):** `transpose`, `rotateAround`.
- **Cluster optimization (`src/placement/cluster-optimization.js`):** `alignConnectedNodes`, `alignVessel`, `optimizeCluster`, `optimizeClusters`, whole-stage `OptimizeClustersRollback`.
- **Gap reduction (`src/placement/gap-reduction.js`):** `gapNormalization`, `reduceGapToNeighbors`, `isBetween`, `nearestBetween`, `nearestConnectedAhead`.
- **Optimizer spatial index (`src/placement/optimizer-spatial-index.js`):** interval index for >= 96 nodes with legacy fallback; `indexedCanMove`, `indexedIsOccupied`, `indexedDoesOverlap`, `nodeMayMoveDescendants`.

## Review corrections (after `935be055132186aee735c4ec450223dda4ca62a3`)
- `Commit` now follows pinned Go per operation: `Step`, context check, operation, context check, container reposition + validation, `SyncClusters`/`SyncSequences` (for every operation), context check. Previously JS ran all operations first and synchronized only with `AffectContainers`.
- Every Go `guard.Step()`/`guard.Finish()` checkpoint is charged: transaction construction (snapshot + existing-overlap sweep), container discovery and wrap loop, overlap-validation collection, fixed origins, structural validation, the post-state sweep, existing-overlap regression loops, descendant/ancestor exception marking, placement-cost capture. The overlap reference limit is the pinned 4,000,000 and the sweep padding uses the pinned `TableNodeGap`/`NodeGap` (120/20).
- `newRequestTransaction` charges the context's shared transaction guard (it previously used a no-op guard). `transpose`, `optimizeCluster`, `OptimizeClusters`, and `gapNormalization` reuse the context returned by `EnsureTransactionWorkGuard` for every nested transaction, score, and gap reduction. A derived transaction context forwards the parent's `Err()` identity.
- Slice 44 call sites passed `{ affectContainers: true }` (lower case), which silently disabled container repositioning; they now pass `AffectContainers`, and `TransactionOptions` rejects unknown keys.
- Every `UpdateState()` result is checked. A failed refresh rolls back to the previous rollback point and propagates before `changed` is reported. Gap reduction now reuses and reassigns one transaction as pinned Go does, instead of creating a fresh one per candidate.
- Thrown exceptions during `Commit` roll back and rethrow the original value, including a thrown candidate sentinel.
- Cluster optimization: the container refit uses the children's fixed bounds (`nodesFixedBounds`), the `Orientation.NONE` skip is live (it compared against an undefined `Orientation.None`), and scoring failures after a commit roll back.
- `EdgeLength` charged crossings with the raw `crossingCost` field (0 until set); it now uses `Graph.CrossingCost()`, which lazily computes and caches the pinned penalty. The Go oracle exposed this on a seeded gap-normalization graph.
- Scoring cancellation errors keep the context error as `cause` (Go `%w`).

## Real-Go fixtures and oracles
Generation is gated: `TALA_SLICE44_ORACLE=1 go test ...` rewrites the fixtures; plain `go test` recomputes every value and asserts the committed fixture byte for byte.

- `internal/layoutgraph/go_transaction_oracle_test.go` -> `js/test/fixtures/go-transaction-reference.json`
  - multi-op commit with per-op reposition/sync and exact work; cluster sync without `AffectContainers`; cancellation at every one of the 34 Commit context checkpoints; exact W = 131 / W-1; overlap rejection; one guard shared by two transactions, a clone, and a cost capture; `UpdateState` advancement and limit rollback; 40 exported sweep graphs with pair sets and work; duplicate references; aggregate reference limit; sparse maximum node count; cluster/sequence dedup; constructor cancellation; long-distance neighbor charge.
- `internal/placement/go_slice44_oracle_test.go` -> `js/test/fixtures/go-slice44-reference.json`
  - transpose on every node of 14 seeded graphs (graph-wide and edge-abduction scoring, wins after 1, 2, and 3 rotations), early rejections, W / W-1, cancellation at all 1,381 context checkpoints, transposed cluster vessel with nested `optimizeCluster`.
  - cluster optimization fixtures from the pinned atomicity tests, W / W-1, every limit below W for two stages (whole-stage rollback including CellSize, costs, and earlier clusters), cache-charge delta.
  - gap normalization on seeded and pinned graphs in all four modes, exhaustive `isBetween`/`nearestConnectedAhead`/`nearestBetween`, W / W-1, and every limit below W for six scenarios covering each refresh site (candidate, backward, accepted, container-side, container-side accepted, nested mirrored, outer).
  - spatial index: legacy path, indexed path, duplicate occupancy, stale graph, stale node count, NaN, infinity, negative dimensions, exceptions, with exact work per query.

## Test Coverage
- `test/unit/transaction.test.js`, `test/unit/transaction-oracle.test.js`, `test/unit/transpose.test.js`, `test/unit/cluster-optimization.test.js`, `test/unit/gap-reduction.test.js`, `test/unit/optimizer-spatial-index.test.js`, `test/unit/slice44-oracle.test.js`, `test/unit/placement-api-boundary.test.js`
- Full suite: 104 files, 2633 tests passing (0 failures).

## Explicitly Out of Scope
- `sizedOptimizer` full search algorithm (deferred to Slice 45)
- `medianPointGuarded` (deferred to Slice 45)
- Placement orchestration (`PlaceNodes`, `Place`, `NormalizeGaps`)
- Packing, routing, labeling, and engine integration
