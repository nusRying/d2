# ADR-050: Label Placement, Legacy Quality Scoring, and Candidate Selection Foundation

## Status

Accepted

## Authority and Scope

Slice 49 builds directly on approved Slice 48 frozen base `eb679d176b9e7966c10045417a0b959e4bc755c4`. Behavioral authority remains pinned Go commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

This slice completes the `labeling` and `quality` internal packages:
- `labeling`: full `Place(ctx, graph)` / `place(ctx, graph, workLimit)` orchestration, node icon and label placement, tranche search, inside-fit checking, double-sized outside tie-breaking, global edge label placement, and exact snapshot rollback atomicity.
- `quality`: complete `labels.go`, `evaluation_guard.go`, `score.go`, and `scoring.go` ports, providing `EvaluateWithArea`, legacy candidate scoring penalty, unrounded graph bounding box `Area()`, and exact `Score.Compare` candidate-selection ordering.

All production files in `internal/labeling` and `internal/quality` are now 100% ported to browser-safe JS.
Remaining unported labeling production files: NONE.
Remaining unported quality production files: NONE.

## Decisions

### 1. Full Label Placement Sequence and Ordering (`labeling.Place`)
`Place(ctx, graph)` executes `place(ctx, graph, maxLabelPlacementWorkUnits)` with location `"PlaceLabels"`:
1. Preflight topology validation: `ValidatePositionedGraphSelection(ctx, "PlaceLabels", graph, nil)`.
2. Snapshot capture: `captureLabelPlacement(graph, nil)`.
3. Rollback boundary installed: on any error, cancellation, work-limit failure, or thrown value, the exact snapshot is restored before rethrowing the identical error/sentinel object.
4. Work guard initialization: `newLabelPlacementWorkGuard(ctx, "PlaceLabels", workLimit)`.
5. Arrowhead labels reserved first: iterate `graph.Edges` in source order, placing source then target arrowhead labels via `PositionArrowheadLabel` and appending fake square label nodes to `placedFakeNodes`.
6. Loop and fixed edge labels reserved second: iterate `graph.Edges` in source order, reserving space for loop edge labels (`edge.IsLoop()`) and fixed edge labels (`edge.Label.PositionFixed()`).
7. Node icon and label placement: iterate `graph.Nodes` in source order (no re-sorting).
   - Siblings and children set: `g.Containers[node.Container]` (excluding self) plus `g.Containers[node]` if container.
   - Ancestors list: `collectLabelPlacementAncestors(node, guard)` bounded by `maxLabelPlacementAncestryDepth = 100`.
   - Icon placement: if `node.Icon != null` and `!node.IsImage()`.
     - If fixed: create fake node at existing position.
     - If movable: evaluate candidates in `labelPositionPreferences(node)` order; compute overlap score `nodeOverlaps + edgeOverlaps + 2 * labelOverlaps`; strict lower score wins; break early on score == 0. If node has a fixed Label, include it in obstacles.
   - Node label search: if `node.Label != null` and not fixed.
     - Search tranches in exact `labelPositionPreferenceTranches(node)` order.
     - Exclude position matching `bestIconPosition`.
     - For inside candidates: test fit using `PadLabelCandidate(fakeLabelNode, LABEL_PADDING)` and `LabelBoxFits(node.InnerBox(), fakeLabelNode.GetBox())`. If it does not fit, reject; if it fits, unpad before overlap scoring.
     - Compute overlap score: `siblingOverlaps + ancestorOverlaps` (using `partialNodeOverlapCount`), `edgeOverlaps` (with `LABEL_PADDING - 1`), `labelOverlaps` (with `LABEL_PADDING`).
     - Outside-label tie break: if both best and candidate positions are outside and have equal score, compare via double-sized candidates (`Width * 2`, `Height * 2`) against obstacles. Strictly lower tie-break score wins; the original normal-sized candidate is committed.
   - Commit node label: append `bestFakeNode` to `placedFakeNodes` and set `node.Label.Position = bestLabelPosition`.
8. Global edge label placement:
   - Identify shared segments with `findSharedSegmentsChecked` and build fake nodes with `SharedSegmentClearance`.
   - Collect and sort unlocked, non-loop labeled edges via `sortLabelPlacementEdges`.
   - For each edge: find best position with `findBestEdgeLabelPosition` and assign `edge.Label.Position` and `edge.LabelPercentage`.
9. Final cancellation check: `guard.check()`.

