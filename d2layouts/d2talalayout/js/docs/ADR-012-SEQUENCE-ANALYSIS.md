# ADR 012: Sequence Discovery, Remembered-State Validation, Defining Edges, and ID Occupancy

## Date
2026-09-30

## Status
Accepted

## Context
In TALA's layout pipeline, sequences of Step nodes are temporarily unified into single compound sequence vessels (`internal/grouping/sequences.go::AddSequences`). This transformation alters graph topology: step nodes are removed from their containers, internal defining edges between steps are abducted/disconnected, and a synthetic sequence vessel node is inserted into the container.

Before executing any graph mutations, the engine performs a **read-only sequence analysis layer**. This layer is responsible for:
1. Identifying new sequences among container children (`identifySequences`).
2. Discovering defining edges that connect consecutive steps in sequences (`SequenceDefiningEdges`).
3. Validating previously remembered sequences from earlier layout phases to determine whether they can be faithfully rebuilt or must have their membership cleared (`isValidRememberedSequence`).
4. Checking for ID collisions across all graph node domains (`hasNodeID`).
5. Deterministically computing next available entity IDs for sequence vessels without colliding with occupied or reserved IDs (`nextAvailableNodeID`).

Slice 11 isolates and ports this entire read-only sequence analysis and validation layer into JavaScript prior to introducing sequence topology mutations in subsequent slices.

---

## Architectural Decisions

### 1. Separation of Analysis from Mutation
Topology mutations (`buildSequence`, `addSequence`, `abductSequenceEdges`, `clearRememberedSequenceMembership`, and `AddSequences` orchestration) require atomic rollback snapshots (`GraphState`), geometry calculations, and structural disconnection.

By isolating the analysis layer into Slice 11:
- The discovery and validation algorithms are verified against exact Go semantics independently of mutation state.
- No `GraphState` snapshots or rollback mechanisms are needed for Slice 11, preserving performance and test clarity.
- All analysis helpers operate strictly read-only, guaranteeing that input graphs remain unmodified.

### 2. Candidate Filtering and Active Node Identity
In `identifySequences(graph, nodes, guard)`:
- An active inventory `activeNodes` is constructed by iterating `graph.Nodes` (charging `guard.Step()` per node).
- Membership is determined strictly by object reference identity (`activeNodes.has(node)`), not `node.ID`.
- A candidate node is evaluated in the exact order:
  1. `if (!activeNodes.has(node)) continue;`
  2. `if (node.IsContainer()) continue;`
  3. `if (node.Sequence != null && !node.Sequence.IsActive()) continue;`
  4. `if (node.FixedTopLeft != null || !node.IsSequenceStep()) continue;`
- **Inactive Remembered Steps:** Nodes that carry an inactive remembered sequence (`node.Sequence != null && !node.Sequence.IsActive()`) are excluded from fresh sequence discovery. They can only be rebuilt via the remembered-state pipeline.
- **Removed Active Nodes:** A node still present in a container's child list but removed from `graph.Nodes` is skipped, preventing removed remembered steps from resurrecting.
- **Container Steps Excluded:** Even if `shape == Step`, any node with `isContainer === true` (`node.IsContainer()`) cannot be a sequence step.
- **Fixed Steps Excluded:** Steps with `FixedTopLeft != null` are skipped.
- **Filtered Input Order:** Filtered candidates maintain the original array order of the container. If `<= 1` candidate step remains, `identifySequences` returns `null` immediately without entering the connectivity loop.

### 3. Run Splitting and Interleaved Sibling Collapse
- Consecutive filtered candidates `previous` and `current` are evaluated for connectivity by scanning `previous.Edges` in array order (charging `guard.Step()` per edge) and testing `previous.Adjacent(edge) === current`.
- Directedness does not matter: both `A -> B` and `B -> A` establish connectivity.
- The scan stops at the first connecting edge.
- If consecutive candidates are connected, they extend the current step run. If not connected, the previous run is closed (if length > 1) and a new run begins at `current`. Singleton runs are discarded.
- Interleaved non-Step children (e.g., `[Step A, Square X, Step B]`) are filtered out during candidate evaluation, collapsing to `[A, B]`. If A and B are directly connected by an edge, they form a valid sequence.

