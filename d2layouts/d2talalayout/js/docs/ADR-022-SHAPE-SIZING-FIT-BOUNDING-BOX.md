# ADR-022: Shape Sizing & FitToBoundingBox

## Status
Implemented — awaiting Slice 21 review

## Context
In D2's layout engine (specifically TALA), nodes require shape-specific sizing to fit arbitrary content bounding boxes and padding. When sizing containers or fitting nodes to their contents, two fundamental operations are used in Go:
1. `Shape.GetDimensionsToFit(width, height, paddingX, paddingY)` (and embedded `Node.GetDimensionsToFit(...)`): calculates the outer shape dimensions required to enclose given content dimensions and padding.
2. `Node.fitToBoundingBox(tl, br *geo.Point, padding Spacing)` (and `Node.FitToBoundingBox(...)`): takes content bounding box coordinates, applies inside label minimum dimension expansion when appropriate, respects nullable desired dimensions, calls `GetDimensionsToFit`, and updates node dimensions (`Width`, `Height`).

This ADR documents the exact semantics, mathematical quirks, edge cases, and boundary constraints ported to JavaScript in Slice 21.

## Decision

### 1. Scope and Public vs Internal APIs
- Implemented `shapeGetDimensionsToFit(shapeType, width, height, paddingX, paddingY)` in `src/shape/inner-geometry.js`.
- Implemented `Node.getDimensionsToFit(width, height, paddingX, paddingY)` and `Node.GetDimensionsToFit(...)` alias in `src/graph/node.js`.
- Implemented `Node.fitToBoundingBox(tl, br, padding)` and `Node.FitToBoundingBox(...)` alias in `src/graph/node.js`.
- Shape sizing helper is exported via `src/shape/inner-geometry.js` and `src/shape/index.js`, but NOT exposed through root `src/index.js`.
- Later operations including `wrapChildren`, `WrapChildren`, `fitNodeToGraph`, `FitToGraph`, `Cluster.ArrangeClusterNodes`, `Cluster.SyncGeometry`, `Graph.SyncClusters`, `Cleanup`, `Join`, `JoinDistancedClusters`, `AddHubs`, and `binPackWrapChildren` remain strictly un-implemented.
- `setContainer` and `SetContainer` remain strictly absent from JS production code.

