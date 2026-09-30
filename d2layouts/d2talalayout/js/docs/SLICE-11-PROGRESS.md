# Slice 11 Progress — Sequence Analysis, Remembered-State Validation, Defining Edges, and ID Occupancy

## 1. Goal
Port the read-only sequence analysis and validation layer of TALA prior to topology mutation:
- `Node.prototype.IsContainer()`
- `identifySequences(graph, nodes, guard)`
- `SequenceDefiningEdges(context, graph)`
- `isValidRememberedSequence(graph, vessel, sequence, activeNodes, guard)`
- `hasNodeID(graph, id)`
- `nextAvailableNodeID(graph, candidate, unavailable)`

---

## 2. Pinned References and Environment
- **Approved Slice 10 Base Head:** `3bf1d0867103e185445d7924e03ebd0eb0f12965`
- **Pinned Upstream D2 Reference:** `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`
- **Host Runtime:** Go `go1.27.0`, OS `windows`, Arch `amd64`
- **Go Sources Studied:**
  - `internal/grouping/sequences.go`
  - `internal/grouping/sequences_test.go`
  - `internal/grouping/sequences_correctness_test.go`
  - `internal/grouping/resource_test.go`
  - `internal/grouping/lifecycle.go`
  - `internal/layoutgraph/sequence.go`
  - `internal/layoutgraph/layout.go`
  - `internal/layoutgraph/structure_api.go`
  - `internal/layoutgraph/hierarchy_access.go`
  - `internal/layoutgraph/node.go`
  - `internal/layoutgraph/edge.go`
  - `internal/layoutgraph/id.go`
  - `internal/limits/work.go`

---

## 3. Scope Decision & Mutation Deferral
Slice 11 intentionally confines its scope to read-only analysis. Topology modifications (`buildSequence`, `addSequence`, `abductSequenceEdges`, `clearRememberedSequenceMembership`, and `AddSequences` pipeline orchestration) are strictly deferred to future mutation slices.
- No `GraphState` snapshots or rollbacks were required or created.
- No edge disconnection, reconnection, or abduction was performed in production grouping code.
- No sequence vessel nodes were created in production grouping code.
- Input graphs remain 100% immutable and alias-preserved.

---

## 4. Reused LayoutGraph Accessors and New IsContainer()
The following accessors were verified and reused from existing JS modules:
- `Node.prototype.IsSequenceStep()`
- `Node.prototype.ConnectionTo()`
- `Node.prototype.Adjacent()`
- `Graph.prototype.SequenceOrder()`
- `Sequence.prototype.IsActive()`

Added to `src/graph/node.js`:
```js
IsContainer() {
  return Boolean(this.isContainer);
}
```
Existing `this.isContainer` boolean field was retained without renaming.

Capitalized method aliases added to `Graph`:
- `AddNodeToContainer(container, node)`
- `AddNewNodeToContainer(container, node)`
- `RemoveNode(node)`

---

## 5. Implementation Summary

### `identifySequences(graph, nodes, guard)`
- **Active Node Inventory:** Iterates `graph.Nodes`, charging `guard.Step()` for each node, and populates `activeNodes` set by reference identity.
- **Candidate Filtering Order:**
  For each candidate in `nodes` (charging `guard.Step()`):
  1. `if (!activeNodes.has(node) || node.IsContainer()) continue;`
  2. `if (node.Sequence != null && !node.Sequence.IsActive()) continue;` (inactive remembered steps skipped)
  3. `if (node.FixedTopLeft != null || !node.IsSequenceStep()) continue;`
- Returns `null` if `<= 1` candidate steps remain (matching Go nil slice convention).
- **Run Discovery & Sibling Collapse:**
  - Preserves container child order.
  - Consecutive pairs scan `previous.Edges` in array order, charging `guard.Step()` per edge.
  - Direction-agnostic connectivity: both `A -> B` and `B -> A` connect steps.
  - Disconnected steps split the run; singleton runs are discarded.
  - Non-step siblings between connected steps are filtered out and collapse cleanly.
  - Returns `Array<Array<Node>> | null`.

### `SequenceDefiningEdges(context, graph)`
- Executes `Validate(context, "GetSequenceDefiningEdges", graph)` prior to work allocation.
- Creates `new WorkGuard(context, "GetSequenceDefiningEdges", MAX_ENGINE_WORK_UNITS)`.
- Traverses `graph.ContainerRDFSOrder(null, guard)` followed by root `null`.
- Traversal is container-local: candidates across container boundaries do not form sequences.
- For each step pair, scans `previous.Edges` in order (charging `guard.Step()`); selects the first matching edge connecting the pair.
- Throws `"TALA sequence steps <A> and <B> have no defining edge"` if an inconsistent step pair lacks an edge.
- Returns `Set<EntityID>` of defining edge IDs. Concludes with `guard.Finish()`.

