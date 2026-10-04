// Slice 47 — arrowhead label geometry.
//
// Pinned references:
//   d2layouts/d2talalayout/internal/labeling/arrowhead.go  — PositionedArrowheadLabel, PositionArrowheadLabel
//   d2layouts/d2talalayout/internal/labelgeom/arrowhead.go — ArrowheadTopLeft
//   d2target/d2target.go — BaseConnection (StrokeWidth 2), Connection.GetArrowheadLabelPosition,
//                          Arrowhead.Dimensions, MIN_ARROWHEAD_STROKE_WIDTH, ARROWHEAD_PADDING
//
// js/src/graph/edge.js carries a private copy of the same renderer geometry
// for Edge.boundingBoxValues; it is not exported, so the renderer port lives
// here for the labeling/routing domains.

import { Box } from '../geometry/box.js';
import { goMax } from '../geometry/go-math.js';
import { LABEL_PADDING, LabelPosition, getPointOnRoute, getUnitNormalVector, routeLength } from '../graph/label-position.js';

const NO_ARROWHEAD = 'none'; // d2target.NoArrowhead
const MIN_ARROWHEAD_STROKE_WIDTH = 2; // d2target.MIN_ARROWHEAD_STROKE_WIDTH
const ARROWHEAD_PADDING = 2.0; // d2target.ARROWHEAD_PADDING
const BASE_CONNECTION_STROKE_WIDTH = 2; // d2target.BaseConnection().StrokeWidth

const TWO_POW_63 = 9223372036854775808;

/**
 * goIntOfFloat models Go's int(float64) conversion on amd64 (CVTTSD2SI):
 * truncation toward zero, and the "integer indefinite" MinInt64 for NaN,
 * infinities and out-of-range values. Other architectures saturate instead;
 * the oracle avoids those inputs.
 */
function goIntOfFloat(value) {
  if (!(value >= -TWO_POW_63 && value < TWO_POW_63)) {
    return -TWO_POW_63;
  }
  return Math.trunc(value) + 0;
}

/** d2target.Arrowhead.Dimensions(strokeWidth). Unknown arrowheads have zero base and multipliers. */
export function arrowheadDimensions(arrowhead, strokeWidth) {
  let baseWidth = 0;
  let baseHeight = 0;
  let widthMultiplier = 0;
  let heightMultiplier = 0;
  switch (arrowhead) {
    case 'arrow':
      baseWidth = 4; baseHeight = 4; widthMultiplier = 4; heightMultiplier = 4;
      break;
    case 'triangle':
      baseWidth = 4; baseHeight = 4; widthMultiplier = 3; heightMultiplier = 4;
      break;
    case 'unfilled-triangle':
      baseWidth = 7; baseHeight = 7; widthMultiplier = 3; heightMultiplier = 4;
      break;
    case 'line':
      widthMultiplier = 5; heightMultiplier = 8;
      break;
    case 'filled-diamond':
      baseWidth = 11; baseHeight = 7; widthMultiplier = 5.5; heightMultiplier = 3.5;
      break;
    case 'diamond':
      baseWidth = 11; baseHeight = 9; widthMultiplier = 5.5; heightMultiplier = 4.5;
      break;
    case 'cross':
      baseWidth = 7; baseHeight = 7; widthMultiplier = 5; heightMultiplier = 5;
      break;
    case 'filled-circle':
    case 'circle':
      baseWidth = 8; baseHeight = 8; widthMultiplier = 5; heightMultiplier = 5;
      break;
    case 'filled-box':
    case 'box':
      baseWidth = 6; baseHeight = 6; widthMultiplier = 5; heightMultiplier = 5;
      break;
    case 'cf-one':
    case 'cf-many':
    case 'cf-one-required':
    case 'cf-many-required':
      baseWidth = 9; baseHeight = 9; widthMultiplier = 4.5; heightMultiplier = 4.5;
      break;
    default:
      break;
  }
  const clippedStrokeWidth = goMax(MIN_ARROWHEAD_STROKE_WIDTH, strokeWidth);
  return [baseWidth + clippedStrokeWidth * widthMultiplier, baseHeight + clippedStrokeWidth * heightMultiplier];
}

