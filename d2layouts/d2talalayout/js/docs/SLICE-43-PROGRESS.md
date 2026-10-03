# Slice 43 Progress — Compaction + Generic Sized Movement

Status: **Implemented — awaiting review**

Frozen Slice 42 base: `49f95ab4e49ebc0e0a5f3309370f7418dc81c577`

Pinned Go: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Implemented
- Layoutgraph compaction accessors: `DeltaTo`, `DoesOverlapAt`, `VisibilityGraphCandidate`, `IsBlocked`, `PointPastFixedOrigin`, and container fixed-origin lookup.
- Routing-cost state snapshot/restore access used by atomic compaction rollback.
- Guarded sized movement predicates: occupancy, overlap, and movement eligibility.
- Generic `moveNodeToBest` candidate scoring with edge length, table crossing cost, symmetry, fixed-origin filtering, original-position tie preference, and shared optimization work accounting.
- Compaction kernels: stable axis ordering, visibility graph, nearest-behind lookup, compaction floor, candidate generation, inflation, subgraph shifting, and iterative compact-along-axis.
- Stage-level exact rollback of Point identity/coordinates and routing-cost state.
- Work/resource locations preserved: `CompactionVisibility`, `CompactionCandidates`, `CompactionMoves`.
- Real-Go oracle: `internal/placement/go_compaction_oracle_test.go` -> `test/fixtures/go-compaction-reference.json`.
- JS oracle replay and direct atomicity/resource/API-boundary gates.

## Real-Go fixture
The committed fixture pins:
- `DeltaTo`: disconnected 20, connected 60, MinWidth override 90.
- exact horizontal sized visibility-edge order.
- exact candidate points.
- generic candidate scorer final position and OptimizationWorkGuard usage.
- exact final node positions for normal and transition compaction.
- `orderedAlongAxis` horizontal and vertical coordinate ordering and ID ties.
- `nearestFrom` trailing edge coordinate maximization and first-occurrence retention.
- `compactionFloor` sized, sizeless, and padding boundary increments.
- `inflateAlongAxis` normal and transition repositioning.
- `optimizerDoesOverlap`, `optimizerIsOccupied`, `optimizerCanMove` predicates and work charging.
- `shiftSubgraphs` moving and non-moving (`TestShiftSubgraphsWontChange`) scenarios.
- `compactAlongAxis` execution, changed status, and work units used.
- exact minimum CompactionMoves work boundary W (954) and first pass work (732).

## Regressions and Dedicated Tests
- Dedicated `test/unit/moves.test.js` protecting strict scoring, tie preference, nil point errors, no-valid-placement errors, fixed-origin constraints, and `CompactionMoves` cancellation location.
- Exact W (954) and W-1 (953) boundary regression in `test/unit/compaction.test.js` verifying full stage rollback of geometry, Point object identity, routing costs, placement cache sentinel, and cache Map survival.
- Panic and cancellation mid-mutation rollbacks matching pinned Go tests.
- Replicating `TestVisibilityGraphOverlap`, `TestVisibilityGraphInitialization`, and `TestShiftSubgraphsWontChange`.

## CI
GitHub Actions automatically runs the full JavaScript parity suite, Go parity packages, and diff hygiene for Slice 43 source/test changes.

## Explicitly out of scope
- sized optimizer
- transpose
- request transactions
- cluster optimization
- optimizer spatial index
- placement orchestration
- packing
- routing
- labeling
- engine integration