### `isValidRememberedSequence(graph, vessel, sequence, activeNodes, guard)`
- **Immediate Rejection (0 work units charged):** `vessel == null`, `sequence == null`, `sequence.IsActive() == true`, `sequence.Vessel !== vessel`, `sequence.Graph !== graph`, `sequence.Nodes.length < 2`.
- **Active Container:** If `sequence.Container != null`, requires `activeNodes.has(sequence.Container)`.
- **Container Key Existence:** Requires `graph.Containers.has(sequence.Container)`.
- **Duplicate Container Children:** Container children each charge `guard.Step()`; duplicate child references invalidate the sequence.
- **Sequence Invariants:** For each node in `sequence.Nodes` (charging `guard.Step()`): non-null, unique, active, matching graph, step shape, unfixed, matching sequence, matching container, unique child in container.
- **Contiguity:** Container child indices must strictly increment by 1 (`i, i + 1, i + 2, ...`).
- **No Defining-Edge Requirement:** Accurately permits valid remembered sequences whose defining edges were disconnected during cleanup.
- Returns Boolean; strictly read-only (does not clear `node.Sequence`).

### `hasNodeID(graph, id)`
- Compares IDs using `BigInt(id) === BigInt(node.ID)`.
- Strictly searches: `graph.Nodes`, `graph.Clusters` (vessels and nodes), `graph.Sequences` (vessels and nodes), `graph.Trees` (sentinels, `tree.Node`, recursive `tree.Children`).
- Safely handles null vessels, sequences, trees, and nodes.

### `nextAvailableNodeID(graph, candidate, unavailable)`
- Evaluates candidate against `unavailable` ID set and `hasNodeID(graph, candidate)`.
- Wrap-around: `if (candidate === INT64_MAX) candidate = 0n; else candidate++;`.
- Fully supports negative candidate IDs (e.g. `-1n`).
- Consumes zero RNG: deterministic candidate increment.

---

## 6. Go Oracle and Fixture Verification
- **Oracle Source:** `test/reference/go_sequence_analysis_oracle.go`
- **Fixture Output:** `test/fixtures/go-sequence-analysis-reference.json`
- **Reproducibility Test:** Generated across two independent runs (`-a` and `-b`) with identical SHA256:
  `96a90f9cd744aa9d8722f43ce91533a061efce8d350fa256254036e3d1957d10`
- **Oracle Evidence Strategy:**
  - Direct public Go APIs: `Node.IsContainer`, `Node.IsSequenceStep`, `Node.ConnectionTo`, `Graph.SequenceOrder`, `grouping.SequenceDefiningEdges`.
  - Indirect public Go evidence for private helpers:
    - `isValidRememberedSequence` observed via `AddSequences` + `Cleanup` round-trip and stale mutation cases (`shape_changed`, `container_changed`, `membership_cleared`, `members_noncontiguous`, `removed_graph_node`).
    - `nextAvailableNodeID` and `hasNodeID` observed via `AddSequences` deterministic RNG collision resolution with ordinary node, cluster vessel, tree sentinel, and nested tree node.
  - Direct JS source-derived tests for private helper unit contracts (e.g. `MaxInt64` wrap-around, exact WorkGuard step counts).

---

## 7. Performance Sanity Benchmark (Informational)
Host: Windows 11 / AMD64 (Bun v1.3.14):
- 10,000 `identifySequences` calls on 3-step chain: **29.99 ms** (~3.0 µs / call)
- 1,000 `SequenceDefiningEdges` calls on nested 3-container graph: **53.81 ms** (~53.8 µs / call)
- 100,000 `hasNodeID` lookups on 50-node graph: **89.52 ms** (~0.9 µs / lookup)

---

## 8. Audits
- **Math.random Audit:** 0 occurrences in `src/grouping`. Zero RNG draws in analysis.
- **Browser Audit:** 0 Node built-in imports (`fs`, `path`, `Buffer`, `process`, `crypto`, `events`, `worker_threads`) in `src/grouping`.
- **Mutation Audit:** 0 topology assignments (`.Sequence =`, `.Container =`, `Disconnect`, `Reconnect`, `AddNode`, `RemoveNode`, `AddNewNodeToContainer`) in `src/grouping`.

---

## 9. Full Regression Results
Authoritative Bun test suite execution:
```text
bun test v1.3.14 (0d9b296a)
438 pass
0 fail
9254 expect() calls
Ran 438 tests across 23 files. [793.00ms]
```
All Slice 01–10 tests remain completely green.

---

## 10. Problems Encountered and Resolutions
1. **Empty Sequences Return Distinction:** `identifySequences` originally returned `[]` when `stepNodes.length > 1` but no pairs were connected. In Go, `var sequences [][]*layoutgraph.Node` is declared without allocation, remaining `nil`. Fixed to `return sequences.length > 0 ? sequences : null` to maintain the `Go nil [] -> JS null` mapping.
2. **Tree Constructor Argument:** `new Tree(node)` expects the node directly rather than `{ Node: node }`. Corrected in ID occupancy tests.
3. **Graph Method Capitalization:** Go methods `AddNewNodeToContainer`, `AddNodeToContainer`, and `RemoveNode` were capitalized in Go tests; added uppercase delegating aliases to `Graph` in `src/graph/graph.js`.
4. **Missing Defining Edge Error Test Hook:** `Validate` accesses `node.Edges` during graph preflight; configuring the Edges mock getter to return empty edges only when called outside `Validate` and `identifySequences` allowed testing the defensive missing defining edge error branch cleanly.

---

## 11. Git History and Commits
1. `fb03c8450` — `docs(tala-js): close approved Slice 10`
2. Next: `feat(tala-js): add sequence analysis helpers`
3. Next: `feat(tala-js): add sequence defining-edge discovery`
4. Next: `test(tala-js): add Go sequence analysis oracle`
5. Next: `docs(tala-js): document Slice 11 sequence analysis`
