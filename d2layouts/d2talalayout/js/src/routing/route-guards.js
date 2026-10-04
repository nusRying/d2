// Slice 47 — routing work guards.
//
// Pinned references (d2layouts/d2talalayout/internal/routing):
//   route_stage_guard.go — routeWorkGuard, aggregate-work context plumbing
//   route_search_guard.go — workBudget, routeSearchWorkGuard, telemetry,
//                           routeSearchIsDescendantOf, routeSearchHasFixedAncestor,
//                           fixedOverlapsForRoute
//   work.go — chargeSkippedRouteWork
//
// Counters are JS Numbers: every limit is far below 2^53 and each guard rejects
// a charge before adding it, so `used <= limit` always holds. Only the
// reserveProduct/reserveSum overflow checks need exact uint64 arithmetic, which
// they perform with BigInt.
//
// Go runs route flavors on goroutines and switches the aggregate guard to an
// atomic path (`enableParallel`). JS executes flavors sequentially, so the
// parallel flag only records that the switch happened; accounting is identical.

import { cachedContextErr, contextDone } from './work.js';

export const MAX_ROUTE_STAGE_WORK_UNITS = 50_000_000;
export const ROUTE_STAGE_CONTEXT_CHECK_STRIDE = 1024;
export const MAX_OVG_WORK_UNITS = 250_000_000; // ovg_resource.go maxOVGWorkUnits
export const MAX_ROUTE_SEARCH_FLAVORS = 3;
export const MAX_ROUTE_SEARCH_WORK_UNITS = 120_000_000;
export const ROUTE_SEARCH_CONTEXT_CHECK_STRIDE = 1024;
export const MAX_SEARCH_WORK_UNITS = MAX_ROUTE_SEARCH_WORK_UNITS;
export const MAX_EDGE_ROUTING_STAGE_WORK_UNITS =
  MAX_OVG_WORK_UNITS + MAX_ROUTE_SEARCH_FLAVORS * MAX_ROUTE_SEARCH_WORK_UNITS + MAX_ROUTE_STAGE_WORK_UNITS;

const UINT64_MAX = (1n << 64n) - 1n;

/** Go `errors.New` sentinels; wrapped errors carry them in `cause`. */
export const errRouteStageWorkLimit = new Error('TALA route-stage work limit exceeded');
export const errRouteSearchWorkLimit = new Error('TALA route-search work limit exceeded');

/** Go errors.Is over the `cause` chain. */
export function errorIs(err, target) {
  for (let current = err; current != null; current = current.cause) {
    if (current === target) return true;
    if (typeof current !== 'object') return false;
  }
  return false;
}

/** fmt.Errorf("%w: <message>", sentinel). */
function wrapSentinel(sentinel, message) {
  return new Error(`${sentinel.message}: ${message}`, { cause: sentinel });
}

/** fmt.Errorf("<prefix>: %w", err). */
function wrapPrefix(prefix, err) {
  return new Error(`${prefix}: ${err.message ?? String(err)}`, { cause: err });
}

function requireCount(units) {
  if (typeof units === 'bigint') return Number(units);
  return units;
}

// ─── routeWorkGuard ──────────────────────────────────────────────────────────

/**
 * RouteWorkGuard is shared by every helper in a route stage. Methods throw
 * the error Go returns.
 */
export class RouteWorkGuard {
  constructor(ctx, location, limit) {
    this.ctx = ctx;
    this.done = contextDone(ctx);
    this.location = location;
    this.used = 0;
    this.limit = requireCount(limit);
    this.parallel = false;
  }

  step() {
    this.add(1);
  }

  add(units) {
    units = requireCount(units);
    if (this.used > this.limit || units > this.limit - this.used) {
      this.check();
      throw wrapSentinel(errRouteStageWorkLimit, `TALA ${this.location} work exceeds limit ${this.limit}`);
    }
    const previous = this.used;
    this.used += units;
    if (units === 0 || Math.floor(previous / ROUTE_STAGE_CONTEXT_CHECK_STRIDE) !== Math.floor(this.used / ROUTE_STAGE_CONTEXT_CHECK_STRIDE)) {
      this.check();
    }
  }

  enableParallel() {
    this.parallel = true;
  }

  check() {
    const err = cachedContextErr(this.ctx, this.done);
    if (err != null) throw wrapPrefix(this.location, err);
  }

  finish() {
    this.check();
  }

  /** Exported Step/Finish share the aggregate budget with layout kernels. */
  Step() {
    this.step();
  }

  Finish() {
    this.finish();
  }

  Used() {
    return this.used;
  }
}

/** newRouteWorkGuard: requires a context, then checks it once. */
export function newRouteWorkGuard(ctx, location, limit) {
  if (ctx == null) {
    throw new Error(`TALA ${location} requires a context`);
  }
  const guard = new RouteWorkGuard(ctx, location, limit);
  guard.check();
  return guard;
}

// ─── Context values ──────────────────────────────────────────────────────────

