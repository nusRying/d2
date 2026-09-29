# Slice 08 — WorkGuard and Browser-Safe Cancellation Accounting Progress

## Goal
Port the reusable TALA work-accounting primitive from `internal/limits/work.go` with exact Go accounting semantics, BigInt 64-bit precision, and a browser-safe cancellation boundary (`AbortSignal`).

## Approved Slice 07 Base
- Commit SHA: `df38f9881a89b0ac6d9e56e28d0e23497f93acf7`

## Pinned D2 Reference SHA
- Commit SHA: `01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579`

## Go Version, OS, and Architecture
- Go Version: `go1.27.0`
- OS: `windows`
- Architecture: `amd64`
- Go binary: `C:\Program Files\Go\bin\go.exe`

## Go Files Studied
1. `d2layouts/d2talalayout/internal/limits/work.go`: Complete `WorkGuard` struct, `NewWorkGuard`, `Step`, `Add`, `Check`, `Finish`, `SetLimit`, `Used`, polling strides (`contextCheckStride = 64`, `cancellableContextCheckStride = 1024`), limits constants (`MaxEngineNodes = 10_000`, `MaxEngineEdges = 50_000`, `MaxEngineWorkUnits = 61_440_000`), and `cachedContextErr`.
2. `d2layouts/d2talalayout/internal/limits/work_test.go`: `TestWorkGuardPreservesLimitAndCancellationErrors`, `TestWorkGuardRejectsInvalidOrExceededZeroLimit`, `TestWorkGuardAddObservesCrossedCancellationStride`, `TestWorkGuardAddLimitPrecedesCancellationWithoutAcceptedBoundary`, `TestWorkGuardAddZeroPreservesBoundaryPolling`, and `errOnlyCancelContext`.
3. `d2layouts/d2talalayout/internal/layoutgraph/work.go`: `workStepper` interface (`Step() error`, `Finish() error`), `unboundedWorkStepper`, and engine constants aliased to `limits.*`.
4. `d2layouts/d2talalayout/internal/grouping/sequences.go`: Downstream consumer of `WorkGuard` during sequence discovery and candidate evaluations.
5. `d2layouts/d2talalayout/internal/layoutgraph/transaction_snapshot.go`: Downstream transaction snapshot mechanism.
6. `d2layouts/d2talalayout/internal/layoutgraph/transaction.go`: Downstream transaction coordination.
7. `d2layouts/d2talalayout/internal/layoutgraph/resource_cancellation_test.go`: Cancellation and resource bounding integration tests.

## Dependency Analysis & Scope Decision: Why GraphState Was Split to Slice 09
Initial planning contemplated implementing `WorkGuard` alongside `GraphState` snapshots in Slice 08. Detailed examination of `internal/layoutgraph/transaction_snapshot.go` and `internal/layoutgraph/transaction.go` established that `GraphState` is responsible for complete transactional state capture and rollback across:
- `Graph.Nodes` and `Graph.Edges` slice and map identity;
- All mutable fields on `Node` and `Edge`;
- Point geometry identity and route point storage;
- Complete group structures (`Containers`, `Clusters`, `Sequences`, `Trees`, `NodeToTree`, `Hubs`, `Directions`, `CommonUncleSiblings`, `EdgeAbductions`, `HerdAssignment`, `Hierarchy`);
- Runtime object reachability.

Attempting to couple work accounting with graph snapshotting would conflate two distinct architectures. Therefore:
- **Slice 08**: Ports `WorkGuard`, limits constants, browser-safe `WorkContext` adapters, and cancellation polling.
- **Slice 09**: Ports `GraphState` exact snapshot and rollback.
- **Future slice**: Ports `grouping.AddSequences`.

## Limits Constants
Implemented in `src/limits/constants.js`:
- Structural count ceilings (as `Number`):
  - `MAX_ENGINE_NODES = 10_000`
  - `MAX_ENGINE_EDGES = 50_000`
  - `MAX_ENGINE_ROUTE_POINTS = 1_000_000`
  - `MAX_ENGINE_TREE_DEPTH = 256`
  - `MAX_GRAPH_SIZE = 30_000`
