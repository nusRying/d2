# ADR 013: Sequence Mutation and Atomic AddSequences

## Date
2026-09-30

## Status
Accepted

## Context
In TALA's layout pipeline, sequences of Step nodes are transformed into composite sequence vessels (`internal/grouping/sequences.go::AddSequences`). This transformation alters graph topology: step nodes are removed from their parent container child lists and from `graph.Nodes`, internal defining edges between steps are disconnected, external edges connected to individual steps are abducted to the vessel node, and a synthetic sequence vessel node is inserted into the container.

Slice 11 implemented and verified the read-only analysis layer (`identifySequences`, `isValidRememberedSequence`, `hasNodeID`, `nextAvailableNodeID`, `SequenceDefiningEdges`).

Slice 12 implements the mutation half and the public transactional engine operation `AddSequences`:
- `clearRememberedSequenceMembership`
- `buildSequence`
- `abductSequenceEdges`
- `addSequence`
- `addSequences` / `AddSequences`

---

## Architectural Decisions

### 1. Analysis vs. Mutation Split
The sequence grouping subsystem is partitioned into:
- Read-only analysis and validation (`sequences-analysis.js`, Slice 11): candidate filtering, run discovery, contiguous membership checks, ID collision detection, and defining edge extraction.
- Topology mutation and transaction orchestration (`sequences-mutation.js`, Slice 12): step dimension normalization, defining edge disconnection, external edge abduction, container/node installation, and atomic rollback snapshot management.

This separation ensures that analysis logic can be queried or validated in isolation without risking graph side effects.

### 2. Geometry Normalization in `buildSequence`
When constructing a sequence vessel:
1. **Width Normalization:**
   For every member step node in order:
   - If `node.Width <= STEP_WEDGE_WIDTH` (35.0), normalize `node.Width = 2 * STEP_WEDGE_WIDTH` (70.0).
   - This exact threshold means widths <= 35 (including negative widths and exactly 35.0) become 70.0, while widths > 35 remain unchanged.
   - Concurrently track `maxHeight = max(maxHeight, node.Height)`, where `maxHeight` is initialized to `0.0`.
2. **Height Normalization:**
   In a second pass, set every step's `node.Height = maxHeight`. Because `maxHeight` starts at 0, an input with all-negative step heights normalizes to height `0.0`.
3. **Geometry Placement:**
   After normalizing step dimensions, `sequence.syncGeometry()` calculates the vessel dimensions, and `sequence.placeVessel()` positions the vessel at the component-wise minimum coordinate `(minX, minY)` if all steps have positions, or leaves `vessel.TopLeft` as `null` if any step lacks a position.

### 3. Defining-Edge Removal
For each consecutive pair of steps `(steps[i-1], steps[i])`:
- Look up the first connection via `step1.connectionTo(step2)`.
- If a connection exists, call `graph.disconnect(edge)`.
- Only the first connection is removed if multiple parallel defining edges exist.
- If no defining edge exists between consecutive steps, the mutation proceeds normally. This is critical for rebuilding remembered sequences where defining edges were disconnected in earlier layout passes.

### 4. Edge Abduction Semantics (`abductSequenceEdges`)
- A fast identity set containing all member step nodes is created.
- Graph edges in `sequence.Graph.Edges` are scanned in encounter order (without sorting).
- For each edge:
  - If both `edge.From` and `edge.To` are sequence members (internal edge or self-loop on a step), the edge is skipped and remains untouched.
  - If `edge.From` is a member, create an `EdgeAbduction` with `OriginallyFrom = edge.From`, `CurrentFrom = sequence.Vessel`, and `CurrentTo = edge.To`. Append it to `abductions` and call `edge.reconnect(sequence.Vessel, false)`.
  - If `edge.To` is a member, create an `EdgeAbduction` with `OriginallyTo = edge.To`, `CurrentTo = sequence.Vessel`, and `CurrentFrom = edge.From`. Append it to `abductions` and call `edge.reconnect(sequence.Vessel, true)`.
- Assign `sequence.EdgeAbductions = abductions`.
- Edge identity and array ordering in `graph.Edges` are preserved.

### 5. Topology Transformation (`addSequence`)
Installing a sequence into the graph follows a strict sequence:
1. `graph.addNewNodeToContainer(sequence.Container, sequence.Vessel)`: establishes vessel in `graph.Nodes` and `graph.Containers[container]`, setting `vessel.Graph = graph` and `vessel.Container = container`.
2. For each member node, set `node.Sequence = sequence`.
3. Filter member nodes out of `graph.Containers[sequence.Container]`. This leaves the newly added vessel in place because its `Sequence` is not set to itself.
4. For each member node, call `graph.removeNode(node)` and set `node.Container = null`. Crucially, `node.Graph` remains pointing to `graph`, preserving logical ownership through `sequence.Nodes`.
5. Insert into `graph.Sequences.set(sequence.Vessel, sequence)`.

### 6. Remembered-State Reconstruction and Object Identity
- When an inactive remembered sequence passes `isValidRememberedSequence`:
  - It is **not** reactivated as the same `Sequence` object.
  - Its member steps and its old vessel `EntityID` are reused.
  - A **new** vessel `Node` is created with the remembered `EntityID`.
  - A **new** `Sequence` object is created and installed.
  - Member steps have `node.Sequence` updated to point to the new `Sequence`.
  - The old inactive vessel node remains discarded and detached.
- If a remembered sequence fails validation:
  - `clearRememberedSequenceMembership(sequence, guard)` is invoked to clear stale `node.Sequence` links on member nodes (if they still point to that invalid sequence).
  - Its steps are not reconstructed, and removed steps are never resurrected into `graph.Nodes`.

