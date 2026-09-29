# Slice 06 — Prescale Stage Progress

## Goal
Port the first executable TALA layout pipeline stage: `placement.Prescale` with exact Go parity.
Implement aspect-ratio normalization, edge-density-based node enlargement, font-size adjustment, and label-dimension adjustment while preserving all Go early-return and rounding semantics.

## Approved Slice 05 Base
- Commit SHA: `becd72a678cb900543affe49e4d3fb50f0a1fd58`

## Pinned D2 Reference SHA
- Commit SHA: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Version
- Reference execution environment: `go1.27.0 windows/amd64` using `C:\Program Files\Go\bin\go.exe`.

## Go Files Studied
1. `d2layouts/d2talalayout/internal/placement/stages.go`: `Prescale`, `scaleBasedOnEdges`, `talaFontSizes`.
2. `d2layouts/d2talalayout/internal/placementcost/geometry.go`: `SideEdgeSpacing = 40.0`.
3. `d2layouts/d2talalayout/internal/layoutgraph/node.go`: `AspectRatio1`, `IsTable`, `IsClass`, `Adjacent`, `NewNode`.
4. `d2layouts/d2talalayout/internal/layoutgraph/label.go`: `Label` struct and fields (`Width`, `Height`, `positionFixed`).
5. `d2layouts/d2talalayout/internal/engine/pipeline.go`: Pipeline stage order, `prescaleStage` execution and lack of context polling.
6. `d2renderers/d2fonts/d2fonts_common.go`: `FontSizes` scale (`[13, 14, 16, 20, 24, 28, 32]`).

## Scope Decision
Strictly isolate `Prescale` from subsequent grouping and placement algorithms. No placement algorithms (`AddSequences`, `AddClusters`, `PreprocessTrees`, `Prepare`, `Place`) are implemented in Slice 06.

## Why AddSequences Was Deferred
Grouping via `grouping.AddSequences` requires a comprehensive set of complex infrastructure not present in the foundation:
- `layoutgraph` validation and `WorkGuard` iteration step limits.
- `GraphState` snapshot capture and transactional rollback framework.
- Remembered-sequence validation and active vessel replacement.
- Deterministic `random.Int63` pseudo-random number generation for sequence identification and spill handling.
- `SequenceAdvance` sequencing logic and geometry arrange/resize helpers (`ArrangeSteps`, `Resize`).
- Temporary sequence vessel creation, edge abduction, and reconnect lifecycle.
- Container replacement lifecycle and cancellation atomicity.
Attempting to partially port `AddSequences` without this infrastructure would create fragile, untested partial implementations.

## Pipeline Position
`Prescale` is stage 1 of the 38-stage layout pipeline defined in `internal/engine/pipeline.go`:
```go
var defaultPipelineStages = [...]pipelineStage{
    {name: "Prescale", run: (*pipeline).prescaleStage},
    {name: "PreprocessSequences", run: (*pipeline).preprocessSequenceStage},
    {name: "Preprocess", run: (*pipeline).preprocessStage},
    ...
}
```
`prescaleStage` takes trivial time and does not poll the context or require rollback.

## Prescale Algorithm
```javascript
export function prescale(graph) {
  for (const node of graph.Nodes) {
    if (node.AspectRatio1()) {
      const size = Math.max(node.Width, node.Height);
      node.Width = size;
      node.Height = size;
    }
    scaleBasedOnEdges(node);
  }
}
```

## AspectRatio1 Behavior
- Evaluated for `Circle` and `RealSquare` nodes.
- Squares dimension to `Math.max(node.Width, node.Height)` before evaluating edge density.
- Normalization occurs **before** any early returns in `scaleBasedOnEdges`. A node with `FixedTopLeft` or 0 edges still has its aspect ratio normalized.
- Ordinary `Square` nodes return `false` for `AspectRatio1()` and do not undergo aspect-ratio squaring.

## Ported Early Returns
`scaleBasedOnEdges(node)` returns immediately if ANY of the following hold:
- `node.FixedTopLeft != null`
- `node.DesiredWidth != null`
- `node.DesiredHeight != null`
- `node.IsTable()`
- `node.IsClass()`
- `node.Edges.length === 0`
Conditions are evaluated independently without collapsing null semantics.

## Edge Counting
- Adjacent edges are mapped by adjacent `Node` object reference.
- Parallel edges to the same neighbor increment that neighbor's edge count.
- Self-loops (`adjacent === node`) are excluded from neighbor counts.
- `sidesForEdges`: 4.0 if `edgeCounts.size >= 4`, else `edgeCounts.size`.
- `edgesPerSide = Math.max(maxEdgesToAdjacent, Math.ceil(totalEdges / sidesForEdges))`.
- If `edgesPerSide === 1`: returns immediately with no scaling.

## SideEdgeSpacing Constant
- Pinned constant: `SideEdgeSpacing = 40.0`.
- Exported from `src/placementcost/constants.js`.
- Minimum side length: `minLength = (edgesPerSide + 1) * SideEdgeSpacing`.
- Early return: `if (minLength < Math.min(node.Width, node.Height)) return;` (strict inequality).

## Font Size Contract
- Supported scale: `[13, 14, 16, 20, 24, 28, 32]`.
- Exported by `talaFontSizes()`, returning a fresh array on every call to avoid mutable shared state.
- If `node.FontSize == null`: early return after geometric scaling. Label dimensions are not scaled.

