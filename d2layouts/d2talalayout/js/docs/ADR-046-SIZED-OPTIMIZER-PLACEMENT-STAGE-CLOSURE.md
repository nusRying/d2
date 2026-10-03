# ADR-046: Sized Optimizer and Placement Stage Closure

## Status
Implemented — awaiting Slice 45 review

## Context
Slice 45 ports the complete pinned `internal/placement/sized_optimizer.go` — the local search that moves, swaps, and transposes sized nodes — plus the placement stage wrappers that are already dependency-closed on Slices 42–44 (`NormalizeGaps`, `TransposeAll`; `Normalize` and `Pad` already exist from Slice 40). `Place`/`placeNodes` remain in Slice 46 because they depend on packing, trees, and container orientation.

Pinned Go authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Decisions

### Module layout
- `src/placement/sized-optimizer.js` holds `SizedOptimizer`, `newSizedOptimizer`, `iterPlacementsAroundPoint`, and `withHubSpokesSuppressed`. It is separate from `optimizer-support.js` so the optimizer stays auditable.
- `src/placement/optimizer-support.js` gains `chargeOptimizerTranspose` and `MAX_OPTIMIZER_PLACEMENT_CANDIDATES` (both from `optimization_guard.go`). `Node.isAdjacentTo` is added to `node.js` (`node.go isAdjacentTo`).
- `src/placement/placement-stages.js` holds `normalizeGaps` and `transposeAll`.
- None of these are exported from `src/placement/index.js` or `src/index.js`; the API-boundary test forbids them.

### Go-compatible RNG consumption
All randomness uses the existing `GoRand` and `limits.Shuffle` port. RNG order per node is: node-index `Shuffle` (once per run) → two `Float64` draws in `medianPointGuarded` (X then Y) → candidate `Shuffle` → swap-candidate `Shuffle` (only when the node did not move) → in the hub fallback, another median (two draws) and candidate `Shuffle`. The oracle pins the generator's next `Int63` after every component and run.

### OptimizationWorkGuard vs transaction WorkGuard
`optimizeWithLimit` first calls `EnsureTransactionWorkGuard(ctx, "LocalOptimizeTransactions")`, then creates `OptimizationWorkGuard("LocalOptimize", limit)` on the returned context. Optimizer work charges the optimization guard. Transposes and other transactions charge the shared transaction guard. `chargeOptimizerTranspose` additionally precharges transpose's work on the optimization guard before `transpose` runs. Setup uses its own guard (`LocalOptimizeSetup`, fixed at `MaxOptimizationWorkUnits`), which callers cannot limit.

### Whole-optimizer atomic rollback
`optimizeWithLimit` captures the approved Slice 42 `OptimizerMutationSnapshot` into reusable scratch. Any error or thrown value restores it before propagating, and scratch is released afterward. The snapshot restores node `TopLeft` identity and values, width, height, cluster policy, herd assignments, and placement costs (cache and routing costs). `moveNodeToBestGuarded` additionally restores candidate-movement positions on any failure. Speculative swaps reuse `withOptimizerPositionsSwapped`.

### Candidate generation ordering
- `findClosestUnoccupiedDistanceGuarded` scans rings 0..100 from right to left. At each step it checks `(x, -y)` before `(x, y)` and applies the root fixed-origin filter. `findUnoccupiedGuarded` and `isPointOccupiedGuarded` keep pinned order: round to the cell grid, reject by fixed origin, `indexedIsOccupied`, then `indexedDoesOverlap(node, point, [node])`.
- `fillPlacementPointsGuarded` charges one Step per stale `seen` entry when reusing scratch. It then generates the diamond with `x` from `+dist` down to `-dist` and, for `y != 0`, `iterPlacementsAroundPoint(x, -y)` before `(x, y)`. Next come long-distance candidates (neighbors sorted by ID after `AddSort`), then the herd node's current position, then `guard.Add(len(points))`.
- The checked-offset cache keys `${x},${y}`. Number-to-string is injective for finite doubles except `-0`/`+0`, which Go map keys also treat as equal.

### Negative coordinate key encoding
The placement dedup key is `uint64(uint32(int64(pX/cell)))<<32 | uint64(uint32(int64(pY/cell)))`. It is computed as a BigInt with `BigInt.asUintN(32, …)`, so negative cells wrap exactly as Go's `uint32` conversion.

### Long-distance neighbor requirements
`newSizedOptimizer` scans edge abductions per node: abducted edges are skipped, and adjacency replacements map to the original endpoint. It then counts every incident edge per (replaced) neighbor, including parallel edges, tracking max `MinWidth`/`MinHeight`. A node's full requirement map is retained only when some neighbor has at least 3 edges and a dimension above the integer cell size. Otherwise the previous value is left untouched, as in Go.

