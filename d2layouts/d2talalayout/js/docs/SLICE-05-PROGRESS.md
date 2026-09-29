# Slice 05 Progress — Preprocessing Topology Foundation

## Goal
Port the missing layoutgraph topology/group records and traversal semantics required by the first preprocessing stages.
Establish faithful JavaScript support for `Sequence`, `Cluster`, `Tree`, `EdgeAbduction`, active group membership, owning-container resolution, stable group ordering, container/cluster reverse-DFS ordering, group-aware node traversal, shape-kind predicates, and group-aware clone isolation and rebinding without yet implementing placement or grouping discovery algorithms.

Slice 05 covers the topology-foundation behavior exercised by its Go oracle and regression suite.

## Approved Slice 04 Base
- Approved Commit: `5ab6807af54a28cebbc2ee6317c8588f51c43188`

## D2 Reference Base
- Pinned Commit: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Version
- Runtime Version: `go1.27.0` (at `C:\Program Files\Go\bin\go.exe`)

## Go Files Studied
- `internal/layoutgraph/sequence.go`: Sequence struct, `first()`, `last()`, `First()`, `Last()`, `isActive()`.
- `internal/layoutgraph/cluster.go`: Cluster struct, zero-value fields, `ClusterArrangement` ("Row", "Column"), `Flip()`, `isActive()`.
- `internal/layoutgraph/tree.go`: Tree struct, `NewTree()`, default `geo.TopLeft` orientation, `isSentinelEdgeSource()`, `sentinelNode()`.
- `internal/layoutgraph/layout.go`: `EdgeAbduction`, `ClusterRDFSOrder()`, `ClusterOrder()`, `TreeOrder()`, `SequenceOrder()`, `isDescendantOf()`.
- `internal/layoutgraph/graph.go`: `Containers`, `Clusters`, `Trees`, `NodeToTree`, `Sequences`, `isSequence()`, `isTreeSentinel()`, `containerRDFSOrder()`.
- `internal/layoutgraph/node.go`: `SetShape()`, `ShapeType()`, `AddNear()`, `Level()`, `rdfsWalk()`, `container()`, `isClusterVessel`.
- `internal/layoutgraph/structure_api.go`: `IsSequenceStep()`, `SameShape()`, `IsTable()`, `IsClass()`, `OwningContainer()`, `WalkRDFS()`.
- `internal/layoutgraph/placement_access.go`: `IsClass()`, `SentinelNode()`.
- `internal/layoutgraph/clone.go`: `copyClusters()`, `copySequences()`, `copyTrees()`, `copyAuxiliaryNodeRecord()`, `resolveNode()`, `copyEdgeAbductions()`, active group node filtering.
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
- `first() / First()` and `last() / Last()`: queries sequence endpoints; throws deterministic error on empty sequence matching Go panic behavior.

## Cluster Model
Implemented in `src/graph/cluster.js`:
- Fields: `Vessel`, `Nodes`, `Arrangement`, `DesiredArrangement`, `Graph`, `EdgeAbductions`, `Padding`, `FixedSize`, `Container`.
- Zero-value defaults: `Arrangement = ""`, `DesiredArrangement = ""`, `Padding = 0`, `FixedSize = false`.
- `ClusterArrangement`: frozen object containing `Row: "Row"`, `Column: "Column"`.
- `flipArrangement()` / `flip()`: flips `Row -> Column` and any other value (including `""`) to `Row`, matching Go `ClusterArrangement.Flip()`.
- `isActive() / IsActive()`: evaluates `this.Vessel != null && this.Vessel.Graph != null`.

