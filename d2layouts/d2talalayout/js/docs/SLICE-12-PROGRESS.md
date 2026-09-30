# Slice 12 Progress Report: Sequence Mutation and Atomic AddSequences

## 1. Environment and Branch Verification
- **Repository Root:** `C:\Users\Umair\Videos\Freelance\Test Task\d2` (`nusRying/d2`)
- **Approved Slice 11 Base SHA:** `8494807cc13c6a17308f35c849bbc0c1c8d95ce7`
- **Branch:** `tala-js/slice-12-sequence-mutation`
- **Pinned Upstream D2 Reference:** `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## 2. Pinned Upstream Go Files Studied
- `d2layouts/d2talalayout/internal/grouping/sequences.go`
- `d2layouts/d2talalayout/internal/grouping/sequences_test.go`
- `d2layouts/d2talalayout/internal/grouping/sequences_correctness_test.go`
- `d2layouts/d2talalayout/internal/grouping/sequences_regression_test.go`
- `d2layouts/d2talalayout/internal/grouping/resource_test.go`
- `d2layouts/d2talalayout/internal/grouping/lifecycle.go`
- `d2layouts/d2talalayout/internal/layoutgraph/sequence.go`
- `d2layouts/d2talalayout/internal/layoutgraph/layout.go`
- `d2layouts/d2talalayout/internal/layoutgraph/graph_state*.go`
- `d2layouts/d2talalayout/internal/layoutgraph/node.go`
- `d2layouts/d2talalayout/internal/layoutgraph/edge.go`
- `d2layouts/d2talalayout/internal/layoutgraph/structure_api.go`
- `d2layouts/d2talalayout/internal/layoutgraph/hierarchy_access.go`
- `d2layouts/d2talalayout/internal/limits/work.go`
- `lib/shape/shape_step.go`

## 3. Files Modified and Created
- **Modified Go Bridge:** `d2layouts/d2talalayout/internal/grouping/sequence_oracle_bridge.go` (extended under `//go:build tala_sequence_oracle`)
- **Production Source Created:** `d2layouts/d2talalayout/js/src/grouping/sequences-mutation.js`
- **Grouping Entry Point Modified:** `d2layouts/d2talalayout/js/src/grouping/index.js` (exported Slice 12 mutation helpers)
- **Go Reference Oracle Created:** `d2layouts/d2talalayout/js/test/reference/go_sequence_mutation_oracle.go`
- **Oracle Reference Fixture Generated:** `d2layouts/d2talalayout/js/test/fixtures/go-sequence-mutation-reference.json`
- **Unit Tests Created:** `d2layouts/d2talalayout/js/test/unit/sequence-mutation.test.js`
- **Oracle Replay Tests Created:** `d2layouts/d2talalayout/js/test/unit/sequence-mutation-oracle.test.js`
- **Documentation Updated/Created:**
  - `docs/ADR-012-SEQUENCE-ANALYSIS.md` (updated status to Accepted)
  - `docs/MIGRATION.md` (updated status for Slice 11 and Slice 12)
  - `docs/ADR-013-SEQUENCE-MUTATION.md` (created architectural record)
  - `docs/SLICE-12-PROGRESS.md` (this report)

## 4. Go Oracle Bridge Wrappers
The build-tagged bridge file `d2layouts/d2talalayout/internal/grouping/sequence_oracle_bridge.go` (`//go:build tala_sequence_oracle`) was extended with direct wrappers around ONLY the real private mutation helpers:
- `ClearRememberedSequenceMembershipBridge(sequence, guard)` -> invokes real `clearRememberedSequenceMembership`
- `BuildSequenceBridge(steps, graph, container, id)` -> invokes real `buildSequence`
- `AddSequenceBridge(graph, sequence)` -> invokes real `addSequence`
- `AbductSequenceEdgesBridge(sequence)` -> invokes real `abductSequenceEdges`

Public `grouping.AddSequences` is called directly by the reference oracle without any wrapper.

## 5. Oracle Generation and Fixture Integrity
- **Command:**
  ```powershell
  go run -tags tala_sequence_oracle test/reference/go_sequence_mutation_oracle.go test/fixtures/go-sequence-mutation-reference.json
  ```
- **Determinism Check:** Generated twice to independent paths (`-a` and `-b`) and compared.
- **Fixture SHA256:**
  `c92fde1f7cd8187cf50aa7c068869712547897f98d33547c083562c8f0f4115b`

## 6. Parity Verification Results

### Direct Helper Scenarios (17/17 Passed)
- **`clearRememberedSequenceMembership`**:
  - `nil_sequence` (zero work)
  - `empty_nodes` (zero work)
  - `normal_two_node` (exact clearance and guard steps)
  - `nil_member` (skipped)
  - `member_other_sequence` (skipped)
  - `duplicate_member` (charged twice)
  - `work_guard_limit_partial` (partial mutation preserved on throw)
- **`buildSequence`**:
  - `two_step_unpositioned` (TopLeft null)
  - `three_step_positioned` (TopLeft component-wise minimum)
  - `narrow_width` (width <= 35 normalized to 70)
  - `width_exactly_wedge` (35.0 normalized to 70.0)
  - `all_negative_heights` (maxHeight normalized to 0.0)
  - `remembered_rebuild_no_edge` (succeeds without defining edge)
  - `parallel_defining_edges` (only first connection disconnected)
  - `external_and_internal_edges` (geometry and abduction ordering verified)
