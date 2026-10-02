# ADR-037: Herd Assignment Orchestration (`AssignHerds`) (Slice 36)

## Status
Accepted — Implemented in Slice 36

## Context
In TALA's proximity pipeline, `proximity.AssignHerds(ctx, graph, root, edgeAbductions)` orchestrates herd discovery, singleton filtering, uncle sorting, connected component partitioning, side eligibility and preference negotiation, mutual pair recording, viral orientation propagation, and cluster vessel arrangement adjustment.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/herding.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

Pinned Go source:
```go
// AssignHerds chooses a shared container side for siblings whose external
// cousins should remain mutually accessible during placement.
func AssignHerds(ctx context.Context, graph *layoutgraph.Graph, root *layoutgraph.Node, abductions []*layoutgraph.EdgeAbduction) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("AssignHerds: %w", err)
	}
	grouped, cousins, err := GroupSheep(ctx, graph, root, abductions)
	if err != nil {
		return err
	}
	var uncleOrder []*layoutgraph.Node
	for uncle, nodes := range grouped {
		if len(nodes) <= 1 {
			delete(grouped, uncle)
			delete(cousins, uncle)
		} else {
			uncleOrder = append(uncleOrder, uncle)
		}
	}
	sortNodesByID(uncleOrder)
	components, err := connectedHerds(ctx, uncleOrder, grouped)
	if err != nil {
		return err
	}
	unbiasedSide := 0
	for _, component := range components {
		sides := []geo.Orientation{geo.Top, geo.Right, geo.Bottom, geo.Left}
		preferred := geo.NONE
		for _, uncle := range component.uncles {
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("AssignHerds: %w", err)
			}
			children := graph.Containers[uncle]
			if len(children) == 0 {
				return invariant.Errorf("herding uncle %s has no children", uncle.DebugID())
			}
			if children[0].TopLeft == nil {
				continue
			}
			for _, node := range grouped[uncle] {
				for _, cousin := range cousins[uncle][node] {
					assignment := cousin.HerdAssignment
					if assignment == nil {
						continue
					}
					orientation := assignment.Orientation
					if !orientation.IsHorizontal() && !orientation.IsVertical() {
						return invariant.Errorf("cousin %s has an invalid herd orientation", cousin.DebugID())
					}
					bothSides := CanUseBothSides(uncle, orientation)
					opposite := orientation.Opposite()
					var nextSides []geo.Orientation
					for _, side := range sides {
						if side == opposite || bothSides && side == orientation {
							nextSides = append(nextSides, side)
						}
					}
					sides = nextSides
					if preferred == geo.NONE {
						preferred = opposite
						if bothSides && assignment.SameSidePairCount() < assignment.OppositeSidePairCount() {
							preferred = orientation
						}
					}
				}
			}
		}
		if len(sides) == 0 {
			for _, node := range component.nodes {
				node.HerdAssignment = nil
			}
			continue
		}
		if preferred == geo.NONE {
			preferred = sides[unbiasedSide%len(sides)]
			unbiasedSide++
		} else if !slices.Contains(sides, preferred) {
			preferred = sides[0]
		}
		for _, node := range component.nodes {
			node.HerdAssignment = layoutgraph.NewHerdAssignment()
			node.HerdAssignment.Orientation = preferred
		}
		for _, uncle := range component.uncles {
			children := graph.Containers[uncle]
			if children[0].TopLeft == nil {
				continue
			}
			for _, node := range grouped[uncle] {
				for _, cousin := range cousins[uncle][node] {
					if cousin.HerdAssignment != nil {
						if preferred == cousin.HerdAssignment.Orientation {
							node.HerdAssignment.PairSameSide(cousin)
							cousin.HerdAssignment.PairSameSide(node)
						} else {
							node.HerdAssignment.PairOppositeSide(cousin)
							cousin.HerdAssignment.PairOppositeSide(node)
						}
					}
				}
			}
		}
	}
	if err := ApplyVirally(ctx, uncleOrder, grouped); err != nil {
		return err
	}
	for _, n := range herdOrder {
		for _, node := range grouped[n] {
			if node.IsClusterVessel() && node.HerdAssignment != nil {
				cluster := graph.Clusters[node]
				if (node.HerdAssignment.Orientation == geo.Top || node.HerdAssignment.Orientation == geo.Bottom) &&
					cluster.Arrangement == layoutgraph.Column {
					cluster.Arrangement = layoutgraph.Row
				} else if (node.HerdAssignment.Orientation == geo.Left || node.HerdAssignment.Orientation == geo.Right) &&
					cluster.Arrangement == layoutgraph.Row {
					cluster.Arrangement = layoutgraph.Column
				}
			}
		}
	}
	return nil
}
```

