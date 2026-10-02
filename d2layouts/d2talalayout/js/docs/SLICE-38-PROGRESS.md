# Slice 38 Progress: Herd Fence Synchronization (`SyncHerdFences`)

## Summary
- **Slice**: 38 — Herd Fence Synchronization (`SyncHerdFences`)
- **Status**: Implemented — awaiting Slice 38 review
- **Base Commit**: `7d244c87f945d2466562190220576a0e0c128cbb` (Slice 37 approved HEAD)
- **Target Branch**: `tala-js/slice-38-sync-herd-fences`
- **Pinned Upstream Reference**: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Scope of Implementation
1. **`src/proximity/herding.js`**:
   - Implemented `syncHerdFences(graph)` and `SyncHerdFences` alias.
   - Computes `graph.BoundingBox()` once up front before node iteration.
   - Iterates `graph.Nodes` in source order without sorting or reordering.
   - Skips unassigned nodes (`node.HerdAssignment == null`) and fixed nodes (`node.FixedTopLeft != null`).
   - Updates `node.HerdAssignment.Val` according to cardinal orientation (`Top` -> `topLeft.Y`, `Bottom` -> `bottomRight.Y`, `Left` -> `topLeft.X`, `Right` -> `bottomRight.X`).
   - Retains existing `Val` for non-cardinal (`TopLeft`, `TopRight`, `BottomLeft`, `BottomRight`), `NONE`, and unknown orientations without error.
   - Leaves fresh `HerdAssignment` (defaulting to `TopLeft`) untouched.
   - Preserves object identities of `HerdAssignment`, `Orientation`, `sameSidePaired`, and `oppositeSidePaired`.
   - Naturally preserves unplaced node nil-bounds behavior and property access errors without synthetic invariants.
2. **`src/proximity/index.js`**:
   - Re-exported `syncHerdFences` and `SyncHerdFences`.
3. **`src/index.js`**:
   - Intentionally untouched; proximity internals are not exposed at package root.

## Test & Verification Results
- **Go Oracle**: `test/reference/go_sync_herd_fences_oracle.go` covering 40 scenarios (A–AN).
- **Go Oracle Fixtures**: `test/fixtures/go-sync-herd-fences-reference.json`.
- **Oracle Replay Tests**: `test/unit/sync-herd-fences-oracle.test.js` (40/40 PASS).
- **Direct Review-Gate Tests**: `test/unit/sync-herd-fences.test.js` (39/39 PASS).
- **Targeted JS Regressions**: 396/396 PASS across 12 files.
- **Full JS Suite**: 1985 passed, 0 failed across 77 test files.
- **Go Packages**:
  - `proximity`: PASS
  - `layoutgraph`: PASS
  - `grouping`: PASS
  - `labelgeom`: PASS
