// Slice 47 — lib/label Position predicates that the shared
// js/src/graph/label-position.js does not provide.
//
// Pinned reference: lib/label/label.go (Position.IsOutside, IsUnlocked,
// IsOnEdge, Mirrored). Inputs are normalized with normalizeLabelPosition so a
// JS `null` (the Label default) behaves as Go's label.Unset.

import { LabelPosition as P, normalizeLabelPosition } from '../graph/label-position.js';

/** Position.IsOutside */
export function IsOutside(position) {
  switch (normalizeLabelPosition(position)) {
    case P.OutsideTopLeft: case P.OutsideTopCenter: case P.OutsideTopRight:
    case P.OutsideBottomLeft: case P.OutsideBottomCenter: case P.OutsideBottomRight:
    case P.OutsideLeftTop: case P.OutsideLeftMiddle: case P.OutsideLeftBottom:
    case P.OutsideRightTop: case P.OutsideRightMiddle: case P.OutsideRightBottom:
      return true;
    default:
      return false;
  }
}

/** Position.IsUnlocked */
export function IsUnlocked(position) {
  switch (normalizeLabelPosition(position)) {
    case P.UnlockedTop: case P.UnlockedMiddle: case P.UnlockedBottom:
      return true;
    default:
      return false;
  }
}

/** Position.IsOnEdge */
export function IsOnEdge(position) {
  switch (normalizeLabelPosition(position)) {
    case P.InsideMiddleLeft: case P.InsideMiddleCenter: case P.InsideMiddleRight: case P.UnlockedMiddle:
      return true;
    default:
      return false;
  }
}

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

/** Position.Mirrored; unknown positions mirror to Unset. */
export function Mirrored(position) {
  return MIRRORED.get(normalizeLabelPosition(position)) ?? P.Unset;
}
