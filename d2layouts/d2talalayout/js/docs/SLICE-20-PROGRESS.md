# Slice 20 Progress: Container Child Positioning

## Status: Implemented — awaiting review

## Summary of Changes
1. **Branch & Repository Gate**:
   - Clean branch `tala-js/slice-20-container-child-positioning` branched from approved Slice 19 HEAD (`ebeee94dcb1d5dc36cd9d4b3975144336f06fdc8`).

2. **Implemented Container Child Positioning (`src/graph/node.js`)**:
   - `expandForLabels(tl, br)`: internal camelCase helper iterating children from `this.Graph.Containers.get(this)`, expanding horizontal bounds `tl.X` and `br.X` for children strictly on the left or right boundary with `child.Label.Width > child.Width`. Ignores label position, height, and interior nodes.
   - `positionContainerChildren(withPadding)`:
     - Early return if `!this.isContainer` before touching `Graph`, `Containers`, `TopLeft`, or `InsidePlacement`.
     - Direct child retrieval from `this.Graph.Containers.get(this) ?? []`.
     - Zero padding when `withPadding == false` (strictly bypasses `Graph.containerPadding`).
     - Delegation to `this.Graph.containerPadding(this, false)` when `withPadding == true`.
     - Pre-expansion fixed bounds via `nodesFixedBounds(children)`.
     - Bounding box expansion via `this.expandForLabels(tl, br)`.
     - Placement calculation via approved `this.InsidePlacement(br.X - tl.X, br.Y - tl.Y, padding)`.
     - Movement of each child via `child.moveNodeWithChildren(dx, dy)`.
   - `PositionContainerChildren(withPadding)`: public Go-cased alias.
   - Preserves object identities of `TopLeft`, `FixedTopLeft`, `Containers` map, and child arrays.
   - Preserves natural runtime error and partial-mutation semantics without rollback or transaction wrappers.

3. **Deterministic Real-Go Oracle & Fixture**:
   - Built `test/reference/go_position_container_children_oracle.go` exercising 21 distinct scenarios:
     - `non_container_noop`
     - `true_container_nil_graph_panics`
     - `square_no_padding`
     - `square_with_padding`
     - `circle_no_padding`
     - `circle_with_padding`
     - `oval_or_cloud`
     - `nested_descendants`
     - `boundary_long_label`
     - `interior_long_label_ignored`
     - `label_height_irrelevant`
     - `fixed_origin`
     - `empty_container_missing_key`
     - `empty_container_empty_slice`
     - `duplicate_child_occurrence`
     - `nil_child_panics_before_movement`
     - `null_top_left_panics_before_movement`
     - `detached_second_child_partial_mutation`
     - `detached_child_zero_delta_no_panic`
     - `container_label_padding`
     - `outside_label_fixed_bounds_ordering`
   - Generated reference fixture `test/fixtures/go-position-container-children-reference.json` (27,538 bytes, SHA256: `5FC1A3F9D6E527ADE166D34F1627A94C06C826D49B17613617927ADC3FF570FD`), verified byte-for-byte reproducible.

4. **Testing & Verification**:
   - Unit tests: `test/unit/position-container-children.test.js` (10 tests).
   - Oracle parity tests: `test/unit/position-container-children-oracle.test.js` (28 tests replaying all scenarios and semantic contract assertions).
   - Full suite passes: 972 pass, 0 fail across 41 files.
   - Go packages pass: `layoutgraph` and `grouping` pass cleanly.
   - Browser safety & static audit pass: 0 violations across 48 source files.
