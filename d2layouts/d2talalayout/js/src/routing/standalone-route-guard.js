// Slice 47 — guarded helpers shared by standalone routing and post-processing.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/standalone_route_guard.go
//
// routeWorkGuard.reserveSort lives on RouteWorkGuard (route-guards.js); the
// free function here forwards to it. Go's (value, error) results become the
// value with guard/helper errors thrown.

import { Node } from '../graph/node.js';
import { euclideanDistance } from '../geometry/math.js';
import { goSortSlice } from '../packing/go-support.js';
import { IsCandidateRejection } from '../graph/transaction.js';
import { orientation } from './geometry.js';
import { LOWER_JITTER_THRESHOLD, NON_ORTHOGONAL_FACTOR } from './tuning.js';
import { RouteSearchWorkGuard } from './route-guards.js';
import { estimateRouteCostGuarded } from './cluster-route-guard.js';
import * as coordinator from './coordinator.js';
import { snapshotPointer } from './snapshot.js';
import { traceToShapeBorder } from './trace.js';
import {
  edgeIsDuplicateOf,
  nodeLabelBoxesOverlap,
  PointValueMap,
} from './layoutgraph-route-support.js';

/** d2 lib/label PADDING. */
const LABEL_PADDING = 5;

// geo.Box.Overlaps (value receiver).
function boxOverlaps(b1, b2) {
  return (b1.TopLeft.X < (b2.TopLeft.X + b2.Width)) && ((b1.TopLeft.X + b1.Width) > b2.TopLeft.X) &&
    (b1.TopLeft.Y < (b2.TopLeft.Y + b2.Height)) && ((b1.TopLeft.Y + b1.Height) > b2.TopLeft.Y);
}

// ovg_edge.go nonNilEquals.
function nonNilEquals(p1, p2) {
  return p1 != null && p2 != null && p1.X === p2.X && p1.Y === p2.Y;
}

/** routeWorkGuard.reserveSort. */
export function reserveSort(guard, length) {
  guard.reserveSort(length);
}

/**
 * portEdgesGuarded groups the edges incident to `node` by the value of the
 * port they use. Returns a PointValueMap (Go map[geo.Point][]*Edge).
 */
export function portEdgesGuarded(edges, node, guard) {
  const portEdges = new PointValueMap();
  for (const edge of edges ?? []) {
    guard.step();
    let port;
    const points = edge.Points ?? [];
    if (edge.From === node) {
      port = points.length === 0 ? null : points[0];
    } else if (edge.To === node) {
      port = points.length === 0 ? null : points[points.length - 1];
    } else {
      continue;
    }
    if (port != null) {
      const existing = portEdges.get(port);
      const list = existing === undefined ? [] : existing;
      list.push(edge);
      portEdges.set(port, list);
    }
  }
  return portEdges;
}

export function edgeHasDuplicateInGuarded(edge, edges, guard) {
  for (const otherEdge of edges ?? []) {
    guard.step();
    if (edgeIsDuplicateOf(otherEdge, edge)) {
      return true;
    }
  }
  return false;
}

/**
 * tryStraightEdgeFallbackGuarded replaces a route with the best straight
 * line when it is cheaper. A candidate rejection keeps the current route.
 * Requires coordinator.routeLineGuarded (ported with coordinator.go).
 */
export function tryStraightEdgeFallbackGuarded(g, edge, guard) {
  guard.step();
  const originalCost = estimateRouteCostGuarded(g.Edges, edge, guard);
  if (typeof coordinator.routeLineGuarded !== 'function') {
    throw new Error('TALA JS: routeLineGuarded (coordinator.go) is not ported yet');
  }
  let fromPort;
  let toPort;
  let lineCost;
  try {
    [fromPort, toPort, lineCost] = coordinator.routeLineGuarded(g, edge, g.Edges, null, guard);
  } catch (err) {
    if (IsCandidateRejection(err)) {
      // A straight replacement is optional.
      return;
    }
    throw err;
  }

  if (edge.Points.length === 4 && euclideanDistance(
    edge.Points[1].X,
    edge.Points[1].Y,
    edge.Points[2].X,
    edge.Points[2].Y,
  ) <= LOWER_JITTER_THRESHOLD) {
    lineCost /= NON_ORTHOGONAL_FACTOR;
  }
  guard.step();
  if (lineCost < originalCost) {
    edge.Points = [fromPort, toPort];
  }
}

