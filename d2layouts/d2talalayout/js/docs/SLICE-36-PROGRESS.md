# Slice 36: Herd Assignment Orchestration (`AssignHerds`)

## Objective
Port `proximity.AssignHerds` from Go to browser-safe JavaScript, matching Go TALA semantics for herd discovery, singleton filtering, uncle sorting, connected component partitioning, side eligibility and preference negotiation, mutual pair recording, viral orientation propagation, and cluster vessel arrangement adjustment.

## Scope
- `assignHerds(context, graph, root, abductions)` and alias `AssignHerds` in `src/proximity/herding.js`
- Exported from `src/proximity/herding.js` and re-exported from `src/proximity/index.js`
- Non-atomic mutation parity: direct in-place mutation without `GraphState` snapshots or transactional rollback
- Strict cancellation parity: initial `ctx.Err()` check throws `WorkCanceledError("AssignHerds")`, null/undefined context throws `TypeError`
- Singleton filtering: removes groups with `nodes.length <= 1` from `grouped` and `cousins`
- Uncle ordering: sorted by ID via `sortNodesByID(uncleOrder)`
- Component side negotiation:
  - Initializes to `[Top, Right, Bottom, Left]`
  - Intersects with valid sides per placed cousin using `canUseBothSides`
  - Invariant throws if uncle has no children or cousin has invalid orientation
  - Clears `HerdAssignment = null` on all component nodes if sides become empty
  - Unbiased cycling modulo 4 advances only on unconstrained components
- Pair recording:
  - Sets `node.HerdAssignment = new HerdAssignment()` with preferred orientation
  - Records `PairSameSide` and `PairOppositeSide` on both node and cousin
- Viral propagation: calls `applyVirally(context, uncleOrder, grouped)`
- Cluster arrangement flip:
  - Examines nodes where `isClusterVessel && HerdAssignment != null`
  - Flips `Column -> Row` on `Top`/`Bottom`
  - Flips `Row -> Column` on `Left`/`Right`
  - Panics with `TypeError` if cluster vessel not in `graph.Clusters`
- Go oracle program at `test/reference/go_assign_herds_oracle.go`
- Reference fixture at `test/fixtures/go-assign-herds-reference.json` (40 scenarios)
- Oracle replay test at `test/unit/assign-herds-oracle.test.js` (40 passing tests)
- Unit tests at `test/unit/assign-herds.test.js` (11 passing tests)
- ADR at `docs/ADR-037-ASSIGN-HERDS.md`

## Progress
- [x] Implement `assignHerds` / `AssignHerds` in `src/proximity/herding.js`.
- [x] Export `assignHerds` and `AssignHerds` from `src/proximity/index.js`.
- [x] Create Go oracle program `test/reference/go_assign_herds_oracle.go`.
- [x] Run Go oracle to generate `test/fixtures/go-assign-herds-reference.json` (40 scenarios).
- [x] Implement JS oracle replay test `test/unit/assign-herds-oracle.test.js` (40 passing tests).
- [x] Implement JS unit tests `test/unit/assign-herds.test.js` mirroring Go `herding_test.go` (11 passing tests).
- [x] Create ADR at `docs/ADR-037-ASSIGN-HERDS.md`.
- [x] Update `docs/MIGRATION.md` for Slice 36.
- [x] Pass all JS tests (`npm test`: 1787 passed, 0 failed).
- [x] Pass Go proximity tests (`go test -v ./d2layouts/d2talalayout/internal/proximity/...`: passed).

## Artifacts
- `src/proximity/herding.js`
- `src/proximity/index.js`
- `test/reference/go_assign_herds_oracle.go`
- `test/fixtures/go-assign-herds-reference.json`
- `test/unit/assign-herds-oracle.test.js`
- `test/unit/assign-herds.test.js`
- `docs/ADR-037-ASSIGN-HERDS.md`
- `docs/SLICE-36-PROGRESS.md`
- `docs/MIGRATION.md`
