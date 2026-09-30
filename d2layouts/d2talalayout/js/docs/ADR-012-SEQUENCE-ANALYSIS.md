# ADR 012: Sequence Discovery, Remembered-State Validation, Defining Edges, and ID Occupancy

## Date
2026-09-30

## Status
Implemented — awaiting Slice 11 review

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

### 5. Remembered-Sequence Validity (`isValidRememberedSequence`)
- Validates whether an inactive remembered sequence can be reconstructed.
- **Immediate Rejections (0 work units charged):**
  - `vessel == null`
  - `sequence == null`
  - `sequence.IsActive() === true` (must be inactive)
  - `sequence.Vessel !== vessel`
  - `sequence.Graph !== graph`
  - `sequence.Nodes.length < 2`
- **Active Container Requirement:** If `sequence.Container != null`, it must be present by reference identity in `activeNodes`.
- **Container Key Existence:** `graph.Containers.has(sequence.Container)` must be `true` (distinguishing key presence from empty default).
- **Duplicate Container Children:** Container children are indexed; each charges `guard.Step()`. Duplicate child references in the container invalidate the sequence.
- **Sequence Node Invariants:** For each node in `sequence.Nodes` (charges `guard.Step()`):
  - Must not be null or duplicate in `sequence.Nodes`.
  - Must be in `activeNodes`.
  - `node.Graph === graph`.
  - `node.IsSequenceStep() === true`.
  - `node.FixedTopLeft == null`.
  - `node.Sequence === sequence`.
  - `node.Container === sequence.Container`.
  - Must exist uniquely in container children.
  - **Contiguity:** Child indices in the container must be strictly consecutive (`i, i + 1, i + 2, ...`) in `sequence.Nodes` order.
- **Absence of Defining-Edge Requirement:** Crucially, remembered validity does NOT require defining edges to be present. Layout output intentionally omits defining edges, so rebuilt remembered sequences accept steps with no remaining edge connection.
- **No Mutation:** `isValidRememberedSequence` returns a Boolean and never modifies `node.Sequence` or graph topology.

### 6. Node ID Occupancy and Candidate Generation
- `hasNodeID(graph, id)`:
  - Compares IDs using `BigInt(id) === BigInt(node.ID)` to ensure precision for 64-bit integers and interoperability between Numbers and BigInts.
  - Search domains are strictly bounded to:
    1. `graph.Nodes`
    2. `graph.Clusters` (vessels and `cluster.Nodes`)
    3. `graph.Sequences` (vessels and `sequence.Nodes`)
    4. `graph.Trees` (sentinel keys, `tree.Node`, recursive `tree.Children`)
  - Other maps (`Containers`, `Hubs`, `Directions`, `Nears`) are not searched.
- `nextAvailableNodeID(graph, candidate, unavailable)`:
  - Takes candidate ID and `unavailable` ID set.
  - Evaluates whether candidate is free in `unavailable` and absent from `hasNodeID(graph, candidate)`.
  - Wrap-around behavior: if candidate equals `INT64_MAX` (`9223372036854775807n`), wraps to `0n`; otherwise increments by `1n`.
  - Negative candidates (e.g. `-1n`) are legal signed int64 values and are supported.
  - Consumes zero RNG: candidate resolution is deterministic increment/wrap.

### 7. Go Oracle and Dual-Layer Verification Strategy
- Public Go APIs (`Node.IsContainer`, `Node.IsSequenceStep`, `Node.ConnectionTo`, `Graph.SequenceOrder`, `grouping.SequenceDefiningEdges`, `grouping.AddSequences`, `grouping.Cleanup`) are exercised directly in `test/reference/go_sequence_analysis_oracle.go`.
- Private Go helpers (`identifySequences`, `isValidRememberedSequence`, `hasNodeID`, `nextAvailableNodeID`) are verified through a dual-layer strategy:
  1. Direct JS unit tests derived from pinned source semantics (`test/unit/sequence-analysis.test.js`).
  2. Public Go behavioral manifestations (`test/unit/sequence-analysis-oracle.test.js`) observing `SequenceDefiningEdges`, remembered sequence rebuilds via `AddSequences` + `Cleanup`, and collision resolution in `AddSequences`.

---

## Consequences
- **Positive:** Read-only analysis logic is fully verified and matches Go behavior across all edge cases (candidate filtering, container boundaries, contiguity, int64 wrap-around).
- **Positive:** Zero topology mutation ensures safety and isolation ahead of mutation stages.
- **Positive:** Browser-safe execution with zero Node built-in dependencies and zero unseeded/Math.random consumption.
- **Downstream Dependency:** Slice 12 will implement `buildSequence`, `addSequence`, `abductSequenceEdges`, `clearRememberedSequenceMembership`, and `AddSequences` pipeline orchestration utilizing these Slice 11 helpers.
