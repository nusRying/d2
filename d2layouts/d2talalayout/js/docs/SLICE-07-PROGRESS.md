# Slice 07 — Sequence Geometry Primitives Progress

## Goal
Port the deterministic `layoutgraph.Sequence` geometry, positioning, and query behaviors required by the future `AddSequences` pipeline stage with exact Go parity.

## Approved Slice 06 Base
- Commit SHA: `aaf8972e7e5ee97faa1ee2aa9f925bce0cb7dc1d`

## Pinned D2 Reference SHA
- Commit SHA: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Version
- Execution environment: `go1.27.0 windows/amd64` using `C:\Program Files\Go\bin\go.exe`.

## Go Files Studied
1. `d2layouts/d2talalayout/internal/layoutgraph/sequence.go`: Core `Sequence` struct, `SequenceAdvance`, `SyncGeometry`, `SyncGeometryWithWork`, `resizeWithWork`, `ArrangeSteps`, `arrangeStepsWithWork`, `PlaceVessel`, `findAbductedNodeByEdge`, and `Graph.SyncSequences`.
2. `d2layouts/d2talalayout/internal/layoutgraph/group_geometry.go`: `ClusterGeometryWork`, `unmeteredGroupGeometryWork`, and `unmeteredGroupGeometry`.
3. `d2layouts/d2talalayout/internal/layoutgraph/subgraph_access.go`: `SharedWorkStepper` contract (`Step() error`, `Finish() error`).
4. `d2layouts/d2talalayout/internal/layoutgraph/placement_access.go`: `Sequence.AbductedNodeByEdge` public wrapper.
5. `d2layouts/d2talalayout/internal/grouping/sequences.go`: `AddSequences` lifecycle and sequence candidate grouping.
6. `d2layouts/d2talalayout/internal/grouping/sequences_regression_test.go`: `TestBuildSequence`, `TestBuildSequenceUsesPositionedSteps`, and `TestSyncSequencesInGraph`.
7. `d2layouts/d2talalayout/internal/layoutgraph/sequence_test.go`: `TestSequenceAdvance` boundary cases.
8. `d2layouts/d2talalayout/internal/engine/sequence_integration_test.go`: Step dimension normalization and sequence serde tests.
9. `lib/shape/shape_step.go`: `STEP_WEDGE_WIDTH = 35.0` constant and wedge clamping logic.

### JavaScript Files Inspected & Modified
1. `src/shape/constants.js`: Created to export `STEP_WEDGE_WIDTH = 35.0`.
2. `src/shape/index.js`: Created to re-export shape constants.
3. `src/graph/group-geometry.js`: Created to export `unmeteredGroupGeometry`.
4. `src/graph/sequence.js`: Implemented `sequenceAdvance`, `SyncGeometry`, `SyncGeometryWithWork`, `resizeWithWork`, `ArrangeSteps`, `arrangeStepsWithWork`, `PlaceVessel`, and `AbductedNodeByEdge`.
5. `src/graph/graph.js`: Implemented `syncSequences()` and `SyncSequences()`.
6. `src/geometry/point.js`: Added `Copy()` alias to `Point`.
7. `src/index.js`: Exported shape, geometry, and group-geometry modules.

## Scope Decision & Why AddSequences Was Separated
`AddSequences` is a multi-step grouping stage that depends on extensive transactional, non-deterministic, and lifecycle mechanisms:
- `Validate` preflight checks.
- `WorkGuard` work budget accounting and cancellation polling.
- `GraphState` snapshots and exact atomic rollback.
- Pseudo-random number generation (`random.Int63`) for candidate ordering and vessel ID generation.
- Defining-edge disconnection, edge abduction, and reconnect lifecycle.
- Container replacement and active vessel installation.

Isolating `Sequence` geometry primitives into Slice 07 ensures that horizontal spacing, overlap calculations, step layout, vessel positioning, and abducted edge queries are fully verified in isolation without coupling to sequence discovery.

## STEP_WEDGE_WIDTH Constant
- Pinned value: `35.0` (from `lib/shape/shape_step.go`).
- Defined in `src/shape/constants.js`.
- Exported and reused across sequence geometry calculations without duplicating literal `35`.

## SequenceAdvance Algorithm
```javascript
export function sequenceAdvance(width) {
  if (width <= 0) {
    return 0;
  }
  let wedge = STEP_WEDGE_WIDTH;
  if (width <= wedge) {
    wedge = width / 2;
  }
  return width - wedge;
}
```
- For `width <= 0`: returns `0`.
- For narrow steps (`width <= 35`): wedge is clamped to `width / 2`, returning `width - width / 2`.
- For wide steps (`width > 35`): full `STEP_WEDGE_WIDTH` is subtracted.
- No rounding or clamping beyond Go rules is applied.

## SharedWorkStepper Contract
Defined in `src/graph/group-geometry.js`:
```javascript
export const unmeteredGroupGeometry = {
  Step() {},
  Finish() {},
};
```
Provides the accounting boundary for `SyncGeometryWithWork` and `arrangeStepsWithWork` without premature WorkGuard complexity.

## SyncGeometry & Resize Behavior
- Calling `SyncGeometryWithWork(work)`:
  1. Validates `work != null` (throws `sequence geometry requires work accounting` if null).
  2. Calls `work.Step()`.
  3. Validates `this.Vessel != null` (throws `sequence is missing its vessel` if null).
  4. Calls `resizeWithWork(work)`.
  5. Calls `arrangeStepsWithWork(work)`.