### 4. SequenceDefiningEdges Public API
- Signature: `SequenceDefiningEdges(context, graph)`.
- Follows pinned entry:
  1. `Validate(context, "GetSequenceDefiningEdges", graph)` (preflight topology check).
  2. `new WorkGuard(context, "GetSequenceDefiningEdges", MAX_ENGINE_WORK_UNITS)`.
- Container traversal: `containerOrder = graph.ContainerRDFSOrder(null, guard); containerOrder.push(null);` (traversing nested containers in RDFS order, then root `null`).
- Sequence discovery is container-local: steps in different containers cannot form a sequence even if connected by an edge.
- Defining Edge Selection: For each discovered step sequence `steps`, for each consecutive pair `steps[i - 1]` and `steps[i]`, scans `steps[i - 1].Edges` in order (charging `guard.Step()`). The first edge where endpoints match `{previous, current}` is chosen. Parallel edges yield the first matching edge in `previous.Edges`.
- Missing Defining Edge Guard: If no edge connects consecutive sequence steps, throws `TALA sequence steps <A> and <B> have no defining edge`.
- Returns `Set<EntityID>` of defining edge IDs. Concludes with `guard.Finish()`.
- **Mid-Traversal Cancellation Integrity:** When context cancellation occurs mid-traversal inside guarded `ContainerRDFSOrder`, execution halts immediately with the proper cancellation error classification and location, no result is produced, and graph state remains completely unmutated (`Graph.Nodes`, `Edges`, `Containers`, `Clusters`, `Sequences`, `Trees`, node/edge aliases, and endpoints are unchanged).

### 5. Remembered-Sequence Validity (`isValidRememberedSequence`)
- Validates whether an inactive remembered sequence can be reconstructed.
- **Immediate Rejections (0 work units charged):**
  - `vessel == null`
  - `sequence == null`
  - `sequence.IsActive() === true` (must be inactive)
  - `sequence.Vessel !== vessel`
  - `sequence.Graph !== graph`
  - `sequence.Nodes.length < 2`
  - Container key missing from `graph.Containers`
- **Active Container Requirement:** If `sequence.Container != null`, it must be present by reference identity in `activeNodes`.
- **Container Key Existence:** `graph.Containers.has(sequence.Container)` must be `true` (distinguishing key presence from empty default). Empty container list charges 1 step (`guard.Step()`) and fails.
- **Duplicate Container Children:** Container children are indexed; each charges `guard.Step()`. Duplicate child references in the container invalidate the sequence.
- **Sequence Node Invariants:** For each node in `sequence.Nodes` (charges `guard.Step()`):
  - Must not be null or duplicate in `sequence.Nodes`.
  - Must be in `activeNodes`.
  - `node.Graph === graph`.
  - `node.isSequenceStep() === true`.
  - `node.FixedTopLeft == null`.
  - `node.Sequence === sequence`.
  - `node.Container === sequence.Container`.
  - Must exist uniquely in container children.
  - **Contiguity:** Child indices in the container must be strictly consecutive (`i, i + 1, i + 2, ...`) in `sequence.Nodes` order.
- **Absence of Defining-Edge Requirement:** Crucially, remembered validity does NOT require defining edges to be present. Layout output intentionally omits defining edges, so rebuilt remembered sequences accept steps with no remaining edge connection.
- **No Mutation:** `isValidRememberedSequence` returns a Boolean and never modifies `node.Sequence` or graph topology.

### 6. Node ID Occupancy, Signed-Int64 Enforcement, and RNG Continuation
- `hasNodeID(graph, id)`:
  - Compares IDs using `BigInt(id) === BigInt(node.ID)` to ensure precision for 64-bit integers and interoperability between Numbers and BigInts.
  - **Iterative Tree Traversal:** Tree traversal uses an explicit DFS stack over `graph.Trees` (root sentinel, `tree.Node`, `tree.Children`) instead of recursive calls, preventing stack overflow on deep tree hierarchies.
  - Search domains are strictly bounded to:
    1. `graph.Nodes`
    2. `graph.Clusters` (vessels and `cluster.Nodes`)
    3. `graph.Sequences` (vessels and `sequence.Nodes`)
    4. `graph.Trees` (sentinel keys, `tree.Node`, `tree.Children`)
  - Other maps (`Containers`, `Hubs`, `Directions`, `Nears`) are not searched.
