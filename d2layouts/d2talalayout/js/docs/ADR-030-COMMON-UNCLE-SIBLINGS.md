# ADR-030: Proximity Common-Uncle Sibling Discovery (`CommonUncleSiblings`) (Slice 29)

## Status
Accepted

## Context
In TALA's proximity pipeline, `proximity.CommonUncleSiblings(graph)` identifies sibling nodes that share an external connection to the same "uncle" — a node at the parent container's peer level. The largest group of such siblings becomes a proximity hint for the placement stage.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/common_uncle.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Design Parity Decisions

### 1. Pure Read-Only Function — No WorkGuard, No Validation
`CommonUncleSiblings` in Go takes only `*layoutgraph.Graph` and returns a map. It performs no `validateEngineGraph`, no `WorkGuard`, no `GraphState`, and no context cancellation checks. The JS implementation matches this exactly: single argument `graph`, no context, no guard, no atomicity wrapper.

### 2. Traversal via `graph.ContainerRDFSOrderUnbounded(null)`
Go iterates `graph.ContainerRDFSOrder(nil)` (the unbounded variant). JS calls `graph.ContainerRDFSOrderUnbounded(null)`. The returned array is the container-RDFS post-order of all containers. The `null` root traverses from the top of the hierarchy.

### 3. Per-Container `uncleToCousins` Map Reset
After processing each container's children and computing the winning uncle group, `uncleToCousins` is reset to a **new empty Map** before moving to the next container. This matches Go's `uncleToCousins = make(map[*layoutgraph.Node]layoutgraph.Nodes)` inside the loop.

### 4. Persistent `orderedUncles` Slice — NOT Reset Per Container
`orderedUncles` is declared **outside** the container loop and is **never reset**. This mirrors Go's `var orderedUncles []*layoutgraph.Node` outside the `for` loop. As the traversal visits more containers, previously seen uncles from earlier containers remain in `orderedUncles` and are iterated again with the newly-reset `uncleToCousins` map. Since `uncleToCousins` has been reset, any uncle not freshly seen in the current container will produce an empty/nil cousin list and be silently skipped.

### 5. Raw `.Container` Comparison — Not `OwningContainer()`
Uncle eligibility check: `adjacent.Container === container.Container`. This is a **raw `.Container` field comparison**, deliberately not using `OwningContainer()` / `owningContainer()` (which follows Cluster/Sequence indirection). This matches the Go source which does `adjacent.Container == container.Container`.

### 6. Cousin Deduplication (no duplicates per uncle)
Before appending a node to a uncle's cousin list, the implementation checks `!cousins.includes(node)`. This prevents a child from appearing more than once for the same uncle, even when multiple parallel edges connect the child to the uncle.

### 7. Larger-Group Wins / Tie Behavior
For each sibling that appears in multiple uncle groups:
- The sibling is assigned to the **largest** group (most cousins).
- **Tie-breaking**: if two groups have equal size, the sibling retains whichever group was installed first (matching Go's `len(existing) < len(siblings)` — strictly less than, so equal-length groups do not replace).

### 8. Fresh Return Map — `graph.CommonUncleSiblings` Not Mutated
`CommonUncleSiblings` always returns a fresh `Map`. It does **not** read from or write to `graph.CommonUncleSiblings`. The Go function also does not assign to the graph field — it returns a value. Callers that need persistence are responsible for assigning the result to `graph.CommonUncleSiblings` themselves.

### 9. Nil Edge / Null Edge Handling
`node.Edges ?? []` handles null/undefined edge slices without throwing. However, a null element **within** the slice (e.g. `[null]`) will cause `node.Adjacent(null)` → `null.From` → TypeError, matching Go's nil-pointer dereference panic for the same input.

### 10. Browser Safety and Architecture
Implemented in `src/proximity/common-uncle.js` and exported via `src/proximity/index.js` (`commonUncleSiblings` and PascalCase alias `CommonUncleSiblings`). Proximity internals are not exported from root `src/index.js`. Zero Node.js runtime imports or non-deterministic primitives are used.
