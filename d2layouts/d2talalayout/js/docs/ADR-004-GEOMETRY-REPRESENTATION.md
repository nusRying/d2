# ADR 004: Geometry Representation and Coordinate Naming

## Status

Accepted

## Context

The Go implementation of D2 TALA heavily relies on a set of core geometric primitives (Point, Vector, Segment, Box, Orientation, etc.) implemented in `lib/geo`. These primitives use `X` and `Y` properties.

The JavaScript ELK graph representation traditionally uses `x`, `y`, `width`, and `height` in its public contract. The graph architecture defined in Slice 01 established a dedicated ELK-to-TALA adapter (`src/elk/adapter.js`) that isolates the external contract from the internal representation.

For Slice 03, we port the `lib/geo` logic. We need a consistent coordinate naming strategy that balances the cognitive load of a future Go-to-JavaScript algorithm port against performance and complexity in JavaScript.

Options considered:
1. **Option A:** Rewrite all ported geometry code to use `x` and `y`. This aligns with typical JavaScript patterns but requires systematic transformation of all ported Go algorithms, making future updates from upstream harder to apply.
2. **Option B:** Keep internal `Point` and `Box` geometry using `X`, `Y`, `TopLeft`, `Width`, and `Height` matching Go. Rely on the `adapter.js` to translate between the lowercase ELK contract and the capitalized internal state when needed.
3. **Option C:** Create aliased properties using JS getters/setters (e.g. `get x() { return this.X; }`), allowing both. This adds performance overhead to tight geometry loops.

## Decision

We chose **Option B**.

We will maintain exact architectural and naming parity for the ported geometric primitives. `Point` uses `.X` and `.Y`. `Box` uses `.TopLeft`, `.Width`, and `.Height`.

We will rely on the explicitly established ELK Adapter to isolate these internal TALA structures from the public ELK JSON contract. We will NOT maintain two independently mutable coordinate fields or incur getter/setter overhead for properties heavily used in hot paths.

## Parity Guarantees

As part of this Slice, the following guarantees were verified using a static output oracle (`test/reference/go_geometry_oracle.go`):
- `math.Round` half-away-from-zero semantics (using a custom `goRound` JS helper).
- IEEE-754 exactly reproducible values, including -0 behavior and NaN propagation.
- Truncation functions (e.g., `TruncateFloat32`, `TruncateDecimals`) accurately reflect Go types casting.
- No arbitrary epsilons were added to strict checks like `denom == 0` in intersections.

## Consequences

- The geometry library strictly mirrors Go structures. Porting hierarchy, placement, and routing algorithms will be straightforward, avoiding `.X` -> `.x` cognitive burden.
- The ELK adapter must accurately translate the coordinates at the boundary when we eventually wire internal layout algorithms to the TALA engine pipeline.
