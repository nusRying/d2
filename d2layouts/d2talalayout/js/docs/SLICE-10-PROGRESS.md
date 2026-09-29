# Slice 10 Progress — Topology Preflight and Guarded Container Traversal

## 1. Goal
Port the bounded engine-topology validation layer required by `AddSequences` and later TALA stages, ensuring that unsafe, cyclic, or maliciously oversized runtime graphs are rejected before `GraphState` snapshots or stage mutations. Also port the WorkGuard-metered nested container traversal (`Graph.ContainerRDFSOrder`).

## 2. Baselines and Environment
- **Approved Slice 09 Base Head:** `b4a34f8f176465f690b4e29710631f72679ffcd0`
- **Pinned Upstream D2 Reference:** `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`
- **Runtime Environment:**
  - Go Version: `go1.24.1`
  - OS / Arch: `windows` / `amd64`
  - Runtime Engine: Bun `v1.3.14 (Windows x64)`

## 3. Go Files Studied
- **Primary:**
  - `internal/layoutgraph/topology_preflight.go` (complete `Validate`, `validateEngineGraph`, `validateNodeParentRelation`, `ancestryParent`, reference bounds, and forest verification)
  - `internal/layoutgraph/structure_api.go` (runtime queues, identity inventory, graph collections)
  - `internal/layoutgraph/graph.go` (`ContainerRDFSOrder`, `containerRDFSOrderContext`)
  - `internal/layoutgraph/hierarchy_access.go` (`Hierarchy.levels` access rules without mutation)
  - `internal/layoutgraph/atomicity_p1_test.go` (preflight validation test suites)
  - `internal/layoutgraph/graph_test.go` (`TestGraphRDFSOrder` nested container and cluster fixture)
- **Supporting Structures:**
  - `internal/layoutgraph/node.go`, `edge.go`, `layout.go`, `cluster.go`, `sequence.go`, `tree.go`, `herding.go`, `hierarchy.go`
  - `internal/limits/work.go` (`MaxEngineTreeDepth`, `MaxEngineNodes`, `MaxEngineEdges`, `MaxTopologyReferences`, `MaxRoutePoints`)
- **Downstream Dependency Proof:**
  - `internal/grouping/sequences.go` (`Validate(ctx, "AddSequences", graph)` gate at entrypoint, followed by `graph.ContainerRDFSOrder(nil, guard)`)
  - `internal/grouping/sequences_correctness_test.go`

## 4. Why AddSequences Was Split
`AddSequences` relies on:
1. `layoutgraph.Validate`: bounded topology validation ensuring no parent cycles, depth > 256, or nil pointers.
2. `GraphState`: snapshot rollback substrate (completed in Slice 09).
3. `graph.ContainerRDFSOrder`: WorkGuard-metered reverse DFS order of containers and clusters.
4. Sequence discovery and vessel creation (`identifySequences`, `SequenceDefiningEdges`, etc. - scheduled for Slice 11).
Implementing `Validate` and guarded `ContainerRDFSOrder` independently ensures the engine's gatekeeper is rigorously verified against a comprehensive Go oracle before introducing sequence vessel mutations.

## 5. Constants and Limits
Defined in `src/limits/constants.js`:
- `MAX_TOPOLOGY_REFERENCES = 1_000_000`
- `MAX_ROUTE_POINTS = 1_000_000`
- `MAX_TOPOLOGY_DEPTH = 256`
- `MAX_PREFLIGHT_WORK = 8_000_000n` (`MAX_TOPOLOGY_REFERENCES * 8n`)
- `MAX_ENGINE_NODES = 10_000`
- `MAX_ENGINE_EDGES = 50_000`

## 6. WorkGuard Integration
`validateEngineGraph` initializes a `WorkGuard` instance:
```javascript
const guard = new WorkGuard(context, location, MAX_ENGINE_WORK_UNITS);
guard.SetLimit(MAX_PREFLIGHT_WORK);
```
- Context validation: `Validate(null, "AddSequences", graph)` delegates to `WorkGuard` constructor, throwing `TALA AddSequences requires a context`.
- Error ordering: if `graph == null`, it fails immediately with `TALA engine requires a graph` before context validation.
- Successful validation completes with `guard.Finish()`.

