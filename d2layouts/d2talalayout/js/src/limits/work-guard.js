import {
  CONTEXT_CHECK_STRIDE,
  CANCELLABLE_CONTEXT_CHECK_STRIDE,
  INT64_MIN,
  INT64_MAX,
} from "./constants.js";
import {
  WorkContext,
  abortSignalWorkContext,
} from "./work-context.js";

export { INT64_MIN, INT64_MAX };

/**
 * Cancellation error matching Go's context.Canceled wrapped with location.
 */
export class WorkCanceledError extends Error {
  constructor(location = "") {
    const loc = location ?? "";
    super(`${loc}: context canceled`);
    this.name = "AbortError";
    this.location = loc;
  }
}

/**
 * Work-limit error matching Go's exact message:
 * "TALA <location> work exceeds limit <limit>"
 */
export class WorkLimitError extends Error {
  constructor(location = "", limit = 0n) {
    const loc = location ?? "";
    const limitStr = typeof limit === "bigint" ? limit.toString() : String(limit);
    super(`TALA ${loc} work exceeds limit ${limitStr}`);
    this.name = "WorkLimitError";
    this.location = loc;
    this.limit = typeof limit === "bigint" ? limit : BigInt(limit);
  }
}

/**
 * Reports whether an error is a work cancellation error.
 */
export function isWorkCanceledError(error) {
  if (!error) return false;
  return error instanceof WorkCanceledError || error.name === "AbortError";
}

/**
 * Reports whether an error is a work limit error.
 */
export function isWorkLimitError(error) {
  if (!error) return false;
  return error instanceof WorkLimitError || error.name === "WorkLimitError";
}

function normalizeInt64Input(value, location, description) {
  let bi;
  if (typeof value === "bigint") {
    bi = value;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new TypeError(`TALA ${location} ${description} must be a safe integer or BigInt`);
    }
    bi = BigInt(value);
  } else {
    throw new TypeError(`TALA ${location} ${description} must be a safe integer or BigInt`);
  }

  if (bi < INT64_MIN || bi > INT64_MAX) {
    throw new TypeError(`TALA ${location} ${description} must fit signed int64`);
  }
  return bi;
}

function normalizeContext(ctx, location) {
  if (ctx == null) {
    throw new Error(`TALA ${location} requires a context`);
  }
  if (ctx instanceof WorkContext) {
    return ctx;
  }
  if (typeof ctx === "object") {
    if (typeof ctx.isCancelled === "function") {
      return ctx;
    }
    if (typeof ctx.aborted === "boolean") {
      return abortSignalWorkContext(ctx);
    }
  }
  throw new Error(`TALA ${location} requires a context`);
}

/**
 * WorkGuard accounts a complete operation's signed work units and polls its
 * context at a fixed stride.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/limits/work.go
 */
export class WorkGuard {
  constructor(ctx, location = "", limit = 0n) {
    const normCtx = normalizeContext(ctx, location);
    const normLimit = normalizeInt64Input(limit, location, "work limit");
    if (normLimit < 0n) {
      throw new Error(`TALA ${location} work limit must not be negative`);
    }

    this.ctx = normCtx;
    this.doneAvailable = Boolean(normCtx.doneAvailable);
    this.pollingStrideValue = this.doneAvailable
      ? CANCELLABLE_CONTEXT_CHECK_STRIDE
      : CONTEXT_CHECK_STRIDE;
    this.location = location ?? "";
    this.limit = normLimit;
    this.used = 0n;

    // Pinned Go order: immediately call Finish() to check cancellation before work starts
    this.Finish();
  }

  /**
   * Step charges one work unit.
   */
  Step() {
    this.used = BigInt.asIntN(64, this.used + 1n);
    if (this.used > this.limit) {
      throw new WorkLimitError(this.location, this.limit);
    }
    return this.checkAtStride();
  }

  step() {
    return this.Step();
  }

  /**
   * Add records multiple work units as one accounting operation.
   */
  Add(units) {
    const normUnits = normalizeInt64Input(units, this.location, "work charge");
    if (normUnits < 0n) {
      throw new Error(`TALA ${this.location} work charge must not be negative`);
    }

    if (normUnits > this.limit || this.used > this.limit - normUnits) {
      const previous = this.used;
      this.used = BigInt.asIntN(64, this.limit + 1n);
      const stride = this.pollingStride();
      if (previous <= this.limit && (previous / stride) !== (this.limit / stride)) {
        if (this.ctx.isCancelled()) {
          throw new WorkCanceledError(this.location);
        }
      }
      throw new WorkLimitError(this.location, this.limit);
    }

    const previous = this.used;
    this.used = BigInt.asIntN(64, this.used + normUnits);
    return this.checkAfterAdd(previous);
  }

  add(units) {
    return this.Add(units);
  }

  checkAfterAdd(previous) {
    const stride = this.pollingStride();
    // Add(0) polls an exact boundary; positive charges also poll when their
    // interval crosses one.
    if (this.used % stride !== 0n && (previous / stride) === (this.used / stride)) {
      return;
    }
    return this.Check();
  }

  checkAtStride() {
    const stride = this.pollingStride();
    if (this.used % stride !== 0n) {
      return;
    }
    return this.Check();
  }

  pollingStride() {
    return this.pollingStrideValue;
  }

  /**
   * Check observes cancellation immediately.
   */
  Check() {
    if (this.ctx.isCancelled()) {
      throw new WorkCanceledError(this.location);
    }
  }

  check() {
    return this.Check();
  }

  /**
   * Finish observes cancellation regardless of the current work count.
   */
  Finish() {
    return this.Check();
  }

  finish() {
    return this.Finish();
  }

  /**
   * SetLimit changes the ceiling without resetting already consumed work.
   */
  SetLimit(limit) {
    this.limit = normalizeInt64Input(limit, this.location, "work limit");
  }

  setLimit(limit) {
    this.SetLimit(limit);
  }

  /**
   * Used returns the number of charged or first-rejected work units.
   */
  Used() {
    return this.used;
  }

  usedCount() {
    return this.Used();
  }
}

/**
 * Constructs a new WorkGuard.
 */
export function newWorkGuard(ctx, location, limit) {
  return new WorkGuard(ctx, location, limit);
}

export const NewWorkGuard = newWorkGuard;