### Current-position tie preference
`moveNodeToBestGuarded` replaces the best candidate on a strict `PrecisionCompare` improvement. On a tie it switches only to the node's original position. It skips auxiliary scoring when `edgeLength - symmetryCost` is already worse. Each obstacle charges a Step, skips the `(-ContainerPadding, -ContainerPadding)` sentinel, and adds `3 * TurnCost()` on overlap. A final context check reports `EdgeLength: …` with the context error as `cause`. If no candidate scores, the original position is restored and the pinned error is thrown.

### Spatial-index rebuild timing
The Slice 44 optimizer spatial index is rebuilt once per optimized node, after the median is computed and before the unoccupied-distance search. The checked-position cache is used (and cleared, not replaced) only when the graph has more than 10 node indices.

### Candidate Shuffle timing
Candidates are shuffled with the optimizer RNG right after generation and before scoring, in both the primary path and the hub fallback.

### Best-swap scoring
Swap candidates are graph indices in source order, shuffled with the same RNG. A candidate must not be fixed, must be adjacent within one cell, must not be in a tree, and must pass indexed overlap checks at the destinations. Then, inside a speculative swap, it must also pass the legacy no-exception overlap checks. A swap wins only if `swappedL1 < currentL1`, `swappedL1 + swappedL2 < currentL1 + currentL2`, and the total beats the best so far, all using `PrecisionCompare`.

### Transpose fallback order and hub-spoke suppression
If the node did not move, the order is: `bestSwapCandidateGuarded`. If it finds a candidate: swap, then sync herd fences. Otherwise: `chargeOptimizerTranspose`, `transpose`, and a Step. If transpose fails, the node is a hub, and `temp != 0`, the optimizer suppresses the spoke edges and repeats median → distance → points → `Shuffle` → move under the same guard and RNG. `withHubSpokesSuppressed` restores the original `Edges` array (identity, order, and contents) on success, error, or throw.

### Herd-fence work precharge
`syncHerdFencesGuarded` charges `AddProduct(n, n+1)` and `Add(len(Edges))`, runs the existing `SyncHerdFences`, then `Finish`.

### NormalizeGaps stage atomicity
`normalizeGaps` ensures the `GapNormalizationTransactions` guard and opens one `AffectContainers` transaction. It then pins the rollback point with `PreservePriorGraphState` and snapshots CellSize and routing costs. Next it runs bidirectional gap normalization in this order: each container in `ContainerRDFSOrder` (horizontal, then vertical), then the whole graph. It ends with `ResetTurnCost`, `SyncSequences`, `SyncClusters`, and `Finish`. Any failure restores the graph state and CellSize, plus either the captured placement costs or the entry routing costs. `transposeAll` ensures `TransposeStageTransactions`, computes CellSize, and transposes nodes in source order. Like pinned Go, it is not stage-atomic.

### Parity correction found by the Slice 45 oracle
`placementcost/edge-length.js` (Slice 41) stopped collecting route obstruction sets as soon as the starting container was the shared ancestor. Pinned Go checks for the ancestor only after advancing, so it also scans outer containers. The fix matches Go's context-check count and obstruction penalties. All earlier placement-cost oracles still pass.

### Oracle
`internal/placement/go_slice45_sized_optimizer_oracle_test.go` writes `js/test/fixtures/go-slice45-sized-optimizer-reference.json` only when `TALA_SLICE45_ORACLE=1`. Otherwise it recomputes every value and asserts the committed fixture byte for byte. Each full run is executed twice inside the oracle to prove determinism.

### Pinned Go nondeterminism (documented, not compared)
- `newSizedOptimizer` iterates the per-node requirement map and breaks at the first qualifying neighbor. With several neighbors, Go's own setup work count depends on map order. Oracle scenarios keep at most one neighbor with qualifying edges per node.
- The zero-edge `Nears` scan breaks at the first usable near. Scenarios use a single near.
- Graph `EdgeLength` runs in parallel for more than 10 nodes, which interleaves its context checks. Counting-context probes therefore use graphs with at most 10 nodes. Larger graphs pin geometry, RNG state, and work limits only.

## Scope Boundaries
Deferred to Slice 46+: packing, trees, `placeNodes`/`Place`, `Prepare`, direct and the standalone Swap stage, alignment, equidistance, dejitter, BalanceSymmetry, container orientation, remaining structural placement, routing, labels, and the engine/public API.
