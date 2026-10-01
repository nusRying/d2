# ADR 019: Node-Set Bounds & Fixed-Origin Geometry

## Date
2026-10-01

## Status
Implemented — awaiting Slice 18 review

## Context
In TALA's layout grouping pipeline, post-layout cleanup (`Cleanup`) arranges cluster nodes and composite container children via `Cluster.ArrangeClusterNodes -> PositionContainerChildren`. These algorithms rely fundamentally on computing the bounding boxes of node sets accounting for fixed-origin offsets (`children.fixedBounds()`).

Before shape-specific `InsidePlacement` or container child positioning can be ported in Slice 19, the underlying geometry bounds layer must be established in JavaScript with exact Go parity.

Pinned Go references:
- `d2layouts/d2talalayout/internal/layoutgraph/node.go` (`bounds`, `boundsWithRounding`, `boundingBoxValues`, `boundingBox`, `fixedBounds`, `modifierElementAdjustments`, `Leftmost`, `Topmost`, `Rightmost`, `Bottommost`, `containerLevel`, `container`)
- `d2layouts/d2talalayout/internal/layoutgraph/graph.go` (`subgraphContainer`, `fixedOrigin`, `containerFixedOrigin`)
- `d2layouts/d2talalayout/internal/layoutgraph/placement_access.go` (`FixedBoundingBox`, `ContainerLevel`)
- `d2layouts/d2talalayout/internal/layoutgraph/packing_access.go` (`ModifierElementAdjustments`)
- `lib/label/label.go` (`GetPointOnBox`, `IsOutside`, `PADDING`)
- `lib/geo/orientation.go` (`Orientation` enum)

---

## Architectural Decisions

### 1. Raw Box to Rounded Bottom-Right Ordering
In `Node.boundingBoxValues(allNodes, roundDimensions)`:
1. `tl = new Point(node.TopLeft.X, node.TopLeft.Y)`. A null `TopLeft` naturally panics/throws TypeError.
2. `br = new Point(tl.X + node.Width, tl.Y + node.Height)`.
3. If `roundDimensions`: `br.X = goRound(br.X)` and `br.Y = goRound(br.Y)` using `goRound` from `src/geometry/math.js` for exact Go-compatible negative half-rounding away from zero.
4. Modifier adjustments are applied next: `tl.Y -= dy` and `br.X += dx` (asymmetric: `dx` does NOT move `tl.X`, and `dy` does NOT extend `br.Y`).
5. `LoopOffsets` adjustments are applied next: `tl.X -= left`, `tl.Y -= top`, `br.X += right`, `br.Y += bottom`.
6. Outside label adjustments are applied next.
7. Outside icon adjustments are applied last.

This deterministic execution order is strictly preserved.

### 2. Modifier Element Adjustments
- `threeDOffset = 15.0`, `multipleOffset = 10.0`.
- Priority rule: `Is3D` takes precedence over `IsMultiple`. If both are true, ONLY 3D offsets apply.
- Shape rule: If `Is3D` and raw `_shapeType === "Hexagon"`, `dy = 15 / 2 = 7.5` and `dx = 15`. Otherwise `dx = 15, dy = 15`.
- If `IsMultiple` without `Is3D`, `dx = 10, dy = 10`.
- Default shape `""` is not Hexagon.

### 3. LoopOffsets Semantics
A nil or missing Go map returns `0.0`. In JS, `node.LoopOffsets` may be `null`, `undefined`, a `Map`, or a plain object. The lookup helper safely returns `0` for any missing key or null map without mutating `LoopOffsets`.

