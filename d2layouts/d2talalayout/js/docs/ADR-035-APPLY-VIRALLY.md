# ADR-035: Viral Herd Orientation Propagation (`ApplyVirally`) (Slice 34)

## Status
Implemented — awaiting Slice 34 review

## Context
In TALA's proximity pipeline, `proximity.ApplyVirally(ctx, herdOrder, herds)` propagates known herd orientations across uncle-grouped sibling sets until reaching fixed-point stability. It ensures that related nodes across shared uncle groupings adopt matching orientations, detecting conflicting orientations with precise invariant error reporting.

Pinned reference:
`d2layouts/d2talalayout/internal/proximity/herding.go` at commit `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

Pinned Go source:
```go
func ApplyVirally(
	ctx context.Context,
	herdOrder []*layoutgraph.Node,
	herds map[*layoutgraph.Node][]*layoutgraph.Node,
) error {
	for {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("AssignHerds: %w", err)
		}
		end := true
		for _, uncle := range herdOrder {
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("AssignHerds: %w", err)
			}
			nodes := herds[uncle]
			var assignment *layoutgraph.HerdAssignment
			for _, node := range nodes {
				if node.HerdAssignment != nil && node.HerdAssignment.Orientation != geo.NONE {
					assignment = node.HerdAssignment
					break
				}
			}
			if assignment != nil {
				for _, node := range nodes {
					if node.HerdAssignment == nil {
						end = false
						node.HerdAssignment = assignment.Copy()
					} else if node.HerdAssignment.Orientation != geo.NONE && node.HerdAssignment.Orientation != assignment.Orientation {
						return invariant.Errorf(
							"node %s has herd orientation %s; expected %s",
							node.DebugID(), node.HerdAssignment.Orientation.ToString(), assignment.Orientation.ToString(),
						)
					}
				}
			}
		}
		if end {
			return nil
		}
	}
}
```

## Design Parity Decisions

### 1. Direct Context Polling (No WorkGuard / No Transaction)
- `ApplyVirally` does not use `limits.WorkGuard`, `GraphState`, or rollback transactions.
- Cancellation is checked via `checkAssignHerdsCancellation(context)`.
- If cancelled, throws `WorkCanceledError("AssignHerds")`, matching Go's `"AssignHerds: context canceled"`.
- Context checks occur at two points:
  1. Once at the start of each outer pass.
  2. Once immediately before processing each uncle in `herdOrder`.
- Zero context checks occur inside the node loops.

### 2. Null Context and Pre-cancelled Semantics
- Pinned Go evaluates `ctx.Err()` at the very top before examining `herdOrder`.
- A null/undefined context naturally throws `TypeError` immediately, even when `herdOrder` is empty.
- A pre-cancelled context fails on the first check with `"AssignHerds: context canceled"`.

### 3. Strict Source Order Preservation
- `herdOrder` and `herds[uncle]` are processed in exact source array order without sorting.
- The first non-NONE assignment encountered in a group is selected as `assignment`.
- Because propagation into earlier groups may cascade into later groups within the same pass (or across subsequent passes when ordered in reverse), source order strictly dictates propagation mechanics and conflict attribution.

### 4. Known Assignment Discovery and Default TopLeft
- A node is considered a source assignment if `node.HerdAssignment != null && node.HerdAssignment.Orientation !== Orientation.NONE`.
- A newly constructed `HerdAssignment()` defaults to `Orientation.TopLeft` (matching Go's zero-value `geo.TopLeft`). This is treated as a valid known orientation, not an unset value.
- Only `Orientation.NONE` is treated as unset.
- Groups where all nodes have nil assignments or `Orientation.NONE` trigger zero propagation.

### 5. Propagation Targets and NONE Immunity
- Propagation occurs strictly into `node.HerdAssignment == null`.
- Nodes with `node.HerdAssignment.Orientation === Orientation.NONE` are immune: they are neither sources of propagation, nor overwritten by propagation, nor treated as conflicts.
- Nodes already possessing the same orientation are left untouched (their object identity, `Val`, and pair Sets remain completely intact).

### 6. Deep Copy Parity
- For nil targets, `node.HerdAssignment = assignment.Copy()` creates a fresh `HerdAssignment` instance with cloned `sameSidePaired` and `oppositeSidePaired` Sets.
- Multiple nil targets within a group receive mutually independent assignment instances.

### 7. Invariant Conflict Formatting and DebugID
- Conflicting non-NONE orientations trigger an immediate invariant violation:
  `layout invariant violated: node <DebugID> has herd orientation <actual>; expected <expected>`
- Uses `node.DebugID()` from Slice 33 (preserving `D2ID` if present).
- Uses `orientationToString` from `../geometry/orientation.js`.

### 8. Non-Atomic Partial Mutation
- Pinned Go performs mutations in place with zero rollback.
- If a group triggers a conflict after earlier nil nodes in that same group were assigned, those earlier nodes retain their mutated assignments.
- If context cancels mid-run, all assignments made prior to cancellation remain installed.

### 9. Extra Stability Pass
- Setting `end = false` occurs whenever a nil assignment is replaced with a copy.
- If any copy occurs in a pass, a full additional pass is executed across all uncles to confirm stability before returning `undefined`.

### 10. Module Export Boundaries
- Exported as `applyVirally` and PascalCase alias `ApplyVirally` in `src/proximity/herding.js` and re-exported from `src/proximity/index.js`.
- Not exported from root `src/index.js`.
