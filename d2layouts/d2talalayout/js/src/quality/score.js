// Port of internal/quality/score.go
import { EvaluateWithArea } from './scoring.js';

export function finite(value) {
  return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value);
}

export function compareNumber(left, right, nonnegative) {
  const leftValid = finite(left) && (!nonnegative || left >= 0);
  const rightValid = finite(right) && (!nonnegative || right >= 0);
  if (leftValid && !rightValid) {
    return -1;
  }
  if (!leftValid && rightValid) {
    return 1;
  }
  if (!leftValid) {
    return 0;
  }
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Score preserves the original TALA penalty and separate area tie-breaker.
 * Diagnostic geometry from Inspect is deliberately absent from this ordering.
 */
export class Score {
  constructor(penalty = 0, area = 0) {
    this.Penalty = penalty;
    this.Area = area;
  }

  /**
   * Compare orders penalties exactly, then areas, with the same handling of
   * non-finite values as the original seed-result comparator.
   */
  Compare(other) {
    const comparison = compareNumber(this.Penalty, other.Penalty, false);
    if (comparison !== 0) {
      return comparison;
    }
    return compareNumber(this.Area, other.Area, true);
  }

  compare(other) {
    return this.Compare(other);
  }
}

/**
 * Evaluate adapts the original evaluator for bounded refinement callers.
 */
export function Evaluate(ctx, graph) {
  const res = EvaluateWithArea(ctx, graph);
  return new Score(res.penalty, res.area);
}