/**
 * ArrowheadTopLeft returns the renderer-compatible top-left position for an
 * arrowhead label (labelgeom.ArrowheadTopLeft → d2target
 * Connection.GetArrowheadLabelPosition). Dimensions are truncated to Go ints
 * exactly like d2target.Text{LabelWidth: int(width)}.
 */
export function ArrowheadTopLeft(route, isTarget, sourceArrowhead, targetArrowhead, width, height) {
  const labelWidth = goIntOfFloat(width);
  const labelHeight = goIntOfFloat(height);

  let index = 0;
  if (isTarget) {
    index = route.length - 2;
  }
  if (index < 0 || index + 1 >= route.length) {
    // Go: connection.Route[index] / [index+1] panics with an index error.
    if (index < 0) {
      throw new RangeError(`runtime error: index out of range [${index}]`);
    }
    const bad = index >= route.length ? index : index + 1;
    throw new RangeError(`runtime error: index out of range [${bad}] with length ${route.length}`);
  }
  const start = route[index];
  const end = route[index + 1];
  // Note: end to start to get normal towards unlocked top position
  const [normalX, normalY] = getUnitNormalVector(end.X, end.Y, start.X, start.Y);

  const shift = Math.abs(normalX) * (labelHeight / 2 + LABEL_PADDING) +
    Math.abs(normalY) * (labelWidth / 2 + LABEL_PADDING);

  const length = routeLength(route);
  let position;
  if (isTarget) {
    position = 1;
    if (length > 0) {
      position -= shift / length;
    }
  } else {
    position = 0;
    if (length > 0) {
      position = shift / length;
    }
  }

  const strokeWidth = BASE_CONNECTION_STROKE_WIDTH;
  const [labelTL] = getPointOnRoute(LabelPosition.UnlockedTop, route, strokeWidth, position, labelWidth, labelHeight);

  let arrowSize = 0;
  if (isTarget && targetArrowhead !== NO_ARROWHEAD) {
    [, arrowSize] = arrowheadDimensions(targetArrowhead, strokeWidth);
  } else if (sourceArrowhead !== NO_ARROWHEAD) {
    [, arrowSize] = arrowheadDimensions(sourceArrowhead, strokeWidth);
  }

  if (arrowSize > 0) {
    const offset = (arrowSize / 2 + ARROWHEAD_PADDING) - strokeWidth / 2 - LABEL_PADDING;
    if (offset > 0) {
      labelTL.X += normalX * offset;
      labelTL.Y += normalY * offset;
    }
  }
  return labelTL;
}

/**
 * PositionedArrowheadLabel is the rendered box reserved beside one end of an
 * edge route. Go embeds geo.Box; the box is exposed as `Box` with promoted
 * TopLeft/Width/Height accessors.
 */
export class PositionedArrowheadLabel {
  constructor(box, edge, isTarget, text) {
    this.Box = box;
    this.Edge = edge;
    this.IsTarget = isTarget;
    this.Text = text;
  }

  get TopLeft() { return this.Box.TopLeft; }
  set TopLeft(value) { this.Box.TopLeft = value; }
  get Width() { return this.Box.Width; }
  set Width(value) { this.Box.Width = value; }
  get Height() { return this.Box.Height; }
  set Height(value) { this.Box.Height = value; }
}

/**
 * PositionArrowheadLabel derives the renderer-compatible label box for one
 * arrowhead. A null result means that endpoint has no arrowhead label.
 */
export function PositionArrowheadLabel(edge, isTarget, route) {
  if (edge == null) {
    return null;
  }
  let value = edge.SourceArrowheadLabel;
  if (isTarget) {
    value = edge.TargetArrowheadLabel;
  }
  if (value == null) {
    return null;
  }
  const topLeft = ArrowheadTopLeft(
    route,
    isTarget,
    String(edge.SourceArrowhead ?? ''),
    String(edge.TargetArrowhead ?? ''),
    value.Width,
    value.Height,
  );
  return new PositionedArrowheadLabel(new Box(topLeft, value.Width, value.Height), edge, isTarget, value.Text);
}
