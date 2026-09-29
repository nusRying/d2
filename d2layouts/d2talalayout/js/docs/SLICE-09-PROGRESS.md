# Slice 09 Progress — GraphState Exact Snapshot and Rollback

## Goal
Port the rollback-state substrate required by topology-changing TALA stages (such as `grouping.AddSequences`) with exact Go behavior, identity preservation, and WorkGuard accounting:
- `GraphStateSnapshotOptions`
- `GraphState`
- `NewGraphStateSnapshot` / `newGraphStateSnapshot`
- `GraphState.UpdateWithWorkGuard`
- `RestoreGraphState`
- Exact in-place Array restoration
- Exact Map and Set restoration
- Pointer and object-value preservation (`Point`, `Label`, `Icon`)
- Runtime object reachability traversal (`collectRuntimeObjectsContext`)
- Full topology snapshot and rollback
- Geometry-only snapshot and rollback
- Edge route capture and restoration
- Minimal state-holder types (`HerdAssignment`, `Hierarchy`, `LongDistanceNeighborRequirements`, `Icon`)
- Clone compatibility verification for new state holders

## Approved Slice 08 Base
- Head SHA: `0b3dbacace1b1d7664c4a25d7cd2671ae5be4338`
- Branch base: `tala-js/slice-08-workguard`

## Pinned Reference
- Commit: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`
- Repository: `https://github.com/nusRying/d2`

## Environment
- Go version: `go1.27.0 windows/amd64`
- Host OS: Windows 11
- Architecture: `amd64`
- Runtime: Bun `v1.3.14`

## Go Files Studied
1. `internal/layoutgraph/transaction_snapshot.go` — primary snapshot structures, `exactSliceSnapshot`, `exactSliceMapSnapshot`, pointer snapshots, `collectRuntimeObjectsContext`, `captureRuntimeStateContext`, `captureGeometryStateContext`.
2. `internal/layoutgraph/transaction.go` — `GraphState` struct definition, `updateContext`, `recordDescendants`, `recordNode`, `Rollback()`.
3. `internal/layoutgraph/hierarchy_access.go` — `NewGraphStateSnapshot`, `UpdateWithWorkGuard`, `OwnedNodes`.
4. `internal/layoutgraph/structure_api.go` — `RestoreGraphState`, `HerdAssignment` pair methods.
5. `internal/layoutgraph/graph_state_test.go` — test helper for `UpdateWithWorkGuard`.
6. `internal/layoutgraph/atomicity_p1_test.go` — `TestTopologyRollbackRestoresEveryExactSliceBacking`.
7. `internal/layoutgraph/transaction_resource_test.go` — `TestGraphStateChargesLongDistanceNeighborOnce`.
8. `internal/layoutgraph/graph.go` — `Graph` struct, nullable `CommonUncleSiblings`, maps.
9. `internal/layoutgraph/node.go` — `Node` struct, `NewNode` defaults, nullable `HerdAssignment`, `LoopOffsets`, `LongDistanceNeighborRequirements`.
10. `internal/layoutgraph/edge.go` — `Edge` struct, points, labels, style.
11. `internal/layoutgraph/cluster.go` — `Cluster` struct, `ClusterArrangement` (Column, Row).
12. `internal/layoutgraph/sequence.go` — `Sequence` struct.
13. `internal/layoutgraph/tree.go` — `Tree` struct.
14. `internal/layoutgraph/layout.go` — `EdgeAbduction` struct, stable ordering functions.
15. `internal/layoutgraph/herding.go` — `HerdAssignment` struct.
16. `internal/layoutgraph/hierarchy.go` — `Hierarchy` struct.
17. `internal/layoutgraph/neighbor_requirements.go` — `LongDistanceNeighborRequirements` struct.
18. `internal/layoutgraph/label.go` — `Label` struct, `PositionFixed()`, `FixPosition()`.
19. `internal/layoutgraph/icon.go` — `Icon` struct, `PositionFixed()`, `FixPosition()`.
20. `internal/layoutgraph/clone.go` — clone semantics vs rollback semantics.
21. `internal/grouping/sequences.go` — downstream consumer usage in `AddSequences`.

## Scope Analysis & Exclusion of Transaction
- **In Scope:** `GraphStateSnapshotOptions`, `NewGraphStateSnapshot`, `UpdateWithWorkGuard`, `RestoreGraphState`, exact slice/map snapshot helpers, pointer snapshots, runtime reachability, WorkGuard accounting, minimal state holders (`HerdAssignment`, `Hierarchy`, `LongDistanceNeighborRequirements`, `Icon`).
- **Explicitly Excluded:** `Transaction`, `Commit`, `UpdateState`, candidate overlap sweeping (`existingOverlaps`, `existingExactOverlaps`), spatial sweep padding, placement cost snapshots, sequence discovery (`AddSequences`), clustering algorithms, routing algorithms.
- **Rationale:** `grouping.AddSequences` relies solely on `GraphState` snapshot/rollback and does not interact with `Transaction` candidate validation.

