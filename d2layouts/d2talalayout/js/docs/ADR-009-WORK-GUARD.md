# ADR 009: WorkGuard and Browser-Safe Cancellation Accounting

## Date
2026-09-29

## Status
Accepted

## Context
TALA relies on bounded iterative and recursive algorithms across its layout stages (such as sequence discovery, bin-packing, compaction, tree placement, and label positioning). To guard against infinite loops, excessive resource consumption, and runaway computations, Go TALA uses a reusable accounting primitive defined in `internal/limits/work.go`: `WorkGuard`.

`WorkGuard` tracks signed work units against an explicit ceiling (`limit`) and periodically polls the Go runtime `context.Context` to cooperatively cancel long-running operations.

Initial planning considered combining `WorkGuard` and `GraphState` (transactional snapshot/rollback) into Slice 08. However, detailed investigation of pinned Go source (`internal/layoutgraph/transaction_snapshot.go` and `internal/layoutgraph/transaction.go`) revealed that `GraphState` is an extensive, intricate subsystem responsible for snapshotting and restoring:
- Node and Edge sets and exact map/slice identities;
- Mutable fields across Node and Edge records;
- Point geometry identity and route point storage;
- Complete group structures (Containers, Clusters, Sequences, Trees, NodeToTree, Hubs, Directions, CommonUncleSiblings, EdgeAbductions, HerdAssignment, Hierarchy);
- Runtime object reachability and structural invariants.

Coupling `WorkGuard` work accounting with `GraphState` would inflate the slice scope and mix orthogonal concerns. Therefore:
- **Slice 08**: Ports `WorkGuard`, limits constants, browser-safe `WorkContext` adapters, and cancellation polling.
- **Slice 09**: Ports `GraphState` exact snapshot capture and atomic rollback.
- **Future slice**: Ports `grouping.AddSequences`.

## Decisions

### 1. Limits Constants, BigInt Representation & Signed int64 API Boundary
Go's work units are signed 64-bit integers (`int64`). Floating-point JavaScript `Number` loses integer precision beyond $2^{53} - 1$ (9,007,199,254,740,991), which risks silent corruption on large charges or pathological boundaries (such as `math.MaxInt64`).

JavaScript `BigInt` can represent values far beyond Go's `int64` range. Since Go's API parameters are typed `int64`, all JavaScript API inputs are restricted to the signed int64 domain:

```text
INT64_MIN = -9223372036854775808n
INT64_MAX =  9223372036854775807n
```

`normalizeInt64Input` validates every external `limit` and `units` parameter:
- Must be a `BigInt` or a safe-integer `Number`.
- Must satisfy `INT64_MIN <= value <= INT64_MAX`.
- Out-of-range BigInts are rejected with `TypeError`.

Internal Go-equivalent arithmetic (such as `used++` or `limit + 1`) may wrap through `BigInt.asIntN(64, ...)` to faithfully reproduce Go's signed overflow behavior. This wrapping is deliberate and does not indicate an input validation failure.

We define:
- **Structural counts** as standard `Number`:
  - `MAX_ENGINE_NODES = 10_000`
  - `MAX_ENGINE_EDGES = 50_000`
  - `MAX_ENGINE_ROUTE_POINTS = 1_000_000`
  - `MAX_ENGINE_TREE_DEPTH = 256`
  - `MAX_GRAPH_SIZE = 30_000`
- **Work-unit budgets and limits** as `BigInt`:
  - `WORK_UNITS_PER_ENTITY = 1024n`
  - `MAX_ENGINE_WORK_UNITS = 61_440_000n` ($((10000 + 50000) \times 1024)$)
  - `MAX_TRANSACTION_WORK_UNITS = 1_000_000_000n`
  - `MAX_TRANSACTION_OVERLAP_REFERENCES = 4_000_000n`
  - `MAX_BIN_PACK_WORK_UNITS = 1_000_000_000n`
  - `MAX_PLACE_TREES_WORK_UNITS = 68_000_000n`
  - `MAX_LABEL_PLACEMENT_WORK_UNITS = 50_000_000n`
- **Internal polling strides** as `BigInt`:
  - `CONTEXT_CHECK_STRIDE = 64n`
  - `CANCELLABLE_CONTEXT_CHECK_STRIDE = 1024n`

