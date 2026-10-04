// Slice 47 — guarded route cost and node-intersection kernels.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/cluster_route_guard.go

import { euclideanDistance } from '../geometry/math.js';
import { isNonSharedCrossing } from './cost.js';
import { TURN_PENALTY } from './tuning.js';
import { CrossingCostWeight, goPow } from './layoutgraph-route-support.js';

/**
 * estimateRouteCostGuarded is estimateRouteCost with one unit per route
 * segment, per candidate edge, and per segment pair.
 */
export function estimateRouteCostGuarded(edges, edge, guard) {
  const points = edge.Points ?? [];
  let length = 0.0;
  for (let index = 0; index < points.length - 1; index++) {
    guard.step();
    length += euclideanDistance(points[index].X, points[index].Y, points[index + 1].X, points[index + 1].Y);
  }
  let cost = length * goPow(TURN_PENALTY, points.length - 2);

  let crossingCount = 0;
  for (const otherEdge of edges ?? []) {
    guard.step();
    if (otherEdge === edge) {
      continue;
    }
    const otherPoints = otherEdge.Points ?? [];
    for (let edgeSegment = 0; edgeSegment < points.length - 1; edgeSegment++) {
      for (let otherSegment = 0; otherSegment < otherPoints.length - 1; otherSegment++) {
        guard.step();
        if (isNonSharedCrossing(edge, otherEdge, edgeSegment, otherSegment)) {
          crossingCount++;
        }
      }
    }
  }
  cost += CrossingCostWeight * crossingCount;
  return cost;
}

/** routeIntersectsNodeGuarded: does any non-ancestor node block a segment? */
export function routeIntersectsNodeGuarded(nodes, edge, guard) {
  const points = edge.Points ?? [];
  for (const otherNode of nodes ?? []) {
    guard.step();
    if (edge.From.IsDescendantOf(otherNode) || edge.To.IsDescendantOf(otherNode)) {
      continue;
    }
    for (let index = 0; index < points.length - 1; index++) {
      guard.step();
      if (otherNode.PassesThrough(points[index], points[index + 1])) {
        return true;
      }
    }
  }
  return false;
}
