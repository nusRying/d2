/**
 * Private layoutgraph/lib helpers needed by the trees port that have no
 * shared JS equivalent yet.
 *
 * Pinned Go authority: f41494e0a162655cb142f9c7b0589129a130cfdd
 *   - internal/invariant/invariant.go (New / Errorf message format)
 *   - lib/label/label.go (Position.Mirrored)
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { LabelPosition } from '../graph/label-position.js';

/**
 * invariant.Errorf: "layout invariant violated: <reason>".
 * Go wraps the ErrViolation sentinel; JS callers only observe the message.
 */
export function invariantError(reason) {
  return new Error(`layout invariant violated: ${reason}`);
}

const P = LabelPosition;

const MIRRORED = new Map([
  [P.OutsideTopLeft, P.OutsideBottomRight],
  [P.OutsideTopCenter, P.OutsideBottomCenter],
  [P.OutsideTopRight, P.OutsideBottomLeft],

  [P.OutsideLeftTop, P.OutsideRightBottom],
  [P.OutsideLeftMiddle, P.OutsideRightMiddle],
  [P.OutsideLeftBottom, P.OutsideRightTop],

  [P.OutsideRightTop, P.OutsideLeftBottom],
  [P.OutsideRightMiddle, P.OutsideLeftMiddle],
  [P.OutsideRightBottom, P.OutsideLeftTop],

  [P.OutsideBottomLeft, P.OutsideTopRight],
  [P.OutsideBottomCenter, P.OutsideTopCenter],
  [P.OutsideBottomRight, P.OutsideTopLeft],

  [P.InsideTopLeft, P.InsideBottomRight],
  [P.InsideTopCenter, P.InsideBottomCenter],
  [P.InsideTopRight, P.InsideBottomLeft],

  [P.InsideMiddleLeft, P.InsideMiddleRight],
  [P.InsideMiddleCenter, P.InsideMiddleCenter],
  [P.InsideMiddleRight, P.InsideMiddleLeft],

  [P.InsideBottomLeft, P.InsideTopRight],
  [P.InsideBottomCenter, P.InsideTopCenter],
  [P.InsideBottomRight, P.InsideTopLeft],

  [P.BorderTopLeft, P.BorderBottomRight],
  [P.BorderTopCenter, P.BorderBottomCenter],
  [P.BorderTopRight, P.BorderBottomLeft],

  [P.BorderLeftTop, P.BorderRightBottom],
  [P.BorderLeftMiddle, P.BorderRightMiddle],
  [P.BorderLeftBottom, P.BorderRightTop],

  [P.BorderRightTop, P.BorderLeftBottom],
  [P.BorderRightMiddle, P.BorderLeftMiddle],
  [P.BorderRightBottom, P.BorderLeftTop],

  [P.BorderBottomLeft, P.BorderTopRight],
  [P.BorderBottomCenter, P.BorderTopCenter],
  [P.BorderBottomRight, P.BorderTopLeft],

  [P.UnlockedTop, P.UnlockedBottom],
  [P.UnlockedBottom, P.UnlockedTop],
  [P.UnlockedMiddle, P.UnlockedMiddle],
]);

/** label.Position.Mirrored; every unlisted position (including Unset) → Unset. */
export function mirroredLabelPosition(position) {
  const mirrored = MIRRORED.get(position);
  return mirrored === undefined ? P.Unset : mirrored;
}
