# Slice 33: LayoutGraph Diagnostic IDs (`DebugID` Parity)

## Objective
Port `Node.DebugID`, `Cluster.DebugID`, and `Sequence.DebugID` from Go to browser-safe JavaScript, matching Go TALA diagnostic formatting, precedence, signed-int64 decimal serialization, and natural malformed-state failure modes.

## Scope
- `nodeDebugID(node)` in `src/graph/node.js`
- `Node.prototype.debugID()` and `Node.prototype.DebugID()`
- `clusterDebugID(cluster)` in `src/graph/cluster.js`
- `Cluster.prototype.debugID()` and `Cluster.prototype.DebugID()`
- `sequenceDebugID(sequence)` in `src/graph/sequence.js`
- `Sequence.prototype.debugID()` and `Sequence.prototype.DebugID()`
- Strict precedence in `Node.DebugID`:
  1. `node == null` -> `"nil"`
  2. `node.D2ID != null` -> `node.D2ID` (empty string preserved)
  3. `node.isClusterVessel` -> `"Cluster vessel of: " + cluster.DebugID()`
  4. `node.Graph.Sequences[node]` -> `"Sequence vessel of: " + sequence.DebugID()`
  5. numeric fallback -> `BigInt(node.ID).toString(10)`
- Cluster diagnostic format: `[member1, member2]; Arrangement: <arrangement>`
- Sequence diagnostic format: `[member1, member2]`
- Source-array order preservation without sorting
- Handling nil members inside Cluster and Sequence as `"nil"`
- Natural `TypeError` failures on nil cluster/sequence receivers and malformed vessel states
- Non-circular import structure (`cluster.js` and `sequence.js` import `nodeDebugID` from `./node.js`)
- Zero mutations to graphs, nodes, clusters, or sequences
- Zero implementations of `ApplyVirally`, `AssignHerds`, `connectedHerds`, `SyncHerdFences`, or `BoundingBox`

## Progress
- [x] Implement JS `nodeDebugID`, `debugID`, and `DebugID` in `src/graph/node.js`.
- [x] Implement JS `clusterDebugID`, `debugID`, and `DebugID` in `src/graph/cluster.js`.
- [x] Implement JS `sequenceDebugID`, `debugID`, and `DebugID` in `src/graph/sequence.js`.
- [x] Create Go Oracle script for 38 scenarios (`go_debug_ids_oracle.go`).
- [x] Generate reference fixture `go-debug-ids-reference.json` (38 scenarios).
- [x] Create oracle replay test `debug-ids-oracle.test.js` (38 pass).
- [x] Create direct unit tests `debug-ids.test.js` (20 pass).
- [x] Pass targeted regression tests across layoutgraph, grouping, and proximity.
- [x] Pass full JS regression suite.
- [x] Pass Go layoutgraph, grouping, and proximity test suites.

## Artifacts
- `docs/ADR-033-CAN-USE-BOTH-SIDES.md` (updated to Accepted)
- `docs/ADR-034-DEBUG-IDS.md`
- `docs/SLICE-33-PROGRESS.md`
- `src/graph/node.js` (updated)
- `src/graph/cluster.js` (updated)
- `src/graph/sequence.js` (updated)
- `test/reference/go_debug_ids_oracle.go`
- `test/fixtures/go-debug-ids-reference.json`
- `test/unit/debug-ids-oracle.test.js`
- `test/unit/debug-ids.test.js`
