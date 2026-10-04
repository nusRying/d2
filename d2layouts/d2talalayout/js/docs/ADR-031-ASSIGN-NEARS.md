# ADR-031: Proximity Near Assignment (`AssignNears`) (Slice 30)

## Status
Accepted

## Context
In TALA's proximity pipeline, `proximity.AssignNears(ctx, graph, root, abductions)` marks otherwise unconnected siblings that share an external neighbor (uncle) so placement keeps them close together. It discovers uncle relationships from edge abductions, identifies direct children of the root container that are ancestors of the original abduction endpoints, groups connected siblings by external uncle, and records mutual `Near` relationships on eligible sibling pairs.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/nears.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

## Design Parity Decisions

### 1. No Topology Preflight
`AssignNears` in Go does not execute `layoutgraph.Validate`, `validateEngineGraph`, or wrap with `GraphState`. The JS port matches this exactly: malformed structures that Go naturally processes or fails on are not pre-rejected.

### 2. WorkGuard Budget and Accounting
- Public `AssignNears` creates a fresh `WorkGuard(ctx, "AssignNears", MAX_ENGINE_WORK_UNITS)`.
- Internal `assignNearsWithWorkLimit` accepts an explicit `workLimit` parameter for low-budget/atomicity testing.
- Exact Step boundaries:
  - 1 Step per abduction scanned
  - 1 Step per direct child scanned for each abduction
  - 1 Step inside each `isDescendantOf` loop iteration
  - 1 Step per uncle during ordered uncles collection
  - 1 Step per connected node while copying each uncle's node set
  - 1 Step per candidate pair `(first, second)`
  - 1 Step per edge scanned in `hasConnection(first, second)`
  - 1 Step per existing Near reference copied in `mutableNears`
- Pre-commit `guard.Finish()` is called before any live `node.Nears` reference is mutated.
- Post-assignment `guard.Finish()` is called after each committed node. No Steps during commit.

### 3. Local Helper Semantics
- `groupVessel(node)`:
  - If `node == null`, returns `null`.
  - Prioritizes `node.Cluster.Vessel` over `node.Sequence.Vessel`.
  - No active-status check (returns vessel even if cluster/sequence is inactive).
  - Falls back to `node`.
- `isDescendantOf(descendant, ancestor, guard)`:
  - Charges `guard.Step()` at loop entry.
  - Tests `descendant === ancestor` before `descendant == null`, returning `true` if both are null/equal.
  - Precedence: `descendant.Container != null` -> `Container`, then `Cluster` -> `Cluster.Vessel`, then `Sequence` -> `Sequence.Vessel`, else `null`.
  - Both `fromDescendant` and `toDescendant` are evaluated before branching on direct children; if both match, `fromDescendant` takes precedence and `CurrentTo` becomes uncle.

### 4. Staged Mutation and Exact-Reference Rollback
- Discovery and pair iteration populate local staged replacement `Set` instances without touching live `node.Nears`.
- Aggregate staged references are checked against `MAX_TOPOLOGY_REFERENCES` (1,000,000).
- If any cancellation, error, or panic occurs before or during commit:
  - Exact original `Nears` map references stored in `originalNears` are restored (`node.Nears = originalNears.get(node)`).
  - Untouched nodes preserve their original references.
- Commit proceeds in ascending node-ID order (`sortNodesByID(commitOrder)`).
- On complete success, fresh replacement `Set` instances remain installed on touched nodes.