## Representation Mapping

### Go Slices -> JavaScript Arrays
- Go preserves the slice header pointer and backing array.
- JavaScript `Array` instances are reference objects without exposed slice headers or separate capacity buffers.
- Mapping: The exact JS equivalent of Go's slice identity is **the original JavaScript `Array` object instance (`===` identity)**.
- Rollback restores that original array **in place**:
  - `original.length = snapshot.values.length;`
  - Elements restored via an indexed loop.
  - Never allocates a replacement array (`[...values]`) on restore.

### Go Maps -> JavaScript Maps
- Rollback clears the original Map (`original.clear()`) and repopulates it with captured entries.
- Retains original Map references even if the property on `Graph` or `Node` was reassigned.
- Preserves `null` vs `Map(size=0)` distinction: nullable collections (such as `CommonUncleSiblings` and `LoopOffsets`) restore to `null` if original was `null`.

### Pointer Snapshots
- For mutable objects (`Point`, `Label`, `Icon`), snapshot retains the original object reference and records its properties (`X`/`Y` for Point; `Text`, `Width`, `Height`, `_positionFixed` for Label; `Position`, `_positionFixed` for Icon).
- During rollback, properties are written directly into the original object, and if the property was reassigned on the owner node/edge, the original reference is reattached.
- Primitive pointers in Go (`D2ID`, `FontSize`, `DesiredWidth`, `DesiredHeight`, column indices) are mapped directly to JavaScript primitives.

## Minimal State-Holder Additions
1. `LongDistanceNeighborRequirements` (`src/graph/neighbor-requirements.js`):
   - Fields: `EdgeCount = 0`, `MaxWidth = 0`, `MaxHeight = 0`.
   - Has struct-value `copy()` method for map value preservation.
2. `HerdAssignment` (`src/graph/herd-assignment.js`):
   - Fields: `oppositeSidePaired = new Set()`, `sameSidePaired = new Set()`, `Orientation = Orientation.TopLeft (0)`, `Val = 0`.
   - Methods: `PairSameSide(node)`, `PairOppositeSide(node)`, `SameSidePairCount()`, `OppositeSidePairCount()`.
3. `Hierarchy` (`src/graph/hierarchy.js`):
   - Fields: `levels = new Map()`, `LevelCount = 0`.
   - Methods: `Levels()`, `ReplaceLevels(levels)`.
4. `Icon` (`src/graph/icon.js`):
   - Fields: `Position = null`, `_positionFixed = false`.
   - Methods: `PositionFixed()`, `FixPosition()`.
5. `Graph`:
   - `CommonUncleSiblings = null`.
6. `Node`:
   - `HerdAssignment = null`, `LoopOffsets = null`, `LongDistanceNeighborRequirements = null`.
   - `initIcon()` / `InitIcon()`.

## Clone Compatibility Findings
- **Hierarchy:** Cloned into a new `Hierarchy` with mapped cloned nodes, but `LevelCount` is NOT copied (remains 0, matching Go `clonedHierarchy := &Hierarchy{level: levels}`).
- **HerdAssignment:** NOT cloned (remains `null` on cloned nodes, matching Go `copyNodeRecord`).
- **LoopOffsets:** NOT cloned (remains `null`).
- **LongDistanceNeighborRequirements:** NOT cloned (remains `null`).
- **CommonUncleSiblings:** Reset to `null` on cloned graph (matching Go `state.clone.CommonUncleSiblings = nil`).
- **Icon:** Position is cloned, but `_positionFixed` is reset to `false` (matching Go `copyIconRecord` semantics).
- **Distinction from GraphState:** `GraphState` preserves and restores `Label._positionFixed` and `Icon._positionFixed`, whereas `cloneGraph` intentionally resets them.

## WorkGuard Accounting & Runtime Traversal
- `collectRuntimeObjectsContext` explores nodes, edges, containers, clusters, sequences, trees, edge abductions, herds, and hierarchies.
- `guard.Step()` is invoked **before** nil and duplicate checks in `addNode`, `addEdge`, `addCluster`, etc., matching Go's exact accounting.
- In `TestGraphStateChargesLongDistanceNeighborOnce`, adding one long-distance neighbor requirement incurs exactly `+1` work step.

## Go Oracle & Fixture
- Script: `test/reference/go_graph_state_oracle.go`
- Fixture: `test/fixtures/go-graph-state-reference.json`
- Canonical SHA256: `26B0BCC365D486C7465C565D01757FED4A37B4EE8C2234B9B7F9D83064F41503`
- Scenarios covered:
  1. `topology_full_rollback` (includes Box identity restoration and EdgeStyle shallow struct / pointer-target mutation parity)
  2. `exact_slice_backing`
  3. `hidden_runtime_objects`
  4. `geometry_only`
  5. `geometry_with_routes`
  6. `topology_without_routes_option`
  7. `state_reuse`
  8. `work_accounting_neighbor`
  9. `error_messages`
  10. `nil_hierarchy_levels`