- **`abductSequenceEdges`**:
  - Direct abduction verified (ordering, OriginallyFrom/To, CurrentFrom/To, internal edge skipped)
- **`addSequence`**:
  - Direct installation verified (vessel in Nodes/Container, members removed from Nodes/Container, member.Sequence set, member.Container null, member.Graph intact)

### Public `AddSequences` Oracle Scenarios (20/20 Passed)
1. `simple_two_step`
2. `three_step_chain`
3. `two_separate_runs`
4. `no_sequence_candidates`
5. `fixed_step_skipped`
6. `container_step_skipped`
7. `nested_containers`
8. `multiple_containers_rdfs`
9. `external_edge_abduction`
10. `positioned_step_geometry`
11. `narrow_step_geometry`
12. `valid_remembered_rebuild` (reuses old vessel ID, creates new Sequence object)
13. `stale_remembered_shape` (clears membership, does not reconstruct)
14. `stale_remembered_container` (clears membership, does not reconstruct)
15. `stale_remembered_noncontiguous` (clears membership, does not reconstruct)
16. `removed_remembered_member` (does not resurrect removed node)
17. `ordinary_id_collision_seed_19` (resolves to collidingID + 1 without extra RNG draw; caller continuation parity preserved)
18. `remembered_ids_reserved_across_containers_seed_73` (fresh sequence does not collide with remembered sequence across containers)
19. `stale_remembered_membership` (member membership manually cleared after cleanup; stale links cleared, sequence not reconstructed)
20. `repeated_deterministic_reconstruction` (same topology rebuilt twice with seed 42; verified `fpA == fpB` in both Go and JS)

### Transaction and Atomicity Scenarios (5/5 Passed)
- Pre-mutation validation rejects cycles/invalid topology before snapshot capture.
- **Phase-Calibrated Snapshot Cancellation:**
  Validation check count measured on the exact graph with a non-cancelling probe (`validationChecks = 16`). Context calibrated to cancel on check 18 (inside `GraphState.updateWithWorkGuard()`). Proves that cancellation during snapshot precedes sequence mutation:
  - `WorkCanceledError.location === "AddSequences"`
  - `graph.Sequences` remains exact original Map instance (size 0)
  - `graph.Nodes`, `graph.Edges`, and `graph.Containers` remain exact original array and Map instances
  - Step `Sequence` remains null
  - **Caller RNG consumed zero draws!**
- **Late-Cancellation Rollback with Real Edge Abduction & Route Identity:**
  Context cancels when `graph.Sequences.size > 0` on topology `outsideA -> step1 -> step2 -> outsideB` (with defining edge `step1 -> step2`, abducted incoming `outsideA -> step1`, abducted outgoing `step2 -> outsideB`, and non-empty `Points` route `[p1, p2]`):
  - Original array and Map references restored by exact identity (`Nodes`, `Edges`, `Containers`, root children, `Sequences`).
  - Defining edge restored to graph and original endpoints (`From = step1, To = step2`).
  - External edge endpoints restored from sequence vessel back to original steps (`From = outsideA, To = step1` and `From = step2, To = outsideB`).
  - Edge `Points` route array restored by exact reference identity (`edgeIn.Points === originalRoutePoints`).
  - Individual `Point` objects restored by exact reference identity (`p1`, `p2`).
  - All `Node.Edges` arrays restored by exact identity.
  - Member dimensions, `TopLeft`, `Sequence = null`, `Container = null`, and `Graph = g` restored.
  - Newly created sequence vessel is completely uninstalled.
- Callers' RNG state is NOT rolled back upon graph rollback.
- Successful `AddSequences` replaces `graph.Sequences` with a new Map.

## 7. Test Suite Summary
- **Targeted Unit Tests:**
  `test/unit/sequence-mutation.test.js`: 20 pass, 0 fail (143 expect() calls)
- **Targeted Oracle Tests:**
  `test/unit/sequence-mutation-oracle.test.js`: 37 pass, 0 fail (119 expect() calls)
- **Full Bun Test Suite:**
  ```text
  524 pass
  0 fail
  9615 expect() calls
  Ran 524 tests across 25 files. [1218.00ms]
  ```
  (Net increase from Slice 11 baseline of 467 tests across 23 files: +57 tests, +2 test files).

## 8. Static Scans and Production Hygiene
- **`git diff --check`:** Passed cleanly (0 whitespace or conflict errors).
- **`Math.random` scan in `src/grouping`:** 0 occurrences.
- **Node-only built-in imports in `src/grouping`:** 0 occurrences.
- **Cleanup implementation scan in `src/grouping`:** 0 occurrences.
- **Cluster mutation / `AddClusters` scan in `src/grouping`:** 0 occurrences.
- **Package export check in `src/index.js`:** Grouping is NOT exported at the package root.

## 9. Scope and Deferred Work
- `grouping.Cleanup` is strictly deferred.
- Cluster discovery, cluster mutation (`AddClusters`), tree discovery, and later grouping/layout stages remain deferred.
- No Slice 13 code was implemented.