## 7. Go Slice Capacity Representation Gap & JS Mapping
In Go, `accountSpareCapacity(slice)` charges `cap(slice) - len(slice)` to `referenceCount` and calls `guard.Check()`.
JavaScript `Array` has `.length` but no separate capacity or backing-array exposure.
- **Mapping Decision:** JS represented capacity equals `Array.length`, meaning spare capacity is always 0.
- **Preserved Cancellation Boundary:** At every accounting point where Go calls `accountSpareCapacity`, JS invokes `guard.Check()`. This preserves cancellation responsiveness without inventing synthetic properties or fake capacity counters.
- **Go-only capacity scenarios:** Aggregate slice spare capacity overflow and route slice capacity overflow in Go tests represent Go backing-store mechanics not representable in JS Array semantics, documented as Go-only representation safety cases.

## 8. Runtime Identity Inventory & Structural Checks
All records are deduplicated by object identity (`Set.has(object)`), not EntityID.
- **Queues:** `queueNode`, `queueEdge`, `queueCluster`, `queueSequence`, `queueTree`, `queueAbduction`, `queueHerd`, `queueHierarchy`.
- **Unique Limits:**
  - Unique nodes <= 10,000 (`TALA engine unique node count exceeds limit 10000`)
  - Unique edges <= 50,000 (`TALA engine unique edge count exceeds limit 50000`)
- **Structural Nil Checks:**
  - Graph node at index `i` is nil: `graph node at index <i> is nil`
  - Graph edge at index `i` is nil: `graph edge at index <i> is nil`
  - Edge missing endpoints: `graph edge <id> has unplaced or missing endpoints`
  - Nil container child: `TALA engine topology contains nil container child`
  - Nil route point: `TALA engine topology contains nil edge route point`
  - Nil cluster vessel/record: `TALA engine topology contains nil cluster vessel` / `record`
  - Nil sequence vessel/record: `TALA engine topology contains nil sequence vessel` / `record`
  - Nil tree node/record: `TALA engine topology contains nil tree node` / `record`
  - Nil tree child: `TALA engine topology contains nil tree child`
  - Nil herd member: `TALA engine topology contains nil herd member`

## 9. Parent-Chain and Descendant Graph Validation
1. **Container Parent (`node.Container`):**
   - Cycle: `TALA engine container parent cycle detected at node <id>`
   - Depth: `TALA engine container parent depth exceeds limit 256`
2. **Effective Container Parent (`node.container()` / `node.OwningContainer()`):**
   - Cycle: `TALA engine effective container parent cycle detected at node <id>`
   - Depth: `TALA engine effective container parent depth exceeds limit 256`
3. **Ancestry Parent (`ancestryParent(node)`):**
   - Precedence: `node.Container` -> `node.Cluster.Vessel` -> `node.Sequence.Vessel` -> `null`.
   - Cycle: `TALA engine ancestry parent cycle detected at node <id>`
   - Depth: `TALA engine ancestry parent depth exceeds limit 256`
4. **Descendant Graph (Union of Containers, Clusters, Sequences):**
   - Iterative DFS state machine (colors: 0 unvisited, 1 visiting, 2 completed).
   - Cycle: `TALA engine descendant cycle detected at node <id>`
   - Depth: `TALA engine descendant depth exceeds limit 256`
   - Missing cluster record for marked vessel: `TALA engine cluster vessel <id> has no cluster record`

## 10. Tree Forest and NodeToTree Inverses
- Tree child cycle: `TALA engine tree child cycle detected`
- Tree parent cycle: `TALA engine tree parent cycle detected`
- Tree depth: `TALA engine tree depth exceeds limit 256`
- Tree repeated as root: `TALA engine tree is listed as more than one root`
- Tree repeated under parent: `TALA engine tree is repeated under one parent`
- Tree shared by multiple parents: `TALA engine tree is shared by multiple parents`
- Node owned by multiple trees: `TALA engine node <id> is owned by multiple trees`
- Tree child inconsistent parent: `TALA engine tree child has an inconsistent parent`
- Root has installed parent: `TALA engine tree root also has an installed parent`
- Inconsistent placement parent: `TALA engine tree root has an inconsistent placement parent`
- NodeToTree key mismatch: `TALA engine node-to-tree alias does not match the tree node`
- NodeToTree uninstalled tree: `TALA engine node-to-tree alias references a tree outside the installed forest`
- NodeToTree coverage mismatch: `TALA engine node-to-tree aliases do not cover the installed forest` / `do not match the installed forest`

