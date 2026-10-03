// Slice 46 — private layoutgraph/invariant helpers needed by the hierarchy
// port that have no shared JS equivalent yet. They are deliberately local to
// js/src/hierarchy so the approved shared graph classes stay unchanged.
//
// Pinned references:
//   internal/invariant/invariant.go         (New, Errorf, ErrViolation)
//   internal/layoutgraph/node.go            (Node.transpose, Nodes.center)
//   internal/layoutgraph/hierarchy_access.go (Node.Transpose, Nodes.Center,
//                                            Nodes.BoundingBox)
//   internal/hierarchy/rank.go              (checkedSubInt64, checkedAddInt64,
//                                            checkedMulInt64)

import { Point } from '../geometry/point.js';
import { nodesBoundingBox } from '../graph/node-bounds.js';
import { INT64_MAX, INT64_MIN } from '../limits/constants.js';

import { OptimizationResourceLimitError } from '../limits/optimization.js';
import { WorkCanceledError, WorkLimitError } from '../limits/work-guard.js';

// JS has one throw channel for both Go returned errors and Go panics. Errors
// the hierarchy port would *return* in Go are tagged so a Go
// `if err != nil { return fmt.Errorf("...: %w", err) }` site can wrap exactly
// those and let anything else (a Go panic, e.g. one raised by a context's
// Err method) propagate unchanged.
const GO_RETURNED_ERROR = Symbol('hierarchy.goReturnedError');

/** An error the pinned Go code returns (rather than panics with). */
export function goError(message, options) {
  const err = options === undefined ? new Error(message) : new Error(message, options);
  err[GO_RETURNED_ERROR] = true;
  return err;
}

/** Reports whether err corresponds to a Go returned error. */
export function isGoReturnedError(err) {
  return err != null && (err[GO_RETURNED_ERROR] === true ||
    err instanceof OptimizationResourceLimitError ||
    err instanceof WorkCanceledError ||
    err instanceof WorkLimitError);
}

// invariant.ErrViolation.
export const ErrViolation = new Error('layout invariant violated');

/** invariant.New: "layout invariant violated: <reason>" wrapping ErrViolation. */
export function invariantNew(reason) {
  return goError(`layout invariant violated: ${reason}`, { cause: ErrViolation });
}

/** fmt.Errorf("<prefix>: %w", err). */
export function wrapError(prefix, err) {
  const message = err != null && err.message != null ? err.message : String(err);
  return goError(`${prefix}: ${message}`, { cause: err });
}

/** Go ctx.Err() for the engine's context shapes. */
export function contextErr(ctx) {
  if (ctx == null) return null;
  if (typeof ctx.Err === 'function') return ctx.Err();
  if (typeof ctx.isCancelled === 'function') {
    return ctx.isCancelled() ? new Error('context canceled') : null;
  }
  return null;
}

/**
 * Node.transpose (node.go): swaps the box axes, the top-left coordinates, and
 * the padding and margin sides. Like Go, padding and margin are not part of
 * GraphState snapshots.
 */
export function transposeNode(n) {
  const width = n.Width;
  n.Width = n.Height;
  n.Height = width;
  n.TopLeft.transpose();
  const padding = n._padding;
  if (padding != null) {
    const left = padding.left;
    padding.left = padding.top;
    padding.top = left;
    const right = padding.right;
    padding.right = padding.bottom;
    padding.bottom = right;
  }
  const margin = n._margin;
  if (margin != null) {
    const left = margin.left;
    margin.left = margin.top;
    margin.top = left;
    const right = margin.right;
    margin.right = margin.bottom;
    margin.bottom = right;
  }
}

/** Nodes.BoundingBox (rounded bounds) → [tl, br]. */
export function nodesBounds(nodes) {
  return nodesBoundingBox(nodes, true);
}

/** Nodes.Center. A nil TopLeft is a Go nil-pointer panic. */
export function nodesCenter(nodes) {
  const [tl, br] = nodesBoundingBox(nodes, true);
  if (tl == null) {
    throw new TypeError('runtime error: invalid memory address or nil pointer dereference');
  }
  return new Point(tl.X + (br.X - tl.X) / 2, tl.Y + (br.Y - tl.Y) / 2);
}

/** Go `copied := *label; &copied` (shallow struct copy). */
export function copyLabel(label) {
  return Object.assign(Object.create(Object.getPrototypeOf(label)), label);
}

// The rank solver's int64 arithmetic. Every quantity it touches is bounded by
// MaxEngineNodes/MaxEngineEdges and validated rank weights (<= 50_000), so
// values stay far below 2^53 and the Go int64 overflow branches are
// unreachable; the helpers still evaluate exact int64 bounds with BigInt if a
// result ever leaves the safe-integer range.
function checkedResult(number, exact) {
  if (Number.isSafeInteger(number)) return [number, true];
  const big = exact();
  if (big > INT64_MAX || big < INT64_MIN) return [0, false];
  throw new RangeError('hierarchy rank arithmetic exceeds the JS safe-integer range');
}

export function checkedSubInt64(a, b) {
  return checkedResult(a - b, () => BigInt(a) - BigInt(b));
}

export function checkedAddInt64(a, b) {
  return checkedResult(a + b, () => BigInt(a) + BigInt(b));
}

export function checkedMulInt64(a, b) {
  if (a === 0 || b === 0) return [0, true];
  return checkedResult(a * b, () => BigInt(a) * BigInt(b));
}

/** A WorkGuard stand-in for math/rand.Shuffle, which charges no work. */
export const NO_WORK_GUARD = Object.freeze({
  Step() {},
  step() {},
  Location() { return ''; },
});
