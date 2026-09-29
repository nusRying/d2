# ADR 010: GraphState Exact Snapshot and Rollback

## Date
2026-09-30

## Status
Implemented — awaiting Slice 09 review

## Context
TALA relies on bounded speculative trials and layout exploration stages (such as sequence discovery and placement in `grouping.AddSequences`, cluster formation, and tree extraction). When a speculative trial fails, violates layout invariants, or is superseded, the graph state must be restored completely and atomically to its exact prior state.

In Go TALA, this rollback substrate is provided by `layoutgraph.GraphState` and its associated operations `NewGraphStateSnapshot`, `UpdateWithWorkGuard`, and `RestoreGraphState` (`internal/layoutgraph/transaction_snapshot.go` and `internal/layoutgraph/transaction.go`).

### Why GraphState is Separate from Transaction
Go TALA groups `GraphState` and `Transaction` in the same package, but their concerns are orthogonal:
- `GraphState` provides identity-preserving exact snapshot capture and rollback of the graph, nodes, edges, subgraphs (clusters, sequences, trees), routes, and ownership maps.
- `Transaction` provides high-level speculative candidate evaluation, spatial sweep overlap validation (`existingOverlaps`, `existingExactOverlaps`), dirty node tracking, and placement cost accumulation.
Crucially, downstream stages like `grouping.AddSequences` do **not** use `Transaction` validation; they directly capture a `GraphState` snapshot before sequence discovery and roll back via `layoutgraph.RestoreGraphState(graph, state)` if sequence formation fails. Coupling `GraphState` with `Transaction` would bloat the slice scope with unrelated spatial sweep and candidate validation algorithms.

## Decisions

### 1. Go Slices vs JavaScript Arrays
In Go, `exactSliceSnapshot` captures both the slice header and the full backing array up to capacity. In rollback, copying back into `original[:cap(original)]` restores length, capacity, and elements without altering the underlying memory address.

JavaScript `Array` objects do not have separate capacity headers. In JavaScript:
- The exact equivalent of Go slice identity is **the original JavaScript `Array` object instance (`===` identity)**.
- Rollback restores that array **in place**:
  - `original.length = snapshot.values.length;`
  - elements copied back via a bounded indexed loop.
- Rollback **never** reallocates a new array (`[...values]` or `slice()`), ensuring all external aliases continue referencing the original array instance.

### 2. Map and Set Identity Preservation
- For `Map` instances (`Containers`, `Clusters`, `Sequences`, `Trees`, `NodeToTree`, `Hubs`, `Directions`, `CommonUncleSiblings`):
  Rollback calls `original.clear()` and re-populates the original map instance with snapshot entries.
- For nested Map-of-Arrays (e.g., `Containers` and `Trees`):
  Both the parent Map and each child Array retain their original object identities and are restored in place.
- For `Set` instances (`node.Nears`, `herd.sameSidePaired`, `herd.oppositeSidePaired`):
  Rollback calls `original.clear()` and repopulates the original set instance.
- Preserves `null` vs `Map(size=0)` distinction: nullable collections (like `CommonUncleSiblings`) remain `null` if captured as `null`, without artificial coercion into empty maps.

### 3. Pointer Snapshot Translation (Point, Label, Icon)
- In Go, `pointerSnapshot[T]` preserves the pointer address and overwrites `*s.pointer = s.value`.
- In JS, `snapshotPoint`, `snapshotLabel`, and `snapshotIcon` retain references to the original object instances and restore their properties in place (`X`, `Y` on `Point`; `Text`, `Width`, `Height`, `_positionFixed` on `Label`; `Position`, `_positionFixed` on `Icon`).
- If an object reference was replaced during mutation (e.g., `node.TopLeft = new Point(...)`), rollback reassigns the original object reference back to the owner node.
- Primitive pointers in Go (`D2ID`, `FontSize`, `DesiredWidth`, `DesiredHeight`, table column indices) are mapped directly to JavaScript primitive values, and their values are restored faithfully without artificial wrappers.

### 4. Box Representation Identity
In Go, `geo.Box` is embedded by value in `Node` (`type Node struct { geo.Box ... }`). Its storage address in memory remains strictly stable across struct rollback (`*node = s.value`).
In JavaScript, `node.Box` is a separate object instance (`this.Box = new Box(null, width, height)`), and `TopLeft`, `Width`, `Height` forward to `node.Box`.

