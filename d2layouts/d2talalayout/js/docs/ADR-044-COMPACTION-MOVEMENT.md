# ADR-044: Compaction + Generic Sized Movement

## Status
Accepted

## Context
Slice 43 ports the dependency-closed placement block that sits between first-stage sizeless optimization and the later sized optimizer. The pinned Go implementation places compaction on top of shared node-spacing geometry, visibility-graph construction, candidate generation, placement-cost scoring, and atomic stage rollback.

The full `sizedOptimizer` is intentionally deferred because its fallback path calls `transpose`, which in turn depends on the request-transaction system and cluster optimization. Pulling those dependencies into this slice would mix separate orchestration concerns.

## Decisions
- Port the layoutgraph accessors required by compaction: dynamic spacing (`DeltaTo`), overlap-at-point, visibility candidate/blocking checks, fixed-origin checks, and graph container fixed-origin lookup.
- Port `optimizerDoesOverlap`, `optimizerIsOccupied`, and `optimizerCanMove` with the pinned OptimizationWorkGuard accounting.
- Port the generic `moveNodeToBest` candidate scorer used by sized placement and compaction.
- Port `compaction` and its helper kernels: axis ordering, visibility edges, subgraph shifting, inflation, candidate generation, and compact-along-axis.
- Preserve exact stage rollback of node Point references/coordinates and cached routing costs on errors, cancellation, resource exhaustion, and thrown exceptions.
- Keep `CompactionVisibility`, `CompactionCandidates`, and `CompactionMoves` as distinct work-accounting locations.
- Validate exact ordering and numeric behavior with a same-package real-Go oracle and a committed JSON fixture.

## Scope Boundaries
Deferred to a later slice:
- `sizedOptimizer`
- `transpose` / rotation trials
- request transactions
- cluster optimization
- sized optimizer spatial index
- swap/transpose orchestration
- placement orchestration (`PlaceNodes`, `Place`)
- packing, routing, labeling, and engine integration

## API
All Slice 43 placement functions remain internal/direct-module APIs. They are not exported from `src/placement/index.js` or package root `src/index.js`.