### 2. Snapshot Atomicity and Work Boundaries (W / W-1)
- The snapshot preserves exact object references: `node.Label`, `node.Icon`, `edge.Label`, `edge.Points`, and `Point` references are not reallocated on rollback.
- At exact work `W`, placement succeeds.
- At `W - 1`, placement fails with `TALA PlaceLabels work exceeds limit <W-1>` and restores all label/icon positions and percentages to their pre-stage values.

### 3. Separation of `quality.Inspect` and Legacy `quality.Evaluate`
- `Inspect` (Slice 48) provides diagnostic repair/safety metrics (`NodeOverlaps`, `RouteObstructions`, `TextOcclusions`, `Crossings`, `Detour`, `RouteLength`) consumed by routing finishing passes (`NudgeEdgeChannels`, `ShortcutEdgeRoutes`).
- `Evaluate` / `Score` (Slice 49) computes the legacy TALA penalty and separate unrounded area tie-breaker for candidate selection.
- Diagnostic metrics from `Inspect` are NOT folded into `Evaluate`.

### 4. Legacy Quality Penalty Formula
`EvaluateWithArea(ctx, graph)` computes:
1. Edge turns penalty: for each non-cluster edge, `max(0, len(Points) - 2) * 0.5`.
2. Diagonal segment penalty: for each edge segment where `curr.X != next.X && curr.Y != next.Y`, `+3`.
3. Edge crossings: `countNonSharedCrossings(graph.Edges, guard)` added directly to score (`+ crossings`).
4. Label placement score: `scoreExistingLabelPlacements(graph, guard)` produces `labelScore in (0, 1]`; adds `1.0 - labelScore` to penalty.
   - Edge labels scored with: `score = (nodeOverlapArea / labelArea) * 2 + labelOverlapCount * 10 + almostLabelOverlapCount + nodeOverlapCount * 2 + edgeOverlapCount * 2 + sharedSegmentOverlapCount`. Note `nodeOverlapCount = 0` is passed matching Go.
   - Final label score: `1 / (1 + totalScore)`.
5. Area tie breaker: `chargeEvaluationAreaWork(graph, guard)` precharges conservative work before computing `graph.Area()`.

### 5. Area as a Strict Tie Breaker
- Graph area is computed using unrounded bounding box: `Math.abs(tl.X - br.X) * Math.abs(tl.Y - br.Y)`.
- Area is NEVER encoded into the float penalty score (avoiding historical precision inversions where area 100 outweighed area 99).
- `Score.Compare` orders penalties first, areas second.

### 6. Score.Compare Semantics
- Penalty: finite value beats non-finite (`NaN`, `+Inf`, `-Inf`). Both invalid are equal. Otherwise exact numeric comparison.
- Area: valid only if finite and `>= 0`. Valid area beats invalid area. Both invalid are equal. Otherwise exact numeric comparison.
- No epsilon or approximate rounding is used.

## Verification

1. Real-Go Oracles:
   - `internal/labeling/go_slice49_labeling_oracle_test.go` -> `js/test/fixtures/go-slice49-labeling-reference.json` -> `js/test/unit/labeling-place-oracle.test.js` (21 tests, all passing).
   - `internal/quality/go_slice49_quality_oracle_test.go` -> `js/test/fixtures/go-slice49-quality-reference.json` -> `js/test/unit/quality-scoring-oracle.test.js` (20 tests, all passing).
   - Gate: `TALA_SLICE49_ORACLE=1`. In normal execution, tests verify committed fixtures byte-identically and do not mutate files.
2. Targeted Unit Tests:
   - `test/unit/labeling-place.test.js`: 7 tests passing.
   - `test/unit/labeling-place-atomicity.test.js`: 3 tests passing.
   - `test/unit/quality-scoring.test.js`: 4 tests passing.
   - `test/unit/quality-evaluation-resource.test.js`: 5 tests passing.
   - Total targeted tests: 60 tests passing across 6 files.
3. Regression and Full Suite:
   - Full JS test suite: 5352 pass, 0 fail across 147 test files (up from 5292 in Slice 48).
   - Full Go test suite across all 15 CI packages: all passing.
   - Browser safety: zero Node builtins in production code.
   - Public API boundary: `js/src/index.js` remains untouched.

## Deferred to Slice 50 (Final Slice)

The following remain for Slice 50:
- Engine pipeline orchestration (`internal/engine`)
- Multi-seed execution and coordination (`evaluateSeedResult`, `coordinateLocalSeeds`, `considerSeedCandidate`)
- Compound candidate orchestration and result validation
- ELK adapter finalization and public `layout()` API
- Package export hardening and publishing
- End-to-end integration and final migration closure