/**
 * A derived context carrying routing values. It forwards Err (identity
 * preserved), the request transaction guard, and Done-ness to its parent, as
 * Go's context.WithValue does.
 */
export class RouteValueContext {
  constructor(parent, key, value) {
    this._parent = parent;
    this._routeKey = key;
    this._routeValue = value;
    this._transactionWorkGuard = parent?._transactionWorkGuard ?? null;
    this.doneAvailable = Boolean(parent?.doneAvailable);
  }

  Err() {
    return this._parent.Err();
  }

  isCancelled() {
    if (typeof this._parent.isCancelled === 'function') return this._parent.isCancelled();
    return this._parent.Err() != null;
  }
}

/** ctx.Value(key) over RouteValueContext chains (and any `_parent` links). */
export function contextValue(ctx, key) {
  for (let current = ctx; current != null; current = current._parent) {
    if (current instanceof RouteValueContext && current._routeKey === key) {
      return current._routeValue;
    }
  }
  return null;
}

const ROUTE_AGGREGATE_WORK_KEY = Symbol('routeAggregateWork');
const ROUTE_SEARCH_TELEMETRY_KEY = Symbol('routeSearchTelemetry');

export function contextWithRouteAggregateWork(ctx, guard) {
  if (ctx == null || guard == null) return ctx;
  return new RouteValueContext(ctx, ROUTE_AGGREGATE_WORK_KEY, guard);
}

export function routeAggregateWorkFromContext(ctx) {
  if (ctx == null) return null;
  return contextValue(ctx, ROUTE_AGGREGATE_WORK_KEY);
}

// ─── Telemetry ───────────────────────────────────────────────────────────────

export class RouteSearchTelemetry {
  constructor() {
    this.samples = [];
  }

  record(guard, work) {
    if (guard.metricID < 0) {
      guard.metricID = this.samples.length;
      this.samples.push(work);
    } else {
      this.samples[guard.metricID] = work;
    }
  }

  snapshot() {
    return this.samples.slice();
  }
}

/** SearchTelemetry: per-flavor work samples for diagnostics and calibration. */
export class SearchTelemetry {
  constructor() {
    this.state = new RouteSearchTelemetry();
  }

  WorkSamples() {
    return this.state.snapshot();
  }
}

export function withRouteSearchTelemetry(ctx, telemetry) {
  return new RouteValueContext(ctx, ROUTE_SEARCH_TELEMETRY_KEY, telemetry);
}

export function WithSearchTelemetry(ctx, telemetry) {
  if (telemetry == null) return ctx;
  return withRouteSearchTelemetry(ctx, telemetry.state);
}

export function routeSearchTelemetryFromContext(ctx) {
  return contextValue(ctx, ROUTE_SEARCH_TELEMETRY_KEY);
}

// ─── routeSearchWorkGuard ────────────────────────────────────────────────────

function flavorWorkLimitError(guard) {
  return wrapSentinel(errRouteSearchWorkLimit, `TALA EdgeRouting flavor ${guard.flavor} work exceeds limit ${guard.limit}`);
}

export class RouteSearchWorkGuard {
  constructor(ctx, flavor, limit) {
    this.ctx = ctx;
    this.done = contextDone(ctx);
    this.flavor = flavor;
    this.used = 0;
    this.limit = requireCount(limit);
    this.metrics = routeSearchTelemetryFromContext(ctx);
    this.metricID = -1;
    this.aggregate = routeAggregateWorkFromContext(ctx);
    this.nextCheck = 0;
    this.deferAggregate = false;
    this.aggregateCharged = 0;
  }

  /** bind switches to the worker context (canceled when a sibling panics). */
  bind(ctx) {
    if (ctx == null) {
      throw new Error('TALA EdgeRouting requires a context');
    }
    this.ctx = ctx;
    this.done = contextDone(ctx);
    this.check();
    this.nextCheck = this.used + ROUTE_SEARCH_CONTEXT_CHECK_STRIDE;
  }

  step() {
    if (this.done == null || this.used >= this.nextCheck) {
      this.check();
      this.nextCheck = this.used + ROUTE_SEARCH_CONTEXT_CHECK_STRIDE;
    }
    if (this.used >= this.limit) {
      this.check();
      throw flavorWorkLimitError(this);
    }
    this.used++;
    if (this.deferAggregate || this.aggregate == null) return;
    this.aggregate.add(1);
  }

  add(units) {
    units = requireCount(units);
    if (this.used > this.limit || units > this.limit - this.used) {
      this.check();
      throw flavorWorkLimitError(this);
    }
    this.used += units;
    if (!this.deferAggregate && this.aggregate != null) {
      this.aggregate.add(units);
    }
    if (this.done == null || units === 0 || this.used >= this.nextCheck) {
      this.check();
      this.nextCheck = this.used + ROUTE_SEARCH_CONTEXT_CHECK_STRIDE;
    }
  }

