# ADR-048: Routing Core Architecture and Parity

## Status
Accepted

## Context
Slice 47 ports the core edge-routing pipeline from `internal/routing` of TALA layout engine. It establishes orthogonal visibility graph (OVG) construction, A* search routing, slingshot heuristic routing, flavor coordination (ShortestToLongest, LongestToShortest, Default), standalone routing stage (`RouteEdges`), whole-graph routing stage (`RouteGraph`), resource guards, cancellation propagation, and atomic multi-subgraph rollback invariants.

Pinned Go behavioral authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Decisions

### 1. Module Architecture
| JS Module | Pinned Go Reference | Responsibilities |
|---|---|---|
| `src/routing/ovg.js` | `internal/routing/ovg.go` | Orthogonal visibility graph nodes, edges, segments, indexed crossings, boundary projections, candidate intersections |
| `src/routing/ovg-hierarchy.js` | `internal/routing/ovg_hierarchy.go` | Hierarchy-aware OVG port mirroring, ancestor port alignment, tunnel integration |
| `src/routing/priority-queue.js` | `internal/routing/priority_queue.go` | Deterministic 4-way / binary min-heap priority queue with decrease-key and Go tie-breaking |
| `src/routing/route.js` | `internal/routing/route.go` | Route representations, segment endpoints generation, colinearity validation |
| `src/routing/slingshot.js` | `internal/routing/slingshot.go` | Heuristic direct routing with L/S flight plans, cache semantics, launch space |
| `src/routing/ovg-edge-router.js` | `internal/routing/ovg_edge_router.go` | Route flavor execution worker, A* search routing, straight-line fallback, symmetrical port evaluation |
| `src/routing/coordinator.js` | `internal/routing/coordinator.go` | Multi-flavor parallel/sequential evaluation, deterministic response ordering, parallel edge reordering, loop routing |
| `src/routing/standalone-router.js` | `internal/routing/standalone_router.go` | Standalone stage (`RouteEdges`), preflight validation, isolated edge routing |
| `src/routing/graph-stage.js` | `internal/routing/route_graph.go` | Whole-graph routing stage (`RouteGraph`), tracked subgraph splitting, observer hooks, atomic ownership rollback |
| `src/routing/route-guards.js` | `internal/routing/route_search_guard.go`, `route_work_guard.go` | Deterministic work budgeting ($W$ and $W-1$ boundary parity), cancellation polling |
| `src/routing/cluster-route-guard.js` | `internal/routing/cluster_route_guard.go` | Guarded node traversal for cluster vessel intersections |

### 2. Flavor Coordinator and Concurrency Determinism
- `generateRouteFlavorResponsesWith` coordinates route generation across three flavors (`ShortestToLongest`, `LongestToShortest`, `Default`).
- The winner is selected strictly based on minimal total route distance. Ties favor the earlier flavor in defined enum order.
- Out-of-order asynchronous worker resolution is handled deterministically via indexed results aggregation.
- If aggregate work limit is exceeded, execution halts immediately with `ErrWorkLimitExceeded`.

### 3. Whole-Graph Routing & Subgraph Splitting
- `RouteGraph` partitions disconnected components into subgraphs via `SplitSubgraphsTracked`.
- Isolated tree edges and member nodes are restored cleanly.
- Intermediate routing progress is broadcast via optional observer callbacks. If an observer throws an error, the pipeline catches it, completely rolls back node ownership and edge points, and rethrows the exact error object.

### 4. Finishing dependencies and Slice 48 boundary
Slice 47 included small finishing dependencies needed by standalone `RouteEdges`, including guarded balancing, duplicate ordering, and shape-border tracing. Slice 48 completes and audits the whole routing subsystem. Full labeling and quality candidate ranking remain deferred to Slice 49.

## Verification
- Comprehensive Go oracle fixture validation in `d2layouts/d2talalayout/internal/routing/go_slice47_routing_core_oracle_test.go`.
- Generated reference fixture `d2layouts/d2talalayout/js/test/fixtures/go-slice47-routing-core-reference.json`.
- Unit tests in `d2layouts/d2talalayout/js/test/unit/routing-core-oracle.test.js` covering 24 scenarios: RouteEdges parity, RouteGraph parity, deterministic $W$/$W-1$ work budgets, out-of-order flavor execution, observer error rethrows, and multi-subgraph atomic rollback.
