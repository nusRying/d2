# Slice 05 Progress — Preprocessing Topology Foundation

## Goal
Port the missing layoutgraph topology/group records and traversal semantics required by the first preprocessing stages.
Establish faithful JavaScript support for `Sequence`, `Cluster`, `Tree`, `EdgeAbduction`, active group membership, owning-container resolution, stable group ordering, container/cluster reverse-DFS ordering, group-aware node traversal, shape-kind predicates, and group-aware clone isolation and rebinding without yet implementing placement or grouping discovery algorithms.

## Approved Slice 04 Base
- Approved Commit: `5ab6807af54a28cebbc2ee6317c8588f51c43188`

## D2 Reference Base
- Pinned Commit: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Version
- Runtime Version: `go1.27.0` (at `C:\Program Files\Go\bin\go.exe`)

## Go Files Studied
- `internal/layoutgraph/sequence.go`: Sequence struct, `IsActive()`, `First()`, `Last()`.
- `internal/layoutgraph/cluster.go`: Cluster struct, `ClusterArrangement` ("Row", "Column"), `Flip()`, `IsActive()`.
- `internal/layoutgraph/tree.go`: Tree struct, `NewTree()`, `isSentinelEdgeSource()`, `SentinelNode()`.
- `internal/layoutgraph/layout.go`: `EdgeAbduction`, `ClusterRDFSOrder()`, `ClusterOrder()`, `TreeOrder()`, `SequenceOrder()`, `isDescendantOf()`.
- `internal/layoutgraph/graph.go`: `Containers`, `Clusters`, `Trees`, `NodeToTree`, `Sequences`, `isSequence()`, `isTreeSentinel()`, `containerRDFSOrder()`.
- `internal/layoutgraph/node.go`: `SetShape()`, `ShapeType()`, `AddNear()`, `Level()`, `rdfsWalk()`, `container()`, `isClusterVessel`.
- `internal/layoutgraph/structure_api.go`: `IsSequenceStep()`, `SameShape()`, `IsTable()`, `IsClass()`, `OwningContainer()`, `WalkRDFS()`.
- `internal/layoutgraph/placement_access.go`: `IsClass()`.
- `internal/layoutgraph/clone.go`: `copyClusters()`, `copySequences()`, `copyTrees()`, `copyAuxiliaryNodeRecord()`, `copyEdgeAbductions()`.
- `internal/layoutgraph/hierarchy_access.go`: `IsTable()`, `SetClusterVessel()`.
- `internal/nodeshape/shape.go`: `nodeshape.New()`, `Kind` enum, recognized shape constants.
- `lib/shape/shape.go`: Canonical D2 shape types, `AspectRatio1()`.

## Dependency Analysis
Preprocessing in TALA follows the sequence:
`Prescale` -> `PreprocessSequences` -> `Preprocess` -> `PreprocessTrees` -> `PreprocessHierarchies` -> `PreprocessClusters` -> `PreprocessHubs`.
All of these algorithms require:
1. `Sequence` records with active checks and step query methods.
2. `Cluster` records with arrangement flipping and active checks.
3. `Tree` topology with parent/child links and sentinel edge endpoints.
4. `EdgeAbduction` records attached to sequences and clusters.
5. `Node.owningContainer()` and `Node.level()` with active group precedence.
6. `Node.isDescendantOf()` following direct containers, cluster vessels, and sequence vessels.
7. Stable BigInt ID ordering (`clusterOrder`, `treeOrder`, `sequenceOrder`).
8. Deep clone support that isolates all group maps, records, and edge abductions.

## Scope Decision
Explicitly out of scope for Slice 05:
- Placement and sizing algorithms (`Prescale`, `Prepare`, `SyncGeometry`, `ArrangeSteps`, `ArrangeClusterNodes`, `Resize`).
- Group discovery passes (`AddSequences`, `AddClusters`, `PreprocessTrees`, `Assign`, `AddHubs`).
- Edge routing or geometry passes.
- Full `nodeshape` geometry/ports/snap points/label preferences.
- Work guards (`limits.WorkGuard`, context cancellation, rollback transactions).
Slice 05 implements solely the data models, ordering, predicates, and cloning needed so subsequent algorithm slices can be ported without placeholders.

## Sequence Model
Implemented in `src/graph/sequence.js`:
- Fields: `Vessel`, `Nodes`, `Graph`, `EdgeAbductions`, `Container`.
- `isActive() / IsActive()`: evaluates `this.Vessel != null && this.Vessel.Graph != null`.
- `first() / First()` and `last() / Last()`: safely queries sequence endpoints.

