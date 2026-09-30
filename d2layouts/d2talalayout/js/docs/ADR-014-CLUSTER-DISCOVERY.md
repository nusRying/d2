# ADR 014: Cluster Discovery Index and Classification

## Date
2026-09-30

## Status
Implemented — awaiting Slice 13 review

## Context
In TALA's layout pipeline, clustering identifies groups of sibling nodes that share structural characteristics and edge patterns so they can be abstracted into composite cluster vessels. The clustering pipeline is divided into two distinct phases:
1. **Cluster Discovery and Classification (Slice 13):** Read-only analysis and caching that builds a `clusterDiscoveryIndex` over candidate container children, computes neighbor adjacencies, records edge signatures, resolves sequence edge abductions, and determines clustering eligibility (`noClustering`).
2. **Cluster Mutation and Abduction (Slice 14):** Graph mutations that create cluster vessel nodes, abduct incident edges, update container hierarchies, and re-run incremental neighbor refreshes.

Slice 13 implements the complete, read-only cluster discovery index and classification system in JavaScript matching `internal/grouping/cluster.go` and `internal/grouping/cluster_discovery.go`.

---

## Architectural Decisions

### 1. `clusterDiscoveryIndex` as a Private Discovery Structure
The `ClusterDiscoveryIndex` is an internal grouping data structure used during cluster formation, not an engine pipeline stage or public graph API. It indexes nodes and edges within a candidate container, maintaining:
- `infos`: Map of `Node -> ClusterDiscoveryInfo` (`neighbors`, `signatures`, `toTableColumn`, `noClustering`).
- `edgeOrder`: Map of `Edge -> int` tracking the canonical insertion order from `graph.Edges`.
- `edgeNodes`: Map of `Edge -> [Node, Node]` tracking the endpoints of each indexed edge.
- `sequenceEdges`: Map of `Sequence -> (Edge -> Node)` caching resolved original pre-abduction endpoints.

It is created via `buildClusterDiscoveryIndex(g, nodes, guard)` and remains internal to the grouping module.

### 2. Arrowhead Preservation and Raw Arrowhead Identifiers
Go represents arrowheads as typed strings (`layoutgraph.Arrowhead`). `ClusterEdgeSignature` tracks the multi-set of arrowhead shapes seen across edges connected to a node:
- `fromArrowheads: Set<string>`
- `toArrowheads: Set<string>`

In Go, empty arrowheads are represented by `""` or `layoutgraph.NoArrowhead` (`"none"`). `ClusterEdgeSignature.add` preserves raw arrowhead identifiers without unnecessary string coercion or normalization. When traversing from the perspective of an edge's target node (`node !== edge.From`), the source and target arrowhead roles are swapped, accurately reflecting the orientation relative to the node.

### 3. The Directed-Count Quirk
In Go's `ClusterEdgeSignature.matches(other)` (`internal/grouping/cluster_discovery.go`), signatures are compared across:
- `from` count equality
- `to` count equality
- `bidirectional` count equality
- `undirected` count equality
- `arrowTypeCount <= 1` constraint on both signatures
- `fromArrowheads` set equality
- `toArrowheads` set equality

Notably, Go's implementation **does not compare the `directed` count directly**. Two signatures with different `directed` counts (e.g. `directed=2` vs `directed=1`) match if their `from`, `to`, `bidirectional`, `undirected`, and arrowhead sets are equal. JavaScript preserves this exact quirk to guarantee 100% classification parity with Go.

### 4. `Node.adjacent` Fallback for Malformed Observers
When querying `node.adjacent(edge)`, if `node` is neither `edge.From` nor `edge.To` (a malformed edge observer in the graph), Go's `Node.Adjacent` unconditionally falls through to return `edge.From`. JS implements this exact fallback:
```js
adjacent(edge) {
  if (this === edge.From) {
    return edge.To;
  }
  return edge.From;
}
```

### 5. Pre-Abduction Neighbor Recovery via `sequenceOriginal`
Sequence vessels in a graph represent abducted chains of step nodes. When computing cluster neighbor adjacency, sequence vessels must be resolved back to their original step nodes:
- `sequenceOriginal(sequence, edge, guard)` checks `sequence.EdgeAbductions`.
- The first abduction encountered for an edge sets the original node mapping.
- Subsequent abductions for the same edge do not overwrite the initial mapping.
- The lookup map is lazily constructed per sequence and cached in `index.sequenceEdges`.
- The initial build charges 1 WorkGuard unit per step; subsequent lookups against the cached map charge 0 WorkGuard units.