**Review correction:**
An initial implementation only restored geometry through the currently attached `node.Box` and therefore failed replacement-object rollback (e.g. `node.Box = new Box(...)`).
GraphState now explicitly captures `originalBox: node.Box` in topology snapshots and `box: n.Box` in geometry-only snapshots, and reattaches `node.Box = originalBox` during rollback *before* restoring `TopLeft`, `Width`, and `Height`. This guarantees:
- `node.Box === originalBox`
- `node.TopLeft === originalTopLeft`
- `node.Width === originalWidth`
- `node.Height === originalHeight`
preserving the representation mapping: **Go embedded-field address stability → JS Box object identity**.

### 5. Edge.Style Shallow Struct Value Semantics
In Go, `edgeSnapshot.value = *edge` copies `Edge.Style` as an `EdgeStyle` struct value. In Go's type definition, `EdgeStyle` contains pointer fields (`Stroke *StyleScalar`, `Fill *StyleScalar`, etc.). The snapshot therefore copies top-level struct values and pointer addresses, but shares the pointed `StyleScalar` targets.

JS GraphState maps this by:
- Preserving the original `edge.Style` object reference (`edge.Style === originalStyle`);
- Capturing a shallow copy of its own top-level fields (`fields: { ...edge.Style }`);
- Restoring top-level fields onto the original Style object and pruning newly added properties;
- **Not** deep-copying pointed `StyleScalar`-like objects (e.g., in-place mutation to `originalStroke.Value` remains intact, matching Go pointer target sharing).

**Distinction from cloneGraph:**
- In `cloneGraph()`, `copyEdgeStyle()` performs deep property-by-property cloning of `EdgeStyle` to produce a completely isolated cloned style instance for the cloned graph.
- In `GraphState`, `captureEdgeStyle()` performs a shallow struct snapshot on the live edge's Style object to match Go's struct-value copy and pointer-sharing rollback semantics.

### 6. Read-Only Hierarchy Capture and Null Preservation
In Go, `Hierarchy.level` is private and `Hierarchy.Levels()` lazily allocates a new map if `level == nil`. Pinned Go GraphState capture and rollback directly access `hierarchy.level` and never call `Levels()`.

In JavaScript:
- GraphState snapshot collection (`collectRuntimeObjectsContext` and `captureHierarchy`) inspects the raw `hierarchy.levels` property and never calls `Levels()`, ensuring snapshot capture remains strictly read-only.
- If `hierarchy.levels` was explicitly `null` (e.g. via `hierarchy.ReplaceLevels(null)`), capture does not allocate an empty map; `hierarchy.levels` remains `null` before, during, and after rollback.
- Similarly, `cloneGraph()` inspects `srcHierarchy.levels` directly without calling `Levels()`. If `srcHierarchy.levels` is null, the cloned hierarchy receives a fresh empty level map per `NewHierarchy()`, but `sourceHierarchy.levels` remains unmutated (`null`).

### 7. Runtime Reachability and Hidden Objects
`collectRuntimeObjectsContext` traverses all objects reachable from:
- `Graph.Nodes` and `Graph.Edges`
- `Graph.Containers` (keys and values)
- `Graph.Clusters` (vessels and clusters, including nodes and edge abductions)
- `Graph.Sequences` (vessels and sequences, including nodes and edge abductions)
- `Graph.Trees` (keys and tree hierarchies)
- `Graph.NodeToTree`
- `Graph.Hubs`
- `Graph.CommonUncleSiblings`
- `Graph.Directions`
- Node references: `Container`, `Nears`, `LongDistanceNeighborRequirements`, `Edges`, `Cluster`, `Sequence`, `HerdAssignment`, `Hierarchy`
- Edge references: `From`, `To`
- Tree references: `Node`, `SentinelEdge`, `Parent`, `Children`
- EdgeAbduction references: `Edge`, `OriginallyFrom`, `OriginallyTo`, `CurrentFrom`, `CurrentTo`
- HerdAssignment references: `sameSidePaired`, `oppositeSidePaired`
- Hierarchy references: `levels` keys