## Cluster Model
Implemented in `src/graph/cluster.js`:
- Fields: `Vessel`, `Nodes`, `Arrangement`, `DesiredArrangement`, `Graph`, `EdgeAbductions`, `Padding`, `FixedSize`, `Container`.
- `ClusterArrangement`: frozen object containing `Row: "Row"`, `Column: "Column"`.
- `flipArrangement()` / `flip()`: flips `Row -> Column` and any other value to `Row`.
- `isActive() / IsActive()`: evaluates `this.Vessel != null && this.Vessel.Graph != null`.

## Tree Model
Implemented in `src/graph/tree.js`:
- Fields: `Node`, `Parent`, `Children`, `SentinelEdge`, `Orientation`.
- `newTree(node) / NewTree(node)`: initializes tree with node and empty children array.
- `isSentinelEdgeSource()`: checks `SentinelEdge.From === this.Node`.
- `sentinelNode() / SentinelNode()`: returns `SentinelEdge.To` if node is source, else `SentinelEdge.From`. Direction is strictly based on endpoint pointers, never inferred from edge arrowheads.

## EdgeAbduction Model
Implemented in `src/graph/edge-abduction.js`:
- Fields: `Edge`, `OriginallyFrom`, `OriginallyTo`, `CurrentFrom`, `CurrentTo`.
- Defaulted to null, supporting construction via fields object.

## Shape Semantics
Implemented minimal semantic layer on `Node` in `src/graph/node.js`:
- Supported canonical shape types: `""`, `Callout`, `Circle`, `Cloud`, `Cylinder`, `Diamond`, `Document`, `Hexagon`, `Image`, `Oval`, `Package`, `Page`, `Parallelogram`, `Person`, `C4Person`, `Queue`, `RealSquare`, `Square`, `Step`, `StoredData`, `Text`, `Class`, `Table`, `Code`.
- `setShape(type)`: preserves existing shape when given unsupported types or non-canonical strings (e.g. lowercase `circle` or `unsupported` preserves previous shape, verified with Go `TestSetShapeUnknownPreservesShape`).
- `aspectRatio1()`: returns `true` only for `Circle` and `RealSquare`.
- `isTable()`: returns `true` for `Table`.
- `isClass()`: returns `true` for `Class`.
- `isSequenceStep()`: returns `true` for `Step`.
- `sameShape(other)`: compares shape kinds (`""` and `"Square"` evaluate to the same kind `Square`).

## Active/Inactive Semantics
Active group status requires `Vessel.Graph !== null`. Inactive (remembered) groups have `Vessel.Graph === null`. Group queries check active status before applying group semantics.

## Owning-Container Semantics
`node.owningContainer() / OwningContainer()`:
1. If in active `Cluster`: returns `node.Cluster.Vessel.Container`.
2. Else if in active `Sequence`: returns `node.Sequence.Vessel.Container`.
3. Else: returns `node.Container`.

## Level/Descendant Changes
- `node.level() / Level()`:
  - If in active `Cluster`: returns `Cluster.Vessel.level()`.
  - If in active `Sequence`: returns `Sequence.Vessel.level()`.
  - Else: returns `1 + (Container ? Container.level() : 0)`.
  Top-level nodes evaluate to level 1, child containers to level 2, grandchild containers to level 3.
- `node.isDescendantOf(maybeAncestor)`:
  - Same node -> true; null descendant -> false.
  - Recurses through `Container`, else `Cluster.Vessel`, else `Sequence.Vessel`.
  - Upstream Go behavior follows `Cluster` and `Sequence` vessel pointers regardless of active state; JS matches this exactly.
  - Covers null ancestor once root is reached.

## Stable Group Ordering
Implemented in `Graph`:
- `clusterOrder() / ClusterOrder()`
- `treeOrder() / TreeOrder()`
- `sequenceOrder() / SequenceOrder()`
Each takes the keys of its corresponding Map, returns a new array, and sorts numerically using BigInt EntityIDs (`BigInt(a.ID) < BigInt(b.ID)`). Tested with deliberately scrambled insertion `[30n, -2n, 5n, 100n]` producing exact sorted order `[-2n, 5n, 30n, 100n]`.

## Container RDFS Traversal
`graph.containerRDFSOrder(root)`:
- Returns `[]` if root is non-null and not a container.
- Traverses children in REVERSE order (`slices.Backward`).
- Descendants appear before their container (RDFS).
- Normal containers recurse and are appended after their descendants.
- Cluster vessels: inspects `Cluster.Nodes` in reverse order; if any member is a container, recurses on it and appends it. The cluster vessel itself is not emitted as a normal container.

## Cluster RDFS Traversal
`graph.clusterRDFSOrder()`:
- Traverses containers in `[...containerRDFSOrder(null), null]` order.
- For each container, iterates its children in forward order and appends any child where `child.isClusterVessel === true`.
- Traversal order is preserved without ID sorting.

