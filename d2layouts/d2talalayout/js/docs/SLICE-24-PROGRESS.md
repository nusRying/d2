# Slice 24 Progress: Cluster Arrangement & SyncGeometry

## Status: Implemented — awaiting review

## Summary of Changes
1. **Branch & Repository Gate**:
   - Clean branch `tala-js/slice-24-cluster-geometry` branched from approved Slice 23 HEAD (`bb7ab69fcd8390a43f68e10dd89be3063f8826ca`).

2. **Implemented Cluster Geometry (`src/graph/cluster.js`)**:
   - `arrangeClusterNodes()` and public alias `ArrangeClusterNodes()`:
     - Unplaced vessel early return: returns immediately if `this.Vessel.TopLeft == null` before inspecting nodes.
     - Nil vessel natural panic: if `this.Vessel == null`, accessing `vessel.TopLeft` naturally throws.
     - Row positioning:
       - Main-axis position advances along X without rounding (`position += node.Width + padding`).
       - Cross-axis alignment uses `goRound(vesselCenter - (node.TopLeft.Y + node.Height / 2))`.
       - Placed members: moved via `node.moveNodeWithChildren(dx, dy)`, moving all descendants by identical delta.
       - Unplaced members: allocated `new Point(position, goRound(vesselCenter - node.Height / 2))` and then invokes `node.positionContainerChildren(false)`.
     - Column positioning:
       - Main-axis position advances along Y without rounding (`position += node.Height + padding`).
       - Cross-axis alignment uses `goRound(vesselCenter - (node.TopLeft.X + node.Width / 2))`.
       - Placed members: moved via `node.moveNodeWithChildren(dx, dy)`.
       - Unplaced members: allocated `new Point(goRound(vesselCenter - node.Width / 2), position)` and then invokes `node.positionContainerChildren(false)`.
     - Member order: preserved strictly as defined in `this.Nodes`.
     - Duplicate members: processed twice in occurrence order.
     - Padding: supports negative (allowing overlap) and fractional values.
     - Idempotence: calling `ArrangeClusterNodes()` repeatedly is idempotent and does not resize vessel or nodes.
   - `syncGeometry()` and public alias `SyncGeometry()`:
     - Nil vessel validation: throws `new Error("cluster is missing its vessel")` if `this.Vessel == null`.
     - Exact order: executes `this.resize(this.Vessel)` first, followed by `this.arrangeClusterNodes()`.
     - Sizing:
       - When `FixedSize === false`, normalizes all member sizes to max width/height and sizes vessel.
       - When `FixedSize === true`, preserves individual member sizes while vessel is sized via `maxWidth * count + padding * (count - 1)`.
       - Empty cluster quirk: Row produces `Width = -padding, Height = 0`; Column produces `Width = 0, Height = -padding`.
       - Unplaced vessel: resizes vessel and normalizes members, but positions are untouched.
     - Nontransactional: no snapshot/rollback; partial mutations remain committed if later steps throw.

3. **Deterministic Real-Go Oracle & Fixture**:
   - Built `test/reference/go_cluster_geometry_oracle.go` exercising 30 distinct scenarios against real Go `c.ArrangeClusterNodes()` and `c.SyncGeometry()`:
     - Arrange:
       - `arrange_nil_vessel_panics`
       - `vessel_unplaced_nil_member_noop`
       - `row_basic`
       - `column_basic`
       - `row_positive_half_round`
       - `column_negative_half_round`
       - `row_fractional_padding`
       - `negative_padding`
       - `row_positioned_container_with_descendant`
       - `row_unplaced_container_member`
       - `unplaced_plain_node`
       - `unknown_arrangement_noop`
       - `duplicate_member_occurrence`
       - `nil_member_panics`
       - `second_nil_member_partial_mutation`
       - `detached_member_nonzero_partial_move`
       - `detached_member_zero_delta_succeeds`
       - `arrange_idempotent`
       - `non_monotonic_member_order`
     - SyncGeometry:
       - `sync_nil_vessel_panics`
       - `sync_row_normalizes_sizes`
       - `sync_column_normalizes_sizes`
       - `sync_fixed_size_heterogeneous_row`
       - `sync_fixed_size_heterogeneous_column`
       - `sync_unplaced_vessel_resizes_only`
       - `sync_empty_row`
       - `sync_empty_column`
       - `sync_unknown_arrangement`
       - `sync_nil_member_panics_before_resize_mutation`
       - `sync_resize_then_arrange_partial_failure`
   - Generated reference fixture `test/fixtures/go-cluster-geometry-reference.json`:
     - Byte size: 36,784 bytes
     - SHA256: `D8D95F78683BF53D55E451328ABBDF427F3908CF0A5D2390F1DFCE7E6E7E1BBA`
     - Determinism: 100% byte-for-byte identical across repeated runs.

4. **Testing & Verification**:
   - Direct unit tests: `test/unit/cluster-geometry.test.js` (12 tests).
   - Oracle parity tests: `test/unit/cluster-geometry-oracle.test.js` (51 tests replaying all 30 scenarios and Section 57 semantic assertions).
   - Full suite passes: 1,220 pass, 0 fail, 47,415 expectations across 49 files.
   - Go packages pass: `layoutgraph` and `grouping` pass cleanly.
   - Browser safety & static audit pass: 0 violations across all source files.

5. **Strict Scope Enforcement**:
   - No guarded/work-accounted variants (`arrangeNodesWithWork`, `SyncGeometryWithWork`, `binPackClusterGeometryWork`, etc.).
   - No `Graph.SyncClusters` or `Graph.SyncNestedGeometry`.
   - No sequence geometry modifications (`Sequence.SyncGeometry`, `ArrangeSteps`, `Graph.SyncSequences`).
   - No `setContainer` / `SetContainer` or grouping orchestration (`Cleanup`, `Join`, `AddHubs`).
