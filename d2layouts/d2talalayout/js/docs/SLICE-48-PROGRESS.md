# Slice 48 Progress — Routing Finishing and Oracle Verification

Status: **Implemented — awaiting review**

Base Commit: `1206bf6edf1680307291a58820742d0bbe73d6f4`

Pinned Go Authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

See ADR-049 for architectural decisions and interface contracts.

## Implemented

### 1. Edge Simplification (`src/routing/edge-simplify.js`)
- Ported from `internal/routing/edge_simplify.go`.
- `SimplifyEdgeRoutes` / `simplifyEdgeRoutesWithLimit` / `simplifyPoints`.
- Five-point Z-pattern reduction, orthogonal segment intersection, non-related node obstruction checks, and edge crossing validation.
- Preserves exact scan/restart order and route-point identity.
- Atomic rollback on budget exhaustion via `runAtomicRouteStage`.

### 2. Port Swapping (`src/routing/swap-ports.js`)
- Ported from `internal/routing/swap_ports.go`.
- `SwapAllEdgePorts` / `swapAllEdgePortsWithWorkLimit` / `swapEdgePortsGuarded`.
- Same-side crossing resolution (`swapEdgesOnSameSide`), adjacent-side corner crossing resolution (`swapEdgesOnAdjacentSides`), and straight-line candidate refinement (`refineEdgeGuarded`, `makeStraightLineGuarded`).
- Exact shape classification: `isEdgeUShaped`, `isEdgeSShaped`, `isEdgeLShaped`.
- Guaranteed rollback of points and arrays at $W-1$.

### 3. Port Interior Balancing (`src/routing/port-interior-balance.js`)
- Ported from `internal/routing/port_interior_balance.go`.
- `balancePortInteriorsGuarded`, `copyRoutePoints`, `changedRouteIsClear`.
- Reuses canonical `hasFixedBalancingPorts` from `postprocess-balance.js`.
- Safely balances interior port corridors without moving fixed approach segments or intersecting obstacles.

### 4. Post-Processing Stages (`src/routing/postprocess.js`)
- Ported from `internal/routing/postprocess.go`.
- `BalanceEdgeSegments` / `balanceEdgeSegmentsWithLimit` / `balanceEdgeSegmentsGuarded`.
- Calls `balanceRegularEdgesGuarded` followed by `balancePortInteriorsGuarded`.
- `FixClusterEdgeBranching` / `fixClusterEdgeBranchingWithLimit` / `fixClusterEdgeBranchingGuarded` for cluster boundary branching corrections.
- Atomic stage integration with full rollback on budget exhaustion or cancellation.

### 5. Channel Nudging (`src/routing/nudge-channels.js`)
- Ported from `internal/routing/nudge_channels.go`.
- `NudgeEdgeChannels` / `nudgeChannelsWithLimit` / `nudgeChannelsGuarded`.
- Channel group construction, problem matrix formulation, and coordinate gap solving (`channelGroup`, `channelArc`, `channelProblem`, `solveChannelGap`).
- Quality evaluation via `quality.Inspect` to guarantee safe channel adjustments.
- Gracefully absorbs work-limit errors while strictly propagating cancellation and invalid input errors.

### 6. Route Shortcutting (`src/routing/shortcut-routes.js`)
- Ported from `internal/routing/shortcut_routes.go`.
- `ShortcutEdgeRoutes` / `shortcutRoutesWithLimit` / `shortcutRoutesGuarded`.
- Staircase / bend shortcutting (`shortcutCandidate`, `shortcutCandidateSafe`, `shortcutOrthogonal`).
- Safe wall clearance and parallel clearance checks using obstacle and label bounding boxes.
- Gracefully absorbs work-limit errors after atomic rollback; propagates cancellation.

### 7. Coordinator Finishing Entry Points (`src/routing/coordinator.js`)
- `StraightEdgesFallback` / `straightEdgesFallbackFrom` / `tryStraightEdgeFallback`.
- `ReorderDuplicates` / `reorderDuplicatesInEdges`.
- `Crosshatch` / `crosshatchWithWorkLimit` / `convertToStraightLineGuarded`.
- Exact identity and routing cost restoration on failure.

### 8. Shape Border Perimeter Tracing (`src/routing/trace.js`, `src/shape/perimeter*.js`)
- Exact border intersection calculation for non-rectangular node shapes (Circle, Oval, Cylinder, Diamond, Cloud, C4Person, etc.).
- Truncates float32 and rounds coordinates matching Go `shape.TraceToShapeBorder`.

### 9. Minimal Quality Inspection Dependency (`src/quality/`)
- `inspection.js`: `Inspect`, `inspectWithLimit`, `Metrics` (`NodeOverlaps`, `RouteObstructions`, `TextOcclusions`, `Crossings`, `Detour`, `RouteLength`).
- `inspection-geometry.js`: `measureGeometry` for node overlaps and edge-node obstructions.
- `inspection-labels.js`: `measureLabels` for label occlusion penalties.
- `crossings.js`: `countNonSharedCrossings` for non-endpoint edge intersections.
- `evaluation-guard.js`: work-guarded evaluation budget.

## Real-Go Oracle Verification
- Pinned Go oracle generator: `internal/routing/go_slice48_routing_finishing_oracle_test.go`.
- Reference fixtures: `js/test/fixtures/go-slice48-routing-finishing-reference.json`.
- Gated by `TALA_SLICE48_ORACLE=1`; default execution verifies against fixture without modifying it.
- JS test suites:
  - `routing-finishing-oracle.test.js`
  - `routing-simplify-swap.test.js`
  - `routing-postprocess-finishing.test.js`
  - `routing-channel-shortcut.test.js`
  - `routing-finishing-coordinator.test.js`
  - `quality-inspection.test.js`
- Exact $W$ and $W-1$ boundary verification with reference-equality rollback assertions.

## Test Suite Status
- Targeted finishing suite (127 tests across 6 files): **100% PASS** (299ms).
- Full JS test suite (5,292 tests across 141 files): **100% PASS** (164.81s).
- Go routing suite (`./d2layouts/d2talalayout/internal/routing/...`): **100% PASS** (3.454s).
- Go quality suite (`./d2layouts/d2talalayout/internal/quality/...`): **100% PASS** (1.045s).

## Completeness Gate
- Production file ledger: `d2layouts/d2talalayout/js/docs/ROUTING-FILE-LEDGER.md`.
- Status: `remaining unported routing production files: NONE`.
