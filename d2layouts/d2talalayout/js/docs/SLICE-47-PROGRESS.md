# Slice 47 Progress — Routing Core and Oracle Verification

Status: **Implemented — awaiting review**

Base Commit: `d746956002c98a35bc6335cfcf3ae0ffa334dbc0`

Pinned Go Authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

See ADR-048 for the architectural decisions and interface contracts.

## Implemented
- **Route Flavor Coordinator** (`src/routing/coordinator.js`):
  - Multi-flavor route worker generation (`ShortestToLongest`, `LongestToShortest`, `Default`).
  - Strict distance-based winner selection with deterministic tie-breaking.
  - Concurrency-safe result aggregation matching Go channel receiver semantics.
  - Resource-guarded parallel edge reordering (`reorderSelectedRoutes`).
  - Straight-line and loop routing fallbacks (`routeLineChecked`, `makeLoopRoute`).
- **Standalone Router Stage** (`src/routing/standalone-router.js`):
  - `RouteEdges` / `routeEdges` with full preflight geometry validation and resource limit bindings.
  - Isolated tree edge map construction and restoration.
  - Atomic transaction rollback on budget exhaustion or cancellation.
- **Graph Stage** (`src/routing/graph-stage.js`):
  - `RouteGraph` / `routeGraph` supporting multi-subgraph partitioned layout.
  - `SplitSubgraphsTracked` with node-graph ownership journal restoration.
  - Observer notifications on completed subgraph routing with exact error rethrow on observer throw.
  - Atomic multi-subgraph rollback ensuring no partial mutations persist on error.
- **Topology and Geometry Extensions**:
  - `Node` Box delegation (`center`, `Center`, `intersections`, `Intersections`, `intersects`, `Intersects`).
  - `Node` Port and orientation helpers (`ports`, `Ports`, `portsByOrientation`, `PortsByOrientation`, `centerPorts`, `CenterPorts`, `mirroredPorts`, `MirroredPorts`, `overlappingPorts`, `OverlappingPorts`, `orientation`, `Orientation`, `orientationAtPoint`, `OrientationAtPoint`).
  - `Graph` subgraph utilities (`TreeEdgeMap`, `AddIsolatedTreeEdges`, `SplitSubgraphs`, `SplitSubgraphsTracked`).
  - `loops.Route` alias exported for routing loop integration.

## Real-Go Oracle Verification
- Go generator & test suite: `internal/routing/go_slice47_routing_core_oracle_test.go`.
- Reference fixtures: `test/fixtures/go-slice47-routing-core-reference.json`.
- Comprehensive JS oracle test suite: `test/unit/routing-core-oracle.test.js` (24 test suites, 245 assertions, 100% PASS):
  - `RouteEdges` parity: empty, straight-edge, chain, cycle, l-route, s-route, obstacle-detour, parallel-edges, nested-containers, cluster-ports.
  - `RouteGraph` parity: zero-edge, single-subgraph, multi-subgraph, near-linked-graph, existing-complete-routes, force-reroute-existing, partial-routes-rejected, subgraph-observer-error.
  - Deterministic $W$ and $W-1$ work budget parity for both `RouteEdges` and `RouteGraph`.
  - Out-of-order flavor execution and aggregate work limits.
  - Observer error throwing and multi-subgraph atomic rollback.

## Test Suite Status
- Targeted routing suite (151 tests across 7 files): **100% PASS**.
- Full JS test suite (5,165 tests across 135 files): **100% PASS**.
- Go routing suite (`./d2layouts/d2talalayout/internal/routing/...`): **100% PASS**.