## Tree Model
Implemented in `src/graph/tree.js`:
- Fields: `Node`, `Parent`, `Children`, `SentinelEdge`, `Orientation`.
- `newTree(node) / NewTree(node)`: initializes tree with node, empty children array, and default `Orientation: Orientation.TopLeft` (matching Go zero value `geo.TopLeft = 0`).
- `isSentinelEdgeSource()`: checks `SentinelEdge.From === this.Node`. Throws if `SentinelEdge` is nil.
- `sentinelNode() / SentinelNode()`: returns `SentinelEdge.To` if node is source, else `SentinelEdge.From`. Throws if `SentinelEdge` is nil. Direction is strictly based on endpoint pointers, never inferred from edge arrowheads.

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
Active group status requires `Vessel.Graph !== null`. Inactive (remembered) groups have `Vessel.Graph === null`. Group queries check active status before applying group semantics. Cloned inactive group records preserve `clonedCluster.Graph === clonedGraph` and `clonedSeq.Graph === clonedGraph` while `clonedVessel.Graph === null`.

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
  - Upstream Go behavior follows `Cluster` and `Sequence` vessel pointers regardless of active state; JS matches this.
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
`cloneGraph(source)` in `src/graph/clone.js`:
- Clones and rebinds `Clusters`, `Sequences`, `Trees` (`NodeToTree`), and `EdgeAbductions`.
- Strict node admission: `resolveNode()` strictly resolves previously admitted nodes; arbitrary unadmitted nodes fail clone.
- Distinct auxiliary ID collisions rejected via `nodeRecordsByID` tracking.
- Structural clone validations: rejects short sequences (< 2 steps), vessel mismatches, and self-contained vessels.
- Detached Tree sentinel edges outside `Graph.Edges` are cloned independently without being inserted into `cloned.Edges`.
- Group-aware container traversal: enters containers that are members of cluster vessels.
- Filters active cluster members and active sequence steps from top-level `cloned.Nodes`, preserving their vessels. Inactive members remain in `cloned.Nodes`.
- Preserves active vs inactive state: inactive sequence/cluster vessels retain `vessel.Graph === null` while group records point to `cloned`.

## Shape Go Oracle
- Source: `test/reference/go_shape_semantics_oracle.go`
- Fixture: `test/fixtures/go-shape-semantics-reference.json`
- Generated using `C:\Program Files\Go\bin\go.exe`.
- SHA256: `de1855ebf2eb0dc6088e7bbb6c2ca55a0fb3d89fb41e0e18689d2eb661cb6376`

## Topology Go Oracle
- Source: `test/reference/go_topology_foundation_oracle.go`
- Fixture: `test/fixtures/go-topology-foundation-reference.json`
- Generated using `C:\Program Files\Go\bin\go.exe`.
- SHA256: `a60d023a92026a64459e48456d39f5d33392a1570fb413030e684ed1041c44c8`

## Fixture Reproducibility
Generated both fixtures twice consecutively using Go:
- Shape fixture SHA256 run 1 & 2: `de1855ebf2eb0dc6088e7bbb6c2ca55a0fb3d89fb41e0e18689d2eb661cb6376` (identical).
- Topology fixture SHA256 run 1 & 2: `a60d023a92026a64459e48456d39f5d33392a1570fb413030e684ed1041c44c8` (identical).

## Full Regression
Authoritative final run:
```powershell
cd d2layouts\d2talalayout\js
bun test
```
Result:
- 109 passed, 0 failed.
- 8096 expect() calls.
- 11 test files.
- Runtime: 231.00ms.
All Slice 01-05 tests pass.

## Math.random Audit
Audited `js/src`: 0 occurrences of `Math.random`.

## Browser Audit
Audited `js/src`: 0 dependencies on Node built-ins (`fs`, `path`, `Buffer`, `process`, `crypto`).

## Performance Sanity
Measurements on small graphs via `bun -e`:
- 100,000 `clusterOrder` operations: 19.69 ms (~0.20 μs/op).
- 100,000 `owningContainer` queries: 1.16 ms (~11.6 ns/query).
- 10,000 `containerRDFSOrder` traversals: 1.12 ms (~0.11 μs/traversal).
- 1,000 group-aware `cloneGraph` calls: 21.53 ms (~21.5 μs/clone).

