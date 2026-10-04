// Slice 50 — deterministic multi-seed coordination and selection.
//
// Pinned reference: d2layouts/d2talalayout/layout.go (runLocalSeed,
// coordinateLocalSeeds, considerSeedCandidate, refineSeedResult).
//
// Go runs seeds on up to MaxConcurrency goroutines. The JS engine is
// synchronous CPU code, so attempts may be executed sequentially; the
// coordinator nevertheless accepts asynchronous attempt functions (tests inject
// out-of-order completions) and its selection is independent of completion
// order: the lowest Score wins and an exact Score tie goes to the LATER
// configured seed index.

import { getContextError } from '../limits/work-context.js';
import { runSeed } from './seed.js';
import { evaluateSeedResult } from './result.js';

export const INTERNAL_INVARIANT_SEED_MESSAGE = 'TALA seed layout failed due to an internal invariant';

export class SeedAttempt {
  constructor(index, seed) {
    this.index = index;
    this.seed = seed;
    this.result = null;
    this.error = null;
  }
}

/**
 * isPanicLike reports whether a thrown value corresponds to a Go panic rather
 * than a returned error: non-Error values and JS runtime faults.
 */
export function isPanicLike(thrown) {
  if (!(thrown instanceof Error)) return true;
  return thrown instanceof TypeError || thrown instanceof RangeError || thrown instanceof ReferenceError;
}

/** runLocalSeed: run + evaluate one seed; panics become a stable invariant error. */
export function runLocalSeed(ctx, input, index, seed) {
  const attempt = new SeedAttempt(index, seed);
  try {
    const laidOut = runSeed(ctx, input, seed);
    attempt.result = evaluateSeedResult(ctx, input, laidOut);
  } catch (err) {
    attempt.result = null;
    attempt.error = isPanicLike(err) ? new Error(INTERNAL_INVARIANT_SEED_MESSAGE, { cause: err }) : err;
  }
  return attempt;
}

/** errors.Join of the non-nil errors, newline separated; null if none. */
function joinErrors(errors) {
  const present = errors.filter((err) => err != null);
  if (present.length === 0) return null;
  const joined = new Error(present.map((err) => err.message).join('\n'));
  joined.errors = present;
  return joined;
}

/**
 * coordinateLocalSeeds runs `run(index, seed)` exactly once per configured
 * seed with at most `concurrency` attempts in flight and selects the winner.
 */
export async function coordinateLocalSeeds(ctx, seeds, concurrency, run) {
  if (seeds == null || seeds.length === 0) {
    throw new Error('tala requires at least one seed');
  }
  if (!(concurrency >= 1)) {
    throw new Error('tala seed concurrency must be positive');
  }
  if (concurrency > seeds.length) concurrency = seeds.length;

  let nextJob = 0;
  const settled = [];
  const worker = async () => {
    while (nextJob < seeds.length) {
      const index = nextJob++;
      settled.push(await run(index, seeds[index]));
    }
  };
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  let bestIndex = -1;
  let best = null;
  const attemptErrors = new Array(seeds.length).fill(null);
  for (const attempt of settled) {
    if (attempt.error != null) {
      attemptErrors[attempt.index] = new Error(`seed ${attempt.seed}: ${attempt.error.message}`, { cause: attempt.error });
      continue;
    }
    const comparison = bestIndex >= 0 ? attempt.result.score.Compare(best.score) : 0;
    if (bestIndex < 0 || comparison < 0 || (comparison === 0 && attempt.index > bestIndex)) {
      bestIndex = attempt.index;
      best = attempt.result;
    }
  }

  const ctxErr = getContextError(ctx);
  if (ctxErr != null) {
    throw new Error(`tala layout stopped before all seeds completed: ${ctxErr.message}`, { cause: ctxErr });
  }
  if (bestIndex < 0) {
    const joined = joinErrors(attemptErrors);
    if (joined == null) {
      throw new Error('no TALA seed produced a layout');
    }
    throw new Error(`all TALA seed attempts failed: ${joined.message}`, { cause: joined });
  }
  return best;
}

export function runLocalSeeds(ctx, input, seeds, concurrency) {
  return coordinateLocalSeeds(ctx, seeds, concurrency, (index, seed) => runLocalSeed(ctx, input, index, seed));
}

function isContextTermination(err) {
  for (let current = err; current != null; current = current.cause) {
    if (typeof current !== 'object') return false;
    if (current.message === 'context canceled' || current.message === 'context deadline exceeded' || current.name === 'AbortError') {
      return true;
    }
  }
  return false;
}

/**
 * refineSeedResult builds an optional candidate. Ordinary errors and throws
 * keep the incumbent; cancellation errors propagate; a canceled context always
 * wins after the build.
 */
export function refineSeedResult(ctx, incumbent, build) {
  let selected = incumbent;
  let error = null;
  try {
    selected = build();
  } catch (err) {
    selected = incumbent;
    if (err instanceof Error && !isPanicLike(err) && isContextTermination(err)) {
      error = err;
    }
  }
  const contextErr = getContextError(ctx);
  if (contextErr != null) error = contextErr;
  if (error != null) throw error;
  return selected;
}

/** considerSeedCandidate accepts only a STRICT score improvement. */
export function considerSeedCandidate(ctx, incumbent, build) {
  const candidate = refineSeedResult(ctx, incumbent, build);
  if (candidate.score.Compare(incumbent.score) < 0) {
    return candidate;
  }
  return incumbent;
}
