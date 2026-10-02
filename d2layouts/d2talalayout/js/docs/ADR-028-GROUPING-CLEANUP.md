# ADR-028: Grouping Cleanup (Slice 27)

## Status
Implemented — awaiting Slice 27 review

## Context
In TALA's layout pipeline, `grouping.Cleanup(graph)` restores cluster members and sequence steps back into the active graph after node placement, and retires the temporary cluster/sequence vessels.

Pinned reference:
`d2layouts/d2talalayout/internal/grouping/lifecycle.go` at `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Design Parity Decisions

### 1. Phased Processing Order
1. Clusters are cleaned first, in sorted node/entity ID order determined by `graph.ClusterOrder()`.
2. Sequences are cleaned second, in sorted node/entity ID order determined by `graph.SequenceOrder()`.
3. Herd assignments are cleared last across all surviving nodes currently in `graph.Nodes`.

This ensures deterministic output regardless of JS Map insertion order.

### 2. Geometry Arrangement Prior to Reinsertion
Before members are re-added to the graph, `cluster.ArrangeClusterNodes()` or `sequence.ArrangeSteps()` is invoked. Neither `SyncGeometry()` nor extra resizing is called during cleanup.

### 3. Member Reinsertion Semantics
For each member in `cluster.Nodes` / `sequence.Nodes`, `graph.AddNewNodeToContainer(container, node)` is called. This appends the node to `graph.Nodes`, appends it to `graph.Containers[container]`, and sets `node.Graph = graph` and `node.Container = container`.

### 4. Edge Abduction Restoration
Abducted edge endpoints are restored via `abduction.Edge.Reconnect(...)`. If an edge was abducted on both endpoints, `OriginallyFrom` is reconnected first, followed by `OriginallyTo`. No artificial guards are added, preserving Go's natural panic semantics when abduction entries are nil.

### 5. Near Transfer & Set Replacement
If `vessel.Nears` is non-empty:
1. It is iterated in ID-sorted order via `vessel.OrderedNears()`.
2. For each near neighbor, the vessel is removed (`near.Nears.delete(vessel)`).
3. The near neighbor is linked symmetrically to each member (`near.AddNear(node)`).
4. `vessel.Nears` is replaced with a new empty `Set` (`vessel.Nears = new Set()`), mirroring Go's `vessel.Nears = map[*layoutgraph.Node]struct{}{}`.

### 6. Vessel Retirement and Map Retention
- The vessel is removed from `graph.Nodes` via `graph.removeNode(vessel)`.
- The vessel is filtered out from its container's child array in `graph.Containers`.
- `vessel.Container = null` and `vessel.Graph = null` are assigned.
- Importantly, `graph.Clusters` and `graph.Sequences` are **retained**; they are not cleared or deleted by `Cleanup` (in contrast to `ResetClusters`).

### 7. HerdAssignment Clearing
`node.HerdAssignment = null` is executed for every node present in `graph.Nodes`. Because retired vessels were already removed from `graph.Nodes`, their `HerdAssignment` field is not cleared.

## Consequences
- Full parity with Go `grouping.Cleanup`.
- Deterministic member and container ordering matching Go reference oracles.
- Zero extra allocations or defensive masking of malformed state.
