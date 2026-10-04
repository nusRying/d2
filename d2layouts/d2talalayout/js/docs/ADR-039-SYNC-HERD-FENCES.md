# ADR-039: Herd Fence Synchronization (`SyncHerdFences`) (Slice 38)

## Status
Accepted

## Context
In TALA's layout pipeline, `proximity.SyncHerdFences(graph)` updates the coordinate constraint (`node.HerdAssignment.Val`) for every assigned herd member to match the diagram's current outer boundary (`graph.BoundingBox()`).

Pinned reference:
- `d2layouts/d2talalayout/internal/proximity/herding.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

Pinned Go source:
```go
// SyncHerdFences updates the coordinate constraint for every assigned herd to
// the current graph boundary.
func SyncHerdFences(graph *layoutgraph.Graph) {
	topLeft, bottomRight := graph.BoundingBox()
	for _, node := range graph.Nodes {
		if node.HerdAssignment == nil || node.FixedTopLeft != nil {
			continue
		}
		switch node.HerdAssignment.Orientation {
		case geo.Top:
			node.HerdAssignment.Val = topLeft.Y
		case geo.Bottom:
			node.HerdAssignment.Val = bottomRight.Y
		case geo.Left:
			node.HerdAssignment.Val = topLeft.X
		case geo.Right:
			node.HerdAssignment.Val = bottomRight.X
		}
	}
}
```

## Decisions & Parity Rules
1. **Bounds Computed Once First**: `graph.BoundingBox()` is invoked exactly once before iterating `graph.Nodes`. It is not recomputed per node or deferred until an eligible node is encountered.
2. **Source Order Iteration**: `graph.Nodes` is traversed sequentially in existing array order without sorting or filtering.
3. **Unassigned Nodes Skipped**: Nodes where `node.HerdAssignment == null` are skipped; no `HerdAssignment` is instantiated.
4. **Fixed Nodes Skipped for Mutation**: Nodes where `node.FixedTopLeft != null` are skipped without mutating `HerdAssignment.Val`. However, fixed nodes still contribute to `graph.BoundingBox()` and therefore influence fences assigned to other non-fixed nodes.
5. **Cardinal Fence Mapping**:
   - `Orientation.Top` -> `node.HerdAssignment.Val = topLeft.Y`
   - `Orientation.Bottom` -> `node.HerdAssignment.Val = bottomRight.Y`
   - `Orientation.Left` -> `node.HerdAssignment.Val = topLeft.X`
   - `Orientation.Right` -> `node.HerdAssignment.Val = bottomRight.X`
6. **Non-Cardinal and Unknown Orientations Unchanged**: Diagonal orientations (`TopLeft`, `TopRight`, `BottomLeft`, `BottomRight`), `NONE`, and unknown numeric orientations have no matching switch case. Their existing `Val` is preserved without error or normalization.
7. **Default HerdAssignment Oddity**: A fresh `new HerdAssignment()` defaults to `Orientation.TopLeft` (matching Go zero-value 0). Consequently, `SyncHerdFences` leaves fresh default assignments untouched.
8. **Assignment and Pair Identity Preservation**: `node.HerdAssignment` object identity is never replaced. `Orientation`, `sameSidePaired` (and count), and `oppositeSidePaired` (and count) are untouched. Only `Val` is mutated.
9. **Full Graph Bounds Influence**: Routed edges and edge labels expand `graph.BoundingBox()` and therefore directly determine the fence coordinates.
10. **Nil Bounds Behavior**: When an unplaced node causes `graph.BoundingBox()` to return `[null, null]`:
    - If all nodes are unassigned, fixed, or have non-cardinal orientations, `SyncHerdFences` returns `undefined` without error.
    - If any non-fixed node has a cardinal orientation, accessing `topLeft.Y`, `bottomRight.Y`, etc. naturally throws `TypeError` before mutating `Val`.
11. **No Context, WorkGuard, or Rollback**: `syncHerdFences` takes only `graph`. The guarded wrapper `syncHerdFencesGuarded` belongs to placement optimization (later slice) and is strictly out of scope.
12. **Exports**: Exported as `syncHerdFences` and `SyncHerdFences` from `src/proximity/index.js`. Intentionally NOT exported from root `src/index.js`.

## Verification
- Real Go oracle program: `test/reference/go_sync_herd_fences_oracle.go` covering 40 scenarios (A–AN).
- Generated oracle fixtures: `test/fixtures/go-sync-herd-fences-reference.json`.
- Oracle replay test: `test/unit/sync-herd-fences-oracle.test.js` (40/40 PASS).
- Direct unit tests: `test/unit/sync-herd-fences.test.js` (39/39 PASS).
- Full JS test suite: 1985 passed, 0 failed across 77 test files.
- Go regression packages: `proximity`, `layoutgraph`, `grouping`, and `labelgeom` all pass.
