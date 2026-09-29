# ADR 005: TALA LayoutGraph Structure and Identifiers

## Date
2026-09-29

## Status
Accepted

## Context
TALA (the DAG placement and routing algorithm) operates on an internal graph representation rather than raw D2 AST or ELK JSON. 

In Go, TALA's `layoutgraph` maintains nodes, edges, hierarchies, connection management, tree topologies, clustering states, near topologies, and geometry. Additionally, graph entities are identified using stable `EntityID` (int64) hash values derived from FNV-1a. 

When porting TALA to JavaScript, we must decide whether to leverage external open source graph structures (like dagre/graphlib) or replicate `layoutgraph` faithfully.

## Decision
We will faithfully port Go's `d2layouts/d2talalayout/internal/layoutgraph` structure to JavaScript. 
1. **EntityIDs**: We will use JavaScript `BigInt` to guarantee lossless 64-bit precision for `EntityID`. 
2. **Hash Function**: We will replicate Go's `hash.FNV32` and `allocateD2EntityIDs` bit-for-bit, including simulated overflow wrapping, for deterministic ID assignment across environments.
3. **Graph Topology**: `Node`, `Edge`, and `Graph` will match Go's API explicitly (e.g. capitalized struct fields, `addNear`, `connect`/`disconnect`).
4. **Coordinate Semantics**: We will explicitly map TALA's absolute coordinates into the ELK adapter's relative coordinates instead of interweaving relative coordinate math into TALA algorithms.

## Rationale
- **Deterministic Parity**: Using `BigInt` and explicitly duplicating the hash function ensures that sorting maps by ID (as TALA does) produces the exact same layout in JS as it does in Go.
- **Portability of Logic**: The TALA layout pipeline (routing, compaction, hierarchy) relies on layoutgraph's unique operations (e.g. `isLoop()`, `reconnect()`). Reusing `dagre` or a naive graph would require writing bridging logic that introduces numeric and ordering discrepancies.
- **Clone Safety**: TALA relies heavily on mutable state passes that involve deep cloning of the graph structure (`cloneGraph`). Structuring our JS nodes identically ensures the cloning guarantees match Go perfectly without leaking mutations.

## Consequences
- TALA JS requires `BigInt` support (available in modern browsers and ES2020+).
- The JS graph objects are relatively verbose and carry explicit Go-like casing conventions (e.g. `node.TopLeft`, `node.Nears`). This aids review against Go reference sources but slightly deviates from conventional JS styling.
