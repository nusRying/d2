# Slice 45 Progress — Sized Optimizer and Placement Stage Closure

Status: **Implemented — awaiting review**

Base Commit: `04257a3c7ff5d221b1148d7da355f6c7a3b5eef1` (Slice 44 approved)

Pinned Go: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

See ADR-046 for the decisions summarized here.

## Implemented
- `src/placement/sized-optimizer.js` — complete `sized_optimizer.go`: `newSizedOptimizer` (validation, `LocalOptimizeSetup` guard, edge-abduction preprocessing, long-distance neighbor requirements, root fixed origin), `optimize`/`optimizeWithLimit`/`optimizeGuarded`, `medianPointGuarded`, `protrudingChildrenGuarded`, `findClosestUnoccupiedDistanceGuarded`, `findUnoccupiedGuarded`, `isPointOccupiedGuarded`, `fillPlacementPointsGuarded`, `moveNodeToBestGuarded`, `bestSwapCandidateGuarded`, `syncHerdFencesGuarded`, `rebuildSpatialIndex`, `iterPlacementsAroundPoint`, `withHubSpokesSuppressed`.
- `src/placement/optimizer-support.js` — `chargeOptimizerTranspose`, `MAX_OPTIMIZER_PLACEMENT_CANDIDATES`.
- `src/graph/node.js` — `isAdjacentTo`.
- `src/placement/placement-stages.js` — `normalizeGaps` (stage-atomic) and `transposeAll`.
- `Normalize`/`Pad` already existed (`stage-geometry.js`, Slice 40); this slice confirms them.
- Parity fix: `src/placementcost/edge-length.js` obstruction-set collection now matches pinned Go (see ADR-046).

## Recorded contracts
- Go-compatible RNG consumption order (node `Shuffle`, two median draws, candidate `Shuffle`, swap `Shuffle`, hub-fallback draws).
- OptimizationWorkGuard (`LocalOptimize`) vs the shared transaction WorkGuard (`LocalOptimizeTransactions`).
- Whole-optimizer atomic rollback through the Slice 42 mutation snapshot.
- Candidate generation ordering, the negative-coordinate uint32 key encoding, and long-distance neighbor requirements.
- Current-position tie preference, spatial-index rebuild timing, and candidate Shuffle timing.
- Best-swap scoring, transpose fallback order, and hub-spoke suppression identity.
- Herd-fence work precharge and NormalizeGaps stage atomicity.

## Real-Go oracle
`internal/placement/go_slice45_sized_optimizer_oracle_test.go` → `js/test/fixtures/go-slice45-sized-optimizer-reference.json`, replayed by `test/unit/sized-optimizer-oracle.test.js`. Generation is gated by `TALA_SLICE45_ORACLE=1`; plain `go test` asserts the committed fixture.

Groups:
- `iterPlacements` (4 cases, exact order).
- `setup`: 13 cases — validation errors; parallel-edge, below-threshold, featured, cluster-abduction, and fixed-root requirements/origin; exhaustive setup cancellation.
- `components`: 25 cases — median (plain, temp, fixed origin, protruding children), closest unoccupied (5), occupied/find-unoccupied grid, placement points (negative coordinates, not-self, long-distance, herd, fixed origin), move (stay, best, tie, must-improve, no placement, obstacle, cluster), best swap (none, found). Each records exact results, work, RNG next value, final state, and a W-1 failure.
- `runs`: 24 full runs — simple, star, featured (herd, hub, near-only, fixed node, long-distance, obstacles), cluster abductions, swap grid, 6 seeded random graphs (single-temperature and annealed), and a 110-node spatial-indexed graph. Each is repeated twice for determinism; single-temperature runs pin W and the W-1 rollback.
- `probes`: exhaustive (strided when large) cancellation at every context check of three full runs, with exact rollback.
- `panicRollback`: a throw at the first check after a trial mutation.
- `stages`: NormalizeGaps (containers, basic, empty, seeded) and TransposeAll (seeded), with exact work, limit sweeps below W, and cancellation probes.

## Test coverage
- `test/unit/sized-optimizer.test.js`, `sized-optimizer-oracle.test.js`, `sized-optimizer-atomicity.test.js`, `sized-optimizer-resource.test.js`, `placement-stage-closure.test.js` (shared builders in `sized-optimizer-fixtures.js`); `placement-api-boundary.test.js` extended.
- Full suite: 109 files, 2680 tests passing (0 failures).

## Explicitly out of scope (Slice 46+)
Packing, trees, `placeNodes`/`Place`, `Prepare`, direct and the standalone Swap stage, alignment, equidistance, dejitter, BalanceSymmetry, container orientation, remaining structural placement finishing, routing, labels, engine/public API.
