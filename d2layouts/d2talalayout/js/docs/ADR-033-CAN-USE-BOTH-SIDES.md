# ADR-033: Herd Side Eligibility (`CanUseBothSides`) (Slice 32)

## Status
Implemented — awaiting Slice 32 review

## Context
In TALA's proximity and herding pipeline, `proximity.CanUseBothSides(node, orientation)` checks whether a layout graph node has the necessary aspect ratio to allow placement on both sides of a herd boundary under the given orientation.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/herding.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

Pinned Go source:
```go
func CanUseBothSides(
	node *layoutgraph.Node,
	orientation geo.Orientation,
) bool {
	isWide := node.Width >= 2*node.Height
	isTall := node.Height >= 2*node.Width

	return (orientation == geo.Top ||
		orientation == geo.Bottom) && isWide ||
		(orientation == geo.Left ||
			orientation == geo.Right) && isTall
}
```

## Design Parity Decisions

### 1. Aspect Ratio and Orientation Semantics
- `isWide` is defined strictly as `node.Width >= 2 * node.Height`.
- `isTall` is defined strictly as `node.Height >= 2 * node.Width`.
- When `orientation` is `Orientation.Top` or `Orientation.Bottom`, the node must be wide (`isWide`).
- When `orientation` is `Orientation.Left` or `Orientation.Right`, the node must be tall (`isTall`).
- Direct equality comparison with `Orientation` enum members is preserved. Helper methods such as `isHorizontal()` / `isVertical()` are avoided to prevent inadvertent semantic drift.

### 2. Inclusive Boundary Behavior
- Go uses `>=` rather than `>`.
- Nodes with exact 2:1 ratio (`Width === 2 * Height`) are wide.
- Nodes with exact 1:2 ratio (`Height === 2 * Width`) are tall.
- Boundary cases such as 20x10 with Top/Bottom and 10x20 with Left/Right evaluate to `true`.

### 3. Non-Side Orientations
- Diagonal orientations (`Orientation.TopLeft`, `Orientation.TopRight`, `Orientation.BottomLeft`, `Orientation.BottomRight`) and `Orientation.NONE` always evaluate to `false` regardless of the node dimensions.

### 4. Zero and Negative Dimensions
- No defensive validation, clamping, normalization, or absolute values are introduced.
- In Go, `0 >= 2 * 0` evaluates to `true` for both `isWide` and `isTall`. Therefore, for `0x0`, all four cardinal orientations return `true`, while non-cardinal orientations return `false`.
- For negative dimensions, raw IEEE-754 arithmetic is applied directly (e.g. `-10 >= 2 * -5` is `-10 >= -10` which is `true`).

### 5. Floating-Point Arithmetic
- Direct JavaScript `Number` arithmetic is used without epsilon or artificial rounding, mirroring Go's `float64` operations.

### 6. Nil Node Behavior
- In Go, passing `nil` panics immediately upon dereferencing `node.Width`.
- In JS, passing `null` or `undefined` naturally throws a `TypeError` when accessing `node.Width`. No defensive nil guard is introduced.

### 7. Purity and Isolation
- The function is strictly pure and produces zero side effects or mutations on `node`.
- No `WorkGuard`, cancellation, context, `GraphState`, or validation preflights are involved.

### 8. Export Boundaries
- Exported as `canUseBothSides` and PascalCase alias `CanUseBothSides` from `src/proximity/herding.js` and re-exported from `src/proximity/index.js`.
- Not exported from root `src/index.js`.

### 9. Deferred Herding Logic
- `AssignHerds` and `connectedHerds` remain deferred to subsequent slices.
- `ApplyVirally` is deferred because its conflict error formatting requires `node.DebugID()`, which is not yet part of the JS graph API.
- `SyncHerdFences` is deferred because it requires `graph.BoundingBox()`, which is not yet part of the JS graph API.
