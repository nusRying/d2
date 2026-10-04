# Slice 49 Progress — Labeling + Quality/Scoring Closure

Status: **Implemented — awaiting Slice 49 review**

Base Commit: `eb679d176b9e7966c10045417a0b959e4bc755c4` (Approved Slice 48)

Pinned Go Authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

See ADR-050 for architectural decisions and interface contracts.

## Implemented

### 1. Labeling Guard Additions (`src/labeling/guard.js`)
- `partialNodeOverlapCount(node, nodes, delta, guard)`: counts obstacles that overlap candidate box without completely covering it.
- `collectLabelPlacementAncestors(node, guard)`: walks `EffectiveContainer()` ancestry with strict pre-step topology depth check (`depth >= 100`).

### 2. Labeling Access Additions (`src/labeling/labeling-access.js` & `src/graph/node.js`)
- `LabelBoxFits(outer, inner)`: strict bounding box containment.
- `PadLabelCandidate(node, padding)`: in-place mutation of `node.TopLeft` without replacing object reference.
- `node.isImage()`, `node.IsImage()`, `node.ancestryParent()`, `node.AncestryParent()`.

### 3. Full Label Placement Orchestration (`src/labeling/placement.js`)
- `Place(ctx, graph)` / `place(ctx, graph, workLimit)`.
- Preflight topology validation via `ValidatePositionedGraphSelection(ctx, "PlaceLabels", graph, null)`.
- Atomic rollback boundary via `captureLabelPlacement(graph, null)` restoring exact state on error, cancellation, or thrown sentinel.
- Arrowhead label reservation in source-before-target order per edge.
- Loop and fixed edge label reservation.
- Source-ordered node iteration with sibling/child obstacle set construction.
- Non-image icon placement with tranche preferences, obstacle scoring, and zero-score early break.
- Node label tranche preference search, icon position exclusion, inside-fit checking with padding, and double-sized outside tie-breaking.
- Global edge label placement reusing Slice 47 `findSharedSegmentsChecked`, `sortLabelPlacementEdges`, and `findBestEdgeLabelPosition`.
- Final cancellation check on `guard.check()`.

### 4. Graph Quality Area API (`src/graph/graph.js`)
- `area()`, `Area()`: unrounded bounding box area `abs(tl.X - br.X) * abs(tl.Y - br.Y)`.

### 5. Quality Evaluation Guard (`src/quality/evaluation-guard.js`)
- `newEvaluationWorkGuard(ctx, limit)`: creates work guard with location `"Evaluate"` and 50,000,000 unit limit.
- `chargeEvaluationAreaWork(g, guard)`: conservative precharge covering nodes, outside labels (4x nodes), edges, and label/arrowhead multipliers.
- `chargeEvaluationWork(guard, amount)`, `evaluationIsDescendantOf(descendant, ancestor, guard)`.

### 6. Quality Labels Evaluation (`src/quality/labels.js`)
- Ported from `internal/quality/labels.go`.
- `scoreExistingLabelPlacements(g, guard)`:
  - Arrowhead label reservations.
  - Loop label reservations.
  - Node icon and node label scoring.
  - Shared segment discovery and clearance box creation.
  - Edge label scoring with non-ancestor / ancestor overlap areas.
- Geometric kernels: `boxesOverlapWithPadding`, `boxCovers`, `boxOverlapArea`, `boxOverlapsLine`, `segmentsIntersect`, `straddlesLine`, `closedIntervalsOverlap`.
- Score formulas: `scoreNodeLabelOverlaps`, `scoreEdgeLabelOverlaps`.
- Guarded shared segment collection and merge sort: `findSharedSegments`, `sortSharedSegments`.

### 7. Quality Scoring and Comparator (`src/quality/score.js` & `src/quality/scoring.js`)
- `EvaluateWithArea(ctx, graph)`: computes layout penalty and separate unrounded graph area.
- `evaluateWithAreaLimit(ctx, graph, workLimit)`: work-guarded evaluation with exact accounting.
- Turn penalties (`max(0, len(Points)-2) * 0.5`), diagonal penalties (`+3`), crossing penalties (`+ crossings`), label score penalties (`1.0 - labelScore`).
- Area strictly separated from penalty to avoid precision/tie-breaking inversions.
- `Score` class with `Compare(other)`:
  - Penalty compared first, area second.
  - Finite values beat non-finite (`NaN`, `+Inf`, `-Inf`).
  - Valid area (`>= 0` and finite) beats invalid area.
  - Exact numerical comparison with zero epsilons.
- `Evaluate(ctx, graph)`: convenience wrapper returning `Score`.

## File Ledgers

### Labeling Package
- `internal/labeling/arrowhead.go` -> `src/labeling/arrowhead.js` (complete)
- `internal/labeling/guard.go` -> `src/labeling/guard.js` (complete)
- `internal/labeling/model.go` -> `src/labeling/model.js` (complete)
- `internal/labeling/placement.go` -> `src/labeling/placement.js` (complete)
- Remaining unported labeling production files: **NONE**

### Quality Package
- `internal/quality/crossings.go` -> `src/quality/crossings.js` (complete)
- `internal/quality/evaluation_guard.go` -> `src/quality/evaluation-guard.js` (complete)
- `internal/quality/inspection.go` -> `src/quality/inspection.js` (complete)
- `internal/quality/inspection_geometry.go` -> `src/quality/inspection-geometry.js` (complete)
- `internal/quality/inspection_labels.go` -> `src/quality/inspection-labels.js` (complete)
- `internal/quality/labels.go` -> `src/quality/labels.js` (complete)
- `internal/quality/score.go` -> `src/quality/score.js` (complete)
- `internal/quality/scoring.go` -> `src/quality/scoring.js` (complete)
- Remaining unported quality production files: **NONE**

## Test Verification

1. Real-Go Oracles:
   - `internal/labeling/go_slice49_labeling_oracle_test.go` (PASS)
   - `internal/quality/go_slice49_quality_oracle_test.go` (PASS)
   - Replay suites: `labeling-place-oracle.test.js` (21 pass), `quality-scoring-oracle.test.js` (20 pass).
2. Targeted Unit Suites:
   - `labeling-place.test.js` (7 pass)
   - `labeling-place-atomicity.test.js` (3 pass)
   - `quality-scoring.test.js` (4 pass)
   - `quality-evaluation-resource.test.js` (5 pass)
   - Total targeted tests: 60 pass, 0 fail across 6 files.
3. Full JS Suite:
   - 5352 pass, 0 fail, 208981 assertions across 147 test files.
4. Go CI Package Regression:
   - `limits`, `layoutgraph`, `placementcost`, `placement`, `proximity`, `grouping`, `hierarchy`, `trees`, `packing`, `loops`, `graphbounds`, `labeling`, `nodeshape`, `routing`, `quality`: all 15 packages pass.