## Font Selection
- Target ratio: `minRatio = Math.min(xRatio, yRatio)`.
- Nearest candidate search: `distance = Math.abs(candidate / originalFontSize - minRatio)`.
- Updates strictly on `distance < closestDistance`. In an exact tie, the first candidate in the scale wins.
- Candidates always divide by the original, unmutated `node.FontSize`.

## Overshoot Correction
- If `bestRatio > minRatio`:
  `minLength = Math.ceil(minLength * bestRatio / minRatio)`.
  Dimensions `Width` and `Height` are clamped to `minLength` if currently smaller.

## Label Scaling
- If `node.Label != null` (and `node.FontSize != null`):
  `node.Label.Width = Math.ceil(node.Label.Width * bestRatio)`.
  `node.Label.Height = Math.ceil(node.Label.Height * bestRatio)`.
- Uses `Math.ceil` exclusively.

## Self-Loop Oracle Findings
- In Go, when all edges are self-loops, `edgeCounts` is empty and `sidesForEdges = 0.0`.
- In Go, `math.Ceil(0.0 / 0.0)` produces `NaN`, which converts to `0` in `int(math.Ceil(NaN))`.
- Consequently, `edgesPerSide = 0`, which avoids the `edgesPerSide == 1` early return.
- `minLength = (0 + 1) * 40.0 = 40.0`.
- A small node (e.g. 20x20) with only self-loops scales to 40x40, with `fontSize = 32` and label scaling to 20x20.
- In JavaScript, `0 / 0` is `NaN` and `Math.max(0, NaN)` is `NaN`. To reproduce Go's exact behavior, JS explicitly maps `sidesForEdges === 0` to `0`, ensuring exact parity without `NaN` propagation.

## Zero-Dimension Oracle Findings
- When `Width = 0` or `Height = 0`, ratio division yields `Infinity`.
- Distance against `Infinity` yields `Infinity`, and `Infinity < Infinity` is false.
- The font search loop never updates `fontSize` or `bestRatio`.
- `node.Width` and `node.Height` expand to `minLength`, while `FontSize` and `Label` remain unchanged.
- JavaScript IEEE-754 arithmetic reproduces this behavior identically.

## ELK Integration Smoke Test
- Ingested ELK graph with 2 nodes and 3 parallel edges via `elkToTalaGraph`.
- Verified input ELK graph object remains deeply unmutated.
- Executed `prescale(talaGraph)`: node enlarged from 80x80 to 160x160.
- Exported via `talaToElkGraph`: returned ELK graph reflected enlarged width and height, preserving all edge identifiers and metadata.

## Go Oracle Fixture SHA256
- Fixture path: `test/fixtures/go-prescale-reference.json`
- SHA256: `a8c00d92004032ac6fdac974c984ccdd8e0bc6155ca8587f34348b3ee2bb10e2`

## Fixture Reproducibility
Generated twice consecutively with `C:\Program Files\Go\bin\go.exe`:
- Run A SHA256: `a8c00d92004032ac6fdac974c984ccdd8e0bc6155ca8587f34348b3ee2bb10e2`
- Run B SHA256: `a8c00d92004032ac6fdac974c984ccdd8e0bc6155ca8587f34348b3ee2bb10e2`
Identical hashes verify deterministic reproducibility.

## Full Regression
Authoritative test run:
```powershell
bun test
```
Result:
- 149 pass
- 0 fail
- 8273 expect() calls
- 13 test files
- Runtime: 592.00ms

## Math.random Audit
- `Math.random` occurrences in `js/src`: **0**

## Browser-Safe Audit
- Node built-in imports/usages (`fs`, `path`, `Buffer`, `process`, `crypto`) in `js/src`: **0**

## Performance Sanity
Benchmarked via Bun runtime:
- 100,000 `prescale` calls on tiny no-edge graph: 7.19 ms (~71.90 ns/call).
- 10,000 `prescale` calls with parallel edges, font scaling, and label resizing: 31.76 ms (~3.18 μs/call).

## Problems Encountered and Review Findings
1. **Self-loop edge counting**: In Go, when only self-loops exist, `sidesForEdges = 0`, causing `0/0 = NaN`, which Go converts to `0` when casting to `int`. JavaScript would propagate `NaN` if not handled, causing arithmetic breakdown. Mapped `sidesForEdges === 0` to `0` in JS to achieve exact Go parity.
2. **AspectRatio1 vs FixedTopLeft ordering**: Verified that `node.AspectRatio1()` executes before `scaleBasedOnEdges()`, ensuring fixed-position circles and real squares are squared even when edge-density scaling is skipped.
3. **Strict < comparison in large node check**: Verified that `minLength < Math.min(width, height)` uses strict inequality, so exact boundary equality does not early-return.

## Limitations
- Placement preparation (`Prepare`), loop offset computation, and label positioning belong to subsequent placement slices.
- Sequence grouping (`AddSequences`), tree preprocessing, and cluster optimization are out of scope.
- Top-level `layout()` entry point and rollback orchestration belong to the engine integration slice.

## Result
Deterministic, browser-safe implementation of the `Prescale` stage in JavaScript with 100% Go oracle parity across all 29 verification cases.

## Commit History on `tala-js/slice-06-prescale`
- `d9fe2c611` docs(tala-js): close approved Slice 05
- `f48a09d3a` feat(tala-js): port Prescale stage
- `6b97a61d5` test(tala-js): add Go Prescale parity oracle
- `59a3e3b8a` docs(tala-js): document Slice 06 Prescale
