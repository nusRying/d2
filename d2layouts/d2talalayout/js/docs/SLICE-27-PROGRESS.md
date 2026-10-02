# Slice 27: Grouping Cleanup

## Objective
Implement `grouping.cleanup` and its PascalCase alias `Cleanup` in `src/grouping/lifecycle.js` matching Go TALA semantics, restoring cluster and sequence members and retiring vessels after node placement while retaining rediscovery metadata.

## Scope
- `cleanup(graph)`
- `Cleanup(graph)`
- Exports in `src/grouping/lifecycle.js` and `src/grouping/index.js`
- Test orchestration ordering, edge restoration, Near transfer, and HerdAssignment clearing.

## Progress
- [x] Create Go Oracle script for grouping.Cleanup scenarios (`go_cleanup_oracle.go`).
- [x] Generate reference fixture `go-cleanup-reference.json` (25 scenarios).
- [x] Implement JS `cleanup` and `Cleanup` in `src/grouping/lifecycle.js`.
- [x] Export `cleanup` and `Cleanup` from `src/grouping/index.js`.
- [x] Create oracle replay test `cleanup-oracle.test.js` (25 pass).
- [x] Create direct unit tests with call ordering instrumentation `cleanup.test.js` (8 pass).
- [x] Pass all JS test coverage (1320 tests pass across 55 files).
- [x] Pass all upstream Go test bounds.
- [x] Clean static boundaries (no `Join`, `AddHubs`, packing, routing, or engine orchestration).

## Artifacts
- `ADR-028-GROUPING-CLEANUP.md`
- `cleanup` / `Cleanup` in `src/grouping/lifecycle.js`
- Replay tests `test/unit/cleanup-oracle.test.js`
- Unit tests `test/unit/cleanup.test.js`
