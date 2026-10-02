# Slice 35: Connected Herd Components (`connectedHerds`)

## Objective
Port package-private helper `proximity.connectedHerds` from Go to browser-safe JavaScript, matching Go TALA semantics for joining uncle groups that share nodes into connected components, retaining deterministic source order, exact FIFO uncle expansion, exact cancellation check placements, and Go nil-slice conventions.

## Scope
- `connectedHerds(context, herdOrder, herds)` in `src/proximity/herding.js`
- Module export only from `src/proximity/herding.js`
- NO export from `src/proximity/index.js` (unexported in Go)
- NO PascalCase alias (`ConnectedHerds`)
- NO export from root `src/index.js`
- Return shape parity:
  - `null` if empty or nil `herdOrder`
  - `component.nodes: null` if 0 nodes are appended to a component
  - `component.uncles: [uncle]` seeded on creation
- Two-phase execution:
  - Phase 1: `byNode` Map construction in source order without deduplication or cancellation polling
  - Phase 2: FIFO expansion per unseen seed uncle
- Exact cancellation check timing:
  - Polled via `checkAssignHerdsCancellation(context)` at start of each expanded uncle
  - Zero checks on entry or during Phase 1
  - Empty/nil `herdOrder` with pre-cancelled or null context succeeds with `null`
  - Non-empty `herdOrder` with null context naturally throws `TypeError`
- Global `seenUncles` and `seenNodes` sets across the entire function
- Support for `null` uncle and `null` node keys
- In-package Go oracle bridge template at `test/reference/go_connected_herds_oracle_test.go`
- Temporary bridge file copied to `internal/proximity/` only for fixture generation, then deleted
- Zero Go package modifications in git
- Zero implementation of `AssignHerds`, `SyncHerdFences`, or `BoundingBox`

## Progress
- [x] Implement JS `connectedHerds` in `src/proximity/herding.js`.
- [x] Create in-package Go oracle bridge template `test/reference/go_connected_herds_oracle_test.go`.
- [x] Temporarily mount bridge, execute Go test, generate fixture `test/fixtures/go-connected-herds-reference.json` (31 scenarios), and delete bridge file.
- [x] Verify zero Go package diff (`git status --short d2layouts/d2talalayout/internal/proximity`).
- [x] Implement oracle replay test `test/unit/connected-herds-oracle.test.js` (31 passing tests).
- [x] Implement direct unit tests `test/unit/connected-herds.test.js` (27 passing tests).
- [x] Update documentation: ADR-035 Accepted, ADR-036 Implemented (awaiting review), MIGRATION.md updated.
- [x] Pass targeted regressions and full JS/Go test suites.

## Artifacts
- `docs/ADR-035-APPLY-VIRALLY.md` (updated to Accepted)
- `docs/ADR-036-CONNECTED-HERDS.md` (created)
- `docs/SLICE-35-PROGRESS.md` (created)
- `docs/MIGRATION.md` (updated)
- `src/proximity/herding.js` (updated)
- `test/reference/go_connected_herds_oracle_test.go` (created)
- `test/fixtures/go-connected-herds-reference.json` (created)
- `test/unit/connected-herds-oracle.test.js` (created)
- `test/unit/connected-herds.test.js` (created)