/**
 * filterEdgeAncestorsGuarded drops ancestors of either endpoint (never the
 * endpoints). Always returns an array (Go returns a non-nil slice).
 */
export function filterEdgeAncestorsGuarded(edge, nodes, guard) {
  const nonAncestors = [];
  for (const node of nodes ?? []) {
    guard.step();
    if (node !== edge.From && node !== edge.To && (edge.From.IsDescendantOf(node) || edge.To.IsDescendantOf(node))) {
      continue;
    }
    nonAncestors.push(node);
  }
  return nonAncestors;
}

/**
 * sourceAndTargetClusterNodesGuarded returns [sourceClusterNodes,
 * targetClusterNodes] as Map<node, true>. Clusters are visited in the
 * graph's Map order (Go ranges a map, so Go's order is random; the results
 * and the work charged are order-independent unless the guard fails).
 */
export function sourceAndTargetClusterNodesGuarded(g, source, target, guard) {
  const sourceClusterNodes = new Map();
  const targetClusterNodes = new Map();

  for (const cluster of g.Clusters?.values() ?? []) {
    guard.step();
    let isSource = false;
    let isTarget = false;
    for (const clusterNode of cluster.Nodes ?? []) {
      guard.step();
      if (clusterNode === source) {
        isSource = true;
      }
      if (clusterNode === target) {
        isTarget = true;
      }
    }
    if (isSource) {
      for (const clusterNode of cluster.Nodes ?? []) {
        guard.step();
        if (clusterNode !== source) {
          sourceClusterNodes.set(clusterNode, true);
        }
      }
    }
    if (isTarget) {
      for (const clusterNode of cluster.Nodes ?? []) {
        guard.step();
        if (clusterNode !== target) {
          targetClusterNodes.set(clusterNode, true);
        }
      }
    }
  }
  return [sourceClusterNodes, targetClusterNodes];
}

export function overlappingEdgesGuarded(start, end, otherEdges, guard) {
  const overlappingEdges = [];
  for (const edge of otherEdges ?? []) {
    guard.step();
    const points = edge.Points ?? [];
    for (let index = 0; index < points.length - 1; index++) {
      guard.step();
      if (coordinator.isVerticalOrHorizontalOverlap(start, end, points[index], points[index + 1])) {
        overlappingEdges.push(edge);
        break;
      }
    }
  }
  return overlappingEdges;
}

export function edgeCanOverlapEdgesGuarded(edge, otherEdges, sourceClusterNodes, targetClusterNodes, guard) {
  const others = otherEdges ?? [];
  if (others.length === 0) {
    // With a Done signal one poll suffices; Err-only contexts keep the
    // eleven-poll legacy sequence below.
    if (guard instanceof RouteSearchWorkGuard && guard.done != null) {
      guard.check();
      return true;
    }
  }
  // Reserve edgeCanOverlapEdges' bounded full passes before calling it.
  for (let pass = 0; pass < 10; pass++) {
    guard.add(others.length);
  }
  guard.check();
  return coordinator.edgeCanOverlapEdges(edge, others, sourceClusterNodes, targetClusterNodes);
}

/**
 * positionedArrowheadLabelCostGuarded scores a positioned arrowhead label.
 * `positioned` and `labels` are labeling.PositionedArrowheadLabel values:
 * { Box, Edge, IsTarget, Text } where Box is the embedded geo.Box.
 */