- `resizeWithWork(work)`:
  - Iterates `this.Nodes`. For each step:
    - Calls `work.Step()` **before** validating the step.
    - If `step == null`, throws `sequence contains a nil step`.
    - Updates `width = Math.max(width, offset + Math.max(0, step.Width))`.
    - Updates `offset += sequenceAdvance(step.Width)`.
    - Updates `height = Math.max(height, Math.max(0, step.Height))`.
  - Sets `Vessel.Width` and `Vessel.Height`.
- Negative dimensions: `Math.max(0, ...)` clamps visible contribution to 0, and `sequenceAdvance(w <= 0)` is 0.
- Empty sequence: leaves vessel dimensions at `0x0`.

## ArrangeSteps Behavior
- If `Vessel.TopLeft == null`: calls `work.Finish()` and returns immediately without altering step positions.
- If `Vessel.TopLeft != null`:
  - Clones `tl = Vessel.TopLeft.copy()`.
  - For each step:
    - Calls `work.Step()`.
    - Sets `step.TopLeft = tl.copy()` (allocating a fresh, independent `Point` instance).
    - Advances `tl.X += sequenceAdvance(step.Width)`.
  - Calls `work.Finish()` once after the loop.
- Step Point instances are completely independent (`step1.TopLeft !== step2.TopLeft !== vessel.TopLeft`).

## PlaceVessel Behavior
- Initializes `topLeft = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)`.
- For each step in `Nodes`:
  - If `step.TopLeft == null`, returns immediately without updating `Vessel.TopLeft`.
  - Updates `topLeft.X = Math.min(topLeft.X, step.TopLeft.X)`.
  - Updates `topLeft.Y = Math.min(topLeft.Y, step.TopLeft.Y)`.
- If all steps have positions, sets `Vessel.TopLeft = topLeft`.
- If `Nodes` is empty, sets `Vessel.TopLeft` to `(+Infinity, +Infinity)`.

## AbductedNodeByEdge Query
- Searches `this.EdgeAbductions` for matching `ea.Edge === edge` by object identity.
- If `ea.CurrentFrom === Vessel`, returns `ea.OriginallyFrom`.
- If `ea.CurrentTo === Vessel`, returns `ea.OriginallyTo`.
- If both endpoints equal `Vessel`, `CurrentFrom` takes precedence, returning `ea.OriginallyFrom`.
- Returns `null` if no match touches the vessel.

## Graph.SyncSequences Traversal
- Early returns if `this.Sequences.size === 0`.
- Iterates `this.Nodes` in order and executes `rdfsWalk`.
- For each node encountered, if `this.Sequences.has(n)`, calls `sequence.SyncGeometry()`.
- Unreachable sequences in `Graph.Sequences` (not reachable from `Graph.Nodes` via `rdfsWalk`) are ignored.

## Go Oracle Fixture SHA256
- Fixture path: `test/fixtures/go-sequence-geometry-reference.json`
- SHA256: `b08337a28a40b04b5f8e8c1085bb3013bae2dd478cb62d98de9ca8a3067326de`

## Fixture Reproducibility
Generated twice consecutively with `C:\Program Files\Go\bin\go.exe`:
- Run A SHA256: `b08337a28a40b04b5f8e8c1085bb3013bae2dd478cb62d98de9ca8a3067326de`
- Run B SHA256: `b08337a28a40b04b5f8e8c1085bb3013bae2dd478cb62d98de9ca8a3067326de`
Identical hashes verify deterministic reproducibility.

## Full Regression
Authoritative test run:
```powershell
bun test
```
Result:
- 201 pass
- 0 fail
- 8547 expect() calls
- 15 test files
- Runtime: ~230ms

## Math.random Audit
- `Math.random` occurrences in `js/src`: **0**

## Browser-Safe Audit
- Node built-in imports/usages (`fs`, `path`, `Buffer`, `process`, `crypto`) in `js/src`: **0**

## Performance Sanity
Benchmarked via Bun runtime:
- 100,000 `SequenceAdvance` calls: 2.32 ms (~23.2 ns/call).
- 100,000 `SyncGeometry` calls on 2-step sequence: 19.34 ms (~193.4 ns/call).
- 10,000 `Graph.SyncSequences` calls on nested graph: 4.06 ms (~406 ns/call).

## Problems Encountered and Review Findings
1. **Container marking during nested sequence sync**: In Go `rdfsWalk`, containers are only walked if `n.isContainer == true`. Using `g.AddNewNodeToContainer(nil, container)` and `g.AddNodeToContainer(container, vessel)` correctly marks `container.isContainer = true`, ensuring nested sequence vessels are visited during graph synchronization.
2. **Active sequence member filtration in clone**: In `cloneGraph`, active sequence members are attached to `clonedSequence.Nodes` and filtered out of `clonedGraph.Nodes` to match Go layoutgraph semantics. Step references must be resolved via `clonedSequence.Nodes` rather than `clonedGraph.Nodes`.
3. **Point independence**: Verified that `arrangeStepsWithWork` copies `tl` for each step, preventing shared coordinate references across steps.

## Limitations
- Sequence discovery, candidate evaluation, and automatic vessel installation (`grouping.AddSequences`) are deferred to subsequent slices.
- `WorkGuard` cancellation budgets and iteration tracking are deferred.
- Transactional rollback (`GraphState` snapshots) is deferred.

## Result
Deterministic, browser-safe implementation of Sequence geometry primitives in JavaScript with 100% Go oracle parity across all test cases.

## Commit History on `tala-js/slice-07-sequence-geometry`
- `19a0a2c6a` docs(tala-js): close approved Slice 06
- `bc05feb4e` feat(tala-js): port sequence geometry primitives
- `beacdff82` test(tala-js): add Go sequence geometry oracle
- `ddca67e67` docs(tala-js): document Slice 07 sequence geometry