### 6. Leaky Container Classification Rules
`clusterHasLeakyEdgeGuarded(g, node, guard)` identifies containers that have incident edges crossing containment boundaries:
- A non-container node is never leaky.
- For a container node, all descendant nodes are collected via `g.allDescendantNodesWithWorkGuard(node, guard)`.
- If any descendant has an incident edge whose other endpoint is not also a descendant of `node`, the container is classified as **leaky**.
- Leaky containers are ineligible for clustering.

### 7. Exclusion Criteria for Clustering (`noClustering`)
A node is marked `noClustering = true` in its discovery info if any of the following hold:
- It is a container node (`node.isContainer` is true).
- It is a sequence vessel (`g.Sequences.has(node)`).
- It has a self-loop edge (`edge.From === edge.To`).
- It is a leaky container (`clusterHasLeakyEdgeGuarded`).
- It has edges connected to table columns (`toTableColumn` flag).

### 8. Incremental Update Methods
The index provides incremental refresh methods matching Go:
- `refreshNeighbors(g, node, guard)`: Recomputes the unique neighbor list for a single node, resolving sequence vessels and sorting edges by graph-edge order.
- `refreshAfterClusterAbduction(g, cluster, guard)`: Refreshes neighbors for all nodes that were adjacent to the cluster members, preparing the index after cluster vessel creation.

### 9. Incident Edge Ordering
`clusterIncidentEdges(index, nodes, guard)` retrieves all unique edges incident to a set of cluster nodes. To ensure determinism, edges are sorted by their original insertion order in `graph.Edges` using `index.edgeOrder`.

### 10. WorkGuard Integration
Every discovery operation integrates with `WorkGuard`:
- Operations charge 1 unit per node step or traversal step.
- Cancellation via `context.isCancelled()` or `AbortSignal` is checked proactively.
- Low-limit boundary conditions strictly adhere to Go limits: executing with `limit = exact` succeeds, while `limit = exact - 1` fails with `WorkLimitError`.
- Mid-operation cancellation throws `WorkCanceledError` and leaves graph topology untouched.

### 11. Read-Only Topology Guarantee
Slice 13 is strictly read-only with respect to graph topology:
- `g.Nodes`, `g.Edges`, `g.Containers`, `g.Clusters`, `g.Sequences`, and `g.Trees` are never mutated.
- Node child lists and incident edge arrays remain unmodified.
- Both successful discovery and aborted/canceled operations preserve graph topology completely.

### 12. Separation Between Discovery (Slice 13) and Mutation (Slice 14)
Slice 13 exclusively provides analysis, indexing, and classification. Mutation methods such as `AddClusters`, `AssignArrangement`, `CreateVessel`, `AddCluster`, `abductClusterEdges`, `Cleanup`, and `Join` are explicitly deferred to Slice 14.

### 13. Thin Go Oracle Bridge
A minimal Go bridge (`internal/grouping/cluster_oracle_bridge.go`) wraps the unexported Go `clusterDiscoveryIndex` behind the build tag `//go:build tala_cluster_discovery_oracle`. It exposes lightweight DTOs without duplicating business logic, ensuring direct oracle parity verification.

### 14. Deterministic Repeat-Run SHA256 Proof
The reference generator `js/test/reference/go_cluster_discovery_oracle.go` runs with `-tags tala_cluster_discovery_oracle` to produce `js/test/fixtures/go-cluster-discovery-reference.json` (1,471,971 bytes). Two consecutive runs produce the identical SHA256 hash:
`DB96227913AFB918C08A85E204A7BD0CFB42B43F01A8363B4E22295E2886FAC3`

### 15. Extended `go-math-rand.js` for Exact Standard Library Parity
To reproduce Go's `rand.Intn(n)` behavior in the 0..99 corpus test, `go-math-rand.js` was extended with:
- `Int31()`: Shifts `Int63()` right by 32 bits, matching Go's `rng.Int31()`.
- `Int31n(n)`: Computes 31-bit pseudo-random integer in `[0, n)` with non-power-of-two rejection sampling.
- `Intn(n)`: Delegates to `Int31n(n)` for 32-bit integer ranges, matching Go's `rand.Intn`.

### 16. Non-Goals
The following methods and operations are strictly outside the scope of Slice 13:
- `AddClusters`
- `AssignArrangement`
- `CreateVessel`
- `AddCluster`
- `abductClusterEdges`
- `Cleanup`
- `Join`
- Public exposure of grouping in `src/index.js`.
