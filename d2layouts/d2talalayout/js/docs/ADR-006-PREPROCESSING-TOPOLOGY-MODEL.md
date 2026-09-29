# ADR 006: Preprocessing Topology Foundation Model

## Date
2026-09-29

## Status
Implemented — awaiting Slice 05 review

## Context
TALA's engine pipeline begins with a series of preprocessing passes:
`Prescale` -> `PreprocessSequences` -> `Preprocess` -> `PreprocessTrees` -> `PreprocessHierarchies` -> `PreprocessClusters` -> `PreprocessHubs`.
Before these placement and grouping discovery algorithms can be ported, the layoutgraph data structures and traversal semantics they rely on must be established with complete Go parity.

In Go, these algorithms do not operate on raw adjacency alone; they query and mutate first-class grouping topology records:
- `Sequence`: ordered sequence of steps enclosed by a sequence vessel.
- `Cluster`: grouped nodes arranged in Row or Column format under a cluster vessel.
- `Tree`: rooted trees oriented in one of four directions with sentinel edges.
- `EdgeAbduction`: temporary transfer of edges between containers and descendant children.
- Active vs inactive group semantics based on vessel graph presence (`vessel.Graph != nil`).
- Active owning-container resolution and recursive hierarchy levels.
- Stable ID ordering (`clusterOrder`, `sequenceOrder`, `treeOrder`) vs hierarchy/traversal order (`containerRDFSOrder`, `clusterRDFSOrder`, `rdfsWalk`).
- Minimal shape-kind classification and predicates required by preprocessing stages.

## Decisions

1. **Why Group Records Precede Algorithms**:
   Porting placement or grouping algorithms without faithful underlying records leads to temporary mock objects, divergent clone semantics, and subtle bugs. Establishing data structures, active queries, ordering, and deep cloning first provides a stable contract for subsequent algorithm slices.

2. **Sequence Model (`src/graph/sequence.js`)**:
   Represents sequences using structural fields: `Vessel`, `Nodes`, `Graph`, `EdgeAbductions`, and `Container`.
   - `isActive() / IsActive()`: evaluates `this.Vessel != null && this.Vessel.Graph != null`. Active status is tied to graph membership of the vessel node, not map presence alone.
   - `first() / First()` and `last() / Last()`: query first and last nodes safely, returning null when empty.
   - Sequence geometry mutation and step placement (`SyncGeometry`, `ArrangeSteps`) are deferred to grouping implementation.

3. **Cluster Model (`src/graph/cluster.js`)**:
   Represents clusters using structural fields: `Vessel`, `Nodes`, `Arrangement`, `DesiredArrangement`, `Graph`, `EdgeAbductions`, `Padding`, `FixedSize`, and `Container`.
   - `ClusterArrangement`: frozen object with `Row` and `Column`.
   - `flipArrangement(arrangement)` and `flip()`: flips `Row -> Column` and any other value to `Row`, matching Go semantics.
   - `isActive() / IsActive()`: evaluates `this.Vessel != null && this.Vessel.Graph != null`.
   - Cluster geometry algorithms (`ArrangeClusterNodes`, `Resize`) are deferred to cluster placement.

4. **Tree Model (`src/graph/tree.js`)**:
   Represents tree topology using fields: `Node`, `Parent`, `Children`, `SentinelEdge`, and `Orientation`.
   - `newTree(node)` / `NewTree(node)`: initializes a new tree node with empty children array and null parent.
   - `isSentinelEdgeSource()`: returns `this.SentinelEdge.From === this.Node`.
   - `sentinelNode()`: returns `SentinelEdge.To` if `isSentinelEdgeSource()`, otherwise `SentinelEdge.From`. Direction is strictly based on endpoint pointer identity, never inferred from edge arrowheads.

5. **EdgeAbduction Model (`src/graph/edge-abduction.js`)**:
   Carries temporary edge transfers with fields: `Edge`, `OriginallyFrom`, `OriginallyTo`, `CurrentFrom`, and `CurrentTo`. Exists so `Sequence` and `Cluster` records can preserve abduction state across cloning and restoration.

6. **Active vs Inactive Groups**:
   Inactive (remembered) sequences and clusters have vessels whose `Graph` is null. Group queries and level computations check `isActive()`, whereas ancestor traversal (`isDescendantOf`) follows vessel parentage regardless of active state, exactly matching Go layoutgraph behavior.

