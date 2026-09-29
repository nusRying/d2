# ADR 006: Preprocessing Topology Foundation Model

## Date
2026-09-29

## Status
Implemented — awaiting Slice 05 review

## Context
TALA's engine pipeline begins with a series of preprocessing passes:
`Prescale` -> `PreprocessSequences` -> `Preprocess` -> `PreprocessTrees` -> `PreprocessHierarchies` -> `PreprocessClusters` -> `PreprocessHubs`.
Before these placement and grouping discovery algorithms can be ported, the layoutgraph data structures and traversal semantics they rely on must be established with strict adherence to Go behavior.

Slice 05 covers the topology-foundation behavior exercised by its Go oracle and regression suite:
- `Sequence`: ordered sequence of steps enclosed by a sequence vessel.
- `Cluster`: grouped nodes arranged in Row or Column format under a cluster vessel.
- `Tree`: rooted trees oriented in one of four directions with sentinel edges.
- `EdgeAbduction`: temporary transfer of edges between containers and descendant children.
- Active vs inactive group semantics based on vessel graph presence (`vessel.Graph != nil`), with group records (`Cluster.Graph`, `Sequence.Graph`) pointing to the owning graph even when inactive.
- Active owning-container resolution and recursive hierarchy levels.
- Stable ID ordering (`clusterOrder`, `sequenceOrder`, `treeOrder`) vs hierarchy/traversal order (`containerRDFSOrder`, `clusterRDFSOrder`, `rdfsWalk`).
- Minimal shape-kind classification and predicates required by preprocessing stages.

## Decisions

1. **Why Group Records Precede Algorithms**:
   Porting placement or grouping algorithms without faithful underlying records leads to temporary mock objects, divergent clone semantics, and subtle bugs. Establishing data structures, active queries, ordering, and deep cloning first provides a stable contract for subsequent algorithm slices.

2. **Sequence Model (`src/graph/sequence.js`)**:
   Represents sequences using structural fields: `Vessel`, `Nodes`, `Graph`, `EdgeAbductions`, and `Container`.
   - `isActive() / IsActive()`: evaluates `this.Vessel != null && this.Vessel.Graph != null`. Active status is tied to graph membership of the vessel node, not map presence alone.
   - `first() / First()` and `last() / Last()`: query first and last nodes, throwing deterministic errors on empty sequences matching Go panic behavior.
   - Sequence geometry mutation and step placement (`SyncGeometry`, `ArrangeSteps`) are deferred to grouping implementation.

3. **Cluster Model (`src/graph/cluster.js`)**:
   Represents clusters using structural fields: `Vessel`, `Nodes`, `Arrangement`, `DesiredArrangement`, `Graph`, `EdgeAbductions`, `Padding`, `FixedSize`, and `Container`.
   - Zero-value defaults matching Go: `Arrangement = ""`, `DesiredArrangement = ""`, `Padding = 0`, `FixedSize = false`.
   - `ClusterArrangement`: frozen object with `Row: "Row"` and `Column: "Column"`.
   - `flipArrangement(arrangement)` and `flip()`: flips `Row -> Column` and any other value (including `""`) to `Row`, matching Go `ClusterArrangement.Flip()`.
   - `isActive() / IsActive()`: evaluates `this.Vessel != null && this.Vessel.Graph != null`.
   - Cluster geometry algorithms (`ArrangeClusterNodes`, `Resize`) are deferred to cluster placement.

4. **Tree Model (`src/graph/tree.js`)**:
   Represents tree topology using fields: `Node`, `Parent`, `Children`, `SentinelEdge`, and `Orientation`.
   - `newTree(node)` / `NewTree(node)`: initializes a new tree node with empty children array, null parent, and `Orientation: Orientation.TopLeft` (matching Go `geo.TopLeft = 0` zero value).
   - `isSentinelEdgeSource()`: returns `this.SentinelEdge.From === this.Node`. Throws if `SentinelEdge` is nil, matching Go nil dereference panic.
   - `sentinelNode()`: returns `SentinelEdge.To` if `isSentinelEdgeSource()`, otherwise `SentinelEdge.From`. Throws if `SentinelEdge` is nil. Direction is strictly based on endpoint pointer identity, never inferred from edge arrowheads.

5. **EdgeAbduction Model (`src/graph/edge-abduction.js`)**:
   Carries temporary edge transfers with fields: `Edge`, `OriginallyFrom`, `OriginallyTo`, `CurrentFrom`, and `CurrentTo`. Exists so `Sequence` and `Cluster` records can preserve abduction state across cloning and restoration.