### 2. Browser-Safe WorkContext Abstraction
Go `WorkGuard` consumes `context.Context`. In web browsers, there is no `context.Context` nor Node's `EventEmitter`. The standard browser mechanism for cooperative cancellation is `AbortSignal`.

However, Go distinguishes contexts where `Done() != nil` (standard cancellable context via channel closing) from contexts where `Done() == nil` but `Err()` can change dynamically. These two categories use different polling strides:
- **`doneAvailable = true`**: Polling stride = `1024n`.
- **`doneAvailable = false`**: Polling stride = `64n` (shorter stride because cancellation is observable only by actively polling `Err()`).

We create a minimal browser-safe `WorkContext` abstraction with three factory functions:
1. `backgroundWorkContext()`: Non-cancellable background context (`context.Background()`). `doneAvailable = false`, `isCancelled() => false`. Polling stride = 64.
2. `abortSignalWorkContext(signal)`: Standard cancellable context backed by browser `AbortSignal`. `doneAvailable = true`, `isCancelled() => Boolean(signal?.aborted)`. Polling stride = 1024.
3. `pollingWorkContext(isCancelled)`: Synthetic polling context for Go parity testing. `doneAvailable = false`, `isCancelled() => Boolean(isCancelled())`. Polling stride = 64.

**Cached polling-mode semantics.** In Go, the Done channel availability is captured at `NewWorkGuard` construction:
```go
done: ctx.Done()
```
The JS implementation therefore captures the polling category/stride once at construction via `this.pollingStrideValue`. Changing `ctx.doneAvailable` after construction must not alter an existing WorkGuard's polling stride.

This behavior is proven by the real Go oracle scenario `cached_done_stride_retained`: a WorkGuard constructed with a standard (Done-available) context retains its 1024-stride even if the context's Done availability were to change, and polls cancellation at step 64 only if constructed with a nil-Done context.

### 3. Context Validation & Null Rejection
In Go:
```go
if ctx == nil {
    return nil, fmt.Errorf("TALA %s requires a context", location)
}
```
In JavaScript:
`NewWorkGuard(null, location, limit)` deterministically throws `Error("TALA <location> requires a context")`. Null or undefined is never silently defaulted to background context. Malformed context objects that do not satisfy the minimal context contract are also rejected.

### 4. Constructor Semantics & Cancellation Pre-Check
In Go:
```go
if limit < 0 {
    return nil, fmt.Errorf("TALA %s work limit must not be negative", location)
}
guard := &WorkGuard{...}
if err := guard.Finish(); err != nil {
    return nil, err
}
return guard, nil
```
1. Negative initial limit throws `Error("TALA <location> work limit must not be negative")`.
2. Calling `guard.Finish()` immediately inside the constructor ensures that an already-aborted context triggers cancellation before any work begins, returning `<location>: context canceled`.

### 5. Step Accounting & Overflow Used Behavior
```go
guard.used++
if guard.used > guard.limit {
    return fmt.Errorf("TALA %s work exceeds limit %d", guard.location, guard.limit)
}
return guard.checkAtStride()
```
- `this.used` is incremented first (`used = BigInt.asIntN(64, used + 1n)`).
- If `used > limit`, throws `WorkLimitError`. The rejected work unit is preserved in `Used()`. For example, with limit 2, three Step calls yield `Used() === 3n`.
- Stride polling checks cancellation if `used % stride === 0n`.

### 6. Add Semantics, Overflow Used & Cancellation Precedence
```go
if units < 0 {
    return fmt.Errorf("TALA %s work charge must not be negative", guard.location)
}
if units > guard.limit || guard.used > guard.limit-units {
    previous := guard.used
    guard.used = guard.limit + 1
    stride := guard.pollingStride()
    if previous <= guard.limit && previous/stride != guard.limit/stride {
        if err := guard.Check(); err != nil {
            return err
        }
    }
    return fmt.Errorf("TALA %s work exceeds limit %d", guard.location, guard.limit)
}
previous := guard.used
guard.used += units
return guard.checkAfterAdd(previous)
```
- Negative charge throws `Error("TALA <location> work charge must not be negative")`. `Used()` is not modified.
- **Overflow setting**: On overflow, `used` is set to `guard.limit + 1n` (rather than adding the entire rejected request).
- **Cancellation precedence**: If the rejected request crossed a polling stride boundary (`previous <= limit && previous / stride !== limit / stride`), cancellation is evaluated before throwing the work-limit error.
- **Work-limit precedence**: If no accepted polling boundary is crossed prior to the overflow, the work-limit error is thrown even if the context is canceled.
- **Accepted Add**: Increments `used += units` and calls `checkAfterAdd(previous)`: if `used % stride !== 0n && previous / stride === used / stride`, returns cleanly; otherwise checks cancellation.

