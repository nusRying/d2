import { ClusterArrangement } from "../graph/cluster.js";

/**
 * LayoutAxis represents orientation axes in placement.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/axis.go
 */
export const LayoutAxis = Object.freeze({
  Invalid: 0,
  Horizontal: 1,
  Vertical: 2,
});

/**
 * TraversalDirection represents traversal orientation along an axis.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/axis.go
 */
export const TraversalDirection = Object.freeze({
  Invalid: 0,
  Forward: 1,
  Backward: 2,
});

/**
 * axisValid reports whether the axis is valid (Horizontal or Vertical).
 *
 * @param {number} axis
 * @returns {boolean}
 */
export function axisValid(axis) {
  return axis === LayoutAxis.Horizontal || axis === LayoutAxis.Vertical;
}

/**
 * axisIsHorizontal reports whether the axis is Horizontal.
 *
 * @param {number} axis
 * @returns {boolean}
 */
export function axisIsHorizontal(axis) {
  return axis === LayoutAxis.Horizontal;
}

/**
 * oppositeAxis returns the orthogonal axis, or Invalid if axis is not valid.
 *
 * @param {number} axis
 * @returns {number}
 */
export function oppositeAxis(axis) {
  switch (axis) {
    case LayoutAxis.Horizontal:
      return LayoutAxis.Vertical;
    case LayoutAxis.Vertical:
      return LayoutAxis.Horizontal;
    default:
      return LayoutAxis.Invalid;
  }
}

/**
 * axisForArrangement maps cluster arrangement to layout axis.
 * Pinned Go behavior: Column -> Horizontal; everything else (Row, "", unknown) -> Vertical.
 *
 * @param {string} arrangement
 * @returns {number}
 */
export function axisForArrangement(arrangement) {
  if (arrangement === ClusterArrangement.Column || arrangement === "column" || arrangement === "Column") {
    return LayoutAxis.Horizontal;
  }
  return LayoutAxis.Vertical;
}

/**
 * directionValid reports whether the direction is valid (Forward or Backward).
 *
 * @param {number} direction
 * @returns {boolean}
 */
export function directionValid(direction) {
  return direction === TraversalDirection.Forward || direction === TraversalDirection.Backward;
}

/**
 * directionIsForward reports whether the direction is Forward.
 *
 * @param {number} direction
 * @returns {boolean}
 */
export function directionIsForward(direction) {
  return direction === TraversalDirection.Forward;
}

/**
 * oppositeDirection returns the reverse direction, or Invalid if direction is not valid.
 *
 * @param {number} direction
 * @returns {number}
 */
export function oppositeDirection(direction) {
  switch (direction) {
    case TraversalDirection.Forward:
      return TraversalDirection.Backward;
    case TraversalDirection.Backward:
      return TraversalDirection.Forward;
    default:
      return TraversalDirection.Invalid;
  }
}