7. **Owning-Container Semantics**:
   `node.owningContainer() / OwningContainer()` follows strict Go priority:
   - If in an active `Cluster`: returns `node.Cluster.Vessel.Container`.
   - Else if in an active `Sequence`: returns `node.Sequence.Vessel.Container`.
   - Else: returns direct `node.Container`.

8. **Level Resolution with Group Membership**:
   `node.level() / Level()` follows:
   - If in an active `Cluster`: returns `Cluster.Vessel.level()`.
   - If in an active `Sequence`: returns `Sequence.Vessel.level()`.
   - Else: returns `1 + (Container ? Container.level() : 0)`.
   Top-level nodes evaluate to level 1, child containers to level 2, and so forth.

9. **Stable ID Order vs Hierarchy Order**:
   - Stable ID order (`clusterOrder`, `sequenceOrder`, `treeOrder`): extracts Map keys, returns a new array, and sorts numerically by BigInt `EntityID` (`BigInt(a.ID) < BigInt(b.ID)`).
   - Traversal order (`containerRDFSOrder`, `clusterRDFSOrder`, `rdfsWalk`): follows DFS/reverse-child order without ID sorting.

10. **Container RDFS Traversal**:
    `containerRDFSOrder(root)`:
    - If `root != null` and `!root.isContainer`, returns empty array `[]`.
    - Children from `Containers.get(root)` are iterated in REVERSE order.
    - Descendants appear before their container (RDFS).
    - Normal containers recurse and are appended after descendants.
    - Cluster vessels: inspect `Cluster.Nodes` in reverse order; any cluster member that is a container recurses and is emitted. The cluster vessel itself is not emitted as a normal container.
    `clusterRDFSOrder()`: traverses containers in `[...containerRDFSOrder(null), null]` order, appending child cluster vessels in child encounter order.

11. **Minimal Shape-Semantic Layer**:
    Instead of porting full `internal/nodeshape` geometry/ports in this slice, `Node` provides the minimal semantic predicate layer required by preprocessing:
    - Supported shape types: `""`, `Callout`, `Circle`, `Cloud`, `Cylinder`, `Diamond`, `Document`, `Hexagon`, `Image`, `Oval`, `Package`, `Page`, `Parallelogram`, `Person`, `C4Person`, `Queue`, `RealSquare`, `Square`, `Step`, `StoredData`, `Text`, `Class`, `Table`, `Code`.
    - `setShape(type)`: preserves previous shape when given unsupported types or non-canonical strings (e.g. lowercase `circle` returns ok=false in Go and preserves existing shape).
    - `aspectRatio1()`: returns `true` only for `Circle` and `RealSquare`.
    - `isTable()`: `_shapeType === "Table"`.
    - `isClass()`: `_shapeType === "Class"`.
    - `isSequenceStep()`: `_shapeType === "Step"`.
    - `sameShape(other)`: compares shape kinds (`""` and `"Square"` evaluate to the same kind `Square`).

12. **Clone Isolation and Rebinding**:
    `cloneGraph(source)` clones and rebinds all non-empty grouping records:
    - `Clusters`: vessels, members, arrangement, padding, and edge abductions rebound to cloned objects; `vessel.isClusterVessel` flag and active/inactive state preserved.
    - `Sequences`: vessels, step nodes, container, and edge abductions rebound; active/inactive state preserved.
    - `Trees`: node, parent, children, sentinel edge, and orientation cloned recursively; `NodeToTree` map rebound.
    - `EdgeAbductions`: `Edge`, `OriginallyFrom`, `OriginallyTo`, `CurrentFrom`, `CurrentTo` rebound to cloned records. Fails if references cannot be resolved.

13. **Browser Constraints**:
    Zero Node built-ins (`fs`, `path`, `Buffer`, `process`, `crypto`) in production `src/`. Zero `Math.random` usage across production sources.

14. **Algorithm Boundaries**:
    Placement algorithms (`Prescale`, `AddSequences`, `Prepare`, `PreprocessTrees`, `Assign`, `AddClusters`, `AddHubs`) and work guards (`limits.WorkGuard`) are strictly out of scope for Slice 05 and will be implemented in Slice 06+.

## Consequences
- Data models for sequences, clusters, trees, and edge abductions are now fully available and verified against Go oracles.
- All subsequent preprocessing algorithms can directly rely on `owningContainer()`, `level()`, `clusterOrder()`, `containerRDFSOrder()`, and group-aware cloning without mock shims.
