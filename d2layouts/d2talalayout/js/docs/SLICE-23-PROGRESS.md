# Slice 23 Progress: FitToGraph

## Status: Implemented — awaiting review

## Summary of Changes
1. **Branch & Repository Gate**:
   - Clean branch `tala-js/slice-23-fit-to-graph` branched from approved Slice 22 HEAD (`008252815545d84cc61382d2daff3a94c545f777`).

2. **Implemented FitToGraph (`src/graph/node.js`)**:
   - `fitNodeToGraph(graph, padding)` and public alias `FitToGraph(graph, padding)`:
     - Fixed bounds source: retrieves bounds strictly from `nodesFixedBounds(graph.Nodes)`.
     - Label expansion source: calls `this.expandForLabels(tl, br)` which internally queries `this.Graph.Containers.get(this)`.
     - Sizing: sizes node via `this.fitToBoundingBox(tl, br, padding)` with explicit padding.
     - Dual-graph semantic: `graph` argument and `this.Graph` are distinct and non-interchangeable.
     - Non-container support: works on any node without requiring `isContainer === true`.
     - Explicit padding only: never calls `containerPadding` on either graph.
     - Dimensions only: mutates `target.Width` and `target.Height` only; target `TopLeft` remains completely unchanged.
     - Preserves object identities of `Box`, `TopLeft`, argument nodes, owner containers, and edge routes.

3. **Deterministic Real-Go Oracle & Fixture**:
   - Built `test/reference/go_fit_to_graph_oracle.go` exercising 27 distinct scenarios using `-tags tala_inside_geometry_oracle` and `layoutgraph.OracleSpacing`:
     - `ordinary_non_container_succeeds`
     - `square_basic`
     - `circle_basic`
     - `oval_basic`
     - `cloud_basic`
     - `real_square_basic`
     - `different_argument_and_owner_graph`
     - `argument_graph_nodes_ignore_owner_graph_nodes`
     - `nil_argument_graph_panics_before_mutation`
     - `nil_owner_graph_panics_after_bounds_before_resize`
     - `empty_argument_graph`
     - `nil_argument_node_panics_before_mutation`
     - `argument_node_null_top_left_panics_before_mutation`
     - `argument_graph_fixed_origin`
     - `argument_graph_outside_label`
     - `owner_boundary_long_label`
     - `owner_interior_long_label_ignored`
     - `owner_child_null_top_left_with_label_panics`
     - `nil_owner_child_panics_before_resize`
     - `argument_graph_contains_target`
     - `asymmetric_padding`
     - `desired_width_larger`
     - `desired_height_larger`
     - `desired_width_zero`
     - `target_inside_label`
     - `target_outside_label`
     - `target_null_top_left_not_in_argument_graph`
   - Generated reference fixture `test/fixtures/go-fit-to-graph-reference.json`:
     - Byte size: 28,991 bytes
     - SHA256: `62260842A8FCA7A4CD86D48F4064E96404F0ECA2076888AAFBA4E381230DD18C`
     - Determinism: 100% byte-for-byte identical across repeated runs.

4. **Testing & Verification**:
   - Direct unit tests: `test/unit/fit-to-graph.test.js` (7 tests).
   - Oracle parity tests: `test/unit/fit-to-graph-oracle.test.js` (39 tests replaying all 27 scenarios and semantic assertions).
   - Full suite passes: 1,157 pass, 0 fail, 46,815 expectations across 47 files.
   - Go packages pass: `layoutgraph`, `grouping`, and tagged `layoutgraph` pass cleanly.
   - Browser safety & static audit pass: 0 violations across 48 source files.

5. **Scope Boundaries Preserved**:
   - `Graph.SyncNestedGeometry` and `Graph.SyncClusters` are strictly absent.
   - `Cluster.ArrangeClusterNodes`, `Cluster.SyncGeometry`, and `Cluster.Resize` are strictly absent.
   - `Cleanup`, `Join`, `JoinDistancedClusters`, `AddHubs` are strictly absent.
   - `setContainer` and `SetContainer` remain strictly absent.