6. **Active vs Inactive Groups**:
   Inactive (remembered) sequences and clusters have vessels whose `Graph` is null. Group queries and level computations check `isActive()`, whereas ancestor traversal (`isDescendantOf`) follows vessel parentage regardless of active state, matching Go layoutgraph behavior. Cloned inactive group records maintain `clonedCluster.Graph === clonedGraph` while `clonedVessel.Graph === null`.

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
    - `Trees`: node, parent, children, sentinel edge, and orientation cloned recursively; `NodeToTree` map rebound. Sentinel edges absent from `Graph.Edges` are cloned independently without being added to `Graph.Edges`.
    - `EdgeAbductions`: `Edge`, `OriginallyFrom`, `OriginallyTo`, `CurrentFrom`, `CurrentTo` rebound to cloned records. Fails if references cannot be resolved.
    - Active group member filtering: active Cluster members and active Sequence steps are filtered out of top-level `cloned.Nodes`, while their vessels remain. Inactive group members remain in `cloned.Nodes`.
    - Strict node resolution: `resolveNode()` only resolves nodes previously admitted to clone state; arbitrary unadmitted nodes fail clone immediately.
    - Auxiliary collision checks: distinct `Node` instances reusing the same `EntityID` fail clone.
    - Structural clone validation: enforces that sequences have >= 2 steps, vessels match map keys, and containers cannot contain themselves.

13. **Browser Constraints**:
    Zero Node built-ins (`fs`, `path`, `Buffer`, `process`, `crypto`) in production `src/`. Zero `Math.random` usage across production sources.

14. **Algorithm Boundaries**:
    Placement algorithms (`Prescale`, `AddSequences`, `Prepare`, `PreprocessTrees`, `Assign`, `AddClusters`, `AddHubs`) and work guards (`limits.WorkGuard`) are strictly out of scope for Slice 05 and will be implemented in Slice 06+.

## Review-Discovered Discrepancies and Corrections
During review of initial Slice 05 implementation, ten specific discrepancies with pinned Go `layoutgraph` were discovered and corrected:
1. **Tree zero-value orientation**: Go `NewTree` initializes `Orientation` to `geo.TopLeft` (0), not `geo.NONE` (8). Corrected default in JS `Tree`.
2. **Sequence empty endpoint behavior**: Go `first()` and `last()` panic on empty slices. JS previously returned `null`; updated to throw deterministic errors.
3. **Cluster zero values**: In Go, zero-value `Cluster` has `Arrangement = ""`, `DesiredArrangement = ""`, and `Padding = 0`. Corrected JS defaults and verified `flipArrangement("") === "Row"`.
4. **Group record Graph vs vessel Graph distinction**: Go `copyClusters` and `copySequences` always assign `Graph: state.clone` to the cloned group record. Active state is controlled exclusively by `vessel.Graph != nil`. Updated JS to assign `cloned` graph to inactive cluster and sequence records.
5. **Active member filtering from cloned Graph.Nodes**: Pinned Go filters out active cluster members and active sequence steps from `state.clone.Nodes` while retaining vessels. Inactive members remain in `Nodes`. Ported this filtering faithfully.
6. **Group-aware container clone traversal**: `copyContainers()` uses group-aware container RDFS order that traverses into cluster members that are containers. Updated `clone.js` to utilize the group-aware traversal.
7. **Strict resolve-vs-copy distinction**: Replaced permissive auxiliary fallback in `resolveNode()` with strict lookup of admitted records, throwing if unadmitted nodes are referenced.
8. **Auxiliary ID collision behavior**: Tracked `nodeRecordsByID` to ensure distinct source Node instances reusing an `EntityID` are rejected.
9. **Detached tree sentinel edge cloning**: Go supports tree sentinel edges outside `Graph.Edges`. Updated `clone.js` to clone absent sentinel edges specifically without inserting them into `cloned.Edges`.
10. **Structural clone validation**: Added validation checks rejecting sequence with < 2 steps, vessel mismatches, and containers referencing themselves.

## Consequences
- Data models for sequences, clusters, trees, and edge abductions are now available and verified against Go oracles.
- All subsequent preprocessing algorithms can directly rely on `owningContainer()`, `level()`, `clusterOrder()`, `containerRDFSOrder()`, and group-aware cloning without mock shims.