  check() {
    const err = cachedContextErr(this.ctx, this.done);
    if (err != null) throw wrapPrefix('EdgeRouting', err);
  }

  reserveProduct(a, b) {
    const product = BigInt(a) * BigInt(b);
    if (product > UINT64_MAX) {
      this.check();
      throw wrapSentinel(errRouteSearchWorkLimit, 'route-search work arithmetic overflow');
    }
    this.add(product > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(product));
  }

  reserveSum(a, b) {
    const sum = BigInt(a) + BigInt(b);
    if (sum > UINT64_MAX) {
      this.check();
      throw wrapSentinel(errRouteSearchWorkLimit, 'route-search work arithmetic overflow');
    }
    this.add(sum > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(sum));
  }

  reserveSort(length) {
    if (length < 2) {
      this.step();
      return;
    }
    let levels = 0;
    for (let remaining = length - 1; remaining > 0; remaining = Math.floor(remaining / 2)) {
      levels++;
    }
    this.reserveProduct(length, levels);
  }

  finish() {
    if (this.metrics != null) {
      this.metrics.record(this, this.used);
    }
    if (this.deferAggregate && this.used !== this.aggregateCharged) {
      const pending = this.used - this.aggregateCharged;
      this.aggregate.add(pending);
      this.aggregateCharged = this.used;
    }
    this.check();
  }

  Used() {
    return this.used;
  }
}

/** newRouteSearchWorkGuard (route_search_guard.go). */
export function newRouteSearchWorkGuard(ctx, flavor, limit) {
  if (ctx == null) {
    throw new Error('TALA EdgeRouting requires a context');
  }
  const guard = new RouteSearchWorkGuard(ctx, flavor, limit);
  if (guard.aggregate instanceof RouteWorkGuard) {
    guard.aggregate.enableParallel();
    guard.deferAggregate = guard.aggregate.limit === MAX_EDGE_ROUTING_STAGE_WORK_UNITS && guard.limit === MAX_ROUTE_SEARCH_WORK_UNITS;
  }
  guard.check();
  guard.nextCheck = ROUTE_SEARCH_CONTEXT_CHECK_STRIDE;
  return guard;
}

/**
 * chargeSkippedRouteWork (work.go): charge `amount` units of skipped work.
 * Without a Done channel, or when the aggregate is charged per operation, it
 * steps unit by unit (each step may poll); otherwise it charges in bulk.
 */
export function chargeSkippedRouteWork(guard, amount) {
  if (guard == null || amount === 0) return;
  const search = guard instanceof RouteSearchWorkGuard ? guard : null;
  if (search == null || search.done == null || (search.aggregate != null && !search.deferAggregate)) {
    for (let i = 0; i < amount; i++) guard.step();
    return;
  }
  const units = amount;
  if (search.used >= search.limit) {
    search.step();
    return;
  }
  const remaining = search.limit - search.used;
  if (units > remaining) {
    search.add(remaining);
    search.step();
    return;
  }
  search.add(units);
}

// ─── Guarded ancestry helpers ────────────────────────────────────────────────

/** routeSearchIsDescendantOf: iterative ancestry walk, one step per level. */
export function routeSearchIsDescendantOf(guard, maybeDescendant, maybeAncestor) {
  for (;;) {
    guard.step();
    if (maybeAncestor === maybeDescendant) return true;
    if (maybeDescendant == null) return false;
    if (maybeDescendant.Container != null) {
      maybeDescendant = maybeDescendant.Container;
    } else if (maybeDescendant.Cluster != null) {
      maybeDescendant = maybeDescendant.Cluster.Vessel;
    } else if (maybeDescendant.Sequence != null) {
      maybeDescendant = maybeDescendant.Sequence.Vessel;
    } else {
      return maybeAncestor == null;
    }
  }
}

export function routeSearchHasFixedAncestor(guard, node) {
  for (let current = node; current != null; current = current.OwningContainer()) {
    guard.step();
    if (current.FixedTopLeft != null) return true;
  }
  return false;
}

/** fixedOverlapsForRoute → Set of nodes, matching fixedOverlapsFor with accounting. */
export function fixedOverlapsForRoute(nodes, guard) {
  const fixedNodes = [];
  for (const node of nodes) {
    guard.step();
    if (routeSearchHasFixedAncestor(guard, node)) fixedNodes.push(node);
  }
  const overlaps = new Set();
  for (const node of fixedNodes) {
    guard.step();
    if (overlaps.has(node)) continue;
    for (const other of nodes) {
      guard.step();
      const nodeBelowOther = routeSearchIsDescendantOf(guard, node, other);
      const otherBelowNode = routeSearchIsDescendantOf(guard, other, node);
      if (node === other || nodeBelowOther || otherBelowNode) continue;
      if (node.Box.overlaps(other.Box)) {
        overlaps.add(node);
        if (routeSearchHasFixedAncestor(guard, other)) overlaps.add(other);
        break;
      }
    }
  }
  guard.check();
  return overlaps;
}
