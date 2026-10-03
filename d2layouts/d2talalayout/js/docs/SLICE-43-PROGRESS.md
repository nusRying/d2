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

## CI
GitHub Actions automatically runs the full JavaScript parity suite, Go parity packages, and diff hygiene for Slice 43 source/test changes.

Final test counts will be recorded after the final green Slice 43 CI run.

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
