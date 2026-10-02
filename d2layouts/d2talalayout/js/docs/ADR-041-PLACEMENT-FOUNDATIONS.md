# ADR-041: Placement Foundations Bundle (Slice 40)

## Status
Implemented — awaiting Slice 40 review

## Context
Following the formal approval of Slice 39 (`PlaceChildrenOrder`), Slice 40 transitions the TALA JavaScript migration from previous micro-slices to an intentionally larger, dependency-closed foundation bundle. This bundle packages all fundamental primitives and invariant checkers required by downstream placement stages (optimizers, compaction, and orthogonal placement) without premature orchestration or optimizer expansion.

Pinned upstream Go reference:
`01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

Authoritative pinned Go files:
- `d2layouts/d2talalayout/internal/placement/axis.go`
- `d2layouts/d2talalayout/internal/placement/node_placement.go`
- `d2layouts/d2talalayout/internal/placement/stress_initialize.go`
- `d2layouts/d2talalayout/internal/placement/stages.go`
- `d2layouts/d2talalayout/internal/placement/cluster_connections.go`
- `d2layouts/d2talalayout/internal/placement/tuning.go`
- `d2layouts/d2talalayout/internal/layoutgraph/graph.go`
- `d2layouts/d2talalayout/internal/layoutgraph/placement_access.go`
- `d2layouts/d2talalayout/internal/layoutgraph/topology_preflight.go`

## Scope of Bundle
Slice 40 encompasses exactly seven dependency-closed placement foundation components:
1. **Layout Axis Primitives** (`src/placement/axis.js`):
   - `LayoutAxis` enum (`Invalid`: 0, `Horizontal`: 1, `Vertical`: 2)
   - `axisValid(axis)`: returns true for Horizontal and Vertical
   - `axisIsHorizontal(axis)`: returns true for Horizontal
   - `oppositeAxis(axis)`: flips Horizontal <-> Vertical; invalid and unknown remain Invalid
   - `axisForArrangement(arrangement)`: returns Horizontal strictly for `ClusterArrangement.Column`; returns Vertical for all other inputs (Row, null, undefined, unknown)
2. **Traversal Direction Primitives** (`src/placement/axis.js`):
   - `TraversalDirection` enum (`Invalid`: 0, `Forward`: 1, `Backward`: 2)
   - `directionValid(dir)`: returns true for Forward and Backward
   - `directionIsForward(dir)`: returns true for Forward
   - `oppositeDirection(dir)`: flips Forward <-> Backward; invalid and unknown remain Invalid
3. **Graph Fixed-Node Access** (`src/graph/graph.js`):
   - `fixedNodes()` / `FixedNodes()`: filters `this.Nodes` preserving source order and object identity for nodes where `FixedTopLeft != null`
   - `hasFixedNode()` / `HasFixedNode()`: returns boolean check whether any node has `FixedTopLeft != null`
4. **Placement Validation** (`src/placement/validation.js`):
   - `validateCellSize(g)`: validates `CellSize >= 1`, integer truncations, non-NaN, finite
   - `validatePlacedNodes(root, nodes)`: verifies all nodes have `TopLeft != null` in source order; reports invariant violation with container ID (or container 0 if root is nil)
   - `validateGridAlignment(g)`: runs `validateCellSize` first; scans nodes in source order; exempts fixed nodes; verifies `TopLeft != null`; verifies coordinate grid alignment via modulo with `CellSize`
5. **Graph-Distance Initializer** (`src/placement/stress-initialize.js`):
   - `initializeByGraphDistance(ctx, g)`:
     - Preflight validation via `layoutgraph.Validate(ctx, "GraphDistanceInitialization", g)`
     - Eligibility gates: `4 <= n <= 64`, `edges <= 256`, `!g.hasFixedNode()`; returns `false` (fallback) without mutating geometry if ineligible
     - Floyd-Warshall shortest path distance matrix on undirected graph edges; returns `false` if disconnected (infinite distance)
     - Circular embedding initialization (`a = 2 * pi * i / n`, `r = sqrt(n)`)
     - 48 relaxation sweeps with context cancellation polling at the start of each sweep
     - Stable degree-ordered integer cell ring assignment with deterministic tie-breaking
     - Atomic commit: coordinates assigned locally, final `ctx.isCancelled()` check, then committed to `node.TopLeft`
6. **Placement Stage Geometry Helpers** (`src/placement/stage-geometry.js`):
   - `placementPadding`: constant `1000.0`
   - `normalize(g)` / `Normalize(g)`:
     - If graph has fixed nodes: unconditionally sets discovery minima to `(1000, 1000)` and shifts all nodes and edge points by `(-1000, -1000)`
     - Otherwise discovers geometric minimum across node `TopLeft`, floored edge `Points`, and floored edge `LabelTopLeft`, then translates nodes and edge points to origin
   - `pad(g)` / `Pad(g)`: shifts all graph node `TopLeft` coordinates by `+1000.0, +1000.0`; does not shift edge points, labels, or `FixedTopLeft`
7. **Cluster External Connection Discovery** (`src/placement/cluster-connections.js`):
   - `clusterExternalConnectedNodes(cluster)` / `ClusterExternalConnectedNodes(cluster)`:
     - Extracts `currentGraph = cluster.Nodes[0].Graph`
     - Scans `cluster.EdgeAbductions` in source order
     - Selects `CurrentFrom` when `OriginallyFrom == null && OriginallyTo != null`
     - Selects `CurrentTo` when `OriginallyTo == null && OriginallyFrom != null`
     - Filters candidates requiring `TopLeft != null` and `candidate.Graph === currentGraph`
     - Deduplicates preserving first-seen encounter order without sorting

## Design Decisions and Parity Highlights
- **First Larger Migration Slice**: Moving beyond micro-slices allows closely coupled placement foundations to land together with full cross-verification while strictly preserving pinned Go observable behavior.
- **Internal Placement Scope Only**: None of the new helpers are exported from `src/placement/index.js` or `src/index.js`. The public API boundary remains intact.
- **Normalize Fixed-Node Oddity**: When any fixed node exists, `Normalize` unconditionally shifts all nodes and edge points by `(-1000, -1000)`. Composing `Normalize` followed by `Pad` restores node coordinates to their original positions, but edge points remain shifted by `-1000`.
- **Graph-Distance Atomicity**: Cancellation or fallback during graph-distance stress initialization never leaves partially mutated node coordinates.
- **Deterministic Numerical Parity**: Verified against real Go oracle output across 69 scenario groups, including exact coordinates for path, star, and cycle graphs.
