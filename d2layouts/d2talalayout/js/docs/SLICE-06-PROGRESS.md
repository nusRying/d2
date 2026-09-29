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
- In Go, `math.Ceil(0.0 / 0.0)` produces `NaN`. In Go's amd64 runtime, the floating-point to integer conversion `int(math.Ceil(NaN))` produces an implementation-defined integer conversion result (minimum integer/negative value).
- Because `maxEdgesToAdjacent == 0`, `max(maxEdgesToAdjacent, convertedCeil)` produces `0`.
- Therefore, the final observed `edgesPerSide = 0`, avoiding the `edgesPerSide == 1` early return.
- `minLength = (0 + 1) * 40.0 = 40.0`.
- A small node (e.g. 20x20) with only self-loops scales to 40x40, with `fontSize = 32` and label scaling to 20x20.
- In JavaScript, `0 / 0` is `NaN` and `Math.max(0, NaN)` is `NaN`. To match the observed Go runtime outcome without relying on architecture-specific NaN-cast quirks, JS explicitly maps `sidesForEdges === 0` to `0`.

## Zero-Dimension Oracle Findings
- When `Width = 0` or `Height = 0`, ratio division yields `Infinity`.
- Distance against `Infinity` yields `Infinity`, and `Infinity < Infinity` is false.
- The font search loop never updates `fontSize` or `bestRatio`.
- `node.Width` and `node.Height` expand to `minLength`, while `FontSize` and `Label` remain unchanged.
- JavaScript IEEE-754 arithmetic reproduces this behavior identically.

## Dedicated Label Cloning Semantics
- In Go (`clone.go`), `copyLabelRecord` copies `Text`, `Position`, `Width`, and `Height`.
- The private Go field `positionFixed` is unexported and deliberately omitted from `copyLabelRecord`, so cloned labels always reset `positionFixed` to `false`.
- JavaScript `src/graph/clone.js` uses a dedicated `copyLabelRecord(source)` helper for `Node.Label`, `Edge.Label`, `Edge.SourceArrowheadLabel`, and `Edge.TargetArrowheadLabel`.
- This ensures cloned labels remain `instanceof Label`, preserve their public properties, and have `_positionFixed` reset to `false` matching Go.

## Input Validation Semantics
- `prescale(graph)` operates directly on `graph.Nodes` matching Go's `Prescale(graph *layoutgraph.Graph)`.
- Null or undefined graph input throws a natural JavaScript exception rather than silently early-returning.
- Valid empty graphs (`new Graph()` with `Nodes.length === 0`) succeed safely as no-ops.

## ELK Integration Smoke Test
- Ingested ELK graph with 2 nodes and 3 parallel edges via `elkToTalaGraph`.
- Verified input ELK graph object remains deeply unmutated.
- Executed `prescale(talaGraph)`: node enlarged from 80x80 to 160x160.
- Exported via `talaToElkGraph`: returned ELK graph reflected enlarged width and height, preserving all edge identifiers and metadata.

## Go Oracle Fixture SHA256
- Fixture path: `test/fixtures/go-prescale-reference.json`
- SHA256: `be0d77400186e811a988db2416fe1b9d92ab45750a47f492dc71a78ec375de76`

## Fixture Reproducibility
Generated twice consecutively with `C:\Program Files\Go\bin\go.exe`:
- Run A SHA256: `be0d77400186e811a988db2416fe1b9d92ab45750a47f492dc71a78ec375de76`
- Run B SHA256: `be0d77400186e811a988db2416fe1b9d92ab45750a47f492dc71a78ec375de76`
Identical hashes verify deterministic reproducibility. Includes `runtimeGOOS` and `runtimeGOARCH` metadata fields.

## Full Regression
Authoritative test run:
```powershell
bun test
```
Result:
- 154 pass
- 0 fail
- 8357 expect() calls
- 13 test files
- 179.00ms

## Math.random Audit
- `Math.random` occurrences in `js/src`: **0**

## Browser-Safe Audit
- Node built-in imports/usages (`fs`, `path`, `Buffer`, `process`, `crypto`) in `js/src`: **0**