- `nextAvailableNodeID(graph, candidate, unavailable)`:
  - **Signed-Int64 Range Enforcement:** Candidate must represent a valid 64-bit signed integer in `[-9223372036854775808n, 9223372036854775807n]`. Unsafe JavaScript Numbers (`!Number.isSafeInteger(candidate)`) and out-of-range BigInts throw `TypeError`.
  - Evaluates whether candidate is free in `unavailable` and absent from `hasNodeID(graph, candidate)`.
  - Wrap-around behavior: if candidate equals `INT64_MAX` (`9223372036854775807n`), wraps to `0n`; otherwise increments by `1n`.
  - Negative candidates (e.g. `-1n`) are legal signed int64 values and are supported.
  - **Zero RNG Consumption & Seed-19 Continuation:** `nextAvailableNodeID` consumes zero RNG draws. When candidate generation starts with an initial draw from Go-compatible `Int63()` (seed 19) colliding with an existing node ID, candidate resolves to `colliding ID + 1`, and the RNG's subsequent draw is verified to match the probe RNG's second draw exactly.

### 7. Direct Build-Tagged Private-Helper Go Bridge and Exact WorkGuard Parity
- Rather than inferring private helper semantics indirectly through high-level mutations, a build-tagged bridge file `d2layouts/d2talalayout/internal/grouping/sequence_oracle_bridge.go` is introduced under `//go:build tala_sequence_oracle`.
- The bridge exposes narrow wrappers around ONLY the four private helpers:
  - `identifySequences` -> `BridgeIdentifySequences`
  - `isValidRememberedSequence` -> `BridgeIsValidRememberedSequence`
  - `hasNodeID` -> `BridgeHasNodeID`
  - `nextAvailableNodeID` -> `BridgeNextAvailableNodeID`
- The Go reference oracle `test/reference/go_sequence_analysis_oracle.go` compiles against this bridge using `-tags tala_sequence_oracle` and directly executes all mandatory private-helper scenarios.
- Serialized Go outputs record exact `guard.Used()` values, confirming complete parity:
  - `identifySequences`: empty (0), one step (2), connected pair (6), disconnected pair (5), late edge match (10), inactive remembered steps (4), active sequence membership (6), duplicate supplied node refs (9), fixed top left (4).
  - `isValidRememberedSequence`: immediate rejects (0), empty container key (1), valid pair (4), duplicate child (4), duplicate sequence member (4), noncontiguous sequence (5), nil member (4), wrong graph (3), fixed top left (3), wrong sequence (4), wrong container (5), node missing from children (3), valid with unrelated neighbors (6).
- Caches RNG draw values during serialization (`nextDraw := layoutRand.Int63()`) rather than calling `Int63()` twice, ensuring exact stream parity.

### 8. Production Scope Minimization
- Unnecessary production surface additions were eliminated:
  - `Node.prototype.IsContainer()` was removed; production code and tests rely on the canonical boolean property `node.isContainer`.
  - `Graph.prototype.AddNodeToContainer()`, `Graph.prototype.AddNewNodeToContainer()`, and `Graph.prototype.RemoveNode()` were removed from `src/graph/graph.js`; tests invoke the existing lowercase methods `graph.addNodeToContainer(...)`, `graph.addNewNodeToContainer(...)`, `graph.removeNode(...)`.
  - Removed top-level export `export * from "./grouping/index.js";` from `src/index.js`. Sequence analysis functions remain internal and importable via their module path `src/grouping/index.js`.

---

## Consequences
- **Positive:** Private helper algorithms (`identifySequences`, `isValidRememberedSequence`, `hasNodeID`, `nextAvailableNodeID`) are directly verified against real Go functions via the build-tagged bridge.
- **Positive:** Exact deterministic `WorkGuard.Used()` counts match between Go and JavaScript.
- **Positive:** Iterative tree traversal protects against deep recursion stack limits.
- **Positive:** Strict signed-int64 validation prevents silent truncation or unsafe Number usage.
- **Positive:** Graph topology remains 100% immutable and unmutated across all analysis passes and mid-traversal cancellations.
- **Positive:** Zero Node built-ins and zero unseeded `Math.random` consumption.
- **Downstream Dependency:** Slice 12 will implement sequence topology mutation (`buildSequence`, `addSequence`, `abductSequenceEdges`, `clearRememberedSequenceMembership`, and `AddSequences` pipeline orchestration) on top of this verified analysis foundation.
