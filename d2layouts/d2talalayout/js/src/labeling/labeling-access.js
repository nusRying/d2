// Slice 47 — layoutgraph accessors used by label placement that the shared
// js/src/graph/node.js / edge.js do not expose with Go semantics.
//
// Pinned references (d2layouts/d2talalayout/internal/layoutgraph):
//   labeling_access.go — LabelBoxesOverlap, LabelOverlapArea, IsClusterEdge
//   node.go            — boxesOverlapWithPadding, overlapArea,
//                        Node.LabelTopLeft, Node.IconSize
//   quality_api.go     — Node.IsImage
//
// These are free functions instead of Node/Edge methods because shared graph
// files are owned by earlier slices. They dereference geometry exactly where
// Go does, so a missing TopLeft throws (Go: nil-pointer panic) instead of the
// shared Node.doesOverlapCalc's tolerant `false`.

import { LABEL_PADDING, getPointOnBox } from '../graph/label-position.js';
import { MAX_ICON_SIZE } from '../graph/structural-access.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { IsOutside } from './label-position-ops.js';
import { LabelPosition, normalizeLabelPosition } from '../graph/label-position.js';

const defaultIconSize = 32.0; // node.go defaultIconSize
const imageType = 'Image'; // layoutgraph imageType = nodeshape.Image

/**
 * boxesOverlapWithPadding (node.go): interiors overlap, treating a gap
 * smaller than padding as overlap.
 */
export function boxesOverlapWithPadding(b1, b2, padding) {
  const b1Right = b1.TopLeft.X + b1.Width;
  const b2Right = b2.TopLeft.X + b2.Width;
  if (b1.TopLeft.X >= b2Right + padding || b2.TopLeft.X >= b1Right + padding) {
    return false;
  }
  const b1Bottom = b1.TopLeft.Y + b1.Height;
  const b2Bottom = b2.TopLeft.Y + b2.Height;
  return b1.TopLeft.Y < b2Bottom + padding && b2.TopLeft.Y < b1Bottom + padding;
}

/** Node.LabelBoxesOverlap → doesOverlapCalc(other, padding). */
export function LabelBoxesOverlap(node, other, padding) {
  return boxesOverlapWithPadding(node.Box, other.Box, padding);
}

/** Node.DoesOverlapExact with Go's nil-dereference behaviour. */
export function DoesOverlapExact(node, other) {
  return boxesOverlapWithPadding(node.Box, other.Box, 0);
}

// Go cmp.Less for float64: NaN orders before every non-NaN value.
function goFloatLess(x, y) {
  return (Number.isNaN(x) && !Number.isNaN(y)) || x < y;
}

// slices.Sort on four float64s: pdqsort falls back to insertionSortOrdered
// below 12 elements, which is stable for ties (-0 vs +0 keep their order).
function sortFloats(values) {
  for (let i = 1; i < values.length; i++) {
    for (let j = i; j > 0 && goFloatLess(values[j], values[j - 1]); j--) {
      const t = values[j];
      values[j] = values[j - 1];
      values[j - 1] = t;
    }
  }
}

/** Node.LabelOverlapArea → overlapArea (node.go). */
export function LabelOverlapArea(node, otherNode) {
  const xs = [];
  const ys = [];
  xs.push(node.TopLeft.X);
  xs.push(node.TopLeft.X + node.Width);
  ys.push(node.TopLeft.Y);
  ys.push(node.TopLeft.Y + node.Height);

  xs.push(otherNode.TopLeft.X);
  xs.push(otherNode.TopLeft.X + otherNode.Width);
  ys.push(otherNode.TopLeft.Y);
  ys.push(otherNode.TopLeft.Y + otherNode.Height);

  sortFloats(xs);
  sortFloats(ys);

  const width = xs[2] - xs[1];
  const height = ys[2] - ys[1];
  return width * height;
}

/** Edge.IsClusterEdge: edge != nil && (From.Cluster != nil || To.Cluster != nil). */
export function IsClusterEdge(edge) {
  return edge != null && (edge.From.Cluster != null || edge.To.Cluster != null);
}

/** Node.IsImage (quality_api.go). */
export function IsImage(node) {
  return node != null && node.shapeType() === imageType;
}

/** Node.LabelTopLeft (node.go): outside positions use the node box, others the inner box. */
export function NodeLabelTopLeft(node, labelPosition, width, height) {
  const box = IsOutside(labelPosition) ? node.Box : node.innerBox();
  return getPointOnBox(labelPosition, box, LABEL_PADDING, width, height);
}

/** Node.IconSize (node.go). */
export function IconSize(node, iconPosition) {
  const minDimension = goMin(node.Width, node.Height);
  let size;
  if (normalizeLabelPosition(iconPosition) === LabelPosition.InsideMiddleCenter) {
    size = 0.5 * minDimension;
  } else {
    size = goMin(minDimension, goMax(defaultIconSize, 0.5 * minDimension));
  }
  size = goMin(size, MAX_ICON_SIZE);

  if (!IsOutside(iconPosition)) {
    const box = node.innerBox();
    size = goMin(goMax(0, box.Width - 2 * LABEL_PADDING), size);
    size = goMin(goMax(0, box.Height - 2 * LABEL_PADDING), size);
  }
  return size;
}

/** Node.LoopOffsets[orientation]; a nil map (or missing key) reads as 0. */
export function loopOffset(node, orientation) {
  const offsets = node.LoopOffsets;
  if (offsets == null) return 0;
  if (offsets instanceof Map) return offsets.has(orientation) ? offsets.get(orientation) : 0;
  return offsets[orientation] ?? 0;
}

/**
 * LabelBoxFits reports whether outer completely contains inner.
 */
export function LabelBoxFits(outer, inner) {
  if (outer == null || inner == null || outer.TopLeft == null || inner.TopLeft == null) {
    return false;
  }
  return (
    inner.TopLeft.X >= outer.TopLeft.X &&
    inner.TopLeft.Y >= outer.TopLeft.Y &&
    inner.TopLeft.X + inner.Width <= outer.TopLeft.X + outer.Width &&
    inner.TopLeft.Y + inner.Height <= outer.TopLeft.Y + outer.Height
  );
}

/**
 * PadLabelCandidate expands (or shrinks, for a negative value) a temporary
 * node box by the same amount on every side.
 * Mutates the existing TopLeft Point without replacing the object reference.
 */
export function PadLabelCandidate(node, padding) {
  const pad = Number(padding);
  if (node.TopLeft != null) {
    node.TopLeft.X -= pad;
    node.TopLeft.Y -= pad;
  }
  node.Width += 2 * pad;
  node.Height += 2 * pad;
}