- Work-unit budgets and limits (as `BigInt`):
  - `WORK_UNITS_PER_ENTITY = 1024n`
  - `MAX_ENGINE_WORK_UNITS = 61_440_000n` ($((10000 + 50000) \times 1024)$)
  - `MAX_TRANSACTION_WORK_UNITS = 1_000_000_000n`
  - `MAX_TRANSACTION_OVERLAP_REFERENCES = 4_000_000n`
  - `MAX_BIN_PACK_WORK_UNITS = 1_000_000_000n`
  - `MAX_PLACE_TREES_WORK_UNITS = 68_000_000n`
  - `MAX_LABEL_PLACEMENT_WORK_UNITS = 50_000_000n`
- Polling strides:
  - `CONTEXT_CHECK_STRIDE = 64n`
  - `CANCELLABLE_CONTEXT_CHECK_STRIDE = 1024n`

`CheckedAddUint64` and `CheckedMulUint64` from `limits/arithmetic.go` are independent arithmetic utilities and were omitted from Slice 08.

## WorkContext Design & Cancellation Mapping
Implemented in `src/limits/work-context.js`:
1. `backgroundWorkContext()`: Models `context.Background()`. `doneAvailable = false`, cancellation never occurs, polling stride = 64.
2. `abortSignalWorkContext(signal)`: Models cancellable context backed by browser `AbortSignal`. `doneAvailable = true`, `isCancelled => signal.aborted`, polling stride = 1024.
3. `pollingWorkContext(isCancelled)`: Models synthetic nil-Done polling context for Go oracle parity testing. `doneAvailable = false`, polling stride = 64.

## BigInt / int64 Decision
To prevent floating-point precision loss and accurately mirror Go's signed `int64` semantics:
- Internal counters (`used`, `limit`) and strides are represented as `BigInt`.
- Input parameters (`limit`, `units`) accept either `BigInt` or safe-integer `Number`, normalized immediately via `normalizeInt64Input`. Fractional numbers, `NaN`, `Infinity`, and unsafe integers are rejected with `TypeError`. Values outside the signed int64 range (`INT64_MIN` to `INT64_MAX`) are rejected with `TypeError`.
- `INT64_MIN = -9223372036854775808n` and `INT64_MAX = 9223372036854775807n` are defined in `constants.js` and re-exported from `work-guard.js`.
- Counter updates apply two's complement 64-bit signed truncation via `BigInt.asIntN(64, ...)`. This faithfully reproduces Go's exact behavior on pathological boundaries (such as `math.MaxInt64 + 1` wrapping to `-9223372036854775808n`).

## WorkGuard Operation Semantics
Implemented in `src/limits/work-guard.js`:
- `NewWorkGuard(ctx, location, limit)`:
  - Rejects null or malformed contexts with `TALA <location> requires a context`.
  - Rejects negative initial limits with `TALA <location> work limit must not be negative`.
  - Calls `Finish()` immediately during construction; if context is pre-aborted, throws `<location>: context canceled`.
- `Step()`:
  - Charges 1 unit: `used = BigInt.asIntN(64, used + 1n)`.
  - If `used > limit`, throws `WorkLimitError` (`TALA <location> work exceeds limit <limit>`).
  - Evaluates cancellation only when `used % stride === 0n`.
- `Add(units)`:
  - Rejects negative charge with `TALA <location> work charge must not be negative`.
  - On overflow (`units > limit || used > limit - units`): sets `used = BigInt.asIntN(64, limit + 1n)`.
  - Cancellation precedence on overflow: if `previous <= limit && previous / stride !== limit / stride`, evaluates cancellation first. If context is cancelled, throws cancellation error.
  - Work-limit precedence on overflow: if no accepted polling boundary was crossed, throws `WorkLimitError`.
  - Accepted charge: updates `used += units` and checks cancellation if `used % stride === 0n || previous / stride !== used / stride`.
- `Add(0)` boundary behavior:
  - At exact stride boundary (`used % stride === 0n`): evaluates cancellation.
  - Away from stride boundary (`used % stride !== 0n`): does not evaluate cancellation.
- `Check()` / `Finish()`:
  - Immediately queries context cancellation. If canceled, throws `WorkCanceledError` (`name = "AbortError"`).
