# ADR-043: Sizeless Optimizer + Initialization Bundle

## Status
Implemented — awaiting Slice 42 review

## Context
We need to migrate the first-stage placement optimization stack from Go Tala into JavaScript:
1. `OptimizationWorkGuard` resource limiting and Lemire bias-free Fisher-Yates `shuffle`.
2. Placement cost snapshots on `Graph` preserving Map reference identity and exact cost fields.
3. Topological node traversal and ancestry queries (`allReachableNodesGuarded`, `reachableNodesGuarded`, `isMajorityTarget`, `hasArrowTo`, `isTargetedTo`).
4. Geometric median and coordinate metrics (`optimizerMedian`, `optimizerAdjacents`, `occupied`, `intersectsOtherNode`, `withinMaxSize`).
5. Candidate node movement and transactional mutation snapshot/restore (`withOptimizerPositionsSwapped`, `OptimizerMutationSnapshot`, `OptimizerCandidateMovement`).
6. `SizelessOptimizer` Simulated Annealing engine (`medianPointGuarded`, `findClosestUnoccupiedDistanceGuarded`, `placementPointsGuarded`, `moveNodeToBestGuarded`, `bestSwapCandidateGuarded`).
7. `initializeNodes` and `nodeCandidatePositions` first-stage layout initialization.

## Scope Boundaries
- Out of scope (deferred to future slices): `sizedOptimizer`, `compaction`, `placeNodesOrthogonally`, `PlaceNodes`, `Place`, `transpose`, `alignment`, `container orientation`, `cluster optimization`, `JoinDistancedClusters`, `packing`, `routing`, `labeling`, `engine orchestration`.
- Internal optimizer symbols are kept private to `src/placement/` and are NOT re-exported in `src/placement/index.js` or root `src/index.js`.

## Decisions
- **Resource Limiting Parity**: `OptimizationWorkGuard` implements unsigned 64-bit BigInt limits (`MAX_OPTIMIZATION_WORK_UNITS = 250_000_000n`), context checking on every 64-unit stride (`OPTIMIZATION_CONTEXT_CHECK_STRIDE = 64n`), arithmetic overflow detection past `2^64 - 1`, and `n log2 n` sorting comparison accounting.
- **Fisher-Yates Shuffle Parity**: `shuffle` faithfully matches Go `limits.Shuffle` using Mitchell & Reeds LFSR state (`GoRand`), using Lemire's reduction algorithm without modulo bias and re-drawing on bias thresholds.
- **Reference Identity Preservation**: `PointerSnapshot` retains original `Point` references on restore, and `PlacementCostSnapshot` mutates the existing Map instance via `.clear()` and key insertion rather than assigning a new Map reference.
- **Sizeless Coordinates**: Abstract cell coordinates (1 unit = 1 cell) are maintained throughout sizeless optimization and candidate scanning.
- **Candidate Scan Order**: Candidate positions are sorted in descending order (`bottomRight` to `topLeft`) for majority targets and ascending order (`topLeft` to `bottomRight`) for non-majority targets. Fixed-node graphs clamp candidate positions to `[0, ∞)`.
- **Atomic Rollback**: Pre-initialization and pre-optimization coordinates are captured transactionally; any cancellation or error restores exact previous coordinates.
- **Real-Go Oracle Validation**: A 21-scenario Go oracle fixture (`go-sizeless-optimizer-reference.json`) was generated from `internal/placement` and verified against JS implementations with full parity.
