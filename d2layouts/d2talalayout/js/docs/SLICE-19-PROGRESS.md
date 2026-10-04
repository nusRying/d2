# Slice 19 Progress: Shape Inner Geometry & Node InsidePlacement

## Status: Implemented — awaiting review

## Summary of Changes
1. **Rebuilt Cleanly from Approved Slice 18 Base (`9fc404a40cc30676492841d7b9cdfd2cae9484d3`)**:
   - Completely eradicated incorrect `InsidePlacement(position, box)` interpretation.
   - Pinned Go implementation uses `Node.InsidePlacement(width, height, padding)` and `Node.InnerBox()`.

2. **Implemented Browser-Safe Shape Geometry Layer (`src/shape/inner-geometry.js`)**:
   - `shapeGetInnerBox(shapeType, box)`: computes shape-specific usable inner box for all 24 recognized shape variants (Circle, Oval, Cloud, Page, Step, Queue, Hexagon, Diamond, Document, Cylinder, StoredData, Parallelogram, Callout, Person, C4Person, Package, Square, RealSquare, Image, Table, Class, Text, Code, and default `""`).
   - `shapeGetInsidePlacement(shapeType, box, width, height, padX, padY)`: ports exact math formulas for Circle, Oval (using `Math.fround(Math.atan2(ry, rx))` for Go float32 precision truncation), Cloud (aspect ratio boundaries for wide, tall, and square), and base shape delegation (`innerTL + padding / 2`).

3. **Implemented Node Wrapper Methods (`src/graph/node.js`)**:
   - `Node.insidePlacement(width, height, padding)` & `Node.InsidePlacement(width, height, padding)`:
     - Extracts padding (`top, bottom, left, right`) supporting plain properties and methods.
     - Calls shape inside placement.
     - Applies Circle-only post-placement centering when `innerBox.Width > totalWidth` or `innerBox.Height > totalHeight`.
     - Applies `goRound` and asymmetric padding correction: `p.X -= goRound(padX/2) - pad.left`, `p.Y -= goRound(padY/2) - pad.top`.
   - `Node.innerBox()` & `Node.InnerBox()`:
     - Calls `shapeGetInnerBox` and applies `goRound` to TopLeft.X, TopLeft.Y, Width, and Height.
     - Returns new instances without mutating node geometry.

4. **Real-Go Oracle & Bridge (`test/reference/go_inside_placement_oracle.go`)**:
   - Added build-tagged bridge `internal/layoutgraph/inside_geometry_oracle_bridge.go` (`//go:build tala_inside_geometry_oracle`) for `layoutgraph.OracleSpacing`.
   - Generated reference fixture `test/fixtures/go-inside-placement-reference.json` covering:
     - All 24 recognized shapes.
     - Asymmetric padding (`top=11, bottom=29, left=7, right=21`).
     - Circle post-centering verification.
     - Oval float32 precision verification.
     - Half-integer rounding (`+0.5`, `-0.5`) verifying `goRound` parity with Go's `math.Round`.
   - Verified 100% byte reproducibility and matching SHA256 hashes across consecutive runs.

5. **Test Coverage**:
   - `test/unit/inside-placement.test.js`: Direct JS unit tests asserting identity, non-mutation, circle centering correction, asymmetric padding, oval float32 precision, and casing aliases.
   - `test/unit/inside-placement-oracle.test.js`: Replays all 32 InsidePlacement scenarios and 31 InnerBox scenarios against real Go output.
   - Full suite passes: 934 passing tests across 39 files with 0 failures.