This ensures that hidden runtime objects (e.g. nodes temporarily removed from `Graph.Nodes` during grouping or tree operations) are captured and restored with full fidelity.

### 8. WorkGuard Step Ordering
In `collectRuntimeObjectsContext`, `guard.Step()` is invoked **before** nil checks and duplicate/already-seen checks for all discovery queues (`addNode`, `addEdge`, `addCluster`, etc.). This guarantees identical bounded-work accounting to Go, charging exactly 1 work unit per traversal encounter.

### 9. Topology Rollback Order
Topology rollback follows Go's exact sequence:
1. Graph-level snapshot (`IsRootHierarchy`, `Nodes`, `Edges`, `CellSize`, Maps)
2. Clusters
3. Sequences
4. Trees
5. EdgeAbductions
6. HerdAssignments
7. Hierarchies
8. Edges
9. Nodes

### 10. Geometry-Only Mode vs Topology Mode
- `CaptureTopology = false`: Only restores node position (`TopLeft`) and dimensions (`Width`, `Height`), cluster arrangement/padding, tree orientation, and `Graph.Nodes` array elements. Does not restore topology map membership.
- `CaptureEdgeRoutes = true` (in geometry mode): Restores `edge.Points` array identity and coordinates for all edges connected to geometry nodes.
- `CaptureTopology = true`: Always captures and restores all edge route points and fields, regardless of the `CaptureEdgeRoutes` flag (matching Go's `captureRuntimeStateContext` architecture).

### 11. GraphState vs Clone Semantics
- In `cloneGraph()`, `Label._positionFixed` and `Icon._positionFixed` are reset to `false`, matching Go's clone behavior.
- In `GraphState`, pointer snapshots preserve and restore `_positionFixed` exactly to its captured value.
- `HerdAssignment`, `LoopOffsets`, and `LongDistanceNeighborRequirements` are **not** cloned by `cloneGraph()`, and `CommonUncleSiblings` is reset to `null`. In `GraphState`, they are fully captured and restored.

### 12. Minimal State Holders and Method Parity
- `LongDistanceNeighborRequirements`: record type (`EdgeCount`, `MaxWidth`, `MaxHeight`, with struct-value copying).
- `HerdAssignment`: `oppositeSidePaired` (Set), `sameSidePaired` (Set), `Orientation` (default `Orientation.TopLeft = 0`), `Val = 0`, pair methods. In Go, `assignment.sameSidePaired[node] = struct{}{}` allows `nil` node map keys; JS parity removes null filtering in `PairSameSide` and `PairOppositeSide` (`Set.add(node)` accepts `null`).
- `Hierarchy`: `levels` (Map), `LevelCount = 0`, `Levels()`, `ReplaceLevels()`.
- `Icon`: `Position = null`, `_positionFixed = false`, `PositionFixed()`, `FixPosition()`.
- `Graph`: `CommonUncleSiblings = null`.
- `Node`: `HerdAssignment = null`, `LoopOffsets = null`, `LongDistanceNeighborRequirements = null`.

### 13. Fixture Metadata and Constants Parity
- The reference generator `test/reference/go_graph_state_oracle.go` exports runtime platform metadata (`runtimeGoVersion`, `runtimeGOOS`, `runtimeGOARCH`, `d2BaseCommit`, `referencePackage`) and limits constants (`MaxEngineNodes`, `MaxEngineEdges`, `MaxEngineWorkUnits`).
- The test suite `test/unit/graph-state-oracle.test.js` strictly asserts these metadata fields and constants against the pinned upstream commit (`01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`) and JS engine limits.

### 14. Browser Safety and Determinism
- Pure JavaScript using standard built-ins (`Array`, `Map`, `Set`, `BigInt`, `Number`).
- Zero Node.js runtime dependencies (`fs`, `path`, `Buffer`, `process`, etc.).
- Zero RNG consumption (`Math.random` count: 0).

## Consequences
- `GraphState` provides a deterministic, identity-preserving rollback substrate.
- Upcoming stages, specifically `grouping.AddSequences`, have the trustworthy foundation required for sequence trial rollbacks.
- Slices 01–08 remain 100% green and intact.