## 11. Guarded Container RDFS Traversal
- `Graph.ContainerRDFSOrder(root, guard)`:
  - Iterates `Containers.get(root)` in reverse order.
  - Calls `guard.Step()` for each child occurrence.
  - Recurses into direct containers (innermost first, appending child after its descendants).
  - If a child is a cluster vessel (`Clusters.get(child)`), iterates `cluster.Nodes` in reverse order, calling `guard.Step()` for each member occurrence, and recurses into member containers (without appending the vessel itself).
  - Does not traverse sequence members.
- `Graph.ContainerRDFSOrderUnbounded(root)` provides unmetered traversal for callers without a guard.
- Canonical TestGraphRDFSOrder order verified: `[19, 15, 13, 16, 14, 12, 11, 9, 5, 3, 6, 4, 2, 1]`.
- Work accounting verified: exactly 15 `guard.Step()` calls for the canonical fixture.

## 12. Real Go Oracle Verification
- **Oracle Source:** `test/reference/go_topology_preflight_oracle.go`
- **Output Fixture:** `test/fixtures/go-topology-preflight-reference.json`
- **Canonical SHA256:** `6BCEC85EB72451EF304C659AAAC2DEE3FA7A468E2DBF76FB3408F742DFDAFE3D`
- **Reproducibility:** Confirmed by running two independent oracle generations and performing byte-for-byte SHA256 comparison.
- **Oracle Test Coverage:** 42 test assertions in `test/unit/topology-preflight-oracle.test.js` validating all 40 scenarios.

## 13. Full Regression Suite
- **Command:** `bun test`
- **Results:**
  - Tests: **370 passed**, **0 failed**
  - Expect() Calls: **9,098**
  - Files: **21 passed**
  - Duration: **836 ms**

## 14. Performance Sanity
- 10,000 `Validate` calls on tiny graph: **~141.39 ms** (~14.1 µs/call)
- 1,000 `Validate` calls on medium graph: **~365.40 ms** (~365.4 µs/call)
- 10,000 guarded `ContainerRDFSOrder` calls: **~9.70 ms** (~0.97 µs/call)

## 15. Audits
- **Browser-Safe Audit:** Verified 0 occurrences of `fs`, `path`, `process`, `Buffer`, `crypto`, `events`, or `worker_threads` across all files in `src/`.
- **Randomness Audit:** Verified 0 occurrences of `Math.random` across all files in `src/`.
- **Read-Only / Non-Mutation Audit:** Verified `Validate()` and `ContainerRDFSOrder()` do not modify node, edge, cluster, sequence, tree, or container collections, even across cancellation and work-limit errors.

## 16. Review Findings & Resolutions
1. **Go Map Iteration Randomness in Cycle Oracles:**
   Go randomized map iteration could report different cycle start nodes on symmetric 2-node cycles. Resolved by formulating cycle test cases with single-node/asymmetric loops, achieving 100% deterministic, byte-identical fixture reproduction.
2. **Descendant Depth Setup:**
   Directly setting `node.Container = parent` caused container parent depth validation to trigger first. Resolved by setting `Containers[parent] = [node]` without setting `node.Container`, properly testing descendant graph depth validation.
3. **JS Cluster/Sequence Constructor Signature:**
   Constructors expect `{ Vessel, Nodes, Graph }` option objects; callers updated to ensure `Vessel` is properly attached.

## 17. Commit History
- `1e1bf8f3d`: `docs(tala-js): close approved Slice 09`
- `feat(tala-js): port topology preflight`
- `feat(tala-js): add guarded container traversal`
- `test(tala-js): add Go topology preflight oracle`
- `docs(tala-js): document Slice 10 topology preflight`
