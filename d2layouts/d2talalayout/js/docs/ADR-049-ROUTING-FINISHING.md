# ADR-049: Routing finishing and inspection dependency

## Status

Implemented — awaiting Slice 48 review

## Authority and scope

Slice 48 builds on approved Slice 47 commit `1206bf6edf1680307291a58820742d0bbe73d6f4`. Behavioral authority remains Go commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

The finishing modules port the pinned scan/restart, geometric safety, route ordering, work accounting, and cancellation rules. Existing OVG, search, coordinator routing, and standalone/graph routing implementations are reused. The coordinator gains its missing public finishing entry points. Shape-border tracing completes the existing dependency on D2 shape perimeter geometry.

## Decisions

- `edge-simplify.js`, `swap-ports.js`, `port-interior-balance.js`, `postprocess.js`, `nudge-channels.js`, and `shortcut-routes.js` implement the missing production passes.
- `hasFixedBalancingPorts` has one canonical implementation in `postprocess-balance.js`.
- Atomic stages reuse `runAtomicRouteStage`, `captureRouteMutations`, and the existing mutation snapshot. Failures restore original arrays, point objects and coordinates, curves, routing costs, captured labels, and reachable node ownership before rethrowing.
- Public channel nudging and shortcutting swallow only route-stage work-limit errors after rollback. Ordinary errors and cancellation propagate. Oversized admission remains an optional no-op after checking cancellation.
- Only the exact `quality.Inspect` kernel is included: inspection, geometry, labels, crossings, and evaluation guard. It supplies `NodeOverlaps`, `RouteObstructions`, `TextOcclusions`, `Crossings`, `Detour`, and `RouteLength` without candidate ranking.
- Production modules use browser-safe JavaScript and existing deterministic geometry/math helpers.

## Stage order

The future engine preserves pinned order: `Crosshatch`, then `SimplifyEdgeRoutes`, `SwapAllEdgePorts`, `StraightEdgesFallback`, `BalanceEdgeSegments`, `FixClusterEdgeBranching`, `TraceEdgesToShapeBorder`, `ReorderDuplicates`, and later `NudgeEdgeChannels`, `ShortcutEdgeRoutes`. This slice exposes the passes; engine integration remains Slice 50.

## Verification

The real-Go oracle `go_slice48_routing_finishing_oracle_test.go` records before/after points and exact work boundaries. Generation requires `TALA_SLICE48_ORACLE=1`; normal execution recomputes and compares the committed fixture without writing. JS tests consume the same fixture and check rollback identity at W−1. CI retains every existing Go package step and adds quality testing with generation disabled.

The production file audit is recorded in [ROUTING-FILE-LEDGER.md](ROUTING-FILE-LEDGER.md). Test totals and completed gates are recorded in [SLICE-48-PROGRESS.md](SLICE-48-PROGRESS.md).

## Deferred

Slice 49 retains full labeling and quality `Score`/`Evaluate`/`Compare`. Slice 50 retains engine, public `layout()`, final E2E and package work.
