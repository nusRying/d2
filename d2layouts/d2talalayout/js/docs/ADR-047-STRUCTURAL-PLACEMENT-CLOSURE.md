# ADR-047: Structural Placement Closure

## Status
Accepted

## Context
Slice 46 closes the structural side of TALA, so routing (Slices 47–48) can run against a fully placed graph. It ports the pinned Go packages `internal/hierarchy`, `internal/trees`, `internal/packing` and `internal/loops`. It also ports the remaining placement algorithms and stage wrappers, `placeNodes`/`Place`, and the dependency-safe preprocessing `Place` needs (`Prepare`, `JoinDistancedClusters`, `graphbounds`, the minimal label model, and the nodeshape port/label-preference subset).

Pinned Go authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Decisions

### Module layout
| JS module | Pinned Go |
|---|---|
| `src/hierarchy/*` (one file per Go file + `structural.js`, `constants.js`, `layoutgraph-support.js`) | `internal/hierarchy/*.go` |
| `src/trees/*` | `internal/trees/*.go` |
| `src/packing/*` (+ `combine-topology.js`, `cluster-geometry-support.js`, `go-support.js`) | `internal/packing/*.go`, `layoutgraph.validateCombineNodeTopology`, `Cluster.SyncGeometryWithWork` |
| `src/loops/*` (incl. `Route`) | `internal/loops/*.go` |
| `src/graphbounds/*` | `internal/graphbounds/bounds.go` |
| `src/labeling/model.js` | `labeling.Initialize` + label-position preferences only |
| `src/shape/ports.js`, `label-preferences.js`, `table-ports.js`, `src/geometry/bezier.js` | nodeshape snap points, port indices, label tiers, table ports; `lib/geo` Bezier |
| `src/placement/{alignment,direct,swap,equidistance,dejitter,symmetry,stage-wrappers,stage-support}.js` | the same-named `internal/placement/*.go`; `Align`/`Swap` from `stages.go` |
| `src/placement/container-orientation.js` | `container_orientation.go` |
| `src/placement/structural-placement.js` | `node_placement.go` (`placeNodes`, `placeNodesOrthogonally`) and `stages.go` (`Place`, `Prepare`) |
| `src/grouping/join.js` | `grouping/join.go` |
| `src/graph/structural-access.js` | layoutgraph `*_access.go`, `node_graph_ownership.go`, `segment_crossing.go`, `abductEdges`/`restoreEdgeAbductions`/`applyEdgeAbductions`, `splitSubgraphsWithOwnership`, `CopyEntitiesFrom`, `UpdateSpacing`/`ComputeNodeSpacing`, guarded distance clusters, `WouldOverlapWithWorkGuard` |
| `src/geometry/go-math.js` | Go `math.Hypot`, `math.Pow(x, 2)`, `math.Max`/`Min`, `Frexp`/`Ldexp` |

New layoutgraph behavior lives in free functions (`structural-access.js`) rather than as new class members, so the approved Slice 1–45 classes stay unchanged. None of the new internals are exported from `src/index.js` or `src/placement/index.js`; `placement-api-boundary.test.js` enforces this.

### Place ownership contract
`place(ctx, graph, seed)` follows the pinned sequence exactly:
1. Save the prior `CommonUncleSiblings`.
2. Set `CommonUncleSiblings = commonUncleSiblings(graph)`.
3. Call `snapshotNodeGraphOwnership`, which walks the runtime topology under the `NodeGraphOwnershipSnapshot` guard.
4. Call `orientationContext`.
5. Call `placeNodes`.
6. Point every node and descendant's `Graph` at the final graph.
7. Call `ComputeCellSize`, then `ResetTurnCost`.

On success `CommonUncleSiblings` becomes `null`. On any failure, including a thrown non-Error ("panic"), a `finally` block restores every snapshotted owner and the prior `CommonUncleSiblings` by identity. Geometry is not rolled back, matching Go.

### placeNodes
`placeNodes` ports Go's defers as one `finally` that runs in Go's LIFO order: split-ownership journal restore, then abduction restore with `setGraphReference`, then the ancestor-obstacle translation undo.

- **Single-node path:** sets `TopLeft` to a copy of `FixedTopLeft`, or `(0,0)`. It then runs `SyncNestedGeometry`, `trees.place` and `direct`, and never the optimizers.
- **General path:**
  1. `abductEdges` and `placeChildrenOrder`, then recurse into containers (and into containers inside clusters), calling `updateOffsets` after each.
  2. `assignNears`/`assignHerds`, then `splitSubgraphsTracked`.
  3. For each subgraph: a `GoRand(seed)` per subgraph, `placeNodesOrthogonally`, `optimizeCluster`, `trees.place`, re-adding tree nodes and sentinel edges, and sharing the root container slice.
  4. `direct` with the abductions temporarily restored.
  5. `combineSubgraphs`, `orientSourceInterior`, then root fitting.

`placeNodesOrthogonally` keeps Go's iteration counts:
- `int(90·√n)` iterations, cooling `(0.2/temp)^(1/iterations)`, and compaction every 9th iteration on alternating axes.
- The even-seed path uses `initializeByGraphDistance`.
- Cell-grid snapping, `TurnCost` then `HalveTurnCost`, the sized optimizer, and `JoinDistancedClusters` every 9th sized iteration plus once at the end.
- At most 10 zero-temperature passes, then fixed-node restoration.

