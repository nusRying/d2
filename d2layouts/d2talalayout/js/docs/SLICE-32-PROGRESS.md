# Slice 32: Herd Side Eligibility (`CanUseBothSides`)

## Objective
Port `proximity.CanUseBothSides` from Go to browser-safe JavaScript, matching Go TALA semantics for evaluating whether a node has the required aspect ratio to be placed on both sides of a herd boundary under a given orientation.

## Scope
- `canUseBothSides(node, orientation)` in `src/proximity/herding.js`
- `CanUseBothSides` (PascalCase alias)
- Module exports in `src/proximity/index.js`
- Exact aspect ratio conditions:
  - `isWide = node.Width >= 2 * node.Height`
  - `isTall = node.Height >= 2 * node.Width`
- Orientation eligibility:
  - Top or Bottom requires `isWide`
  - Left or Right requires `isTall`
- Inclusive boundary comparison (`>=`)
- Non-cardinal orientations (TopLeft, TopRight, BottomLeft, BottomRight, NONE) evaluate to `false`
- IEEE-754 direct arithmetic on zero and negative dimensions without artificial normalization
- Natural failure on `null`/`undefined` node via `TypeError` (parity with Go nil pointer dereference panic)
- Zero mutation of node dimensions or state
- Pure function without WorkGuard, GraphState, or validation preflight
- Zero placement integration, zero `AssignHerds`, `connectedHerds`, `ApplyVirally`, or `SyncHerdFences`

## Progress
- [x] Implement JS `canUseBothSides` and `CanUseBothSides` in `src/proximity/herding.js`.
- [x] Export `canUseBothSides` and `CanUseBothSides` from `src/proximity/index.js`.
- [x] Create Go Oracle script for 60 scenarios (`go_can_use_both_sides_oracle.go`).
- [x] Generate reference fixture `go-can-use-both-sides-reference.json` (60 scenarios).
- [x] Create oracle replay test `can-use-both-sides-oracle.test.js` (60 pass).
- [x] Create direct unit tests `can-use-both-sides.test.js` (15 pass).
- [x] Pass all targeted tests (75 pass across 2 files).
- [x] Pass full JS regression suite.
- [x] Pass Go proximity, layoutgraph, and grouping test suites.

## Artifacts
- `docs/ADR-032-GROUP-SHEEP.md` (updated to Accepted)
- `docs/ADR-033-CAN-USE-BOTH-SIDES.md`
- `docs/SLICE-32-PROGRESS.md`
- `src/proximity/herding.js` (updated)
- `src/proximity/index.js` (updated)
- `test/reference/go_can_use_both_sides_oracle.go`
- `test/fixtures/go-can-use-both-sides-reference.json`
- `test/unit/can-use-both-sides-oracle.test.js`
- `test/unit/can-use-both-sides.test.js`