## Problems Encountered and Review-Discovered Discrepancies
During initial implementation and subsequent code review, the following issues were identified and resolved:
1. **Tree zero-value orientation**: `NewTree(node)` in Go assigns `Orientation` to `geo.TopLeft` (0) via zero-allocation struct, rather than `geo.NONE` (8). Corrected in JS `Tree`.
2. **Sequence empty endpoint behavior**: Go `first()` and `last()` panic when `len(s.Nodes) == 0`. JS initially returned `null`; updated to throw deterministic errors.
3. **Cluster zero values**: In Go, zero-value `Cluster` has `Arrangement = ""`, `DesiredArrangement = ""`, and `Padding = 0`. Corrected JS defaults and verified `flipArrangement("") === "Row"`.
4. **Group record Graph vs vessel Graph distinction**: Go `copyClusters` and `copySequences` always assign `Graph: state.clone` to the cloned group record. Active state is controlled exclusively by `vessel.Graph != nil`. Updated JS to assign `cloned` graph to inactive cluster and sequence records.
5. **Active member filtering from cloned Graph.Nodes**: Pinned Go filters out active cluster members and active sequence steps from `state.clone.Nodes` while retaining vessels. Inactive members remain in `Nodes`. Ported this filtering.
6. **Group-aware container clone traversal**: `copyContainers()` uses group-aware container RDFS order that traverses into cluster members that are containers. Updated `clone.js` to utilize group-aware traversal.
7. **Strict resolve-vs-copy distinction**: Replaced permissive auxiliary fallback in `resolveNode()` with strict lookup of admitted records, throwing if unadmitted nodes are referenced.
8. **Auxiliary ID collision behavior**: Tracked `nodeRecordsByID` to ensure distinct source Node instances reusing an `EntityID` are rejected.
9. **Detached tree sentinel edge cloning**: Go supports tree sentinel edges outside `Graph.Edges`. Updated `clone.js` to clone absent sentinel edges specifically without inserting them into `cloned.Edges`.
10. **Structural clone validation**: Added validation checks rejecting sequence with < 2 steps, vessel mismatches, and containers referencing themselves.

## Review-Risk Notes
- Preprocessing algorithms in Slice 06 (`AddSequences`, `AddClusters`, `PreprocessTrees`) mutate group memberships and rely on `cloneGraph` preserving inactive remembered states. The regression test suite now directly covers these states.
- Shape predicates (`aspectRatio1`, `sameShape`, `isTable`, etc.) are minimal wrappers around `Node._shapeType`. Full polygon geometry and port indices remain deferred to the node shape / routing slice.

## Licensing / Provenance
All code translated directly from pinned D2/TALA source (`github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph`) under Mozilla Public License 2.0.

## Limitations
- Placement geometry mutation (`ArrangeSteps`, `Resize`, `ArrangeClusterNodes`) not implemented yet (belongs in grouping/placement slices).
- Tree preprocessing algorithms and reversal not implemented yet (belongs in tree slice).
- WorkGuard and transactional rollback not ported (belongs in algorithm slices).

## Result
Deterministic, browser-safe preprocessing topology foundation in JavaScript matching the behavior exercised by the Go TALA reference oracles and test suite.

## Commit History on `tala-js/slice-05-topology-foundation`
- `ebf007b40` docs(tala-js): close approved Slice 04
- `254761e25` feat(tala-js): add preprocessing topology records
- `c80c0e4ac` feat(tala-js): add group traversal and shape semantics
- `1dad84aba` test(tala-js): add Go topology foundation oracles
- `5e25d095d` fix(tala-js): finalize Slice 05 topology parity

## Final Test Execution Output
```text
bun test
109 pass
0 fail
8096 expect() calls
Ran 109 tests across 11 files. [160.00ms]
```
