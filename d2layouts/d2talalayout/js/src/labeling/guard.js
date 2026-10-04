// Slice 47 — label-placement work guard, snapshot/restore and the overlap
// kernels shared by labeling.PlaceNewEdges and labeling.Place.
//
// Pinned reference: d2layouts/d2talalayout/internal/labeling/guard.go
//
// Deferred to Slice 49 (used only by labeling.Place): partialNodeOverlapCount,
// collectLabelPlacementAncestors.
//
// Go returns errors; every function here throws the same error instead.
// Work counters are JS Numbers: the production limit (50,000,000) is far below
// 2^53 and add() rejects a charge before adding it, so used <= limit holds.

import { Point } from '../geometry/point.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { goRound } from '../geometry/math.js';
import { Orientation } from '../geometry/orientation.js';
import { LABEL_PADDING } from '../graph/label-position.js';
import { Node } from '../graph/node.js';
import { MAX_ICON_SIZE } from '../graph/structural-access.js';
import { MAX_LABEL_PLACEMENT_WORK_UNITS, MAX_TOPOLOGY_DEPTH } from '../limits/constants.js';
import { getContextError } from '../limits/work-context.js';
import { PositionArrowheadLabel } from './arrowhead.js';
import { IsOutside } from './label-position-ops.js';
import {
  DoesOverlapExact,
  IsImage,
  LabelBoxesOverlap,
  LabelOverlapArea,
  NodeLabelTopLeft,
  loopOffset,
} from './labeling-access.js';

// Label placement is intentionally bounded independently of adapter input
// validation.
export const maxLabelPlacementWorkUnits = Number(MAX_LABEL_PLACEMENT_WORK_UNITS);
export const maxLabelPlacementAncestryDepth = MAX_TOPOLOGY_DEPTH;
export const labelPlacementContextCheckStride = 64;

/** ctx.Err() for Err-bearing contexts; AbortSignal-like contexts via getContextError. */
export function contextErr(ctx) {
  if (typeof ctx.Err === 'function') {
    return ctx.Err();
  }
  return getContextError(ctx);
}

/** fmt.Errorf("%s: %w", location, err). */
export function wrapContextError(location, err) {
  return new Error(`${location}: ${err?.message ?? String(err)}`, { cause: err });
}

/**
 * LabelPlacementWorkGuard (Go labelPlacementWorkGuard) makes every unit of
 * quadratic/candidate work both cancellable and bounded.
 */
export class LabelPlacementWorkGuard {
  constructor(ctx, location, limit) {
    this.ctx = ctx;
    this.location = location;
    this.used = 0;
    this.limit = limit;
  }

  step() {
    this.add(1);
  }

  add(units) {
    if (units < 0) {
      throw new Error(`TALA ${this.location} received a negative work estimate`);
    }
    // Written this way rather than used+units > limit so the calculation cannot
    // wrap before the comparison.
    if (this.used < 0 || this.used > this.limit || units > this.limit - this.used) {
      // Preserve cancellation as the primary failure when it races the budget
      // boundary.
      this.check();
      throw new Error(`TALA ${this.location} work exceeds limit ${this.limit}`);
    }
    const previous = this.used;
    this.used += units;
    if (units === 0 ||
      Math.floor(previous / labelPlacementContextCheckStride) !== Math.floor(this.used / labelPlacementContextCheckStride)) {
      this.check();
    }
  }

  check() {
    const err = contextErr(this.ctx);
    if (err != null) {
      throw wrapContextError(this.location, err);
    }
  }
}

function normalizeLimit(limit) {
  return typeof limit === 'bigint' ? Number(limit) : limit;
}

/** newLabelPlacementWorkGuard */
export function newLabelPlacementWorkGuard(ctx, location, limit) {
  if (ctx == null) {
    throw new Error(`TALA ${location} requires a context`);
  }
  const normalized = normalizeLimit(limit);
  if (normalized < 0) {
    throw new Error(`TALA ${location} work limit must not be negative`);
  }
  const guard = new LabelPlacementWorkGuard(ctx, location, normalized);
  guard.check();
  return guard;
}

