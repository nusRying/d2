# ADR-045: Transactions, Transpose, Cluster Optimization, Gap Reduction, and Optimizer Spatial Index

## Status
Implemented — awaiting Slice 44 review

## Context
Slice 44 ports the transaction substrate, transpose, cluster optimization, gap reduction, and spatial index substrate required for layout placement in TALA. In Go, these modules form the transactional foundation and spatial acceleration layer upon which sized optimization is built.

The full `sizedOptimizer` and `medianPointGuarded` are intentionally deferred to Slice 45 to keep slice scope manageable and strictly dependency-closed.

## Decisions
- **Transaction Substrate (`src/graph/transaction.js`):**
  - Port `Transaction`, `TransactionOptions`, constructors, `UpdateState`, `CloneGeometryContext`, `Rollback`, `CapturePlacementCosts`, and `RestoreGraphState` from pinned `transaction.go`.
  - Rollback points reuse the approved `GraphState` port (ADR-010) instead of a second snapshot implementation, so pointer, route, `Graph.Nodes`, and topology identity follow one audited path.
  - `Commit` reproduces pinned Go's observable sequence exactly: initial `Finish` + context check; per operation `Step`, context check, operation, context check, container reposition and validation (when `AffectContainers`), then `SyncClusters`/`SyncSequences` and a context check for every operation; followed by guarded overlap-validation collection, fixed origins, graph-wide structural validation, the post-state overlap sweep, existing-overlap regression checks, a final context check, and `Finish`. Work counts are part of the contract and are pinned by the Go oracle.
  - Requests share one aggregate transaction budget: every constructor without an explicit guard uses `EnsureTransactionWorkGuard`, and stage functions reuse the context it returns.
  - Error conventions: errors pinned Go returns are returned (`Commit`, `UpdateState`, `CapturePlacementCosts`, constructors); `WorkGuard` failures throw (existing JS contract); anything thrown during `Commit` rolls back and is rethrown with its original identity. `ErrInvalidCandidate`/`ErrNonImprovingCandidate` are only produced for candidate rejections.
  - `TransactionOptions` rejects unknown keys so a misspelled option can no longer silently disable container repositioning.
- **Placement Cost Parity (`src/placementcost/graph.js`):**
  - Port `EdgeLength`, `GraphEdgeCrossings`, `ContainerAlignmentCost`, and `segmentsCross` for scoring graph candidates.
  - Implement 64-bit FNV-1a state hashing for placement edge length cache lookups.
  - `EdgeLength` charges crossings with `Graph.CrossingCost()`, which (as in Go) lazily computes and caches the crossing penalty in the graph-owned routing cost.
- **Transpose & Rotation (`src/placement/transpose.js`):**
  - Implement `transpose` and `rotateAround` for 90-degree CCW rotations and trial candidate evaluation.
- **Cluster Optimization (`src/placement/cluster-optimization.js`):**
  - Port `alignConnectedNodes`, `alignVessel`, `optimizeCluster`, `optimizeClusters`, and `OptimizeClustersRollback`.
- **Gap Reduction (`src/placement/gap-reduction.js`):**
  - Port `gapNormalization`, `reduceGapToNeighbors`, `isBetween`, `nearestBetween`, and `nearestConnectedAhead`.
- **Optimizer Spatial Index (`src/placement/optimizer-spatial-index.js`):**
  - Port `OptimizerSpatialIndex` segment tree for fast interval/occupancy queries on graphs with >= 96 nodes, with simple fallback for smaller graphs.
  - Port `indexedCanMove`, `indexedIsOccupied`, `indexedDoesOverlap`, and `nodeMayMoveDescendants`.
- **API and Browser Safety:**
  - Maintain pure browser safety: no `node:`, `fs`, `path`, `crypto`, `process`, or `Math.random` in `src/`.
  - Keep internal placement algorithms unexported from public barrels (`src/placement/index.js` and `src/index.js`).

- **Go oracles:** `internal/layoutgraph/go_transaction_oracle_test.go` and `internal/placement/go_slice44_oracle_test.go` regenerate their fixtures only when `TALA_SLICE44_ORACLE=1`; otherwise they recompute every value and assert the committed fixtures, so ordinary `go test` never writes to the checkout.

## Scope Boundaries
Deferred to Slice 45:
- `sizedOptimizer` full search algorithm
- `medianPointGuarded`
- Placement orchestration (`PlaceNodes`, `Place`)
- Packing, routing, labeling, and engine integration
