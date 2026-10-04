# Slice 18 Progress Report: Node-Set Bounds & Fixed-Origin Geometry

## 1. Branch and Baseline Verification
- **Repository:** `C:\Users\Umair\Videos\Freelance\Test Task\d2`
- **GitHub Remote:** `nusRying/d2`
- **Approved Starting Point (Slice 17):**
  - Branch: `tala-js/slice-17-descendant-node-movement`
  - Approved Base SHA: `766b297f768a06d99a603caed0b105a22664d61c`
- **Working Branch:** `tala-js/slice-18-node-bounds-fixed-origin`
- **Merge Base:** `766b297f768a06d99a603caed0b105a22664d61c`

## 2. Implemented Scope
Slice 18 delivers the bounds computation and fixed-origin geometry layer for nodes and node-sets:

- **Label Positioning and Point Projection** (`js/src/graph/label-position.js`):
  - `LABEL_PADDING = 5`: constant spacing between node border and outside elements.
  - `LabelPosition` enum and canonical string mappings covering all 36 Go enum positions.
  - `isOutsideLabelPosition(pos)`: identifies Outside positions (numeric 1..12, string `OUTSIDE_*`, or `IsOutside()` method).
  - `getPointOnBox(position, box, padding, width, height)`:
    - Full deterministic switch across all 12 Outside, 9 Inside, and 12 Border positions matching `lib/label/label.go`.
    - Unset/Unknown fallback returns `box.TopLeft.copy()`.

- **Node Modifier and Bounds Primitives** (`js/src/graph/node.js`):
  - `Node.modifierElementAdjustments()` and `ModifierElementAdjustments()`:
    - Priority rule: `Is3D` takes precedence over `IsMultiple`.
    - 3D Hexagon: `dx = 15, dy = 7.5`.
    - 3D normal: `dx = 15, dy = 15`.
    - Multiple: `dx = 10, dy = 10`.
    - Default shape `""` is not treated as Hexagon.
  - `Node.boundingBoxValues(allNodes, roundDimensions)`:
    - Initial `tl = copy(TopLeft)`, `br = tl + (Width, Height)`. Throws TypeError naturally if `TopLeft == null`.
    - Go-compatible rounding: uses `goRound` from `src/geometry/math.js` for negative half-values away from zero.
    - Asymmetric modifier adjustment: `tl.Y -= dy`, `br.X += dx`.
    - `LoopOffsets` application: safe lookup supporting `Map` and plain objects without mutating inputs.
    - Outside label expansion: evaluates when `Label != null && isOutside && allNodes != null`. Uses boundary padding 5 at extremes, 10 otherwise. Legacy right/bottom trigger compares anchor `labelTL.X > br.X` and `labelTL.Y > br.Y`.
    - Outside icon expansion: evaluates when `Icon != null && shape !== "Image" && isOutside && allNodes != null`. Fixed size 64, fixed padding 10. Excludes Image shape.
  - `Node.boundsWithRounding(allNodes, roundDimensions)` and `bounds(allNodes)` / `Bounds(allNodes)`.
  - `Node.fixedOrigin()` and `FixedOrigin()`: returns `new Point(TopLeft.X - FixedTopLeft.X, TopLeft.Y - FixedTopLeft.Y)`.
  - `Node.containerLevel()` and `ContainerLevel()`: counts ancestor hops via `owningContainer()`.

- **Node-Set Helpers and Fixed Bounds** (`js/src/graph/node-bounds.js`):
  - `nodesLeftmost`, `nodesTopmost`, `nodesRightmost`, `nodesBottommost`:
    - Skips target identity and skips peers with null TopLeft.
    - Equality does not disqualify target (tied extrema supported).
  - `nodesBoundingBox(nodes, roundDimensions)` and `nodesBounds(nodes)`:
    - Empty set returns `[Point(-Infinity, -Infinity), Point(Infinity, Infinity)]`.
    - Any node with null TopLeft returns `[null, null]` immediately.
  - `nodesSubgraphContainer(nodes)`:
    - First null owning container causes immediate null return.
    - Container of least nested node wins; strict `<` breaks ties (first minimum wins).
  - `nodesFixedOrigin(nodes)`:
    - Finds first eligible node in subgraph container with non-null fixedOrigin.
    - Root-level nodes (`container === null`) are eligible.
  - `nodesFixedBounds(nodes)` and public equivalent `FixedBoundingBox(nodes)`:
    - `[tl, br] = nodesBounds(nodes)`. If `fixedOrigin != null`, `tl = fixedOrigin`.
    - Asymmetric replacement: `br` is NEVER translated by fixed origin.
    - Preserves `[Point, null]` malformed state when one node has null TopLeft but sibling has fixed origin.
    - Read-only: input array and node geometries are never mutated.

## 3. Real-Go Oracle and Verification Infrastructure
- **Oracle Generator:** `js/test/reference/go_node_bounds_oracle.go`
  - Scenarios: `empty_nodes`, `simple_rounded_bounds`, `negative_half_rounding`, `fractional_dimensions`, `negative_dimensions`, `loop_offsets`, `modifier_3d_square`, `modifier_3d_hexagon`, `modifier_multiple`, `modifier_3d_beats_multiple`, `modifier_plus_loop_offsets`, `outside_label_boundary`, `outside_label_nonboundary`, `outside_icon`, `image_icon_excluded`, `combined_label_modifier_loop`, `fixed_origin_root`, `fixed_origin_nested`, `fixed_origin_first_wins`, `fixed_origin_active_cluster`, `fixed_origin_active_sequence`, `partial_null_with_fixed_origin`, `outside_label_bottom_right_boundary`, `outside_label_bottom_right_nonboundary`, `tied_extremes`, `nil_peer_top_left`.
- **Oracle Fixture:** `js/test/fixtures/go-node-bounds-reference.json`
  - File Size: `5,133` bytes
  - Deterministic SHA256 across consecutive runs: `a2d1715949679d76ee142b2ce9b68d10602607b5a6e2a4eb0ab3f8f94fc54e91`
- **Oracle Replay Test:** `js/test/unit/node-bounds-oracle.test.js`
  - 31 pass, 0 fail (140 `expect()` assertions).
  - Includes explicit semantic contract assertions against fixture values.
- **Direct JS Unit Test:** `js/test/unit/node-bounds.test.js`
  - 35 pass, 0 fail (160 `expect()` assertions).
  - Full projection and bounds coverage, immutability and object identity verification.

## 4. Test Suite and Static Analysis Results
- **JS Test Suite:** 860 pass, 0 fail across 37 files (44,922 expectations).
- **Go Tests:**
  - `internal/layoutgraph/...`: `ok` (0.852s)
  - `internal/grouping/...`: `ok` (0.310s)
- **Static Audit:**
  - `Math.random` in `js/src`: 0
  - Node-only imports in `js/src`: 0
  - Root `js/src/index.js` exposure: unchanged (no grouping or bounds exposed)
  - Forbidden Slice 19+ tokens: 0 occurrences