### Context values
Go's `context.WithValue(ctx, containerOrientationDisabled{}, true)` becomes a `TransactionWorkContext`. It forwards `Err` and the request transaction guard unchanged and carries an own property. Lookups walk `_parent`, so later derived transaction contexts still see the flag.

### ctx.Err() parity
Go calls `ctx.Err()` exactly once per check. Three earlier ports polled `isCancelled` instead, so counting contexts never cancelled them and Err-call counts drifted:
- `PlaceChildrenOrder` (Slice 40)
- `AssignHerds`/`GroupSheep` (Slice 37)
- `initializeByGraphDistance` (Slice 43)

All three now call `getContextError` once per pinned check. Errors keep the Go `cause`: `AssignHerds:`/`PlaceChildrenOrder:` wrapping, and the raw context error for stress initialization.

- **AssignHerds nil context:** still throws, as Go panics on a nil context.
- **Stress initialization with a polling-only context:** still raises the canonical `AbortError`.

The structural oracle pins exact Err-call counts for every probed `Place` scenario; this is how the gaps were found.

### Other shared parity corrections found by the Slice 46 oracles
- **`placementcost.containerAlignmentCost`** called `isContainer()` on the boolean field, so it threw for any graph with two or more nodes. It also read an uncomputed `nonCenterPortCost`. `Graph.nonCenterPortCostValue()`/`NonCenterPortCost()` now ports Go's lazy, cached computation, and the scorer uses `IsContainer()`.
- **`Node.tableColumnPortValue`** invented side ports for non-table shapes, where Go returns `ok=false`, and used `Math.round`. It now delegates to the exact nodeshape port in `shape/table-ports.js`.
- **Go `math.Hypot`** (`p·√(1+(q/p)²)`) and **`math.Pow(x, 2)`** (Frexp/Ldexp squaring) now come from `geometry/go-math.js`. They are used in stress initialization, flow continuity, placement candidate counts, and oval geometry.
- **Not ported: `math.Pow` with a fractional exponent.** On amd64 it goes through `math.Exp`/`math.Log` assembly whose FMA path depends on CPU features, so pinned Go is not bit-stable across machines there. JS keeps `Math.pow` for those two sites: the cooling factor and the stress step size. Every oracle scenario matches.

### Nondeterminism in pinned Go (documented, not compared)
- **`abductEdges`** seeds candidate abductions from the `Clusters`/`Sequences` maps. JS uses Map insertion order; the order matters only when several unused abductions match one container abduction.
- **`placeNodes` cluster resize** ranges over `g.Clusters` (order-independent).
- **Transaction `Commit`** loops over `Graph.Containers`. When a cancellation lands there, which check reports it depends on map order. The stages oracle marks such probes `errorVaries`; JS accepts either message while still checking cancellation and rollback exactly.
- **BalanceSymmetry** builds its adjacency from a map. Scenarios use exactly two adjacents, which makes the outcome order-independent.
- **Hierarchy:** `findCycleEdges` work steps, the fixed-member scan in `placeNodesInHierarchy`, and `PlaceCompound`'s `NodeToTree` scan. The packages' own oracles keep probe scenarios clear of order-dependent counts.
- **Trees:** `buildPlacementTrees` merges undirected roots into the first-seen group on a child-count tie. Scenarios avoid that tie.
- **Parallel `EdgeLength`** for graphs with more than 10 nodes interleaves context checks. Probe scenarios have at most 10 nodes; larger graphs pin geometry only.

### Known representation differences
- JS has a single throw channel. Errors Go *returns* and Go panics both become throws; messages and `cause` chains match. Hierarchy tags Go-returned errors so `rankDAG` wraps only those.
- Go `GraphState` charges work per `cap(edge.Points)`; JS arrays have no spare capacity, so JS charges per length. Oracle builders allocate exact-capacity routes in Go.
- Go nil slices and maps become `[]`, `null`, or an empty `Map`, as documented per module. `LoopOffsets` is a `Map` keyed by Orientation.

### Real-Go oracles
All are gated by `TALA_SLICE46_ORACLE=1`. Plain `go test` recomputes and asserts the committed fixture byte for byte (CRLF normalized).

| Go oracle | Fixture | JS replay |
|---|---|---|
| `internal/placement/go_slice46_structural_oracle_test.go` | `go-slice46-placement-reference.json` | `structural-placement-oracle.test.js` |
| `internal/placement/go_slice46_stages_oracle_test.go` | `go-slice46-placement-stages-reference.json` | `placement-stages-oracle.test.js` |
| `internal/hierarchy/go_slice46_hierarchy_oracle_test.go` | `go-slice46-hierarchy-reference.json` | `hierarchy-oracle.test.js` |
| `internal/trees/go_slice46_trees_oracle_test.go` | `go-slice46-trees-reference.json` | `trees-oracle.test.js` |
| `internal/packing/go_slice46_packing_oracle_test.go` | `go-slice46-packing-reference.json` | `packing-oracle.test.js` |
| `internal/loops/go_slice46_loops_oracle_test.go` | `go-slice46-loops-reference.json` | `loops-oracle.test.js` |
| `internal/graphbounds/go_slice46_graphbounds_oracle_test.go` | `go-slice46-graphbounds-reference.json` | `graphbounds-oracle.test.js` |
| `internal/labeling/go_slice46_label_model_oracle_test.go` | `go-slice46-label-model-reference.json` | `label-model-oracle.test.js` |

## Scope Boundaries
Deferred: routing (Slices 47–48), full label placement and quality scoring (Slice 49), and the engine pipeline and public `layout()` API (Slice 50).
