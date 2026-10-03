# ADR-045: Transactions, Transpose, Cluster Optimization, Gap Reduction, and Optimizer Spatial Index

## Status
Implemented — awaiting Slice 44 review

## Context
Slice 44 ports the transaction substrate, transpose, cluster optimization, gap reduction, and spatial index substrate required for layout placement in TALA. In Go, these modules form the transactional foundation and spatial acceleration layer upon which sized optimization is built.

The full `sizedOptimizer` and `medianPointGuarded` are intentionally deferred to Slice 45 to keep slice scope manageable and strictly dependency-closed.

## Decisions
- **Transaction Substrate (`src/graph/transaction.js`):**
  - Implement full `Transaction`, `GraphState`, `TransactionOptions`, and `restoreGraphState`.
  - Provide `ErrInvalidCandidate`, `ErrNonImprovingCandidate`, and `isCandidateRejection` helpers with both class- and instance-based type identification.
  - Implement candidate overlap validation, sweep-line fast validation, and structural bad-state / fixed-origin constraints.
  - Support full transaction rollback and state cloning without leaking state mutations on error or cancellation.
- **Placement Cost Parity (`src/placementcost/graph.js`):**
  - Port `EdgeLength`, `GraphEdgeCrossings`, `ContainerAlignmentCost`, and `segmentsCross` for scoring graph candidates.
  - Implement 64-bit FNV-1a state hashing for placement edge length cache lookups.
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

## Scope Boundaries
Deferred to Slice 45:
- `sizedOptimizer` full search algorithm
- `medianPointGuarded`
- Placement orchestration (`PlaceNodes`, `Place`)
- Packing, routing, labeling, and engine integration
