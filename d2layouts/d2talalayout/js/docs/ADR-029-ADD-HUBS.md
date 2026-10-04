# ADR-029: Proximity Hub Discovery (`AddHubs`) (Slice 28)

## Status
Accepted

## Context
In TALA's proximity pipeline, `proximity.AddHubs(ctx, graph)` identifies "hubs" — nodes that have both a leaf spoke (degree 1) and at least one other non-leaf connection (degree != 1) within the same layout group (same `OwningContainer`). Discovered hubs and their ordered leaf spokes are recorded in `graph.Hubs`.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/hubs.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Design Parity Decisions

### 1. Validate-First Execution
`validateEngineGraph(context, "AddHubs", graph)` is executed prior to WorkGuard construction or any hub computation. If topology validation fails, the function throws immediately without allocating or touching `graph.Hubs`.

### 2. WorkGuard Budget and Accounting
A fresh `WorkGuard` is created with location `"AddHubs"` and limit `MAX_ENGINE_WORK_UNITS` (61,440,000 work units).
Accounting strictly matches Go:
- Exactly 1 work unit per `graph.Nodes` entry scanned.
- Exactly 1 work unit per `node.Edges` entry scanned.
- `guard.Finish()` is called after all iterations complete, right before installing `graph.Hubs`.

### 3. Local Temporary Map & Failure Atomicity
To match Go's atomicity semantics:
- A local `hubs = new Map()` is populated during the scan.
- `graph.Hubs` is only replaced after all node and edge scans complete and `guard.Finish()` succeeds.
- On any validation failure, context cancellation, or work limit exceedance, the original `graph.Hubs` Map reference and its contents remain completely untouched.

### 4. Fresh Map Replacement on Success
On success, `graph.Hubs` is assigned the local `hubs` Map reference. This ensures the map reference is always replaced upon successful execution, even if no hubs are found or if the discovered hubs match prior contents.

### 5. Node and Edge Iteration Ordering
- Node iteration uses `graph.Nodes` source array order without sorting, deduplication, or filtering.
- Edge iteration uses `node.Edges` source array order. Discovered spokes are appended in the exact order their incident edges appear on the hub node. Spoke IDs are not sorted.

### 6. OwningContainer Layout Group Filtering
For each incident edge, `adjacent = node.Adjacent(edge)`.
The adjacent node is compared using `adjacent.OwningContainer() !== node.OwningContainer()`. If the owning containers differ, the edge is skipped entirely — contributing neither a spoke nor setting `hasConnected`. Root-level nodes have `OwningContainer() === null` and are considered in the same group.

### 7. Hub Classification Rules
A node is recorded in `graph.Hubs` if and only if:
1. `spokes.length > 0`: At least one same-container adjacent node has raw incident edge count equal to 1 (`adjEdgeCount === 1`).
2. `hasConnected === true`: At least one same-container adjacent node has raw incident edge count not equal to 1 (`adjEdgeCount !== 1`).

Candidate nodes with leaf spokes only or non-leaf connections only are not hubs.

### 8. Nil-Slice Parity
In Go, nil slices range cleanly with 0 iterations and have `len() == 0`.
JavaScript uses `graph.Nodes ?? []`, `node.Edges ?? []`, and `adjacent.Edges != null ? adjacent.Edges.length : 0` to preserve exact Go nil-slice parity without masking invalid topology states rejected by preflight validation.

### 9. Browser Safety and Architecture
Implemented in `src/proximity/hubs.js` and exported via `src/proximity/index.js` (`addHubs` and PascalCase alias `AddHubs`). Proximity internals are not exported from root `src/index.js`. Zero Node.js runtime imports or non-deterministic primitives are used.