### 4. Outside Label Positioning and Boundary-Specific Padding
- Label positioning evaluates only when `node.Label != null && isOutsideLabelPosition(node.Label.Position) && allNodes != null`.
- Label anchor point `labelTL` is computed against the raw unexpanded `node.Box` using `getPointOnBox(position, node.Box, 5, width, height)`.
- Left expansion: `if (labelTL.X < tl.X)`, uses boundary padding `5` if `nodesLeftmost(allNodes, node)`, else `10`.
- Top expansion: `if (labelTL.Y < tl.Y)`, uses boundary padding `5` if `nodesTopmost(allNodes, node)`, else `10`.
- Right expansion legacy trigger: `if (labelTL.X > br.X)` (comparing anchor X directly, not right edge of label), adds `label.Width + 5` if `nodesRightmost(allNodes, node)`, else `label.Width + 10`.
- Bottom expansion legacy trigger: `if (labelTL.Y > br.Y)` (comparing anchor Y directly, not bottom edge of label), adds `label.Height + 5` if `nodesBottommost(allNodes, node)`, else `label.Height + 10`.
- When `allNodes == null`, outside labels are ignored entirely.

### 5. Outside Icon Adjustment & Image Exclusion
- Evaluates only when `node.Icon != null && node._shapeType !== "Image" && isOutsideLabelPosition(node.Icon.Position) && allNodes != null`.
- If raw `_shapeType === "Image"`, outside icons do not affect bounds.
- Icon dimensions are capped at `64 x 64` (`MaxIconSize`), with anchor `getPointOnBox(icon.Position, node.Box, 5, 64, 64)`.
- Unlike labels, icons always use fixed padding `10` regardless of boundary status.
- Left/top/right/bottom expansions update bounds independently using min/max.

### 6. Node-Set Extremal Helpers
`nodesLeftmost`, `nodesTopmost`, `nodesRightmost`, `nodesBottommost`:
- Iterate nodes in input order.
- Skip exact target identity (`peer === node`).
- Skip peers where `peer.TopLeft == null`.
- Equality does not disqualify the target (tied nodes are all recognized as extremes).
- Compare only raw coordinate edges; do not incorporate labels, icons, modifiers, or LoopOffsets.

### 7. Empty Bounds & Null TopLeft Handling
- `nodesBoundingBox([], round)` returns `[Point(-Infinity, -Infinity), Point(Infinity, Infinity)]`.
- If any node in the input set has `node.TopLeft == null`, `nodesBoundingBox` returns `[null, null]` immediately.
- Duplicate node instances in input arrays are processed repeatedly without sorting or deduplication.

### 8. Container Level & Active Cluster/Sequence Ownership
- `node.containerLevel()` traverses the `owningContainer()` chain until `null`, counting hops.
- Active `Cluster` and `Sequence` ownership takes precedence over raw `node.Container`: if an active cluster or sequence vessel exists, the vessel's container is returned.
- `nodesSubgraphContainer(nodes)` finds the container of the least nested node. If any node has a `null` owning container, it returns `null` immediately. Strict `<` breaks ties so the first minimum-level container wins.

### 9. Fixed Origin & Fixed Bounds
- `node.fixedOrigin()` returns `new Point(TopLeft.X - FixedTopLeft.X, TopLeft.Y - FixedTopLeft.Y)` if both points are present, else `null`. Points are not rounded and original objects are not mutated.
- `nodesFixedOrigin(nodes)` identifies `container = nodesSubgraphContainer(nodes)`, and finds the first node belonging to `container` that has a valid `fixedOrigin()`. Root-level nodes (`container === null`) are eligible.
- `nodesFixedBounds(nodes)` calls `[tl, br] = nodesBounds(nodes)`. If `fixedOrigin != null`, `tl` is replaced with `fixedOrigin`.
- Asymmetric replacement: `br` is NEVER translated or recomputed by the fixed origin.
- Malformed state preservation: if `nodesBounds` returned `[null, null]` due to a peer with `TopLeft == null`, but an eligible sibling has a valid fixed origin, `nodesFixedBounds` returns `[Point, null]`.

### 10. Scope Boundaries & Deferred Features
- No `WorkGuard`, `context`, cancellation, transaction, `GraphState`, or RNG in Slice 18.
- `PositionContainerChildren`, `InsidePlacement`, `InnerBox`, `expandForLabels`, `wrapChildren`, `fitToBoundingBox`, `Cluster.ArrangeClusterNodes`, and `Cleanup` remain strictly deferred.
- No public exposure in root `js/src/index.js`.
