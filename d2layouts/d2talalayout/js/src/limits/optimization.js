import {
  MAX_OPTIMIZATION_WORK_UNITS,
  OPTIMIZATION_CONTEXT_CHECK_STRIDE,
} from "./constants.js";
import {
  WorkContext,
  abortSignalWorkContext,
  canonicalContext,
} from "./work-context.js";
import {
  WorkCanceledError,
} from "./work-guard.js";

export const MAX_UINT64 = 0xffffffffffffffffn;

/**
 * OptimizationResourceLimitError reports exhausted or overflowing optimization
 * work accounting.
 *
 * Pinned reference: internal/limits/optimization.go ErrOptimizationResourceLimit
 */
export class OptimizationResourceLimitError extends Error {
  constructor(message) {
    const fullMessage = message.startsWith("TALA optimization resource limit exceeded")
      ? message
      : `TALA optimization resource limit exceeded: ${message}`;
    super(fullMessage);
    this.name = "OptimizationResourceLimitError";
  }
}

/**
 * Reports whether an error represents optimization resource limit exhaustion.
 */
export function isOptimizationResourceLimitError(error) {
  if (!error) return false;
  return (
    error instanceof OptimizationResourceLimitError ||
    error.name === "OptimizationResourceLimitError" ||
    (typeof error.message === "string" &&
      error.message.includes("TALA optimization resource limit exceeded"))
  );
}

function normalizeContext(ctx, location) {
  return canonicalContext(ctx, location);
}

/**
 * len64 returns the minimum number of bits required to represent value.
 * Pinned reference: math/bits.Len64
 */
export function len64(value) {
  const bi = typeof value === "bigint" ? value : BigInt(value);
  if (bi <= 0n) return 0n;
  return BigInt(bi.toString(2).length);
}

/**
 * OptimizationWorkGuard accounts one complete hierarchy or placement
 * optimization. The limit is an explicit ceiling; zero permits cancellation
 * checks but no charged work.
 *
 * Pinned reference: internal/limits/optimization.go OptimizationWorkGuard
 */
export class OptimizationWorkGuard {
  constructor(ctx, location = "", limit = MAX_OPTIMIZATION_WORK_UNITS) {
    if (ctx == null) {
      throw new Error(`TALA ${location} requires a context`);
    }
    this.ctx = normalizeContext(ctx, location);
    this.location = location ?? "";
    const normLimit = typeof limit === "bigint" ? limit : BigInt(limit);
    if (normLimit < 0n || normLimit > MAX_UINT64) {
      throw new OptimizationResourceLimitError(
        `TALA optimization resource limit exceeded: ${this.location} work arithmetic overflow`
      );
    }
    this.limit = normLimit;
    this.used = 0n;

    // Pinned Go order: Finish() is called immediately in constructor
    this.Finish();
  }

  Step() {
    return this.Add(1n);
  }

  step() {
    return this.Step();
  }

  Add(amount) {
    const amt = typeof amount === "bigint" ? amount : BigInt(amount);
    if (amt === 0n) {
      return this.Check();
    }
    if (amt < 0n || amt > MAX_UINT64 || MAX_UINT64 - this.used < amt) {
      throw new OptimizationResourceLimitError(
        `TALA optimization resource limit exceeded: ${this.location} work arithmetic overflow`
      );
    }
    const previous = this.used;
    const next = previous + amt;
    if (next > this.limit) {
      throw new OptimizationResourceLimitError(
        `TALA optimization resource limit exceeded: TALA ${this.location} work exceeds limit ${this.limit}`
      );
    }
    this.used = next;
    if (
      previous / OPTIMIZATION_CONTEXT_CHECK_STRIDE !==
      next / OPTIMIZATION_CONTEXT_CHECK_STRIDE
    ) {
      return this.Check();
    }
  }

  add(amount) {
    return this.Add(amount);
  }

  AddProduct(a, b) {
    const aBi = typeof a === "bigint" ? a : BigInt(a);
    const bBi = typeof b === "bigint" ? b : BigInt(b);
    if (aBi < 0n || bBi < 0n) {
      throw new OptimizationResourceLimitError(
        `TALA optimization resource limit exceeded: ${this.location} work arithmetic overflow`
      );
    }
    if (aBi !== 0n && bBi > MAX_UINT64 / aBi) {
      throw new OptimizationResourceLimitError(
        `TALA optimization resource limit exceeded: ${this.location} work arithmetic overflow`
      );
    }
    return this.Add(aBi * bBi);
  }

  addProduct(a, b) {
    return this.AddProduct(a, b);
  }

  AddSort(length) {
    const len = typeof length === "bigint" ? length : BigInt(length);
    if (len <= 1n) {
      return this.Check();
    }
    return this.AddProduct(len, len64(len - 1n));
  }

  addSort(length) {
    return this.AddSort(length);
  }

  Check() {
    const err = this.ctx.Err();
    if (err != null) {
      throw new WorkCanceledError(this.location, err);
    }
  }

  check() {
    return this.Check();
  }

  Finish() {
    return this.Check();
  }

  finish() {
    return this.Finish();
  }

  Location() {
    return this.location;
  }

  location() {
    return this.location;
  }

  Used() {
    return this.used;
  }

  used() {
    return this.used;
  }
}

export function newOptimizationWorkGuard(ctx, location, limit) {
  return new OptimizationWorkGuard(ctx, location, limit);
}

export const NewOptimizationWorkGuard = newOptimizationWorkGuard;

/**
 * shuffleIndex draws a pseudo-random index in [0, n) using Lemire's reduction
 * with rejection sampling, charging one Step for each draw attempt.
 *
 * Pinned reference: internal/limits/optimization.go shuffleIndex
 */
export function shuffleIndex(random, n, guard) {
  guard.Step();
  let v = BigInt(random.Uint32());
  const nBig = BigInt(n);
  let product = v * nBig;
  let low = Number(BigInt.asUintN(32, product));
  const nUint = Number(BigInt.asUintN(32, nBig));
  if (low < nUint) {
    const threshold = Number(
      BigInt.asUintN(32, -nBig) % BigInt.asUintN(32, nBig)
    );
    while (low < threshold) {
      guard.Step();
      v = BigInt(random.Uint32());
      product = v * nBig;
      low = Number(BigInt.asUintN(32, product));
    }
  }
  return Number(product >> 32n);
}

/**
 * Shuffle reproduces math/rand.Shuffle's Fisher-Yates implementation with a guard
 * check before every random draw. Its reduction algorithm and draw order are
 * intentionally identical so seeded layout output remains stable.
 *
 * Pinned reference: internal/limits/optimization.go Shuffle
 */
export function shuffle(values, random, guard) {
  if (random == null) {
    throw new Error(
      `TALA ${guard ? guard.Location() : ""} shuffle requires a random generator`
    );
  }
  let i = values.length - 1;
  const largeLimit = 2147483646; // (1 << 31) - 2 in Go
  for (; i > largeLimit; i--) {
    guard.Step();
    const j = Number(random.Int63n(BigInt(i + 1)));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  for (; i > 0; i--) {
    const j = shuffleIndex(random, i + 1, guard);
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
}

export const Shuffle = shuffle;
