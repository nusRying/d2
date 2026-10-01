# ADR-024: FitToGraph

## Status
Implemented — awaiting Slice 23 review

## Context
In D2's layout engine (specifically TALA), nodes (both container and non-container) can be sized to enclose a layout graph footprint via `Node.fitNodeToGraph(graph, padding)` and its public alias `Node.FitToGraph(graph, padding)`.

In Go TALA, the implementation is defined in:
- `d2layouts/d2talalayout/internal/layoutgraph/node.go:51` (`fitNodeToGraph`)
- `d2layouts/d2talalayout/internal/layoutgraph/placement_access.go:88` (`FitToGraph`)

```go
func (node *Node) fitNodeToGraph(g *Graph, padding Spacing) {
    tl, br := Nodes(g.Nodes).fixedBounds()
    node.expandForLabels(tl, br)
    node.fitToBoundingBox(tl, br, padding)
}

func (node *Node) FitToGraph(graph *Graph, padding Spacing) {
    node.fitNodeToGraph(graph, padding)
}
```

This ADR documents the exact procedural sequence, dual-graph semantics, non-container support, dimension-only mutation, error behavior, and boundary constraints ported to JavaScript in Slice 23.

## Decision

### 1. Scope and API
- Implemented `Node.fitNodeToGraph(graph, padding)` and `Node.FitToGraph(graph, padding)` on `Node` in `src/graph/node.js`.
- Future operations such as `Graph.SyncNestedGeometry`, `Graph.SyncClusters`, `Cluster.ArrangeClusterNodes`, `Cluster.SyncGeometry`, `Cluster.Resize`, `orientationFootprintSize`, `Cleanup`, `Join`, `JoinDistancedClusters`, `AddHubs`, bin packing, routing, tree/hierarchy placement orchestration, and engine pipeline remain strictly un-implemented.
- `setContainer` and `SetContainer` remain strictly absent from JS production code.

### 2. Procedural Pipeline and Ordering
`fitNodeToGraph(graph, padding)` executes the exact procedural steps of pinned Go:
```text
1. [tl, br] = nodesFixedBounds(graph.Nodes)
2. this.expandForLabels(tl, br)
3. this.fitToBoundingBox(tl, br, padding)
```

### 3. Critical Dual-Graph Semantic
The method interacts with two distinct graph references:
1. **Argument Graph (`graph`)**: The graph passed as the first parameter. Its `Nodes` array (`graph.Nodes`) supplies the input coordinates to `nodesFixedBounds(graph.Nodes)`. Unrelated nodes in `this.Graph.Nodes` are completely ignored for bounds calculation.
2. **Target Owner Graph (`this.Graph`)**: The graph owning the target node. `this.expandForLabels(tl, br)` internally queries `this.Graph.Containers.get(this)` for boundary children with labels wider than the child's width. Container entries in `graph.Containers` are not consulted by `expandForLabels`.

These two graph references are distinct and non-interchangeable.

### 4. Key Invariants & Behavioral Quirks
- **No `isContainer` requirement**: Unlike `wrapChildren` and `positionContainerChildren`, `fitNodeToGraph` contains no `isContainer` check. Any ordinary node can call `FitToGraph` and be resized to fit a graph footprint.
- **Explicit padding only**: The `padding` parameter passed to `FitToGraph` is authoritative and directly forwarded to `this.fitToBoundingBox(tl, br, padding)`. `containerPadding` is never called on either graph.
- **Dimensions only (No translation)**: `FitToGraph` mutates only `target.Width` and `target.Height`. `target.TopLeft` is not dereferenced, modified, or replaced. There is no call to `InsidePlacement`, `translate`, or `MoveWithChildren`.
- **Target TopLeft is irrelevant**: Even if `target.TopLeft === null`, `FitToGraph` succeeds as long as target is not an element of `graph.Nodes`.
- **Empty argument graph non-finite behavior**: If `graph.Nodes` is empty, `nodesFixedBounds` produces `tl = (-Inf, -Inf), br = (+Inf, +Inf)`. Forwarded to `fitToBoundingBox`, this produces infinite dimensions (`Width = +Inf, Height = +Inf`) without throwing or early-returning.
- **Natural failure order without rollback**:
  - If `graph == null`, panics immediately when accessing `graph.Nodes` before any mutation.
  - If `this.Graph == null`, `nodesFixedBounds` succeeds, but `expandForLabels` dereferences `this.Graph.Containers` and throws before `fitToBoundingBox` can mutate target dimensions.
  - If an argument node is `null` or has `TopLeft == null`, throws during `nodesFixedBounds` before target mutation.
  - If an owner container child has `TopLeft == null` with a non-null label, throws during `expandForLabels` before target mutation.
- **Fixed-origin integration**: Argument nodes with `FixedTopLeft` participate in `nodesFixedBounds` through established fixed-origin semantics.
- **Desired dimensions**: Retains `DesiredWidth` and `DesiredHeight` semantics (larger desired dimensions expand the final size; `DesiredWidth = 0` is treated as non-null).
- **No WorkGuard or RNG**: The operation is unmetered and deterministic.
