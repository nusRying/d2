# ADR-042: Node Placement-Cost Kernel Bundle

## Status
Implemented — awaiting Slice 41 review

## Context
We need to migrate the node-level placement cost scoring layer from the Go codebase.

## Decisions
- Node-level kernel scope is fully migrated.
- Graph-wide placementcost logic (e.g. `GraphEdgeCrossings`) is excluded.
- Added various layoutgraph accessors in `Node`, `Graph`, and `Edge`.
- Used exact direct `ctx.Err()` semantics. Nil contexts naturally fail.
- Underlying context errors are preserved exactly as `EdgeLength: ...`.
- No `WorkGuard` is used; standard `checkScoringCancellation` polling at `64` intervals.
- The scorer scratch is properly reused.
- The `placementcost` barrel exports are strictly managed; no internal kernel functions are exposed to the root.
- Malformed behaviors (e.g. nil parameters to orientation, ancestry) now properly mimic Go's natural failure (TypeError panics) rather than returning default safe values.
- Optimizer dependency is unlocked.