### 2. Sizing Algorithms and Shape Parity
- **Base Sizing**: Default shape, `""`, `Square`, `Image`, `Table`, `Class`, `Text`, `Code`, and unspecialized shapes return `[Math.ceil(width + paddingX), Math.ceil(height + paddingY)]`. Uses `Math.ceil`, not `goRound`.
- **RealSquare**: Computes `sideLength := Math.ceil(Math.max(width + paddingX, height + paddingY))` and returns `[sideLength, sideLength]`.
- **Circle**: Computes `length := Math.max(width + paddingX, height + paddingY)` and returns `diameter := Math.ceil(Math.SQRT2 * length)` for both dimensions.
- **Oval**: Computes `theta := Math.fround(Math.atan2(height, width))`, padded dimensions `width + paddingX * Math.cos(theta)` and `height + paddingY * Math.sin(theta)`, scales by `Math.SQRT2`, takes `Math.ceil`, and limits aspect ratio via `limitAR(..., 3.0)`. Explicit `Math.fround` float32 truncation is required.
- **LimitAR**: Internal helper implementing pinned Go `LimitAR(width, height, aspectRatio)`. Preserves strict `if (width > aspectRatio * height) ... else if (height > aspectRatio * width) ...` ordering. Uses `goRound` for `math.Round`.
- **Cloud**: Uses Slice 19 constants (`CLOUD_WIDE_ASPECT_BOUNDARY = 1.3`, `CLOUD_TALL_ASPECT_BOUNDARY = 0.7692`, inner dimensions 0.72x0.54, 0.48x0.54, 0.6x0.54). Computes `(width + paddingX) / (height + paddingY)` and divides by appropriate inner dimensions before `Math.ceil`.
- **Page**: Computes `totalWidth := width + paddingX`, `totalHeight := height + paddingY`. If `totalHeight < 3 * PAGE_CORNER_HEIGHT` (strict `<`), adds `PAGE_CORNER_WIDTH` to `totalWidth`. Clamps with `Math.max(totalWidth, 2 * PAGE_CORNER_WIDTH)` and `Math.max(totalHeight, PAGE_CORNER_HEIGHT)`.
- **Step**: Returns `[Math.ceil(width + paddingX + 2 * STEP_WEDGE_WIDTH), Math.ceil(height + paddingY)]` with `STEP_WEDGE_WIDTH = 35.0`.
- **Queue**: Always adds `3 * DEFAULT_ARC_DEPTH = 72.0` to width before ceil. Does not use narrow-box `getArcWidth` clamp.
- **Cylinder**: Always adds `3 * DEFAULT_ARC_DEPTH = 72.0` to height before ceil. Does not use short-height arc clamp.
- **Hexagon**: Returns `[Math.ceil(1.5 * (width + paddingX)), Math.ceil(1.5 * (height + paddingY))]`.
- **Diamond**: Returns `[Math.ceil(2 * (width + paddingX)), Math.ceil(2 * (height + paddingY))]`.
- **Document**: Computes `baseHeight := (height + paddingY) * DOC_PATH_HEIGHT / DOC_PATH_INNER_BOTTOM` with `18.925 / 14.0`.
- **StoredData**: Adds `2 * STORED_DATA_WEDGE_WIDTH = 30.0` to width.
- **Parallelogram**: Adds `2 * PARALLEL_WEDGE_WIDTH = 52.0` to width.
- **Callout**: Base height `height + paddingY`. If `baseHeight < DEFAULT_TIP_HEIGHT (45.0)` (strict `<`), doubles it; otherwise adds `45.0`.
- **Person**: Adds shoulder width `totalWidth * (20.2 / 68.3) / (1 - 2 * (20.2 / 68.3)) * 2` and limits AR to 1.5.
- **C4Person**: Content width `/ 0.9`, head and body geometry, vertical padding `totalWidth * 0.06`, minimum height `totalWidth * 0.95`, and AR limit 1.5.
- **Package**: Inner height `height + paddingY`, top height `innerHeight * 0.2 / 0.8`, capped at `PACKAGE_TOP_MAX_HEIGHT = 55.0`. No minimum top height clamp is applied in sizing.

### 3. FitToBoundingBox Semantics and Quirks
- **Content Dimensions**: `width = br.X - tl.X`, `height = br.Y - tl.Y`. Negative / inverted bounds pass through without normalization.
- **Inside Label Minimum**: If `node.Label != null && !isOutsideLabelPosition(node.Label.Position)`:
  - `minWidth = node.Label.Width - padding.left - padding.right + LABEL_PADDING * 4` (20px).
  - `minHeight = node.Label.Height - padding.top - padding.bottom + LABEL_PADDING * 4` (20px).
  - `Unset` position (`0`) is NOT outside, so it participates in minimum expansion.
  - Outside label positions do not trigger minimum expansion.
- **Desired Dimension Quirk**:
  - `DesiredWidth` and `DesiredHeight` are nullable numbers (`null` represents Go nil). `0` or negative values are non-null.
  - If `DesiredWidth != null`, inside-label `minWidth` does NOT replace content width before shape fitting. Content width remains `br.X - tl.X`.
  - After shape fitting, `node.Width = node.DesiredWidth != null ? Math.max(fitWidth, node.DesiredWidth) : fitWidth`.
  - Same rules apply independently to `DesiredHeight`.
- **Mutation and Invariants**:
  - Only `node.Width` and `node.Height` are modified.
  - `node.Box` object identity is preserved.
  - `node.TopLeft` is not read or modified; `node.TopLeft === null` resizes successfully.
  - `tl === null` or `br === null` throws naturally before any dimension changes.
  - Sizing does not depend on container status or graph references.

## Consequences
- Full parity with Go `Shape.GetDimensionsToFit` and `Node.fitToBoundingBox`.
- Provides the essential geometric sizing foundation required for container resizing and future `wrapChildren`.
- Fully browser-safe: 0 Node.js built-ins, 0 `Math.random`, fully deterministic arithmetic.