export class LabelPositionSnapshot {
  constructor(label, position) {
    this.label = label;
    this.position = position;
  }
}

export class IconPositionSnapshot {
  constructor(icon, position) {
    this.icon = icon;
    this.position = position;
  }
}

export class EdgeLabelPercentageSnapshot {
  constructor(edge, percentage) {
    this.edge = edge;
    this.percentage = percentage;
  }
}

/**
 * LabelPlacementSnapshot records only the state label placement owns. The
 * original label/icon objects are kept (not copied) to preserve identity.
 */
export class LabelPlacementSnapshot {
  constructor() {
    this.labels = [];
    this.icons = [];
    this.edgePercentages = [];
  }

  restore() {
    for (const state of this.labels) {
      state.label.Position = state.position;
    }
    for (const state of this.icons) {
      state.icon.Position = state.position;
    }
    for (const state of this.edgePercentages) {
      state.edge.LabelPercentage = state.percentage;
    }
  }
}

/** captureLabelPlacement */
export function captureLabelPlacement(g, extraEdges) {
  const snapshot = new LabelPlacementSnapshot();
  const seenLabels = new Set();
  const seenIcons = new Set();
  const seenEdges = new Set();

  const captureLabel = (value) => {
    if (value == null) return;
    if (seenLabels.has(value)) return;
    seenLabels.add(value);
    snapshot.labels.push(new LabelPositionSnapshot(value, value.Position));
  };
  const captureIcon = (value) => {
    if (value == null) return;
    if (seenIcons.has(value)) return;
    seenIcons.add(value);
    snapshot.icons.push(new IconPositionSnapshot(value, value.Position));
  };
  const captureEdge = (edge) => {
    if (edge == null) return;
    captureLabel(edge.Label);
    if (seenEdges.has(edge)) return;
    seenEdges.add(edge);
    snapshot.edgePercentages.push(new EdgeLabelPercentageSnapshot(edge, edge.LabelPercentage));
  };

  if (g != null) {
    for (const node of g.Nodes) {
      if (node == null) continue;
      captureLabel(node.Label);
      captureIcon(node.Icon);
    }
    for (const edge of g.Edges) {
      captureEdge(edge);
    }
  }
  for (const edge of extraEdges ?? []) {
    captureEdge(edge);
  }
  return snapshot;
}

/** nodeOverlapCount */
export function nodeOverlapCount(node, nodes, delta, guard) {
  let count = 0;
  for (const otherNode of nodes) {
    guard.step();
    if (LabelBoxesOverlap(node, otherNode, delta)) {
      count++;
    }
  }
  return count;
}

/** partialNodeOverlapCount */
export function partialNodeOverlapCount(node, nodes, delta, guard) {
  let count = 0;
  for (const otherNode of nodes) {
    guard.step();
    if (LabelBoxesOverlap(node, otherNode, delta) && !otherNode.covers(node)) {
      count++;
    }
  }
  return count;
}

/** nodeOverlapArea → [area, overlapCount] */
export function nodeOverlapArea(node, nodes, delta, partial, guard) {
  let area = 0.0;
  let overlapCount = 0;
  for (const otherNode of nodes) {
    guard.step();
    if (!LabelBoxesOverlap(node, otherNode, delta) || (partial && otherNode.covers(node))) {
      continue;
    }
    if (delta === 0 || DoesOverlapExact(node, otherNode)) {
      area += LabelOverlapArea(node, otherNode);
      overlapCount++;
    }
    if (!otherNode.IsContainer()) {
      area += node.area();
      overlapCount++;
    }
  }
  return [area, overlapCount];
}

/** edgeOverlapCount */
export function edgeOverlapCount(node, edges, delta, guard) {
  let count = 0;
  for (const edge of edges) {
    guard.step();
    for (let pointIndex = 1; pointIndex < edge.Points.length; pointIndex++) {
      guard.step();
      if (node.overlapsLine(edge.Points[pointIndex - 1], edge.Points[pointIndex], delta)) {
        count++;
      }
    }
  }
  return count;
}

