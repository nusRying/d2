# ADR 007: Prescale Pipeline Stage

## Date
2026-09-29

## Status
Implemented — awaiting Slice 06 review

## Context
In TALA's layout pipeline, `Prescale` is the very first executable stage executed before any grouping, placement, or routing logic.
Pinned engine order:
`Prescale` -> `PreprocessSequences` (`AddSequences`) -> `Preprocess` -> `PreprocessTrees` -> `PreprocessHierarchies` -> `PreprocessClusters` -> `PreprocessHubs` -> ...

In the Go implementation (`internal/engine/pipeline.go`):
```go
// prescaleStage takes trivial time, so it does not poll the context itself.
func (p *pipeline) prescaleStage(ctx context.Context) error {
	placement.Prescale(p.graph)
	return nil
}
```
Because `Prescale` completes in trivial time without iterative search, it does not poll the cancellation context, consume random numbers, allocate new topology objects, or require transactional rollback mechanisms.

## Decisions

### 1. Scope Isolation from AddSequences
`placement.Prescale` is strictly isolated from `grouping.AddSequences`. Porting `AddSequences` requires:
- GraphState snapshot and rollback framework
- WorkGuard iteration budgeting
- Deterministic Go PRNG sequence allocation (`random.Int63`)
- ID collision/spill handling
- Sequence advance / resize / arrange geometry mutation
- Temporary sequence vessel lifecycle management
- Edge abduction and reconnection
- Container replacement lifecycle and cancellation atomicity

Attempting to bundle `AddSequences` with `Prescale` would compromise the strict verification boundary. Hence, Slice 06 focuses exclusively on `Prescale`.

### 2. Pipeline Position and Cancellation Boundary
`Prescale` operates synchronously and deterministically on an already-ingested layoutgraph.
No `AbortController`, `context` emulation, `WorkGuard` budget, or async promises are introduced in this stage.

### 3. AspectRatio1 Normalization
Prior to evaluating edge density or early returns, any node satisfying `node.AspectRatio1()` (`Circle` and `RealSquare`) is normalized so that both dimensions equal `Math.max(node.Width, node.Height)`.
Ordinary `Square` nodes do not have `AspectRatio1() === true` and do not receive automatic aspect-ratio normalization.
Crucially, this normalization happens before any early returns in `scaleBasedOnEdges`. A node with `FixedTopLeft` or `Edges.length === 0` still has its aspect ratio normalized.

### 4. Early-Return Contract
`scaleBasedOnEdges(node)` returns immediately if ANY of the following conditions hold:
- `node.FixedTopLeft != null` (fixed-position nodes cannot expand to accommodate edges)
- `node.DesiredWidth != null` (explicit user-specified width constraint)
- `node.DesiredHeight != null` (explicit user-specified height constraint)
- `node.IsTable()` (tables manage child row/column layout independently)
- `node.IsClass()` (class shapes manage compartment layouts independently)
- `node.Edges.length === 0` (nodes with zero edges require no edge-density scaling)

Each condition is evaluated independently without combining null semantics.

### 5. Edge-Density Model and SideEdgeSpacing
- Port spacing constant: `placementcost.SideEdgeSpacing = 40.0` (exported from `src/placementcost/constants.js`).
- Adjacent edge counts are accumulated by adjacent `Node` object reference.
- Parallel edges to the same neighbor increment that neighbor's count (no deduplication).
- Self-loops (`adjacent === node`) are excluded from neighbor counts.
- `sidesForEdges` is set to `4.0` if `edgeCounts.size >= 4`, or `edgeCounts.size` if `< 4`.
- `edgesPerSide = Math.max(maxEdgesToAdjacent, Math.ceil(totalEdges / sidesForEdges))`.
- If `edgesPerSide === 1`, returns immediately without scaling.
- Minimum length: `minLength = (edgesPerSide + 1) * SideEdgeSpacing`.
- Early return on strict inequality: `if (minLength < Math.min(node.Width, node.Height)) return;`.
  If `minLength === Math.min(Width, Height)`, scaling proceeds.