### 7. Add(0) Boundary Behavior
In Go:
`Add(0)` checks cancellation if and only if `used % stride === 0n`.
- At `Used = 0` (boundary): `0 % 1024 === 0`, so `Add(0)` checks and observes cancellation.
- At `Used = 1` (away from boundary): `1 % 1024 !== 0`, so `Add(0)` returns without observing cancellation.

### 8. SetLimit Semantics
In Go:
```go
func (guard *WorkGuard) SetLimit(limit int64) {
    guard.limit = limit
}
```
- Input is validated via `normalizeInt64Input` (rejects non-safe-integer Numbers, out-of-range BigInts).
- Does NOT reset `used`.
- Does NOT immediately validate or check `used`.
- Accepts negative replacement limits without immediate check (Go parity: no guard on the replacement value beyond `int64` typing).
- Subsequent operations evaluate against the new ceiling.

The oracle scenario `set_limit_negative` proves that `SetLimit(-5)` is accepted by Go; subsequent `Step()` yields `WorkLimitError` with message `"TALA setNegative work exceeds limit -5"` and `used: 1`.

### 9. Step int64 Wrap Behavior
When `limit = math.MaxInt64` (9223372036854775807), `Add(math.MaxInt64)` succeeds and sets `used = 9223372036854775807n`. A subsequent `Step()` executes `used++`, which in Go's signed int64 arithmetic wraps to `-9223372036854775808` (math.MinInt64).

In JavaScript, `BigInt.asIntN(64, 9223372036854775807n + 1n)` produces `-9223372036854775808n`, faithfully reproducing this behavior.

Since the wrapped `used` (`-9223372036854775808n`) is less than `limit` (`9223372036854775807n`), no `WorkLimitError` is thrown. The oracle scenario `step_int64_wrap` records exactly:
```json
{ "kind": "none", "message": "", "used": "-9223372036854775808" }
```

This proves the internal `used++` signed int64 wrap behavior separately from the `limit + 1` Add-overflow case.

### 10. Error Hierarchy & Classification
- `WorkCanceledError`: Subclass of `Error` with `name = "AbortError"` and message `<location>: context canceled`.
- `WorkLimitError`: Subclass of `Error` with `name = "WorkLimitError"` and message `TALA <location> work exceeds limit <limit>` (interpolated as a decimal string without a trailing `n`).
- Helper functions: `isWorkCanceledError(error)` and `isWorkLimitError(error)`.

### 11. SharedWorkStepper Compatibility
Slice 07 established the narrow work-accounting contract for sequence geometry:
```javascript
Sequence.SyncGeometryWithWork(guard)
```
`WorkGuard` implements `Step()` and `Finish()`, satisfying this contract. A positioned 2-step sequence consumes exactly 5 work units:
1 initial step + 2 resize steps + 2 arrange steps = 5.
`Finish()` verifies cancellation without charging work, leaving `guard.Used() === 5n`.

### 12. Arithmetic Utilities Omission
Pinned `limits/arithmetic.go` contains `CheckedAddUint64` and `CheckedMulUint64`. These are independent unsigned arithmetic helpers not used by `WorkGuard` or sequence geometry. They are deliberately omitted from Slice 08.

## Consequences
- JavaScript engine consumers now have a unified, browser-safe work-accounting primitive with exact Go parity.
- Cooperative cancellation integrates directly with modern browser `AbortSignal` / `AbortController`.
- All operations are synchronous and cooperative; no timers (`setTimeout`), asynchronous promises, or Node built-in modules are introduced.
- Slice 09 can build atomic `GraphState` rollback on top of this verified foundation.
