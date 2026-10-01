# Slice 21 Progress: Shape Sizing & FitToBoundingBox

## Status: Implemented — awaiting review

## Summary of Changes
1. **Branch & Repository Gate**:
   - Clean branch `tala-js/slice-21-shape-sizing-fit-bounds` branched from approved Slice 20 HEAD (`7215cc92e43bcc869eca31de9ad65bd91f986cba`).

2. **Implemented Shape Sizing & FitToBoundingBox**:
   - `shapeGetDimensionsToFit(shapeType, width, height, paddingX, paddingY)` in `src/shape/inner-geometry.js`:
     - Covers all 24 recognized shape types: default/square-like (`""`, `Square`, `Image`, `Table`, `Class`, `Text`, `Code`), `RealSquare`, `Circle`, `Oval`, `Cloud`, `Page`, `Step`, `Queue`, `Hexagon`, `Diamond`, `Document`, `Cylinder`, `StoredData`, `Parallelogram`, `Callout`, `Person`, `C4Person`, and `Package`.
     - `limitAR(width, height, aspectRatio)`: implements Go `LimitAR` with strict `if ... else if` ordering and `goRound`.
     - Explicit float32 truncation emulation in Oval sizing: `Math.fround(Math.atan2(height, width))`.
     - Queue and Cylinder sizing always add `3 * DEFAULT_ARC_DEPTH = 72.0` without narrow-box clamps.
     - Callout handles strict `<` tip height branch.
     - Page handles corner width and height branch (`totalHeight < 3 * PAGE_CORNER_HEIGHT`).
     - Cloud handles wide, tall, and square aspect-ratio divisions.
     - Package handles top-height cap at 55.0 with no minimum clamp.
   - `Node.getDimensionsToFit` and `Node.GetDimensionsToFit` in `src/graph/node.js`:
     - Pure query method returning newly allocated `[fitWidth, fitHeight]`.
     - No mutation of node geometry, label, or desired dimensions.
   - `Node.fitToBoundingBox(tl, br, padding)` and `Node.FitToBoundingBox(tl, br, padding)` in `src/graph/node.js`:
     - Content bounds: `width = br.X - tl.X`, `height = br.Y - tl.Y`. Inverted/negative bounds pass through.
     - Inside label minimum expansion: applies when `Label != null && !isOutsideLabelPosition(Label.Position)`. Unset position (`0`) is not outside and participates in expansion. Outside label positions are ignored.
     - Desired dimensions: nullable semantics (`!= null`). `0` is non-null. Non-null desired dimension suppresses inside-label minimum on that axis, and competes via `Math.max(fit, desired)`.
     - Natural failure when `tl == null` or `br == null` throws before node dimension mutation.
     - Only `node.Width` and `node.Height` are modified; `node.Box` object identity is preserved.
     - No graph or container dependencies; works with `node.TopLeft == null`.

3. **Deterministic Real-Go Oracle & Fixture**:
   - Built `test/reference/go_shape_sizing_oracle.go` using `layoutgraph.OracleSpacing` bridge under build tag `tala_inside_geometry_oracle`.
   - Exercised 46 `GetDimensionsToFit` scenarios across all recognized shapes and boundary branches.
   - Exercised 23 `FitToBoundingBox` scenarios across label positions, desired dimensions, asymmetric padding, inverted/fractional bounds, null TopLeft, and panic conditions.
   - Generated reference fixture `test/fixtures/go-shape-sizing-reference.json`:
     - Byte size: 21,696 bytes
     - SHA256: `877E022B99FE483509BD6B658C9C94B85682E8D95ED28D30736EC91C37A27CDD`
     - Determinism: 100% byte-for-byte identical across repeated runs.

4. **Testing & Verification**:
   - Unit tests: `test/unit/shape-sizing.test.js` (15 tests).
   - Oracle parity tests: `test/unit/shape-sizing-oracle.test.js` (80 tests replaying all 46 sizing + 23 fit scenarios, semantic contract assertions, and Oval float32 precision proof).
   - Full suite passes: 1,067 pass, 0 fail, 46,000 expectations across 43 files.
   - Go packages pass: `layoutgraph` and `grouping` pass cleanly.
   - Build-tagged Go oracle package passes: `layoutgraph` with `tala_inside_geometry_oracle` passes.
   - Browser safety & static audit pass: 0 violations across 48 source files.

5. **Scope Boundaries Preserved**:
   - `wrapChildren` and `WrapChildren` are strictly absent.
   - `fitNodeToGraph` and `FitToGraph` are strictly absent.
   - `Cluster.ArrangeClusterNodes`, `Cluster.SyncGeometry`, `Graph.SyncClusters`, `Cleanup`, `Join`, `JoinDistancedClusters`, `AddHubs`, and engine orchestration remain absent.
   - `setContainer` and `SetContainer` remain strictly absent from JS production code.