/** collectLabelPlacementAncestors */
export function collectLabelPlacementAncestors(node, guard) {
  const ancestors = [];
  for (let current = node, depth = 0; current != null; depth++) {
    if (depth >= maxLabelPlacementAncestryDepth) {
      throw new Error(`TALA ${guard.location} container depth exceeds limit ${maxLabelPlacementAncestryDepth}`);
    }
    guard.step();
    ancestors.push(current);
    current = typeof current.EffectiveContainer === 'function' ? current.EffectiveContainer() : current.effectiveContainer();
  }
  return ancestors;
}

/** isLabelPlacementDescendantOf */
export function isLabelPlacementDescendantOf(maybeDescendant, maybeAncestor, guard) {
  for (let depth = 0; ; depth++) {
    if (maybeAncestor === maybeDescendant) {
      return true;
    }
    if (maybeDescendant == null) {
      return false;
    }
    if (depth >= maxLabelPlacementAncestryDepth) {
      throw new Error(`TALA ${guard.location} ancestry depth exceeds limit ${maxLabelPlacementAncestryDepth}`);
    }
    guard.step();
    if (maybeDescendant.Container != null) {
      maybeDescendant = maybeDescendant.Container;
    } else if (maybeDescendant.Cluster != null) {
      maybeDescendant = maybeDescendant.Cluster.Vessel;
    } else if (maybeDescendant.Sequence != null) {
      maybeDescendant = maybeDescendant.Sequence.Vessel;
    } else {
      maybeDescendant = null;
    }
  }
}