- `SetLimit(limit)`:
  - Validates via `normalizeInt64Input` (rejects non-safe-integer Numbers, out-of-range BigInts).
  - Replaces `limit` without resetting `used` and without checking existing `used`, exactly matching Go.
  - Accepts negative replacement limits (Go parity: no immediate check).
- `Used()`:
  - Returns `used` as `BigInt`.

## Sequence SharedWorkStepper Integration
Verified integration with `Sequence.SyncGeometryWithWork(guard)`:
- Positioned 2-step sequence:
  - 1 initial step + 2 resize steps + 2 arrange steps = 5 steps.
  - `Finish()` checks cancellation without charging work.
  - `guard.Used() === 5n`.
- Overflow: With limit 3, fails during first arrange step with `WorkLimitError` and `guard.Used() === 4n`.
- Cancellation: Pre-aborted controller throws `WorkCanceledError` during sequence synchronization.

## Real Go WorkGuard Oracle & Fixture Reproducibility
- Reference Oracle: `test/reference/go_work_guard_oracle.go`
- Generated Fixture: `test/fixtures/go-work-guard-reference.json`
- Generated independently twice using `C:\Program Files\Go\bin\go.exe`.
- Fixture SHA256: `5A99C37C658203FFEAAEBF9718831A0F51E6BD4FD763BEBEA4DBC0D3F34D2A76` (both runs identical).

## Full Regression Test Suite
Executed `bun test` (authoritative final run after correction commit):
- **Result**: `267 pass, 0 fail`
- **Expect calls**: `8753 expect() calls`
- **Test files**: `17 test files`
- **Runtime**: `492.00ms`

All test suites from Slices 01–07 remained completely green.

## Math.random Audit
- `js/src` audit for `Math.random`: 0 matches found.

## Browser-Safe Audit
- Node built-ins audit (`fs`, `path`, `buffer`, `process`, `crypto`, `events`, `worker_threads`): 0 imports found in `src/limits/`.
- No asynchronous timers (`setTimeout`, `setInterval`) or promise loops.

## Performance Sanity Benchmark
Informational benchmarks measured in `test/unit/work-guard.test.js`:
- 1,000,000 background `Step()` calls: ~75ms (budget < 500ms).
- 100,000 `Add(10)` calls: ~24ms (budget < 200ms).
- 100,000 `Check()` calls: ~1.2ms (budget < 200ms).

## Problems Encountered & Resolutions
1. **Initial method naming conflict**: In `WorkGuard`, the property `this.used` held a `BigInt`, which conflicted with an alias `used()`. Removed `used()` method alias and retained `Used()` and `usedCount()`.
2. **Sequence integration node setup**: In `Sequence.SyncGeometryWithWork` tests, `Node` constructor arguments were passed as `{ ID: 1n, TopLeft: ... }` rather than `new Node(1n); node.TopLeft = ...`. Fixed instantiation to properly assign TopLeft on the vessel.
3. **INT64 range enforcement**: `normalizeLimitOrUnits` did not enforce signed int64 boundaries, accepting arbitrary BigInt values. Renamed to `normalizeInt64Input` with `INT64_MIN`/`INT64_MAX` range checks matching Go's `int64` parameter domain.
4. **Polling stride not cached**: `pollingStride()` re-read `ctx.doneAvailable` on every call. Go captures the context's Done channel availability at construction. Fixed by caching `pollingStrideValue` during `WorkGuard` construction.
5. **SetLimit lacked range validation**: `SetLimit` used inline validation instead of `normalizeInt64Input`. Unified to use the same validation path as constructor and `Add`.

## Limitations & Deferred Work
- `GraphState` snapshots and `RestoreGraphState` are deferred to Slice 09.
- `grouping.AddSequences` and sequence candidate discovery are deferred to a subsequent slice.
- `limits/arithmetic.go` unsigned helpers (`CheckedAddUint64`, `CheckedMulUint64`) are not included.

## Commit History on Branch
```text
3605b6999 fix(tala-js): enforce signed-int64 API domain and cache polling stride
3290d3d54 docs(tala-js): document Slice 08 WorkGuard
206039ff8 test(tala-js): add Go WorkGuard parity oracle
e56d542a7 feat(tala-js): port WorkGuard accounting
71dd68663 docs(tala-js): close approved Slice 07
```
