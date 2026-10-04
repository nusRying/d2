# Slice 28: Proximity Hub Discovery (`AddHubs`)

## Objective
Implement `proximity.addHubs` and its PascalCase alias `AddHubs` in `src/proximity/hubs.js` matching Go TALA semantics, discovering candidate hub nodes and their ordered leaf spokes within the same containing layout group and recording them atomically into `graph.Hubs`.

## Scope
- `addHubs(context, graph)`
- `AddHubs(context, graph)`
- Module exports in `src/proximity/hubs.js` and `src/proximity/index.js`
- Validate-first execution via `validateEngineGraph(context, "AddHubs", graph)`
- WorkGuard limit `MAX_ENGINE_WORK_UNITS` with exact accounting: 1 unit per node + 1 unit per edge
- `guard.Finish()` before committing local `Map` to `graph.Hubs`
- Failure atomicity (preserving previous `graph.Hubs` reference and contents)
- Success reference replacement (installing a fresh `Map` reference even if empty)
- Same-container grouping filtering via `node.OwningContainer()`
- Raw edge length leaf classification (`adjacent.Edges.length === 1`)

## Progress
- [x] Create Go Oracle script for `proximity.AddHubs` scenarios (`go_add_hubs_oracle.go`).
- [x] Generate reference fixture `go-add-hubs-reference.json` (21 scenarios).
- [x] Implement JS `addHubs` and `AddHubs` in `src/proximity/hubs.js`.
- [x] Export `addHubs` and `AddHubs` from `src/proximity/index.js`.
- [x] Create oracle replay test `add-hubs-oracle.test.js` (21 pass).
- [x] Create direct unit tests `add-hubs.test.js` (10 pass).
- [x] Pass all targeted tests (31 pass across 2 files).
- [x] Pass full JS regression suite (1351 pass across 57 files).
- [x] Pass all upstream Go test suites (`proximity/...`, `layoutgraph/...`, `grouping/...`).
- [x] Clean static boundaries (zero `Math.random()`, zero Node-only imports, no `AssignNears`, `CommonUncleSiblings`, `SyncHerdFences`, `JoinDistancedClusters`, placement, packing, routing, or engine orchestration).

## Artifacts
- `docs/ADR-029-ADD-HUBS.md`
- `docs/SLICE-28-PROGRESS.md`
- `src/proximity/hubs.js`
- `src/proximity/index.js`
- `test/reference/go_add_hubs_oracle.go`
- `test/fixtures/go-add-hubs-reference.json`
- `test/unit/add-hubs-oracle.test.js`
- `test/unit/add-hubs.test.js`