### 6. Non-Square vs AspectRatio1 Dimension Expansion
- Non-`AspectRatio1`: Each dimension is independently enlarged to `minLength` if it is currently `< minLength`. Ratios `xRatio = minLength / Width` and `yRatio = minLength / Height` are recorded for axes that expand (otherwise 1.0).
- `AspectRatio1`: Both dimensions are enlarged to `minLength` if `Width < minLength`.

### 7. Font Scale and Nearest Selection
- Layout font sizes are restricted to the TALA scale: `[13, 14, 16, 20, 24, 28, 32]`, matching Go `d2renderers/d2fonts.FontSizes`.
- `talaFontSizes()` returns a fresh array on every call to prevent mutation of shared engine state.
- If `node.FontSize == null`, geometric expansion remains in effect, but no font or label scaling is performed.
- Scale ratio target: `minRatio = Math.min(xRatio, yRatio)`.
- Nearest candidate search iterates through `talaFontSizes()` evaluating `distance = Math.abs(candidate / originalFontSize - minRatio)`.
- Candidate selection updates on strict inequality `distance < closestDistance`. In an exact distance tie, the first candidate in the scale wins.
- Original `node.FontSize` is used for all ratio divisions; `node.FontSize` is only updated after the loop.

### 8. Font Overshoot Correction and Label Rounding
- If `bestRatio > minRatio`, font enlargement exceeds geometric scaling. To avoid visual crowding, `minLength` is corrected:
  `minLength = Math.ceil(minLength * bestRatio / minRatio)`
  Dimensions `Width` and `Height` are clamped up to `minLength` if smaller.
- Label dimensions (if `node.Label != null`) scale using `Math.ceil`:
  `node.Label.Width = Math.ceil(node.Label.Width * bestRatio)`
  `node.Label.Height = Math.ceil(node.Label.Height * bestRatio)`

### 9. Self-Loop and Zero-Dimension Semantics
- When all edges on a node are self-loops, `edgeCounts` is empty and `sidesForEdges` is `0.0`. In Go, `float64(0)/0` produces `NaN`; on amd64, converting `math.Ceil(NaN)` to `int` produces an implementation-dependent negative integer value, after which `max(maxEdgesToAdjacent, convertedCeil)` evaluates to `0` because `maxEdgesToAdjacent` is `0`. The final observed semantic outcome in Go is `edgesPerSide = 0`, bypassing the `edgesPerSide == 1` early-return check and setting `minLength = (0 + 1) * 40.0 = 40.0`. To reliably reproduce this final Go oracle result without depending on host-specific NaN integer conversion semantics, JS explicitly maps `sidesForEdges === 0` to `0`. A small node (e.g. 20×20) with only self-loops scales to 40×40 with font scaling to 32 and label scaling to 20×20.
- When `Width = 0` or `Height = 0`, ratio division produces `Infinity`. Distance checks against `Infinity` evaluate to false (`Infinity < Infinity` is false), so `FontSize` and `Label` remain unscaled while geometry expands to `minLength`, matching Go.

### 10. Label Cloning Semantics
- In Go `copyLabelRecord(source *Label) *Label`, `Text`, `Position`, `Width`, and `Height` are copied into a newly allocated `*Label`.
- The unexported `positionFixed` flag is intentionally not copied and resets to `false` in the cloned record.
- In JS `clone.js`, `copyLabelRecord(source)` clones labels as `instanceof Label`, preserving public properties while leaving `_positionFixed` reset to `false`.

### 11. Mutation Boundary and Non-Mutation of Topology
`Prescale` operates directly on `graph.Nodes` (throwing on null/undefined graph input) and mutates only:
- `node.Width`
- `node.Height`
- `node.FontSize`
- `node.Label.Width`
- `node.Label.Height`
All other graph topology (nodes, edges, containers, groups, trees, coordinates, nears, IDs) remains strictly unmutated. A valid empty graph (`new Graph()`) succeeds as a no-op.

## Consequences
- The JavaScript engine now possesses its first executable layout stage matching Go reference behavior.
- ELK adapter round-trip confirms external integration validity.
- Subsequent stages (`AddSequences`, `Prepare`) can rely on valid prescaled geometries.