export function positionedArrowheadLabelCostGuarded(positioned, nodes, labels, routes, edges, guard) {
  for (const other of labels ?? []) {
    guard.step();
    if (positioned.Edge === other.Edge && positioned.IsTarget === other.IsTarget) {
      continue;
    }
    if (boxOverlaps(positioned.Box, other.Box)) {
      if (positioned.Text === other.Text) {
        continue;
      }
      return Infinity;
    }
  }

  const graph = positioned.Edge.From.Graph;
  // &layoutgraph.Node{Box: positioned.Box, Graph: graph}
  const fakeLabelNode = new Node(0n);
  fakeLabelNode.Box = positioned.Box;
  fakeLabelNode.Graph = graph;
  let overlapCount = 0;
  for (const node of nodes ?? []) {
    guard.step();
    if (nodeLabelBoxesOverlap(fakeLabelNode, node, LABEL_PADDING)) {
      overlapCount++;
    }
  }
  let penalty = 4 * graph.TurnCost() * overlapCount;

  let overlappingEdgeCount = 0;
  for (const route of routes ?? []) {
    guard.step();
    if (route.GEdge === positioned.Edge) {
      continue;
    }
    const ovgNodes = route.OVGNodes ?? [];
    for (let index = 1; index < ovgNodes.length; index++) {
      guard.step();
      if (fakeLabelNode.OverlapsLine(ovgNodes[index - 1].Point, ovgNodes[index].Point, 0)) {
        overlappingEdgeCount++;
        break;
      }
    }
  }
  for (const edge of edges ?? []) {
    guard.step();
    if (edge === positioned.Edge) {
      continue;
    }
    const points = edge.Points ?? [];
    for (let index = 1; index < points.length; index++) {
      guard.step();
      if (fakeLabelNode.OverlapsLine(points[index - 1], points[index], 0)) {
        overlappingEdgeCount++;
        break;
      }
    }
  }
  penalty += graph.TurnCost() * overlappingEdgeCount;
  return penalty;
}

export function edgeIsStraightGuarded(edge, guard) {
  const points = edge.Points ?? [];
  if (points.length < 2) {
    guard.step();
    return false;
  }
  let first = points[0];
  let second = points[1];
  for (let index = 2; index < points.length; index++) {
    guard.step();
    if (orientation(first, second, points[index]) !== 0) {
      return false;
    }
    first = second;
    second = points[index];
  }
  return true;
}

// Go slice indexing: an out-of-range index panics instead of yielding undefined.
function goIndex(points, index) {
  const length = points == null ? 0 : points.length;
  if (index < 0 || index >= length) {
    throw new RangeError(`runtime error: index out of range [${index}] with length ${length}`);
  }
  return points[index];
}

function firstPoint(points) {
  return goIndex(points, 0);
}

function lastPoint(points) {
  return goIndex(points, (points == null ? 0 : points.length) - 1);
}

export function edgeHasOverlappingEndGuarded(edge, guard) {
  const start = firstPoint(edge.Points);
  const end = lastPoint(edge.Points);
  for (const fromEdge of edge.From.Edges ?? []) {
    guard.step();
    if (fromEdge !== edge && (nonNilEquals(firstPoint(fromEdge.Points), start) || nonNilEquals(lastPoint(fromEdge.Points), start))) {
      return true;
    }
  }
  for (const toEdge of edge.To.Edges ?? []) {
    guard.step();
    if (toEdge !== edge && (nonNilEquals(firstPoint(toEdge.Points), end) || nonNilEquals(lastPoint(toEdge.Points), end))) {
      return true;
    }
  }
  return false;
}

/**
 * reorderDuplicatesInEdgesGuarded swaps straight duplicate routes so a
 * labeled edge sits on the outside of its bundle.
 */
