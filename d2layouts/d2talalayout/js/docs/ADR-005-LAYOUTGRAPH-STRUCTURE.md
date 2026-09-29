# ADR 005: TALA LayoutGraph Structure and Identifiers

## Date
2026-09-29

## Status
Implemented — awaiting Slice 04 review

## Context
TALA (the DAG placement and routing algorithm) operates on an internal graph representation rather than raw D2 AST or ELK JSON. 

In Go, TALA's `layoutgraph` maintains nodes, edges, hierarchies, connection management, tree topologies, clustering states, near topologies, and geometry. Additionally, graph entities are identified using stable `EntityID` (int64) hash values derived from FNV-1a. 

When porting TALA to JavaScript, we must decide whether to leverage external open source graph structures (like dagre/graphlib) or replicate `layoutgraph` faithfully.

## Decisions

1. **BigInt EntityID**: Entity identifiers are represented as native JavaScript `BigInt` values to guarantee lossless 64-bit integer semantics matching Go's `int64`/`uint32` allocation ranges.
2. **UTF-8 FNV Allocation**: Deterministic entity ID generation implements exact 32-bit FNV-1a hashing (`d2FNV32`) over UTF-8 byte streams, complete with secondary linear spill allocation starting at `firstD2SpillEntityID` (`1 << 32`).
3. **Go-Byte String Comparator**: String ordering for ambiguous hash collision resolution uses `compareGoStringsUTF8` (lexicographical UTF-8 byte comparisons) rather than JavaScript UTF-16 code-unit ordering, ensuring identical tie-breaking across Go and JS runtimes (e.g., `U+E000` < `U+10000`).
4. **Canonical Node.Box**: Node geometry is anchored by a persistent composed `geo.Box` instance accessed through Go-compatible capitalized getters/setters (`TopLeft`, `Width`, `Height`), avoiding divergent geometric representations.
5. **External and Numeric Indexes**: The graph maintains dedicated lookup maps (`nodesByExternalId`, `edgesByExternalId`, `nodesByEntityId`, `edgesByEntityId`) that survive graph cloning and rebind exclusively to cloned records.
6. **Persistent Endpoint Index**: Port and node endpoints are registered in `endpoints` map with `{ kind: "node" | "port", node, port }`, fully isolated during cloning.
7. **Absolute Internal Coordinates**: The internal layout graph operates strictly in absolute coordinates throughout all layout and routing passes.
8. **Relative ELK Output**: The ELK boundary adapter reconstructs nested relative coordinates (`elkNode.x`, `elkNode.y`) from internal absolute positions only at the serialization boundary.
9. **Transitional edge.route**: Multi-section edge route arrays (`edge.route`) pass through untouched when unrouted, preserving ELK section bend points and custom section metadata across round-trips.

## Rationale
- **Deterministic Parity**: Using `BigInt` and explicitly duplicating the hash function ensures that sorting maps by ID (as TALA does) produces the exact same layout in JS as it does in Go.
- **Portability of Logic**: The TALA layout pipeline (routing, compaction, hierarchy) relies on layoutgraph's unique operations (e.g. `isLoop()`, `reconnect()`). Reusing `dagre` or a naive graph would require writing bridging logic that introduces numeric and ordering discrepancies.
- **Clone Safety**: TALA relies heavily on mutable state passes that involve deep cloning of the graph structure (`cloneGraph`). Structuring our JS nodes identically ensures the cloning guarantees match Go perfectly without leaking mutations.

## Consequences
- TALA JS requires `BigInt` support (available in modern browsers and ES2020+).
- The JS graph objects are relatively verbose and carry explicit Go-like casing conventions (e.g. `node.TopLeft`, `node.Nears`). This aids review against Go reference sources but slightly deviates from conventional JS styling.
