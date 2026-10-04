// Slice 47 — guarded kernels for edge-segment balancing.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/balance_route_guard.go

import { Point } from '../geometry/point.js';
import { Segment } from '../geometry/segment.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { newEdgeSegment } from '../graph/structural-access.js';
import { edgeSegmentOwner } from './layoutgraph-route-support.js';

/**
 * removeDuplicatePointsGuarded drops consecutive equal points; a route that
 * collapses to one point gains a copy shifted one unit right.
 */
export function removeDuplicatePointsGuarded(points, guard) {
  if (points == null || points.length <= 1) {
    guard.step();
    return points;
  }

  const result = [points[0]];
  for (let index = 1; index < points.length; index++) {
    guard.step();
    const previous = points[index - 1];
    const current = points[index];
    if (previous.X !== current.X || previous.Y !== current.Y) {
      result.push(current);
    }
  }

  if (result.length === 1) {
    const secondPoint = result[0].Copy();
    secondPoint.X++;
    result.push(secondPoint);
  }
  return result;
}

/** nodeSegmentsGuarded: the two node borders parallel to the axis. */
export function nodeSegmentsGuarded(nodes, isHorizontal, guard) {
  const out = [];
  for (const node of nodes ?? []) {
    guard.step();
    const tl = node.TopLeft;
    if (isHorizontal) {
      out.push(new Segment(tl, new Point(tl.X + node.Width, tl.Y)));
      out.push(new Segment(new Point(tl.X, tl.Y + node.Height), new Point(tl.X + node.Width, tl.Y + node.Height)));
    } else {
      out.push(new Segment(tl, new Point(tl.X, tl.Y + node.Height)));
      out.push(new Segment(new Point(tl.X + node.Width, tl.Y), new Point(tl.X + node.Width, tl.Y + node.Height)));
    }
  }
  return out;
}

/**
 * edgeSegmentsGuarded: axis-aligned route segments with Start before End.
 * Go returns a nil slice when there are none; JS returns an empty array
 * (only length and iteration are observable).
 */
export function edgeSegmentsGuarded(edges, isHorizontal, guard) {
  const out = [];
  for (const edge of edges ?? []) {
    guard.step();
    const points = edge.Points ?? [];
    for (let index = 0; index < points.length - 1; index++) {
      guard.step();
      let start = null;
      let end = null;
      if (isHorizontal) {
        if (points[index].Y === points[index + 1].Y) {
          if (points[index].X < points[index + 1].X) {
            start = points[index];
            end = points[index + 1];
          } else {
            start = points[index + 1];
            end = points[index];
          }
        }
      } else if (points[index].X === points[index + 1].X) {
        if (points[index].Y < points[index + 1].Y) {
          start = points[index];
          end = points[index + 1];
        } else {
          start = points[index + 1];
          end = points[index];
        }
      }
      if (start != null && end != null) {
        out.push(newEdgeSegment(start, end, edge));
      }
    }
  }
  return out;
}

/**
 * routeSegmentBounds is the cancellable geo.Segment.GetBounds. Returns
 * [floor, ceil].
 */
export function routeSegmentBounds(segment, segments, buffer, guard) {
  let ceil = Infinity;
  let floor = -Infinity;
  if (segment.Start.X === segment.End.X && segment.Start.Y === segment.End.Y) {
    guard.step();
    return [floor, ceil];
  }
  const isHorizontal = segment.Start.X === segment.End.X;
  for (const otherSegment of segments ?? []) {
    guard.step();
    if (isHorizontal) {
      if (otherSegment.End.Y < segment.Start.Y - buffer) {
        continue;
      }
      if (otherSegment.Start.Y > segment.End.Y + buffer) {
        continue;
      }
      if (otherSegment.Start.X <= segment.Start.X) {
        floor = goMax(floor, otherSegment.Start.X);
      }
      if (otherSegment.Start.X > segment.Start.X) {
        ceil = goMin(ceil, otherSegment.Start.X);
      }
    } else {
      if (otherSegment.End.X < segment.Start.X - buffer) {
        continue;
      }
      if (otherSegment.Start.X > segment.End.X + buffer) {
        continue;
      }
      if (otherSegment.Start.Y <= segment.Start.Y) {
        floor = goMax(floor, otherSegment.Start.Y);
      }
      if (otherSegment.Start.Y > segment.Start.Y) {
        ceil = goMin(ceil, otherSegment.Start.Y);
      }
    }
  }
  return [floor, ceil];
}

/** evenlyDistributeGuarded: `count` integral-step positions inside (floor, ceil). */
export function evenlyDistributeGuarded(floor, ceil, count, guard) {
  if (count <= 0 || floor >= ceil) {
    guard.step();
    return [];
  }
  const increment = Math.floor((ceil - floor) / (count + 1));
  if (increment <= 0) {
    guard.step();
    return [];
  }
  const out = [];
  for (let index = 1; index <= count; index++) {
    guard.step();
    out.push(floor + index * increment);
  }
  return out;
}

/** balanceOrderStatus (ordered: max() picks the stronger outcome). */
export const balanceOrderPreserved = 0;
export const balanceOrderReversed = 1;
export const balanceOrderContactChanged = 2;

/**
 * checkBalanceOrder checks a proposed batch move against parallel routes in
 * other movement ranges. `batchSet` is a Set of batch members.
 */
export function checkBalanceOrder(batch, batchSet, segments, proposed, isHorizontal, guard) {
  let moving = false;
  for (let i = 0; i < batch.length; i++) {
    guard.step();
    const segment = batch[i];
    const old = isHorizontal ? segment.Start.X : segment.Start.Y;
    if (proposed[i] !== old) {
      moving = true;
      break;
    }
  }
  if (!moving) {
    return balanceOrderPreserved;
  }
  let status = balanceOrderPreserved;
  for (const other of segments ?? []) {
    guard.step();
    if (batchSet.has(other)) {
      continue;
    }
    for (let i = 0; i < batch.length; i++) {
      guard.step();
      const segment = batch[i];
      // Preserve ordering between distinct routes, not within a route.
      if (edgeSegmentOwner(segment) === edgeSegmentOwner(other)) {
        continue;
      }
      let old = segment.Start.Y;
      let position = other.Start.Y;
      let start = segment.Start.X;
      let end = segment.End.X;
      let otherStart = other.Start.X;
      let otherEnd = other.End.X;
      if (isHorizontal) {
        old = segment.Start.X;
        position = other.Start.X;
        start = segment.Start.Y;
        end = segment.End.Y;
        otherStart = other.Start.Y;
        otherEnd = other.End.Y;
      }
      if (proposed[i] === old) {
        continue;
      }
      // Closed intervals matter: touching intervals can acquire a crossing.
      if (goMax(start, end) < goMin(otherStart, otherEnd) || goMax(otherStart, otherEnd) < goMin(start, end)) {
        continue;
      }
      if (old === position || proposed[i] === position) {
        return balanceOrderContactChanged;
      }
      if ((old < position) !== (proposed[i] < position)) {
        status = balanceOrderReversed;
        // Keep checking: a later relation may prohibit fallback.
      }
    }
  }
  return status;
}
