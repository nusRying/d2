# Slice 34: Viral Herd Orientation Propagation (`ApplyVirally`)

## Objective
Port `proximity.ApplyVirally` from Go to browser-safe JavaScript, matching Go TALA semantics for propagating herd orientations across uncle-grouped sibling sets until reaching stability, with precise non-atomic partial mutation, invariant error formatting via `node.DebugID()`, and context cancellation checks.

## Scope
- `applyVirally(context, herdOrder, herds)` in `src/proximity/herding.js`
- `ApplyVirally` (PascalCase alias)
- Module exports in `src/proximity/index.js`
- Direct context polling (no `WorkGuard`, no `GraphState`, no transactions, no rollback)
- Exact cancellation check timing:
  - Top of each outer pass
  - Immediately before each uncle in `herdOrder`
  - Zero checks inside the node loops
- Top-of-pass check occurs immediately; null context throws `TypeError` even on empty `herdOrder`
- Source array order preservation for `herdOrder` and `herds[uncle]`
- First non-NONE assignment selected as group orientation
- `Orientation.TopLeft` defaults treated as valid known orientations
- `Orientation.NONE` is never a source and is never overwritten
- Propagation only into `node.HerdAssignment == null`
- Existing matching orientations left untouched with identity preserved
- Deep assignment copy via `assignment.Copy()`
- Exact invariant error message formatting:
  `layout invariant violated: node <DebugID> has herd orientation <actual>; expected <expected>`
- Preserving partial mutation on invariant error and on cancellation
- Extra outer stability pass whenever any copy occurs
- Cascading multi-pass virality when herd order requires it
- Safe handling of `herds == null`, missing uncle keys, and null uncle keys
- Zero implementation of `AssignHerds`, `connectedHerds`, `SyncHerdFences`, or `BoundingBox`

## Progress
- [x] Implement JS `applyVirally` and `ApplyVirally` in `src/proximity/herding.js`.
- [x] Re-export `applyVirally` and `ApplyVirally` from `src/proximity/index.js`.
- [x] Create Go Oracle script for 34 scenarios (`go_apply_virally_oracle.go`).
- [x] Generate reference fixture `go-apply-virally-reference.json` (34 scenarios).
- [x] Create oracle replay test `apply-virally-oracle.test.js` (34 pass).
- [x] Create direct unit tests `apply-virally.test.js` (27 pass).
- [x] Pass targeted regression tests across proximity and layoutgraph.
- [x] Pass full JS regression suite.
- [x] Pass Go proximity, layoutgraph, and grouping test suites.

## Artifacts
- `docs/ADR-034-DEBUG-IDS.md` (updated to Accepted)
- `docs/ADR-035-APPLY-VIRALLY.md`
- `docs/SLICE-34-PROGRESS.md`
- `src/proximity/herding.js` (updated)
- `src/proximity/index.js` (updated)
- `test/reference/go_apply_virally_oracle.go`
- `test/fixtures/go-apply-virally-reference.json`
- `test/unit/apply-virally-oracle.test.js`
- `test/unit/apply-virally.test.js`
