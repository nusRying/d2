# ADR 008: Sequence Geometry Primitives

## Date
2026-09-29

## Status
Implemented — awaiting Slice 07 review

## Context
In TALA's layout engine, sequence grouping is a multi-phase subsystem. Prior to executing full sequence identification, candidate abduction, and vessel installation (`grouping.AddSequences`), the layoutgraph requires deterministic geometry, layout, and query primitives on `Sequence` records.

In pinned Go D2 (`d2layouts/d2talalayout/internal/layoutgraph/sequence.go`), `Sequence` objects own:
- Horizontal advance calculations (`SequenceAdvance`) factoring in step wedge geometry.
- Automatic vessel dimension calculations based on step overlap (`resizeWithWork`).
- Step placement relative to the sequence vessel (`ArrangeSteps`).
- Vessel placement relative to step bounding top-left positions (`PlaceVessel`).
- Traversal synchronization across nested graphs (`Graph.SyncSequences`).
- Original endpoint resolution for abducted edges (`AbductedNodeByEdge`).

## Decisions

### 1. Separation from `AddSequences`
`grouping.AddSequences` is a high-level grouping algorithm requiring:
- Graph validation and transactional rollback (`GraphState` snapshots).
- Pseudo-random number generation (`math/rand`) for sequence vessel allocation and candidate breaking.
- Active vessel replacement, edge abduction, defining-edge disconnection, and container reassignment.
- Iteration budgets and cooperative cancellation via `WorkGuard`.

By isolating the deterministic geometry primitives into Slice 07, `Sequence` geometry can be rigorously validated against Go layoutgraph behavior without premature coupling to the sequence-creation lifecycle.

### 2. STEP_WEDGE_WIDTH Source
In Go `lib/shape/shape_step.go`, the constant `STEP_WEDGE_WIDTH = 35.0` defines the horizontal width of the triangular wedge on a step shape.
We define and export `STEP_WEDGE_WIDTH = 35.0` in `src/shape/constants.js`. The literal `35` is never duplicated in sequence calculations.

### 3. SequenceAdvance Semantics
`SequenceAdvance(width)` calculates the horizontal distance from one step's top-left to the next:
- If `width <= 0`, returns `0`.
- If `width <= STEP_WEDGE_WIDTH`, the wedge is clamped to `width / 2.0`, returning `width - width / 2.0`.
- If `width > STEP_WEDGE_WIDTH`, the full wedge is subtracted: `width - STEP_WEDGE_WIDTH`.
No rounding or artificial clamping is applied beyond these Go rules.

### 4. Resize and Negative Dimensions
`resizeWithWork` starts with `width = 0`, `offset = 0`, `height = 0`.
For each step in `Nodes`:
- `work.Step()` is invoked first.
- If `step == null`, throws an invariant error (`sequence contains a nil step`).
- `width = Math.max(width, offset + Math.max(0, step.Width))`
- `offset += SequenceAdvance(step.Width)`
- `height = Math.max(height, Math.max(0, step.Height))`
After traversing all steps, `Vessel.Width` and `Vessel.Height` are set.
Negative dimensions clamp to `0` in visible contribution (`Math.max(0, step.Width)`), and `SequenceAdvance(width <= 0)` evaluates to `0`.

### 5. ArrangeSteps and Point Ownership
When `Vessel.TopLeft` is `null`, `arrangeStepsWithWork` calls `work.Finish()` and returns immediately without altering step positions or allocating Points.
When `Vessel.TopLeft` is defined:
- A fresh copy of `Vessel.TopLeft` is created.
- For each step, `work.Step()` is called, and `step.TopLeft = tl.copy()` assigns a distinct, independent `Point` instance.
- `tl.X += SequenceAdvance(step.Width)`.
- `work.Finish()` is called once after loop completion.
Every step receives its own `Point` object, preventing shared mutable reference bugs.

### 6. PlaceVessel Independent Minima and Infinity
`PlaceVessel()` computes the top-left corner of the sequence vessel:
- If ANY step in `Nodes` has `TopLeft == null`, the method returns immediately leaving `Vessel.TopLeft` untouched.
- Minima for X and Y are calculated independently:
  `topLeft.X = Math.min(topLeft.X, step.TopLeft.X)`
  `topLeft.Y = Math.min(topLeft.Y, step.TopLeft.Y)`
- For an empty sequence (`Nodes.length === 0`), `PlaceVessel` assigns `new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)`.

### 7. AbductedNodeByEdge Query
`AbductedNodeByEdge(edge)` performs read-only resolution of abducted endpoints:
- Matches `edge` by strict object reference (`e === ea.Edge`).
- If `ea.CurrentFrom === Vessel`, returns `ea.OriginallyFrom`.
- If `ea.CurrentTo === Vessel`, returns `ea.OriginallyTo`.
- If both match `Vessel`, `CurrentFrom` takes precedence matching Go.
- Returns `null` if no matching abduction touches the vessel.

### 8. Graph.SyncSequences Traversal
`Graph.SyncSequences()`:
- Early-returns if `this.Sequences.size === 0`.
- Traverses `Graph.Nodes` in natural order using `rdfsWalk`.
- Does NOT sort by EntityID or filter by `sequence.IsActive()`.
- Sequence map entries whose vessels are not reachable from `Graph.Nodes` via `rdfsWalk` are never synchronized.

### 9. Minimal SharedWorkStepper Boundary
Go sequence geometry accepts `SharedWorkStepper` with `Step() error` and `Finish() error`.
We provide `unmeteredGroupGeometry` with no-op `Step()` and `Finish()` methods in `src/graph/group-geometry.js`.
`SyncGeometry()` and `ArrangeSteps()` delegate to their `*WithWork` variants using `unmeteredGroupGeometry`.

### 10. Error Handling Convention
In Go, invariant violations return errors (`invariant.New(...)`).
In JavaScript, these invalid conditions throw standard `Error` objects rather than using Result envelopes or silent failures.

### 11. Clone Compatibility
`cloneGraph(source)` properly clones `Sequence` records, auxiliary vessels, and member lists. Synchronizing sequences on a cloned graph updates only the cloned geometry while leaving the source graph unmodified.

## Consequences
- Deterministic, browser-safe sequence geometry in JavaScript with 100% Go oracle parity.
- Zero dependencies on Node built-ins or RNG.
- Clear structural foundation ready for sequence grouping and WorkGuard integration in subsequent slices.