## Node RDFS Traversal
`node.rdfsWalk(applyFunc) / node.WalkRDFS(applyFunc)`:
- Recursively visits direct container children first.
- If cluster vessel, visits cluster nodes; ELSE if sequence vessel, visits sequence step nodes.
- Cluster branch strictly takes precedence over sequence branch (verified by pathological test).
- Current node visited last.

## Clone Changes
`cloneGraph(source)` updated in `src/graph/clone.js`:
- Clones and rebinds `Clusters`, `Sequences`, `Trees` (`NodeToTree`), and `EdgeAbductions`.
- Rebinds member pointers: `member.Cluster = clonedCluster`, `member.Sequence = clonedSequence`.
- Rebinds auxiliary nodes (vessels and tree nodes) and preserves `isClusterVessel` flag.
- Preserves active vs inactive state: inactive sequence/cluster vessels retain `Graph === null`.
- Rebinds `EdgeAbduction` fields (`Edge`, `OriginallyFrom`, `OriginallyTo`, `CurrentFrom`, `CurrentTo`).

## Shape Go Oracle
- Source: `test/reference/go_shape_semantics_oracle.go`
- Fixture: `test/fixtures/go-shape-semantics-reference.json`
- Generated using `C:\Program Files\Go\bin\go.exe`.
- SHA256: `de1855ebf2eb0dc6088e7bbb6c2ca55a0fb3d89fb41e0e18689d2eb661cb6376`

## Topology Go Oracle
- Source: `test/reference/go_topology_foundation_oracle.go`
- Fixture: `test/fixtures/go-topology-foundation-reference.json`
- Generated using `C:\Program Files\Go\bin\go.exe`.
- SHA256: `4cec1bac2dad2d14d1f1a8784d66a3ca8a37e6ece152bbbef0b1b308a65934bb`

## Fixture Reproducibility
Generated both fixtures twice consecutively using Go:
- Shape fixture SHA256 run 1 & 2: `de1855ebf2eb0dc6088e7bbb6c2ca55a0fb3d89fb41e0e18689d2eb661cb6376` (identical).
- Topology fixture SHA256 run 1 & 2: `4cec1bac2dad2d14d1f1a8784d66a3ca8a37e6ece152bbbef0b1b308a65934bb` (identical).

## Full Regression
Run with `bun test`:
- 98 passed, 0 failed.
- 8013 expect() calls.
- 11 test files.
- Runtime: ~155ms.
All Slice 01-04 tests remained 100% green.

## Math.random Audit
Audited `js/src`: 0 occurrences of `Math.random`.

## Browser Audit
Audited `js/src`: 0 dependencies on Node built-ins (`fs`, `path`, `Buffer`, `process`, `crypto`).

## Performance Sanity
Measurements on small graphs:
- 100,000 `clusterOrder` operations: ~103ms (~1.03 μs/op).
- 100,000 `owningContainer` queries: ~3.1ms (~31 ns/query).
- 10,000 `containerRDFSOrder` traversals: ~5.2ms (~0.52 μs/traversal).
- 1,000 group-aware `cloneGraph` calls: ~74ms (~74 μs/clone).

## Problems Encountered and Resolved
1. **Lowercase shape strings vs Go `SetShape`**: Probing revealed Go's `nodeshape.New` strictly matches canonical PascalCase strings (`Callout`, `Circle`, etc.) and `""`. Lowercase strings return `ok=false` in Go and preserve existing shape. Handled with exact Go parity.
2. **Go `NewGraph` uninitialized `NodeToTree`**: In Go, `NewGraph()` leaves `NodeToTree` nil until created during tree operations. Initialized `g.NodeToTree = make(...)` in oracle to avoid nil map panic.
3. **ClusterArrangement `Flip()`**: In Go, `Flip()` is a value receiver method on `ClusterArrangement` returning the flipped arrangement. Implemented `flipArrangement` and `Cluster.flip()`.
4. **Clone test node lookup**: In `group-clone.test.js`, initially tried looking up cloned nodes in `nodesByEntityId` which was not populated on plain un-adapted graphs. Resolved with explicit ID finder.

## Licensing / Provenance
All code translated directly from pinned D2/TALA source (`github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph`) under Mozilla Public License 2.0.

## Limitations
- Placement geometry mutation (`ArrangeSteps`, `Resize`, `ArrangeClusterNodes`) not implemented yet (belongs in grouping/placement slices).
- Tree preprocessing algorithms and reversal not implemented yet (belongs in tree slice).
- WorkGuard and transactional rollback not ported (belongs in algorithm slices).

## Result
Complete, deterministic, browser-safe preprocessing topology foundation in JavaScript matching Go TALA reference.