/** clusterBoundaryNodePlacement */
export function clusterBoundaryNodePlacement(node, nodes, orientation, guard) {
  for (const other of nodes) {
    guard.step();
    if (other === node || other.TopLeft == null) {
      continue;
    }
    switch (orientation) {
      case Orientation.Left:
        if (other.TopLeft.X < node.TopLeft.X) return false;
        break;
      case Orientation.Top:
        if (other.TopLeft.Y < node.TopLeft.Y) return false;
        break;
      case Orientation.Right:
        if (other.TopLeft.X + other.Width > node.TopLeft.X + node.Width) return false;
        break;
      case Orientation.Bottom:
        if (other.TopLeft.Y + other.Height > node.TopLeft.Y + node.Height) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

/** clusterNodeBoundingBoxPlacement → [topLeft, bottomRight] */
export function clusterNodeBoundingBoxPlacement(node, nodes, guard) {
  if (node == null || node.TopLeft == null) {
    throw new Error(`TALA ${guard.location} cluster contains an unplaced node`);
  }
  guard.step();
  const tl = node.TopLeft.copy();
  const br = new Point(goRound(tl.X + node.Width), goRound(tl.Y + node.Height));
  const [dx, dy] = node.modifierElementAdjustments();
  if (dx !== 0 || dy !== 0) {
    tl.Y -= dy;
    br.X += dx;
  }
  tl.X -= loopOffset(node, Orientation.Left);
  tl.Y -= loopOffset(node, Orientation.Top);
  br.X += loopOffset(node, Orientation.Right);
  br.Y += loopOffset(node, Orientation.Bottom);

  if (node.Label != null && IsOutside(node.Label.Position)) {
    const labelTopLeft = NodeLabelTopLeft(node, node.Label.Position, node.Label.Width, node.Label.Height);
    const boundaryPadding = LABEL_PADDING;
    const outsidePadding = 2 * LABEL_PADDING;
    if (labelTopLeft.X < tl.X) {
      const boundary = clusterBoundaryNodePlacement(node, nodes, Orientation.Left, guard);
      const padding = boundary ? boundaryPadding : outsidePadding;
      tl.X = Math.floor(labelTopLeft.X - padding);
    }
    if (labelTopLeft.Y < tl.Y) {
      const boundary = clusterBoundaryNodePlacement(node, nodes, Orientation.Top, guard);
      const padding = boundary ? boundaryPadding : outsidePadding;
      tl.Y = Math.floor(labelTopLeft.Y - padding);
    }
    if (labelTopLeft.X > br.X) {
      const boundary = clusterBoundaryNodePlacement(node, nodes, Orientation.Right, guard);
      const padding = boundary ? boundaryPadding : outsidePadding;
      br.X = Math.ceil(labelTopLeft.X + node.Label.Width + padding);
    }
    if (labelTopLeft.Y > br.Y) {
      const boundary = clusterBoundaryNodePlacement(node, nodes, Orientation.Bottom, guard);
      const padding = boundary ? boundaryPadding : outsidePadding;
      br.Y = Math.ceil(labelTopLeft.Y + node.Label.Height + padding);
    }
  }
  if (node.Icon != null && !IsImage(node) && IsOutside(node.Icon.Position)) {
    const iconSize = MAX_ICON_SIZE;
    const iconTopLeft = NodeLabelTopLeft(node, node.Icon.Position, iconSize, iconSize);
    const outsidePadding = 2 * LABEL_PADDING;
    tl.X = goMin(tl.X, Math.floor(iconTopLeft.X - outsidePadding));
    tl.Y = goMin(tl.Y, Math.floor(iconTopLeft.Y - outsidePadding));
    br.X = goMax(br.X, Math.ceil(iconTopLeft.X + iconSize + outsidePadding));
    br.Y = goMax(br.Y, Math.ceil(iconTopLeft.Y + iconSize + outsidePadding));
  }
  return [tl, br];
}

/** clusterLabelPlacementOrientation → [orientation, index] */
export function clusterLabelPlacementOrientation(node, member, cluster, guard) {
  let clusterTopLeft = new Point(-Infinity, -Infinity);
  let clusterBottomRight = new Point(Infinity, Infinity);
  if (cluster.Nodes.length > 0) {
    clusterTopLeft = new Point(Infinity, Infinity);
    clusterBottomRight = new Point(-Infinity, -Infinity);
    for (const clusterNode of cluster.Nodes) {
      const [topLeft, bottomRight] = clusterNodeBoundingBoxPlacement(clusterNode, cluster.Nodes, guard);
      clusterTopLeft.X = goMin(clusterTopLeft.X, topLeft.X);
      clusterTopLeft.Y = goMin(clusterTopLeft.Y, topLeft.Y);
      clusterBottomRight.X = goMax(clusterBottomRight.X, bottomRight.X);
      clusterBottomRight.Y = goMax(clusterBottomRight.Y, bottomRight.Y);
    }
  }
  const shell = new Node(0n, clusterBottomRight.X - clusterTopLeft.X, clusterBottomRight.Y - clusterTopLeft.Y);
  shell.TopLeft = clusterTopLeft;
  const orientation = node.orientation(shell);
  let index = -1;
  for (let candidateIndex = 0; candidateIndex < cluster.Nodes.length; candidateIndex++) {
    guard.step();
    if (cluster.Nodes[candidateIndex] === member) {
      index = candidateIndex;
      break;
    }
  }
  return [orientation, index];
}

// geo.EuclideanDistance
function euclideanDistance(x1, y1, x2, y2) {
  if (x1 === x2) {
    return Math.abs(y1 - y2);
  } else if (y1 === y2) {
    return Math.abs(x1 - x2);
  }
  return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
}

/** routeLengthPlacement */
export function routeLengthPlacement(edge, guard) {
  let length = 0.0;
  for (let index = 1; index < edge.Points.length; index++) {
    guard.step();
    const previous = edge.Points[index - 1];
    const current = edge.Points[index];
    length += euclideanDistance(previous.X, previous.Y, current.X, current.Y);
  }
  return length;
}

/** edgeLabelTopLeft: reserves both route passes of d2's route label helper. */
export function edgeLabelTopLeft(edge, position, width, height, guard) {
  for (let pass = 0; pass < 2; pass++) {
    guard.add(edge.Points.length);
  }
  const point = edge.labelTopLeft(position, width, height);
  guard.check();
  return point;
}

/** positionedArrowheadLabel: reserves the three route passes of arrowhead placement. */
export function positionedArrowheadLabel(edge, isTarget, guard) {
  for (let pass = 0; pass < 3; pass++) {
    guard.add(edge.Points.length);
  }
  const positioned = PositionArrowheadLabel(edge, isTarget, edge.Points);
  guard.check();
  return positioned;
}

export class LabelEdgeSortItem {
  constructor(edge, length) {
    this.edge = edge;
    this.length = length;
  }
}

/**
 * sortLabelPlacementEdges: bottom-up stable merge sort (ties keep the left
 * item, matching sort.SliceStable) with one work step per moved item.
 */
export function sortLabelPlacementEdges(edges, guard) {
  let items = new Array(edges.length);
  for (let index = 0; index < edges.length; index++) {
    guard.step();
    const edge = edges[index];
    const length = routeLengthPlacement(edge, guard);
    items[index] = new LabelEdgeSortItem(edge, length);
  }
  let buffer = new Array(items.length);
  const less = (left, right) => {
    if (right.edge.Points.length === 2 && left.edge.Points.length > 2) {
      return true;
    }
    if (left.edge.Points.length === 2 && right.edge.Points.length > 2) {
      return false;
    }
    return left.length < right.length;
  };
  for (let width = 1; width < items.length;) {
    for (let start = 0; start < items.length; start += 2 * width) {
      const middle = Math.min(start + width, items.length);
      const end = Math.min(start + 2 * width, items.length);
      let left = start;
      let right = middle;
      let output = start;
      while (left < middle && right < end) {
        guard.step();
        if (less(items[right], items[left])) {
          buffer[output] = items[right];
          right++;
        } else {
          buffer[output] = items[left];
          left++;
        }
        output++;
      }
      while (left < middle) {
        guard.step();
        buffer[output] = items[left];
        left++;
        output++;
      }
      while (right < end) {
        guard.step();
        buffer[output] = items[right];
        right++;
        output++;
      }
    }
    [items, buffer] = [buffer, items];
    if (width > Math.floor(items.length / 2)) {
      break;
    }
    width *= 2;
  }
  const sorted = new Array(items.length);
  for (let index = 0; index < items.length; index++) {
    sorted[index] = items[index].edge;
  }
  guard.check();
  return sorted;
}

/**
 * sortSharedSegmentGroup: the same cancellable stable merge sort over shared
 * segment candidates, ordered by (start, end) coordinate. Sorts in place.
 */
export function sortSharedSegmentGroup(segments, coordinate, checkWork) {
  if (segments.length < 2) {
    return;
  }
  let buffer = new Array(segments.length);
  const less = (left, right) => {
    if (coordinate(left.Start) === coordinate(right.Start)) {
      return coordinate(left.End) < coordinate(right.End);
    }
    return coordinate(left.Start) < coordinate(right.Start);
  };
  let items = segments;
  for (let width = 1; width < items.length;) {
    for (let start = 0; start < items.length; start += 2 * width) {
      const middle = Math.min(start + width, items.length);
      const end = Math.min(start + 2 * width, items.length);
      let left = start;
      let right = middle;
      let output = start;
      while (left < middle && right < end) {
        if (checkWork != null) checkWork();
        if (less(items[right], items[left])) {
          buffer[output] = items[right];
          right++;
        } else {
          buffer[output] = items[left];
          left++;
        }
        output++;
      }
      while (left < middle) {
        if (checkWork != null) checkWork();
        buffer[output] = items[left];
        left++;
        output++;
      }
      while (right < end) {
        if (checkWork != null) checkWork();
        buffer[output] = items[right];
        right++;
        output++;
      }
    }
    [items, buffer] = [buffer, items];
    if (width > Math.floor(items.length / 2)) {
      break;
    }
    width *= 2;
  }
  if (items.length > 0 && items !== segments) {
    for (let index = 0; index < items.length; index++) {
      segments[index] = items[index];
    }
  }
}
