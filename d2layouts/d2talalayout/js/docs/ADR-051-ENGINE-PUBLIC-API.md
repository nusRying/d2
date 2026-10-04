# ADR-051: Engine, Multi-Seed Selection and Public ELK Layout API

## Status
Accepted

(ADR numbers and migration slice numbers are independent; this ADR belongs to
Slice 50, the final migration slice.)

## Context
Slice 50 closes the migration. All algorithm packages were ported in Slices
1–49. Slice 50 ports the remaining orchestration:
- `internal/engine/pipeline.go`, `compound_candidate.go`, `compound_routes.go`
- `internal/layoutgraph/clone.go` (`Clone(ctx, …)`)
- the top-level `layout.go`, `result.go`, `result_validate.go`, `seedgraph.go` and `limits.go`

It also exposes the public `layout()` API.

Pinned Go authority: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`.

Per ADR-001 the public contract is ELK-compatible JSON. The D2-specific Go
adapter (`adapter.go`, `patch.go`, most of `adapter_validate.go`) is
deliberately **not** ported. Its safety principles (bounded topology, input
immutability, deterministic errors) are applied to the ELK adapter instead.

## Decisions

### Engine pipeline (`src/engine/pipeline.js`)
- **Stage order.** The stage plan is exactly the pinned 37-stage
  `defaultPipelineStages`: Prescale, PreprocessSequences, Preprocess,
  PreprocessTrees, PreprocessHierarchies, PreprocessClusters, PreprocessHubs,
  NodePlacement, SwapStuff, Transpose, AlignAxes, GapNormalization, AlignAxes,
  OptimizeClusters, AlignAxes, BalanceSymmetry, Equidistance, AlignAxes,
  BinPack, CleanupStuff, Rescale, EdgeRouting, Crosshatch, Dejitter,
  EdgeRouting, SimplifyEdgeRoutes, SwapEdgePorts, StraightEdgesFallback,
  BalanceEdgeSegments, FixClusterEdgeBranching, TraceEdgesToShapeBorder,
  ReorderDuplicates, BinPack, PlaceLabels, NudgeEdgeChannels,
  ShortcutEdgeRoutes, Normalize. A test parses the Go stage table and
  compares it name by name.
- **Two RNG streams.** `newPipeline` creates two independent
  `GoRand(seed)` streams: `hierarchyPlacementRandom` for `hierarchy.Place`,
  and `random` for sequences and clusters.
- **AlignAxes.** `alignAxesNeeded` starts true. AlignAxes clears it *before*
  calling `Align`. GapNormalization, OptimizeClusters (after
  `ComputeCellSize`) and Equidistance (after `ComputeCellSize`) set it from
  their return values.
- **Route state reset.** At stage 0, immediately before Prescale:
  `ResetClusters`, then `resetFullLayoutRouteState`. That resets each edge
  (`Points = []`; unless the label is fixed, `LabelPercentage = 0` and an
  unlocked label position becomes Unset; `IsCurve = false`), then calls
  `ResetPlacementCosts`.
- **Shared transaction guard.** `ensureTransactionWorkGuard(ctx,
  "AutolayoutTransactions")` runs once, and every stage receives that shared
  guarded context.
- **Per-stage checks.** The context is checked before and after every stage
  (`<Stage>: context canceled`). After every stage the graph bounding box is
  checked against MaxGraphSize 30000: `layout invariant violated: Dimensions
  w:…, h:… reached after stage …`.
- **Routing.** EdgeRouting runs `RouteGraph` with `ForceReroute`,
  `RoutesPreviouslyCompleted`, the route observer and the pipeline as
  `CompletionObserver`. `runGraphRouting` restores `snapshots` and
  `edgeRoutingComplete` on any error or throw. The default observer clears
  snapshots. The snapshot observer (instrumentation only) copies the OVG via
  `MarshalJSON`/`UnmarshalJSON` and clones the graph with context. Dejitter's
  result sets `forceReroute`.
- **`Layout(ctx, graph, {Seed})`.** Checks in order: context required,
  pre-cancellation (`Autolayout: …`), graph required. It then calls
  `Clone(ctx, graph)` and `runLayout(…, validate = false)`, followed by a
  post-cancellation check. The input graph is never mutated.
  - **Contexts without a Done channel.** `runLayout` wraps such a context the
    way Go's `context.WithCancel` does (`CancelChildContext`). The child keeps
    the parent's values but has its own `Err`, so a polling context with no
    Done signal is not consulted inside the pipeline, exactly as in Go.
    `AbortSignal` contexts have a Done signal and are polled directly.
- **No concurrency in the engine.** The engine is synchronous CPU code; no
  Workers are used.

### Context-aware clone (`src/graph/clone.js`)
`Clone(ctx, source)` follows the pinned order:
1. The context is required (`TALA CloneGraph requires a context`).
2. The source is required (`cannot clone a nil graph`).
3. `validateEngineGraph(ctx, "CloneGraph", source)`.
4. `WorkGuard("CloneGraph", MaxEngineWorkUnits)`.
5. `guard.Step()` at every pinned point.
6. `Finish()`.

A partial clone is never published and the source is never mutated.
`cloneGraph(source)` is kept for earlier callers. A gated Go oracle pins the
`ctx.Err()` call counts, and every cancellation index is probed.

### Compound candidate and route preservation
- **`CompoundCandidate`** returns the input graph unchanged when any of these
  hold: more than 128 nodes, more than 256 edges, root child count outside
  3..64, no container among the root children, or a fixed node. Otherwise it:
  1. Clones the graph with the context.
  2. Runs `PlaceCompound(ctx, candidate, GoRand(0))`.
  3. Rejects the candidate if it has more cross-axis detours than the
     original. Touching projections are not disjoint, matching Go's `<`.
  4. Checks the context.
  5. Calls `reroutePlaced` (route reset, then the 9-stage routing mini
     pipeline, then `Normalize` unless the graph has a fixed node).
  6. Applies the MaxGraphSize check.
- **`PreserveCompoundRoutes`** clones `selected` and restores `IsCurve` by
  edge index. It then copies fixed node labels and icons, and fixed edge
  labels with their `LabelPercentage`. These are full struct copies, so the
  fixed bookkeeping is kept, unlike the ordinary clone. Routes that
  `compoundEnclosedRoute` accepts are translated by the root's displacement.
  Finally it runs `ResetPlacementCosts`, `labeling.Place` and `Normalize`
  under the `CompoundRoutes` guard.
- Both entry points are pinned against real Go in
  `go-slice50-engine-reference.json` (`compound` group).

### Result validation and seed results (`src/layout/`)
- `result-validation.js` ports `result_validate.go`:
  - completed-graph checks: finite and in-range geometry up to 1e9, positive
    dimensions, complete routes, label percentage in [0, 1], cancellation
    polled every 256 route points;
  - topology checks: same node IDs, edge IDs and endpoints, where only
    sequence-defining edges (`SequenceDefiningEdges`) may be omitted;
  - immutable metadata checks for nodes, edges, styles and labels, plus
    canonical direction keys and the TALA font-size scale.
- `result.js` `evaluateSeedResult` follows the pinned order, ending with
  `EvaluateWithArea` and the non-finite-penalty error. The score is
  `quality/score.js` `Score`, which is identical to Go's `layoutScore.compare`
  (penalty first, then area, exact comparison, no epsilon).

### Multi-seed selection (`src/layout/options.js`, `coordinator.js`)
- **Defaults.** Seeds default to `[1, 2, 3]`. Concurrency defaults to
  `min(navigator.hardwareConcurrency ?? 4, 4)`.
- **Seed normalization.** Seeds may be safe-integer Numbers, BigInts or
  integer strings, converted to signed int64 BigInts. Floats, unsafe integers
  and out-of-range values are rejected. Normalization rejects an empty list
  and more than 64 entries, dedupes keeping the first occurrence (no
  sorting), and rejects more than 16 unique seeds. `seed` and `seeds` are
  mutually exclusive.
- **Concurrency.** `maxConcurrency` of 0 or undefined means the default. Other
  values must be in 1..16 and are clamped to the seed count.
- **Execution.** Every configured seed runs exactly once. Selection is
  independent of completion order: lower Score wins, and an *exact* tie goes
  to the later configured index. Attempts run sequentially because the engine
  is synchronous; the coordinator is tested with injected asynchronous
  attempts in every completion order.
- **Failures.** A failed attempt is recorded by seed index (`seed <n>:
  <error>`). If every attempt fails, the error is `all TALA seed attempts
  failed:` followed by the failures joined in index order. A cancellation
  observed after all attempts settle wins over any success. A panic-like
  throw (a non-Error value, `TypeError`, `RangeError` or `ReferenceError`)
  becomes `TALA seed layout failed due to an internal invariant`.
- **Optional compound candidate.** Only a strict improvement replaces the
  incumbent. Ordinary errors, throws, worse candidates and ties keep the
  incumbent; cancellation propagates, and context cancellation always wins
  after the build. A different selected graph is refined by
  `PreserveCompoundRoutes`, and the refined result is accepted without a
  score comparison, as in Go.

### ELK adapter and public API
- **Labels.** At most one layout-managed label per node and per edge, mapped
  to the internal Label. Its position stays Unset on input; more than one
  label is an explicit error.
- **Edge direction.** Every ELK edge becomes a directed TALA edge from its
  source to its target, with no source arrowhead and a triangle target
  arrowhead. This matches the Go D2 adapter's translation of `a -> b` and lets
  TALA's direction-aware hierarchy and tree placement act on ELK input.
- **Direction.** `layoutOptions["elk.direction"]` (or the
  `org.eclipse.elk.direction` key) maps UP, DOWN, LEFT and RIGHT,
  case-insensitively, to Top, Bottom, Left and Right on the root or a
  container.
- **Edge output.** `edge.Points` with at least 2 points becomes exactly one
  ELK section (`startPoint`, `bendPoints`, `endPoint`) relative to the
  edge's owner. A stale input section is replaced; its `id` is kept.
- **Node and label output.** Node `x`/`y` are parent-relative. Managed node
  labels are node-relative and edge labels are owner-relative. Everything
  else (ids, ports, port endpoint ids, layoutOptions, custom metadata) is
  preserved from a `structuredClone` of the input.
- **Input bounds.** These are enforced iteratively before any expensive work:
  nodes ≤ 10,000, edges ≤ 50,000, input route points ≤ 1,000,000, nesting
  depth ≤ 256.
- **`layout(elkGraph, options)`.** Async. The steps are:
  1. Derive the context from `options.signal` (or a background context).
  2. Check for pre-cancellation (a pre-aborted signal fails before
     conversion).
  3. Validate the options.
  4. Convert ELK to the internal graph once.
  5. Create the seed input.
  6. Run the seeds.
  7. Consider the optional compound candidate and refinement.
  8. Validate the final graph.
  9. Convert the result to ELK.
  10. Check for cancellation (`TALA layout canceled before apply: …`). See
      "Cancellation and the single-thread runtime" for what a signal can
      observe.

  It returns a new plain JSON-serializable object and never mutates the
  input. Internal runtime faults become `TALA layout failed due to an
  internal invariant`. Validation, resource-limit and cancellation errors are
  passed through unchanged.
- **Package.** The package is `@syntroper/tala-js` with
  `"exports": {".": "./src/index.js"}` and `"type": "module"`. The root
  exports only `layout` and `defaultOptions`. The former internal barrel is
  `src/internal.js`, used by tests only. `"sideEffects"` is not declared.
- **Browser safety.** The runtime is browser-only: no Node built-ins,
  `process`, `Buffer`, `crypto`, workers or `Math.random`. CI bundles the
  root with `bun build --target browser` and greps the bundle.

### Cancellation and the single-thread runtime
- **No Workers.** No Workers are used internally. The engine, seed attempts
  and adapters run synchronously on the calling JavaScript thread; `layout()`
  is `async` only for API ergonomics.
- **Go parity inside the engine.** The internal `WorkContext` machinery keeps
  Go's cancellation parity whenever the context's state can be observed
  synchronously: polling points, stage boundaries, error messages and
  rollback all match pinned Go. That covers a context or signal that is
  already aborted, or one aborted by code running inside the layout.
- **Event-loop limitation.** Browser `AbortSignal` delivery runs through the
  event loop. An abort triggered by a timer or other event-loop callback
  cannot preempt a blocking synchronous stage, because that callback cannot
  run until the layout returns control. Such a mid-run abort is not observed.
  A signal already aborted before `layout()` begins is honored immediately,
  before any work.
- **Consumer guidance.** Applications that need responsive cancellation
  during long layouts should host the package in their own Worker or a
  similar isolated execution boundary. This is an acknowledged public-runtime
  constraint, not a gap in the migration.

### Real-Go oracles
All oracles are generated only when `TALA_SLICE50_ORACLE=1` is set; normal
`go test` verifies them without writing.
- **`internal/engine/go_slice50_engine_oracle_test.go`** →
  `go-slice50-engine-reference.json`, replayed by `engine-e2e-oracle.test.js`.
  The cases cover: empty, single node, 2-node edge, 3-node chain, branch,
  nested container, inner + outer edges, loop, labeled nodes and edge, fixed
  node, hierarchy-friendly graph, direction RIGHT, cluster-friendly graph,
  and multiple components, across one or more seeds. Each case records node
  geometry, ordered route points, IsCurve, label position and percentage, and
  the quality penalty and area. The compound group records CompoundCandidate
  and PreserveCompoundRoutes results.
- **`go_slice50_selection_oracle_test.go`** (top-level package) →
  `go-slice50-selection-reference.json`, replayed by
  `seed-selection-oracle.test.js`. It covers normalizeSeeds, score
  comparison (including adjacent floats and NaN/Inf), coordinateLocalSeeds
  at concurrency 1–3, and optional candidate and refinement outcomes. The JS
  replay runs every completion order.
- **`internal/layoutgraph/go_slice50_clone_oracle_test.go`** →
  `go-slice50-clone-reference.json`, covering clone `Err()` counts and error
  messages.

## Scope
This ADR completes the migration's required orchestration. No planned
migration slice remains.
