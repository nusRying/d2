# ADR-027: Nested Geometry Synchronization (Slice 26)

## Status
Accepted

## Context
TALA orchestrates geometry nested updates through `Graph.SyncNestedGeometry()`. This iterates through every node in `Graph.Nodes` in source order and applies independent sync stages for Container Positioning, Cluster Synchronization (and associated padding correction), and Sequence Synchronization. 

Since this method acts as an orchestrator of previously approved primitives, strict conformance to the original Go ordering and conditional logic is mandatory to ensure identical final layout geometry. 

## Design Parity Decisions

### 1. Traversal Order
`SyncNestedGeometry` loops through `Graph.Nodes` using native array iteration (`for (const node of this.Nodes)`), which mirrors Go's `for _, n := range g.Nodes`. No deduplication or reordering occurs. 

### 2. Condition Independence
Unlike mutually exclusive conditionals, the Go code uses three separate `if` blocks for container, cluster, and sequence handling. A single multi-role node will have all applicable stages executed sequentially in exact Go order:
1. `node.positionContainerChildren(true)`
2. `this.Clusters.get(node).SyncGeometry()` (with padding correction)
3. `this.Sequences.get(node).SyncGeometry()`

### 3. Cluster Padding Correction
If a cluster member is also a container, it must have its padding applied. This involves:
- Computing `this.containerPadding(cn, true)`
- Getting `this.Containers.get(cn)`
- Using `child.moveNodeWithChildren(padding.left, padding.top)` to shift descendants.

### 4. Natural Failures & Map Membership
Instead of aggressive `if (seq)` guard clauses, the JS implementation relies on `this.Sequences.get(node) !== undefined` and natural `TypeError` throwing to perfectly reflect Go map presence versus `nil` pointers.

## Consequences
- The orchestration perfectly matches Go output logic.
- Node arrays process predictably according to `Graph.Nodes` source order.
- Test instrumentation verifies the method execution order rather than just the resultant coordinates.