### 7. Reserved ID Inventory and ID Occupancy
Before any mutation or validation of remembered sequences, `AddSequences` collects all active and reserved IDs into `reservedNodeIDs`:
- All active nodes in `graph.Nodes`.
- All cluster vessel IDs and cluster member node IDs in `graph.Clusters`.
- All sequence vessel IDs and sequence member node IDs in `graph.Sequences`.
Because this reservation happens before stale remembered sequences are invalidated, old remembered vessel IDs remain reserved throughout the `AddSequences` invocation even if discarded.

### 8. Stable Container and Group Ordering
Containers are traversed in `ContainerRDFSOrder(null, guard)` followed by the root (`null`).
Within each container:
- Fresh sequence candidate groups are discovered via `identifySequences`.
- Remembered groups for the container are appended after fresh groups.
- All groups are stable-sorted ascending by `containerIndex[group[0]]` (the child index of the group's first member in the container's current child list).
- This order is strictly stable to preserve container child precedence.

### 9. RNG Draw Ordering and Remembered-ID Slot Alignment
- For `len(groups)` total groups in a container, exactly one `random.Int63()` draw is executed per group in group order (charging `guard.Step()` per draw).
- Draws are collected into `generatedIDs[i]`, and mapped `slotByID[generatedIDs[i]] = i`.
- **RNG-Slot Alignment:**
  - Before assigning IDs, if a group's first step has a remembered vessel ID, and that ID coincides with one of the `slotByID` slots that is still empty, the group is placed into that aligned slot.
  - Remaining unoccupied slots are filled sequentially by the remaining groups in order.
- **Collision Resolution without Redraw:**
  - When assigning vessel IDs, if a group has a remembered vessel ID, that ID is used directly.
  - Otherwise, `id = nextAvailableNodeID(graph, generatedIDs[i], reservedNodeIDs)`.
  - Collision resolution consumes **zero** RNG draws. No redraws occur.

### 10. Snapshot Precedence and Rollback Semantics
- Prior to any mutation, `Validate(context, "AddSequences", graph)` verifies graph validity and rejects cycles or invalid topology.
- A `GraphState` snapshot is taken with:
  ```js
  newGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true })
  state.UpdateWithWorkGuard(graph, guard)
  ```
- No sequence mutation occurs before snapshot capture completes.
- **Phase-Calibrated Snapshot Cancellation:**
  To prove that cancellation during snapshot capture precedes mutation, tests measure exact validation check counts with a counting probe and calibrate cancellation to trigger on the 2nd check after validation (inside `GraphState.updateWithWorkGuard()`). The graph remains completely untouched, `graph.Sequences` original Map is preserved, and caller PRNG consumes exactly **zero** random draws.
- **Late-Cancellation Rollback with Real Edge Abduction & Route Identity:**
  When cancellation fires after sequence installation and edge abduction (`outsideA -> step1 -> step2 -> outsideB` with defining edge `step1 -> step2`, abducted incoming `outsideA -> step1`, and abducted outgoing `step2 -> outsideB`), `RestoreGraphState(graph, state)` restores:
  - `graph.Nodes`, `graph.Edges`, and `graph.Containers` arrays and Map by exact identity.
  - Original container child arrays by exact identity.
  - Defining edge restored to graph and original member endpoints (`From = step1, To = step2`).
  - External edge endpoints restored from vessel back to original member steps (`From = outsideA, To = step1` and `From = step2, To = outsideB`).
  - Edge `Points` route array by exact reference identity, and individual `Point` objects by exact reference identity.
  - All `Node.Edges` arrays by exact identity.
  - Member dimensions, `TopLeft`, `Sequence = null`, `Container = null`, and `Graph = g`.
  - The newly installed sequence vessel is completely uninstalled from nodes, containers, and sequences.
- **RNG Non-Rollback:** Callers' PRNG state is never rolled back on graph restore, matching Go standard behavior.

### 11. `graph.Sequences` Map Replacement
- On successful execution, `graph.Sequences` is replaced with a **new** `Map()` instance prior to inserting newly built sequences.
- On failure/rollback, `RestoreGraphState` restores the **original** `Map()` instance.

### 12. Deferral of Cleanup and Cluster Mutation
- `Cleanup` is the post-layout phase that unrolls vessels and restores step nodes back into containers.
- Slice 12 implements only the forward mutation and `AddSequences` transaction.
- `Cleanup`, cluster mutation, and later grouping slices remain strictly deferred to subsequent slices.

### 13. Build-Tagged Go Oracle Bridge and Canonical Verification
- The Go reference bridge `d2layouts/d2talalayout/internal/grouping/sequence_oracle_bridge.go` (`//go:build tala_sequence_oracle`) was extended with direct wrappers around private Go helpers:
  - `ClearRememberedSequenceMembershipBridge`
  - `BuildSequenceBridge`
  - `AddSequenceBridge`
  - `AbductSequenceEdgesBridge`
- The Go reference oracle `test/reference/go_sequence_mutation_oracle.go` generates `test/fixtures/go-sequence-mutation-reference.json` (SHA256: `c92fde1f7cd8187cf50aa7c068869712547897f98d33547c083562c8f0f4115b`) containing canonical fingerprints for direct helper tests and 20 comprehensive `AddSequences` scenarios, including:
  - Stale remembered membership (where one step's membership was modified after cleanup; verified stale link cleared and sequence not reconstructed).
  - Repeated deterministic reconstruction (verifying that rebuilding the same topology twice with the same seed produces identical fingerprints in both Go and JS: `fpA == fpB`).
- The JS test suite replayed all scenarios and proved bit-for-bit parity against the Go oracle fixture.
