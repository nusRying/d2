# Routing production file ledger

Pinned Go authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

This inventory includes every production `internal/routing/*.go` file; Go tests and oracle generators are excluded. JavaScript paths below are relative to `js/src/routing/` unless identified as documentation. A file counts as covered when its operational kernels are implemented, including shared implementations and the language adaptations recorded below.

| Go production file | JS implementation | Go function declarations | Coverage |
| --- | --- | ---: | --- |
| `balance_crossings.go` | postprocess-balance.js | 2 | Covered |
| `balance_route_guard.go` | balance-route-guard.js | 6 | Covered |
| `cluster_route_guard.go` | cluster-route-guard.js | 2 | Covered |
| `coordinator.go` | coordinator.js, standalone-route-guard.js, route-stage.js | 38 | Covered |
| `cost.go` | cost.js | 5 | Covered |
| `doc.go` | ADR-048-ROUTING-CORE.md, ADR-049-ROUTING-FINISHING.md (package documentation) | 0 | Covered |
| `edge_simplify.go` | edge-simplify.js | 10 | Covered |
| `filter.go` | filter.js | 1 | Covered |
| `geometry.go` | geometry.js | 5 | Covered |
| `graph_stage.go` | graph-stage.js | 2 | Covered |
| `loop_router.go` | coordinator.js (makeLoopRoute) | 1 | Covered |
| `nudge_channels.go` | nudge-channels.js | 13 | Covered |
| `ovg.go` | ovg.js, ovg-go-support.js | 31 | Covered |
| `ovg_edge.go` | ovg-edge.js | 5 | Covered |
| `ovg_edge_router.go` | ovg-edge-router.js, route-guards.js | 19 | Covered |
| `ovg_edge_set.go` | ovg-edge-set.js | 9 | Covered |
| `ovg_hierarchy.go` | ovg-hierarchy.js | 9 | Covered |
| `ovg_node.go` | ovg-node.js | 24 | Covered |
| `ovg_resource.go` | ovg-resource.js | 42 | Covered |
| `port_interior_balance.go` | port-interior-balance.js, postprocess-balance.js (canonical fixed-port predicate) | 4 | Covered |
| `postprocess.go` | postprocess.js, postprocess-balance.js | 8 | Covered |
| `priority_queue.go` | priority-queue.js | 12 | Covered |
| `route.go` | route.js | 4 | Covered |
| `route_search_guard.go` | route-guards.js | 18 | Covered |
| `route_stage_guard.go` | route-stage.js, route-guards.js | 18 | Covered |
| `shortcut_routes.go` | shortcut-routes.js | 16 | Covered |
| `slingshot.go` | slingshot.js | 16 | Covered |
| `snapshot.go` | snapshot.js | 3 | Covered |
| `standalone_route_guard.go` | standalone-route-guard.js | 14 | Covered |
| `standalone_router.go` | standalone-router.js | 3 | Covered |
| `swap_ports.go` | swap-ports.js | 24 | Covered |
| `trace.go` | trace.js | 3 | Covered |
| `tree_routes.go` | tree-routes.js | 5 | Covered |
| `tuning.go` | tuning.js (constants) | 0 | Covered |
| `tunnel.go` | tunnel.js | 9 | Covered |
| `turns.go` | turns.js | 1 | Covered |
| `work.go` | work.js | 2 | Covered |

## Shared kernels and language adaptations

- `coordinator.go` goroutine response collection is implemented by sequential workers with declared-index ordering in `generateRouteFlavorResponsesWith`. JavaScript does not create Go channels or goroutines. Worker panic, cancellation, response ordering, and aggregate-budget behavior remain covered by the Slice 47 coordinator oracle tests.
- `straightEdgeFallbackRollback.captureCosts/record/restore` is represented by the approved `captureRouteMutations` snapshot boundary. The new public fallback wrapper restores routing costs and exact route identities on errors and thrown values.
- `ovg_edge_router.go` `borrowPortMap` and `returnPortMap` are Go allocation-pool plumbing. The JavaScript search kernel creates fresh value-keyed `PointValueMap` instances at the corresponding sites; no browser-side global pool is required for geometry or ownership semantics.
- `checkEdgeRoutingCanceled` and context-termination decisions are implemented through routing work guards and cancellation checks; cancellation never becomes a successful route candidate.
- `route_stage_guard.go` uses the approved shared route mutation snapshot, positioned geometry validation, cancellation-aware stable sort, and route work guard. No finishing stage introduces a separate rollback system.
- `port_interior_balance.go` reuses the canonical `hasFixedBalancingPorts` implementation in `postprocess-balance.js`.
- `nudge_channels.go` and `shortcut_routes.go` use the minimal `js/src/quality/` inspection kernel: inspection, geometry, labels, crossings, and evaluation ancestry/work helpers. This dependency does not implement quality ranking APIs.
- `doc.go` is package documentation rather than an executable kernel. `tuning.go` constants are represented in `tuning.js`.

The six Slice 48 finishing modules, public coordinator finishing wrappers, minimal quality inspection dependency, and existing routing primitives form the complete production routing subsystem. The source inventory contains no placeholder or unimplemented routing kernel.

remaining unported routing production files: NONE
