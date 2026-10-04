// Slice 47 — candidate route scoring.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/cost.go
//
// Crossing semantics belong to routing: intersections at the exact end of an
// axis-aligned segment are bends off a shared route, not route crossings.

import { orientation } from './geometry.js';
import { TURN_PENALTY } from './tuning.js';
import { CrossingCostWeight, edgeLength, goPow } from './layoutgraph-route-support.js';

/** estimateRouteCost scores one candidate against already-selected routes. */
export function estimateRouteCost(edges, edge) {
  let cost = edgeLength(edge);
  cost *= goPow(TURN_PENALTY, edge.Points.length - 2);

  // int64 accumulator; counts stay far below 2^53.
  let crossingCount = 0;
  for (const otherEdge of edges ?? []) {
    if (otherEdge === edge) {
      continue;
    }
    crossingCount += countNonSharedCrossings(edge, otherEdge);
  }
  cost += CrossingCostWeight * crossingCount;
  return cost;
}

export function countNonSharedCrossings(edge, otherEdge) {
  let crossingCount = 0;
  for (let edgeSegment = 0; edgeSegment < edge.Points.length - 1; edgeSegment++) {
    for (let otherSegment = 0; otherSegment < otherEdge.Points.length - 1; otherSegment++) {
      if (isNonSharedCrossing(edge, otherEdge, edgeSegment, otherSegment)) {
        crossingCount++;
      }
    }
  }
  return crossingCount;
}

export function isNonSharedCrossing(edge, otherEdge, edgeSegment, otherSegment) {
  if (!nonParallelIntersection(
    edge.Points[edgeSegment],
    edge.Points[edgeSegment + 1],
    otherEdge.Points[otherSegment],
    otherEdge.Points[otherSegment + 1],
  )) {
    return false;
  }

  // Skip intersections at the exact end of the segment to avoid counting
  // bends off shared edges.
  const segmentStartX = edge.Points[edgeSegment].X;
  const segmentStartY = edge.Points[edgeSegment].Y;
  if (segmentStartX === edge.Points[edgeSegment + 1].X &&
    (segmentStartX === otherEdge.Points[otherSegment].X || segmentStartX === otherEdge.Points[otherSegment + 1].X)) {
    return false;
  }
  if (segmentStartY === edge.Points[edgeSegment + 1].Y &&
    (segmentStartY === otherEdge.Points[otherSegment].Y || segmentStartY === otherEdge.Points[otherSegment + 1].Y)) {
    return false;
  }
  return true;
}

export function equalSigns(first, second) {
  return (first > 0 && second > 0) || (first === 0 && second === 0) || (first < 0 && second < 0);
}

/**
 * nonParallelIntersection reports whether segments ab and cd intersect at an
 * angle. Collinear overlap is intentionally not a routing crossing.
 */
export function nonParallelIntersection(a, b, c, d) {
  const abcOrientation = orientation(a, b, c);
  const abdOrientation = orientation(a, b, d);
  if (equalSigns(abcOrientation, abdOrientation)) {
    return false;
  }

  const cdaOrientation = orientation(c, d, a);
  const cdbOrientation = orientation(c, d, b);
  return !equalSigns(cdaOrientation, cdbOrientation);
}