## Decisions

1. **Export Surface and Public API**:
   - `assignHerds` and its PascalCase alias `AssignHerds` are exported from `src/proximity/herding.js`.
   - Re-exported from `src/proximity/index.js`.
   - Matches the public API contract of `AssignNears` and `GroupSheep`.

2. **Non-Atomic Mutation Without Rollback**:
   - Unlike `AssignNears` (which uses `GraphState` snapshots and restores them upon cancellation/error), `AssignHerds` in pinned Go is **non-atomic**. It operates directly on graph node references in-place without snapshotting or rollback.
   - When an invariant violation occurs on later components (e.g. invalid cousin orientation) or cancellation fires mid-pipeline, earlier mutations remain in the graph, as verified by oracle scenarios `AG_partial_mutation_before_error` and `AH_partial_mutation_before_cancellation`.

3. **Cancellation and Null Context Parity**:
   - Pinned Go calls `ctx.Err()` at function entry.
   - If `context` is null/undefined, evaluating `context.isCancelled` immediately throws `TypeError`, exactly matching Go's panic on nil `ctx.Err()`.
   - When cancelled, throws `WorkCanceledError("AssignHerds")`, preserving the `AssignHerds: context canceled` error message.

4. **Singleton Filtering and Deterministic Uncle Ordering**:
   - Groups with `nodes.length <= 1` are deleted from `grouped` and `cousins`.
   - Retained uncles are appended to `uncleOrder` and sorted by ID via `sortNodesByID(uncleOrder)` (using `BigInt(node.ID)` ordering).

5. **Component Side Negotiation and Unbiased Cycling**:
   - Sides initialize to `[Top, Right, Bottom, Left]`.
   - Per uncle, checks `graph.Containers.get(uncle)`. If empty, throws `layout invariant violated: herding uncle <DebugID> has no children`.
   - If first child is unplaced (`children[0].TopLeft == null`), the uncle is skipped.
   - Per cousin, checks orientation: throws `layout invariant violated: cousin <DebugID> has an invalid herd orientation` if not horizontal or vertical.
   - Intersects sides with opposite and allowed same-side (via `canUseBothSides`).
   - If `sides.length === 0`: clears all component nodes' `HerdAssignment = null` and continues.
   - Unbiased selection: uses `sides[unbiasedSide % sides.length]` and increments `unbiasedSide`. Incompatible components do NOT advance `unbiasedSide`.

6. **Cluster Vessel Arrangement Flipping**:
   - After viral propagation, any node in the retained herds where `node.isClusterVessel && node.HerdAssignment != null` has its associated `graph.Clusters.get(node)` examined.
   - Flips `Column -> Row` on `Top` or `Bottom`.
   - Flips `Row -> Column` on `Left` or `Right`.
   - No-op otherwise.
   - Missing cluster entry panics with `TypeError`, matching Go's nil pointer dereference on `graph.Clusters[node]`.

## Verification
- Comprehensive 40-scenario Go oracle program `test/reference/go_assign_herds_oracle.go` run against pinned Go implementation.
- Fixture generated at `test/fixtures/go-assign-herds-reference.json`.
- Full JS oracle replay test at `test/unit/assign-herds-oracle.test.js` validating all 40 scenarios (100% pass).
- Unit tests at `test/unit/assign-herds.test.js` reproducing Go `herding_test.go` test cases (`TestAssignHerdVirality`, `TestUseBothSides`, `TestRandomHerdVirality`, `TestAssignHerdsRejectsUnindexedUncleChildren`, `TestAssignHerdsReconcilesOverlappingGroups`, and cluster arrangement flips).
- Full JS test suite: 1787 tests passing, 0 failures.
- Full Go proximity test suite: all tests passing.
