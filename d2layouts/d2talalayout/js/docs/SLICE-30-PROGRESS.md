# Slice 30: Proximity Near Assignment (`AssignNears`)

## Objective
Port `proximity.AssignNears` and its work-limited kernel `assignNearsWithWorkLimit` from Go to browser-safe JavaScript, matching Go TALA semantics for discovering external uncles from edge abductions and marking eligible siblings near each other with staged replacement and exact-reference rollback.

## Scope
- `assignNears(context, graph, root, abductions)` in `src/proximity/nears.js`
- `AssignNears` (PascalCase alias)
- `assignNearsWithWorkLimit` exported from `src/proximity/nears.js` for unit/low-budget testing
- Module exports in `src/proximity/index.js`
- Local helpers `groupVessel` and `isDescendantOf` matching Go precedence and step accounting
- Staged replacement sets with aggregate `MAX_TOPOLOGY_REFERENCES` (1,000,000) check
- Pre-commit and per-node-commit `guard.Finish()` checks
- Exact original `Nears` reference rollback on any error or cancellation
- Commit in ascending node-ID order
- Zero placement integration, zero engine modifications

## Progress
- [x] Implement JS `assignNears` and `assignNearsWithWorkLimit` in `src/proximity/nears.js`.
- [x] Export `assignNears` and `AssignNears` from `src/proximity/index.js`.
- [x] Create Go Oracle script for 25 scenarios (`go_assign_nears_oracle.go`).
- [x] Generate reference fixture `go-assign-nears-reference.json` (25 scenarios).
- [x] Create oracle replay test `assign-nears-oracle.test.js` (25 pass).
- [x] Create direct unit tests `assign-nears.test.js` (23 pass).
- [x] Pass all targeted tests (48 pass across 2 files).
- [x] Pass full JS regression suite.
- [x] Pass Go proximity, layoutgraph, and grouping test suites.

## Artifacts
- `docs/ADR-030-COMMON-UNCLE-SIBLINGS.md` (updated to Accepted)
- `docs/ADR-031-ASSIGN-NEARS.md`
- `docs/SLICE-30-PROGRESS.md`
- `src/proximity/nears.js`
- `src/proximity/index.js` (updated)
- `test/reference/go_assign_nears_oracle.go`
- `test/fixtures/go-assign-nears-reference.json`
- `test/unit/assign-nears-oracle.test.js`
- `test/unit/assign-nears.test.js`
