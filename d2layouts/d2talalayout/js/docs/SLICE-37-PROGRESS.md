# Slice 37 Progress: Graph & Edge Bounding Box Kernel

## Summary
- **Slice**: 37 — Graph & Edge Bounding Box Kernel
- **Status**: Implemented — awaiting Slice 37 review
- **Base Commit**: `ee9711f332591c1fb9bbe5066b994aeda45348cf` (Slice 36 approved HEAD)
- **Target Branch**: `tala-js/slice-37-graph-bounding-box`
- **Pinned Upstream Reference**: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Scope of Implementation
1. **`src/geometry/math.js`**:
   - Added `chopPrecision(f)` using `goRound(Math.fround(f * 10000) / 10000)` and normalizing negative zero to `+0`.
   - `chopPrecision` exists only in `geometry/math.js` and is consumed internally by edge label geometry; it is intentionally NOT re-exported from the geometry barrel or root public API.
2. **`src/graph/node-bounds.js`**:
   - Added `nodesUnroundedBounds` and `nodesUnroundedFixedBounds` to support `boundingBox(false)`.
3. **`src/graph/label-position.js`**:
   - Added `routeLength`, `routeGetPointAtDistance`, `getUnitNormalVector`, and `getPointOnRoute` implementing exact route-label geometry and precision chopping.
4. **`src/graph/edge.js`**:
   - Added `boundingBoxValues`, `bounds`, `BoundingBox`, `BoundingBoxValues`, and `labelTopLeft` / `LabelTopLeft`.
   - Included main edge label support with `strokeWidth = 3.0`.
   - Included renderer-compatible arrowhead labels (`SourceArrowheadLabel`, `TargetArrowheadLabel`) with integer truncation, `strokeWidth = 2.0`, end-to-start unit normal calculation, arrow height sizing table, and target fallback to source arrow dimensions.
   - Applied Go-compatible rounding `goRound(...)` to edge bounds.
5. **`src/graph/graph.js`**:
   - Added `boundingBox(roundNodeDimensions = true)`, `bounds()`, and `BoundingBox()`.
   - Aggregated node fixed bounds (`nodesFixedBounds` / `nodesUnroundedFixedBounds`) and edge bounding values.
   - Evaluated edge inclusion via `edgeTL.X !== Infinity && edgeTL.X !== -Infinity` matching Go `!math.IsInf(edgeTL.X, 0)`.
   - Applied Go-compatible rounding `goRound(...)` to final graph bounds.

## Test & Verification Results
- **Go Oracle**: `test/reference/go_graph_bounding_box_oracle.go` covering 56 scenarios (A–Q graph, R–BD edge).
- **Go Oracle Fixtures**: `test/fixtures/go-graph-bounding-box-reference.json`.
- **Oracle Replay Tests**: `test/unit/graph-bounding-box-oracle.test.js` (56/56 PASS).
- **Direct Review-Gate Tests**: `test/unit/graph-bounding-box.test.js` (33/33 PASS).
- **Targeted JS Regressions**: PASS across node bounds, graph lifecycle, edge, label position, debug ID, and assign herds.
- **Full JS Suite**: 1906 passed, 0 failed across 75 test files.
- **Go Packages**:
  - `layoutgraph`: PASS
  - `proximity`: PASS
  - `grouping`: PASS
  - `labelgeom`: PASS