## Review Findings & Parity Resolutions
1. **Box Identity Restoration:**
   - *Finding:* The initial implementation claimed Box identity restoration, but only restored geometry through the currently attached `node.Box`. If `node.Box` was replaced with a new instance after snapshotting (`node.Box = new Box(...)`), rollback failed to restore `node.Box === originalBox`.
   - *Resolution:* `captureNode()` in topology mode now captures `originalBox: node.Box`, and `nodeGeometry` in geometry-only mode records `box: n.Box`. Rollback reattaches `node.Box = originalBox` *before* setting `TopLeft`, `Width`, and `Height`.
   - *Review correction note:* GraphState now captures the original JS Box object because Go's Box is embedded storage whose address remains stable across struct rollback. Representation mapping: Go embedded-field address stability → JS Box object identity.
2. **Edge.Style Shallow Struct Value Semantics:**
   - *Finding:* `Edge.Style` was captured by direct reference. In Go, `edgeSnapshot.value = *edge` copies `EdgeStyle` as a struct value with pointer fields (`Stroke *StyleScalar`). The Go snapshot copies top-level struct fields by value, but shares pointed `StyleScalar` targets.
   - *Resolution:* Implemented `captureEdgeStyle(style)`, which preserves the original Style object reference (`edge.Style === originalStyle`), captures a shallow copy of its own top-level fields, restores top-level properties and deletes added keys upon rollback, but leaves pointed `StyleScalar` mutations intact (e.g. `originalStroke.Value = "green"` is preserved).
3. **Read-Only Hierarchy Capture & Null Preservation:**
   - *Finding:* GraphState capture (`captureHierarchy` and `collectRuntimeObjectsContext`) called `hierarchy.Levels()`, which lazily allocates `levels = new Map()` if `levels == null`, violating snapshot read-only behavior. Similarly, `cloneGraph()` called `srcHierarchy.Levels()`.
   - *Resolution:* GraphState capture and `cloneGraph()` now inspect raw `hierarchy.levels` without calling `Levels()`. If `hierarchy.levels` was `null`, capture leaves it `null` before, during, and after rollback. `cloneGraph()` clones with a fresh empty map for the target hierarchy but leaves `sourceHierarchy.levels` untouched as `null`.
4. **Oracle Metadata and Constants Consumption:**
   - *Finding:* Oracle metadata (`runtimeGoVersion`, `runtimeGOOS`, `runtimeGOARCH`, `d2BaseCommit`, `referencePackage`) and limit constants (`MaxEngineNodes`, `MaxEngineEdges`, `MaxEngineWorkUnits`) were generated in the fixture but not asserted in unit tests.
   - *Resolution:* Added strict assertions in `graph-state-oracle.test.js` validating all metadata fields against non-empty strings, `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`, `github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph`, and matching engine constants.
5. **HerdAssignment Null Key Parity:**
   - *Finding:* `HerdAssignment.PairSameSide(node)` and `PairOppositeSide(node)` filtered `null` unlike Go, where `nil` is a legal map key in `map[*Node]struct{}`.
   - *Resolution:* Removed `if (node != null)` check; `Set.add(node)` now supports `null` keys identically to Go.
6. **Exact Nullable Collections Restoration:**
   - *Finding:* Rollback fallback patterns (`this.edges ? this.edges.restore() : []`, `Containers ? ... : new Map()`) could convert an explicitly `null` source field into `[]` or `new Map()`.
   - *Resolution:* Replaced fallbacks with `snapshot ? snapshot.restore() : null`, preserving `null` state fidelity.

## Full Regression
Run with `bun test`:
- 301 pass
- 0 fail
- 8951 expect() calls
- 19 test files
- Runtime: 512.00ms

## Audits
- **Math.random audit:** 0 occurrences in `src/`.
- **Browser-safe audit:** 0 Node.js built-ins (`fs`, `path`, `Buffer`, `process`, etc.) in `src/`.
- **Performance sanity:**
  - 1,000 topology snapshots/restores: ~35ms
  - 10,000 geometry snapshots/restores: ~47ms
  - 100 topology snapshots with routes/groups: ~2.8ms

## Commit History
1. `55fba5333` — `docs(tala-js): close approved Slice 08`
2. `feat(tala-js): add GraphState runtime state holders`
3. `feat(tala-js): port GraphState snapshot and rollback`
4. `test(tala-js): add Go GraphState parity oracle`
5. `docs(tala-js): document Slice 09 GraphState`
6. `fix(tala-js): finalize GraphState identity parity`
7. `docs(tala-js): document Slice 09 review parity resolutions`
