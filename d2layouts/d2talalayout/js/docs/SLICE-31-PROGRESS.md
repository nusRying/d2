# Slice 31: Herd Discovery (`GroupSheep`)

## Objective
Port `proximity.GroupSheep` from Go to browser-safe JavaScript, matching Go TALA semantics for grouping root container children by their external uncle and recording cousin connections from edge abductions.

## Scope
- `groupSheep(context, graph, root, abductions)` in `src/proximity/herding.js`
- `GroupSheep` (PascalCase alias)
- Module exports in `src/proximity/index.js`
- Local helpers `groupVessel` and `descendantOf` matching Go precedence
- Direct context polling (no `WorkGuard`)
- Exact cancellation check timing (each child, each abduction including used abductions)
- Zero cancellation checks if root has no children
- Source array order preservation for children and abductions
- Global `used` array across all children
- Single-use abductions consumed before cousin climbing / uncle validation
- Cousin climbing precedence: Cluster > Sequence > OwningContainer
- Final uncle requires `uncle != null && uncle.isContainer`
- `byUncle` node deduplication per uncle
- `toCousin` cousin duplicate preservation
- Zero mutation of graph or node state; fresh Map instances returned
- Zero placement integration, zero `AssignHerds` implementation

## Progress
- [x] Implement JS `groupSheep` and `GroupSheep` in `src/proximity/herding.js`.
- [x] Export `groupSheep` and `GroupSheep` from `src/proximity/index.js`.
- [x] Create Go Oracle script for 33 scenarios (`go_group_sheep_oracle.go`).
- [x] Generate reference fixture `go-group-sheep-reference.json` (33 scenarios).
- [x] Create oracle replay test `group-sheep-oracle.test.js` (33 pass).
- [x] Create direct unit tests `group-sheep.test.js` (23 pass).
- [x] Pass all targeted tests (56 pass across 2 files).
- [x] Pass full JS regression suite.
- [x] Pass Go proximity, layoutgraph, and grouping test suites.

## Artifacts
- `docs/ADR-031-ASSIGN-NEARS.md` (updated to Accepted)
- `docs/ADR-032-GROUP-SHEEP.md`
- `docs/SLICE-31-PROGRESS.md`
- `src/proximity/herding.js`
- `src/proximity/index.js` (updated)
- `test/reference/go_group_sheep_oracle.go`
- `test/fixtures/go-group-sheep-reference.json`
- `test/unit/group-sheep-oracle.test.js`
- `test/unit/group-sheep.test.js`