export function reorderDuplicatesInEdgesGuarded(edges, guard) {
  const list = edges ?? [];
  for (const edge of list) {
    guard.step();
    if (edge.HasTableColumn() || edge.Label == null) {
      continue;
    }
    if (!edgeIsStraightGuarded(edge, guard)) {
      continue;
    }
    const hasOverlappingEnd = edgeHasOverlappingEndGuarded(edge, guard);

    const duplicates = [];
    for (let index = 0; index < list.length; index++) {
      const other = list[index];
      guard.step();
      if (other === edge || !edgeIsDuplicateOf(other, edge)) {
        continue;
      }
      if (!edgeIsStraightGuarded(other, guard)) {
        continue;
      }
      let otherHasOverlappingEnd = false;
      if (hasOverlappingEnd) {
        otherHasOverlappingEnd = true;
      } else {
        otherHasOverlappingEnd = edgeHasOverlappingEndGuarded(other, guard);
      }
      if (otherHasOverlappingEnd) {
        let sourceArrow = edge.SourceArrowhead;
        let targetArrow = edge.TargetArrowhead;
        if (other.From === edge.To) {
          [sourceArrow, targetArrow] = [targetArrow, sourceArrow];
        }
        if (other.TargetArrowhead === targetArrow && other.SourceArrowhead === sourceArrow) {
          duplicates.push(index);
        }
      } else {
        duplicates.push(index);
      }
    }

    if (duplicates.length <= 1) {
      continue;
    }
    const start = edge.Points[0];
    const end = edge.Points[edge.Points.length - 1];
    const dx = end.X - start.X;
    const dy = end.Y - start.Y;
    const sourceOrder = [edge];
    const targetOrder = [edge];
    for (const index of duplicates) {
      guard.step();
      sourceOrder.push(list[index]);
      targetOrder.push(list[index]);
    }

    guard.reserveSort(sourceOrder.length);
    guard.reserveSort(targetOrder.length);
    if (dy > dx) {
      goSortSlice(sourceOrder, (left, right) => left.Points[0].X < right.Points[0].X);
      goSortSlice(targetOrder, (left, right) => left.Points[left.Points.length - 1].X < right.Points[right.Points.length - 1].X);
    } else {
      goSortSlice(sourceOrder, (left, right) => left.Points[0].Y < right.Points[0].Y);
      goSortSlice(targetOrder, (left, right) => left.Points[left.Points.length - 1].Y < right.Points[right.Points.length - 1].Y);
    }

    let consistentOrder = true;
    for (let index = 0; index < sourceOrder.length; index++) {
      guard.step();
      if (sourceOrder[index] !== targetOrder[index]) {
        consistentOrder = false;
        break;
      }
    }
    if (!consistentOrder) {
      continue;
    }
    let currentIndex = -1;
    for (let index = 0; index < sourceOrder.length; index++) {
      guard.step();
      if (sourceOrder[index] === edge) {
        currentIndex = index;
        break;
      }
    }
    if (currentIndex === 0 || currentIndex === sourceOrder.length - 1) {
      continue;
    }
    const first = sourceOrder[0];
    const last = sourceOrder[sourceOrder.length - 1];
    if (first.Label != null && last.Label != null) {
      continue;
    }
    guard.step();

    if (last.Label == null) {
      [edge.Points, last.Points] = [last.Points, edge.Points];
      if (last.From === edge.To) {
        reverseEdgeRouteGuarded(edge, guard);
        reverseEdgeRouteGuarded(last, guard);
      }
    } else if (first.Label == null) {
      [edge.Points, first.Points] = [first.Points, edge.Points];
      if (first.From === edge.To) {
        reverseEdgeRouteGuarded(edge, guard);
        reverseEdgeRouteGuarded(first, guard);
      }
    }
  }
  guard.finish();
}

/** reverseEdgeRouteGuarded reverses the route array in place. */
export function reverseEdgeRouteGuarded(edge, guard) {
  const points = edge.Points ?? [];
  for (let left = 0, right = points.length - 1; left < right; left++, right--) {
    guard.step();
    const tmp = points[left];
    points[left] = points[right];
    points[right] = tmp;
  }
}

/**
 * traceToShapeBorderGuarded traces one route; a value thrown by the tracer
 * restores both endpoint positions before it propagates.
 */
export function traceToShapeBorderGuarded(edge, guard) {
  guard.step();
  if (edge == null || edge.From == null || edge.To == null || edge.Points == null || edge.Points.length < 2) {
    return;
  }
  const fromPosition = snapshotPointer(edge.From.TopLeft);
  const toPosition = snapshotPointer(edge.To.TopLeft);
  try {
    traceToShapeBorder(edge);
  } catch (thrown) {
    edge.From.TopLeft = fromPosition.restore();
    edge.To.TopLeft = toPosition.restore();
    throw thrown;
  }
  guard.step();
}
