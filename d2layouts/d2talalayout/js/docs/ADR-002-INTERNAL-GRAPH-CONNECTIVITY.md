# ADR 002: Internal Graph Connectivity

## Context

D2's Go implementation of TALA represents the internal layout graph (`layoutgraph`) with direct object pointers:
- `Edge.From *Node`
- `Edge.To *Node`

In our initial Slice 01 JavaScript foundation, we represented edges using string IDs (`source` and `target` strings) and maintained nodes inside `inEdges` and `outEdges` as arrays of strings.

During the review of Slice 01, it was noted that relying on string-based ID lookups diverges structurally from the Go TALA architecture. String ID lookups incur performance overhead (map lookups) and complicate algorithmic translations that assume direct object traversal. Additionally, ELK graphs use endpoint IDs that can refer to either nodes or ports, which requires explicit resolution upon ingestion.

## Decision

We will align the internal JavaScript connectivity model directly with the Go TALA architecture:
1. `Edge` objects will store direct references to their connected `Node` objects (`from` and `to`).
2. We will maintain an `edges` array on the `Node` object (containing `Edge` references), aligning with how TALA tracks incident edges, rather than separate `inEdges` and `outEdges` string arrays.
3. The ELK adapter (`elkToTalaGraph`) will be responsible for resolving ELK endpoint IDs (which could be node IDs or port IDs) into their respective parent `Node` references during ingestion.
4. If an edge endpoint cannot be resolved, or if the edge is a hyperedge (more than one source/target), the adapter will fail explicitly.

## Consequences

- **Pros:**
  - High structural parity with the Go TALA implementation, easing the future migration of layout algorithms.
  - Faster traversal during layout execution, as edge endpoints are immediate object references.
- **Cons:**
  - Graph serialization and deep-cloning become slightly more complex due to circular object references (e.g., `cloneGraph` must re-wire references manually).
  - Memory footprint might theoretically differ, though direct references are standard in JS engines.
