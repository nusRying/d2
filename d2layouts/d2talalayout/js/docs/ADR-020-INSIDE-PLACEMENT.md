# ADR-020: Shape Inner Geometry & Node InsidePlacement

## Status
Accepted / Implemented (Slice 19)

## Context
In D2's layout engine (specifically TALA), nodes require calculating how content fits inside a shape's usable inner area:
1. `Node.InsidePlacement(width, height, padding)`: computes the top-left coordinate `geo.Point` where content of dimension `(width, height)` with given `Spacing` padding can be placed inside the node.
2. `Node.InnerBox()`: returns the usable inner bounding box `*geo.Box` of the node, rounded with `math.Round`.

The previous, unapproved Slice 19 implementation erroneously conflated `InsidePlacement` with label positioning (`label.Position.GetPointOnBox`), taking a label position enum and box instead of `(width, height, Spacing)`. This ADR documents the corrected, pinned Go architecture.

## Decision

### 1. Shape Geometry Layer (`src/shape/inner-geometry.js`)
We implement pure, browser-safe functional geometry helpers:
- `shapeGetInnerBox(shapeType, box)`
- `shapeGetInsidePlacement(shapeType, box, width, height, paddingX, paddingY)`

These port the exact behavior of Go `lib/shape/shape_*.go`:
- Base Shape (`baseShape`): returns the outer box for `GetInnerBox()`, and returns `innerTL + padding / 2` for `GetInsidePlacement(...)`.
- Specialized `GetInnerBox` shapes:
  - `Circle`: inscribed square based on radius and diagonal offset `r - r * sqrt(2)/2`.
  - `Oval`: derived from oval inside placement at `(0, 0)` padding.
  - `Cloud`: aspect ratio branching (`CLOUD_WIDE_ASPECT_BOUNDARY`, `CLOUD_TALL_ASPECT_BOUNDARY`, and square fallback).
  - `Page`: corner wedge shrinkage if `height < 3 * pageCornerHeight`.
  - `Step`: `STEP_WEDGE_WIDTH = 35.0` legacy geometry (width -= 70, x += 35).
  - `Queue`: arc depth `24.0` or `width / 2` (width -= 3 * arc, x += arc).
  - `Hexagon`: 1/6 offset, 1.5 divisor on width and height.
  - `Diamond`: 1/4 offset, 2.0 divisor on width and height.
  - `Document`: height scaled by `14.0 / 18.925`.
  - `Cylinder`: arc height `24.0` or `height / 2` (height -= 3 * arc, y += 2 * arc).
  - `StoredData`: wedge width `15.0` (width -= 30, x += 15).
  - `Parallelogram`: wedge width `26.0` (width -= 52, x += 26).
  - `Callout`: tip height `45.0` or `height / 2` (height -= tip).
  - `Person`: shoulder width factor `20.2 / 68.3`.
  - `C4Person`: head radius and body top factors with 5% horizontal and 3% vertical padding.
  - `Package`: top height `min(55, height * 0.2)`.
  - Default / square-like types (`""`, `Square`, `RealSquare`, `Image`, `Table`, `Class`, `Text`, `Code`): use base shape behavior (unmodified outer box).

- Specialized `GetInsidePlacement` shapes:
  - `Circle`: uses `r = width / 2`, `halfLength = r * sqrt(2) / 2`, and `math.Ceil`.
  - `Oval`: uses `Math.fround(Math.atan2(ry, rx))` to emulate Go `float64(float32(math.Atan2(ry, rx)))` float32 precision truncation, followed by radius calculation along diagonal and `math.Ceil`.
  - `Cloud`: selects wide, tall, or square formulas based on content aspect ratio `(width + padX) / (height + padY)`.
  - All other shapes: inherit base shape placement which delegates to the concrete shape's `GetInnerBox().TopLeft + padding / 2`.

### 2. Node InsidePlacement Wrapper (`Node.InsidePlacement`)
In `Node.insidePlacement(width, height, padding)`:
1. Extract padding values `(top, bottom, left, right)` supporting both plain object properties and method accessors (`Left()`, `Top()`, etc.).
2. Compute `padX = left + right`, `padY = top + bottom`.
3. Call `shapeGetInsidePlacement(this._shapeType, this.Box, width, height, padX, padY)`.
4. Circle Post-Centering Correction:
   If `this._shapeType === "Circle"`:
   ```js
   const totalWidth = width + padX;
   const totalHeight = height + padY;
   const innerBox = shapeGetInnerBox(this._shapeType, this.Box);
   if (innerBox.Width > totalWidth) {
     p.X += (innerBox.Width - totalWidth) / 2.0;
   }
   if (innerBox.Height > totalHeight) {
     p.Y += (innerBox.Height - totalHeight) / 2.0;
   }
   ```
5. Rounding and Asymmetric Padding Correction:
   ```js
   p.X = goRound(p.X);
   p.Y = goRound(p.Y);
   p.X -= goRound(padX / 2.0) - pad.left;
   p.Y -= goRound(padY / 2.0) - pad.top;
   ```
   Uses `goRound` to guarantee half-integer round-away-from-zero matching Go's `math.Round`.

### 3. Node InnerBox Wrapper (`Node.InnerBox`)
In `Node.innerBox()`:
1. Call `shapeGetInnerBox(this._shapeType, this.Box)`.
2. Construct and return a new `Box` with a new `Point`, rounding all 4 coordinates with `goRound`:
   ```js
   return new Box(
     new Point(goRound(box.TopLeft.X), goRound(box.TopLeft.Y)),
     goRound(box.Width),
     goRound(box.Height)
   );
   ```
3. Guarantee that neither `this.Box` nor `this.TopLeft` is mutated, and the returned instances are brand new.

### 4. Separation from Label Positioning
The label position primitives implemented in Slice 18 (`getPointOnBox(box, labelPosition, labelPadding)`) remain independent and unchanged. `Node.InsidePlacement` does not take label position arguments.

### 5. Scope Boundaries
No container child placement (`PositionContainerChildren`), wrap children, label expansion, cluster arrangement, cleanup, join, hub, routing, packing, or later orchestration logic is included.

## Consequences
- Full parity with Go `Node.InsidePlacement` and `Node.InnerBox`.
- Browser-safe implementation with 0 Node.js dependencies and deterministic numeric precision matching Go.
