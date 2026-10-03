# Slice 46 Progress — Structural Placement Closure

Status: **Implemented — awaiting review**

Base Commit: `e06041e795f67f717cbbf1580e8ef99b3a824c94` (Slice 45 approved)

Pinned Go: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

See ADR-047 for the decisions summarized here.

## Implemented
- **Hierarchy** (`src/hierarchy/`):
  - `candidates`, `assign`, `removeIsolatedMemberships`, `place`, `placeCompound`, `isHorizontal`.
  - Ranking: `rankDAG`/`rankDAGWithLimit` (network simplex with longest-path fallback and overflow-checked arithmetic), plus the rank graph and queue.
  - Crossing minimization, global sifting, and Brandes–Köpf alignment.
- **Trees** (`src/trees/`): `preprocess`, `place`, `descendants`.
  - Covers tree extraction, fringe/terminal handling, candidate roots, chain reversal, and reconnect.
  - Covers layout geometry, orientation transforms, edge-label positioning, and fixed origins.
- **Packing** (`src/packing/`): `pack`, `combineSubgraphs`.
  - Also ports binpack candidates and route blocking, routed-container preservation (routes are never cleared), packing and combine snapshots, and combine topology validation.
- **Loops** (`src/loops/`): `computeOffsets`, `updateOffsets`, `route`, `edgesInOrder` (with a Go `SortStableFunc` port).
- **Graph bounds** (`src/graphbounds/`).
- **Label model** (`src/labeling/model.js`): `initialize` and the default label-position preferences.
- **Nodeshape subset** (`src/shape/`): ports, label preferences, and table ports.
- **Placement stages:**
  - `alignAxes`, `alignmentDeltas`, `tryMove`, `attemptShift`.
  - The direct helpers and `direct`.
  - `swapPositions`, `smartSwapPositions`, `swapOptimize`.
  - `equidistance`, `dejitter` (returns the `forceReroute` boolean), `balanceSymmetry`, `isSimple`.
  - The `align` and `swap` stage wrappers.
- **Container orientation:** `orientationContext`, `orientSourceInterior`, `interiorFlow`, `orientationFitsContainer`, `orientationFootprintSize`.
- **Structural placement:** `placeNodes`, `placeNodesOrthogonally`, `place` (with the Go ownership contract), `prepare`.
- **Grouping:** `joinDistancedClusters`.
- **layoutgraph access helpers** (`src/graph/structural-access.js`), `Graph.nonCenterPortCostValue`, and `src/geometry/go-math.js`.

## Parity corrections to earlier slices
- `PlaceChildrenOrder`, `AssignHerds`/`GroupSheep` and `initializeByGraphDistance` now call `ctx.Err()` exactly as Go does. Each previously polled `isCancelled`.
- `placementcost.containerAlignmentCost` no longer throws and computes the non-center port cost lazily, as Go does.
- `Node.tableColumnPortValue` now returns `ok=false` for non-table shapes and uses Go rounding.
- Go-exact `Hypot` and `Pow(x, 2)` are now used where pinned Go uses them.

## Real-Go oracle groups
All oracles are gated by `TALA_SLICE46_ORACLE=1`. Plain `go test` asserts the committed fixtures.

- **placement** (`go-slice46-placement-reference.json`):
  - `Place` groups: empty, singleton (including one node with trees, and labels/multiple), fixed singleton, nested container (including container-only and self-loop orientation preflight), tree + ordinary nodes, hierarchy members, cluster, sequence, Near, Herd (hub and herd), fixed child obstacles, edge abduction, seeded determinism (small and 16-node random graphs).
  - Each stable scenario is run 3× in Go. Graphs with ≤10 nodes pin the exact `ctx.Err()` count, strided cancellation probes, and panic probes.
  - Every probe checks ownership identity and that `CommonUncleSiblings` is restored.
  - Each scenario also pins the transaction-guard W/W−1 boundary.
  - Other groups: `JoinDistancedClusters` (standalone or shared guard, fixed target, container moves, W/W−1, probes), container orientation (source down/up, loop preflight, insufficient fan-out, probes), and `Prepare` (label positions, loop offsets).
- **placement stages** (`go-slice46-placement-stages-reference.json`): 162 cases.
  - Align, Swap, direct, Equidistance, Dejitter (`forceReroute` both true and false), BalanceSymmetry, and seeded random graphs.
  - 67 W/W−1 boundaries and 88 exhaustive or strided cancellation probe sets.
- **hierarchy:** simple DAG, multiple valid ranks, long edges, crossings, fixed hierarchy, compound hierarchy, disconnected candidates, cycle handling, resource boundary, cancellation, panic rollback, seeded determinism.
- **trees:** chain, branching, multiple trees, fixed root, orientation changes, labels, container tree, preprocessing reversal, reconnect, cancellation, seeded determinism, plus W/W−1 and panic rollback.
- **packing:** disconnected components, aspect ratio, routed container, nested container, combine subgraphs, W/W−1, cancellation, panic rollback.
- **loops, graphbounds, label model:** see ADR-047.

## Test coverage
- New JS tests:
  - `hierarchy*`, `trees*`, `packing*`.
  - `placement-stages-oracle`, `placement-stage-algorithms`, `structural-placement-oracle`.
  - `loops-oracle`, `graphbounds-oracle`, `label-model-oracle`, `slice46-structural`.
- `placement-api-boundary.test.js` is extended with every new internal.
- **Full JS suite:** 123 files, 4451 tests, 0 failures.
- **Go:** all pass, including every Slice 46 fixture assertion. Packages: hierarchy, trees, packing, placement, layoutgraph, grouping, proximity, limits, placementcost, loops, graphbounds, labeling, nodeshape.
- **CI:** the Go parity job in `.github/workflows/tala-js-ci.yml` runs, as separate steps: limits, layoutgraph, placementcost, placement, proximity, grouping, hierarchy, trees, packing, loops, graphbounds, labeling, nodeshape. The real-Go oracles run in assertion mode (no `TALA_SLICE46_ORACLE`), recomputing and validating the committed fixtures.

## Explicitly out of scope (Slices 47–50)
Routing, full label placement, quality scoring, the engine pipeline, and the public `layout()` API.