## Performance Sanity
Benchmarked via Bun runtime:
- 100,000 `prescale` calls on tiny no-edge graph: 7.19 ms (~71.90 ns/call).
- 10,000 `prescale` calls with parallel edges, font scaling, and label resizing: 31.76 ms (~3.18 μs/call).

## Problems Encountered and Review Findings
1. **Self-loop edge counting**: On amd64 Go runtime, `int(math.Ceil(NaN))` produces a negative integer, and `max(0, convertedCeil)` yields `0`. JavaScript explicitly maps `sidesForEdges === 0` to `0` to produce this exact semantic outcome cleanly.
2. **Label prototype preservation**: Replaced generic `structuredClone` with `copyLabelRecord` in `clone.js` to preserve `instanceof Label` and reset `positionFixed` to `false` matching Go `copyLabelRecord`.
3. **Strict input semantics**: Removed permissive null check from `prescale(graph)`, allowing invalid null input to throw while preserving empty graph no-op behavior.
4. **AspectRatio1 vs FixedTopLeft ordering**: Verified that `node.AspectRatio1()` executes before `scaleBasedOnEdges()`, ensuring fixed-position circles and real squares are squared even when edge-density scaling is skipped.
5. **Strict < comparison in large node check**: Verified that `minLength < Math.min(width, height)` uses strict inequality, so exact boundary equality does not early-return.

## Review Corrections Resolution
The following review corrections were implemented and verified in commit `d8546ff73`:
- **Label prototype preservation through cloneGraph**: Implemented dedicated `copyLabelRecord(source)` in `src/graph/clone.js` for `Node.Label`, `Edge.Label`, `Edge.SourceArrowheadLabel`, and `Edge.TargetArrowheadLabel` so cloned labels remain `instanceof Label` with independent `Text`, `Position`, `Width`, and `Height` state.
- **positionFixed reset parity**: Verified and enforced that `positionFixed` is reset to `false` on cloned labels, matching Go's omission of the unexported `positionFixed` field in `copyLabelRecord`.
- **Strict null Prescale behavior**: Removed permissive `!graph` check from `prescale(graph)`, allowing null/undefined graph arguments to throw naturally while maintaining no-op behavior for valid empty graphs (`new Graph()`).
- **GOOS/GOARCH oracle evidence**: Extended `go_prescale_oracle.go` metadata with `runtimeGOOS` (`windows`) and `runtimeGOARCH` (`amd64`), regenerated fixture twice with verified identical SHA256 (`be0d77400186e811a988db2416fe1b9d92ab45750a47f492dc71a78ec375de76`), and asserted these fields in tests.
- **Corrected self-loop explanation**: Documented that amd64 Go runtime conversion `int(math.Ceil(NaN))` yields an implementation-defined negative integer which `max(0, convertedCeil)` resolves to `0`, rather than claiming a language-level NaN-to-zero cast.
- **Expanded topology non-mutation test**: Added explicit checks asserting immutability of `Containers`, `Clusters`, `Sequences`, `Trees`, `Node.Edges`, `Node.Nears`, `FixedTopLeft`, `DesiredWidth`, `DesiredHeight`, and other topological properties.
- **Clone -> Prescale integration test**: Added engine-workflow integration test running `prescale(cloneGraph(source))` and verifying that workspace nodes scale while source graph instances and labels remain untouched.

## Limitations
- Placement preparation (`Prepare`), loop offset computation, and label positioning belong to subsequent placement slices.
- Sequence grouping (`AddSequences`), tree preprocessing, and cluster optimization are out of scope.
- Top-level `layout()` entry point and rollback orchestration belong to the engine integration slice.

## Result
Deterministic, browser-safe implementation of the `Prescale` stage in JavaScript with 100% Go oracle parity across all 29 verification cases, dedicated Label cloning, strict topology non-mutation guarantees, and full metadata verification.

## Commit History on `tala-js/slice-06-prescale`
- `d8546ff73` fix(tala-js): address Slice 06 review corrections
- `774c9262d` docs(tala-js): record final docs commit SHA
- `59a3e3b8a` docs(tala-js): document Slice 06 Prescale
- `6b97a61d5` test(tala-js): add Go Prescale parity oracle
- `f48a09d3a` feat(tala-js): port Prescale stage
- `d9fe2c611` docs(tala-js): close approved Slice 05
