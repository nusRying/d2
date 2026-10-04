// Slice 47 — atomic route-stage boundary.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/route_stage_guard.go
// (routeMutationSnapshot, captureRouteMutations, validateRouteStageGeometry,
// routeStageGraphBoundingBox, restore, runAtomicRouteStage*,
// stableSortRouteValues). The routeWorkGuard half of that file lives in
// route-guards.js.
//
// Errors Go returns and values Go panics with both arrive here as JS throws.
// Every stage boundary restores the exact pre-stage route state first and
// then rethrows the original value unchanged.

import { Point } from '../geometry/point.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { goRound } from '../geometry/math.js';
import { FixedBoundingBox } from '../graphbounds/index.js';
import { Validate } from '../graph/topology-preflight.js';
import { invariantNew } from '../hierarchy/layoutgraph-support.js';
import { newRouteWorkGuard } from './route-guards.js';
import { newEdgeSnapshot, snapshotPointer } from './snapshot.js';
import {
  edgeIDValue,
  isEdgePosition,
  isLabelPositionSet,
  MaxRoutePoints,
  MaxTopologyReferences,
} from './layoutgraph-route-support.js';

/** routeMutationSnapshot. */
export class RouteMutationSnapshot {
  constructor(graph = null) {
    this.graph = graph;
    this.cellSize = 0;
    this.costs = { Crossing: 0, Turn: 0, NonCenterPort: 0 };
    this.nodes = new Map();
    this.nodeGraphs = new Map();
    this.edges = new Map();
  }

  restore() {
    if (this.graph != null) {
      this.graph.CellSize = this.cellSize;
      this.graph.RestoreRoutingCosts(this.costs);
    }
    for (const [node, topLeft] of this.nodes) {
      node.TopLeft = topLeft.restore();
      node.Graph = this.nodeGraphs.get(node);
    }
    for (const [edge, state] of this.edges) {
      state.restore(edge);
    }
  }
}

/**
 * captureRouteMutations records every route reachable through the
 * collections used by post-processing, plus node positions and graph
 * references of every endpoint and container/cluster/sequence descendant.
 */
export function captureRouteMutations(g, extraEdges, guard) {
  const snapshot = new RouteMutationSnapshot(g);
  if (g != null) {
    snapshot.cellSize = g.CellSize;
    snapshot.costs = g.RoutingCosts();
  }
  const nodeQueue = [];
  const captureNode = (node) => {
    guard.step();
    if (node == null) {
      return;
    }
    if (snapshot.nodes.has(node)) {
      return;
    }
    snapshot.nodes.set(node, snapshotPointer(node.TopLeft));
    snapshot.nodeGraphs.set(node, node.Graph);
    nodeQueue.push(node);
  };
  const capture = (edge) => {
    // Charge every reference before de-duplication.
    guard.step();
    if (edge == null) {
      return;
    }
    if (snapshot.edges.has(edge)) {
      return;
    }

    const fullPoints = edge.Points ?? [];
    const pointValues = new Array(fullPoints.length);
    const backing = new Array(fullPoints.length);
    for (let index = 0; index < fullPoints.length; index++) {
      guard.step();
      const point = fullPoints[index];
      backing[index] = point;
      pointValues[index] = snapshotPointer(point);
    }
    snapshot.edges.set(edge, newEdgeSnapshot(edge, backing, pointValues));
    captureNode(edge.From);
    captureNode(edge.To);
  };
  if (g != null) {
    for (const edge of g.Edges ?? []) {
      capture(edge);
    }
    for (const node of g.Nodes ?? []) {
      captureNode(node);
      if (node == null) {
        continue;
      }
      for (const edge of node.Edges ?? []) {
        capture(edge);
      }
    }
  }
  for (const edge of extraEdges ?? []) {
    capture(edge);
  }
  // Walk each unique descendant once so rollback covers container, cluster,
  // and sequence members a route helper may move.
  for (let index = 0; index < nodeQueue.length; index++) {
    const node = nodeQueue[index];
    let nodeGraph = node.Graph;
    if (nodeGraph == null) {
      nodeGraph = g;
    }
    if (nodeGraph == null) {
      continue;
    }
    if (node.IsContainer()) {
      for (const child of nodeGraph.Containers?.get(node) ?? []) {
        captureNode(child);
      }
    }
    if (node.IsClusterVessel()) {
      const cluster = nodeGraph.Clusters?.get(node);
      if (cluster != null) {
        for (const child of cluster.Nodes ?? []) {
          captureNode(child);
        }
      }
    }
    const sequence = nodeGraph.Sequences?.get(node);
    if (sequence != null) {
      for (const child of sequence.Nodes ?? []) {
        captureNode(child);
      }
    }
  }
  guard.finish();
  return snapshot;
}

function finite(value) {
  return !Number.isNaN(value) && value !== Infinity && value !== -Infinity;
}

/** validateRouteStageGeometry rejects malformed geometry before capture. */
export function validateRouteStageGeometry(g, extraEdges, guard) {
  const extras = extraEdges ?? [];
  if (extras.length > MaxTopologyReferences) {
    throw new Error(`TALA ${guard.location} extra edge references exceed limit ${MaxTopologyReferences}`);
  }
  const seenNodes = new Set();
  const graphNodes = new Set();
  const validateNode = (node, description) => {
    guard.step();
    if (node == null) {
      throw new Error(`TALA ${guard.location} contains a nil ${description}`);
    }
    if (seenNodes.has(node)) {
      return;
    }
    seenNodes.add(node);
    if (node.TopLeft == null) {
      throw new Error(`TALA ${guard.location} ${description} has no position`);
    }
  };
  const nodes = g.Nodes ?? [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    validateNode(node, `graph node at index ${index}`);
    graphNodes.add(node);
  }

  const seen = new Set();
  let routePointCapacity = 0;
  const validateEdge = (edge, requireGraphEndpoints) => {
    guard.step();
    if (edge == null) {
      throw new Error(`TALA ${guard.location} contains a nil edge`);
    }
    if (seen.has(edge)) {
      return;
    }
    seen.add(edge);
    if (requireGraphEndpoints) {
      if (!graphNodes.has(edge.From)) {
        throw new Error(`graph edge ${edgeIDValue(edge)} source node does not belong to the graph`);
      }
      if (!graphNodes.has(edge.To)) {
        throw new Error(`graph edge ${edgeIDValue(edge)} target node does not belong to the graph`);
      }
    }
    const points = edge.Points ?? [];
    // JS arrays have no spare capacity: cap(edge.Points) == len(edge.Points).
    const capacity = points.length;
    if (routePointCapacity > MaxRoutePoints || capacity > MaxRoutePoints - routePointCapacity) {
      throw new Error(`TALA ${guard.location} route point capacity exceeds limit ${MaxRoutePoints}`);
    }
    routePointCapacity += capacity;
    if (points.length === 1) {
      throw invariantNew(`edge ${edgeIDValue(edge)} has an incomplete route: expected at least two points, got 1`);
    }
    for (const [name, label] of [
      ['label', edge.Label],
      ['source arrowhead label', edge.SourceArrowheadLabel],
      ['target arrowhead label', edge.TargetArrowheadLabel],
    ]) {
      if (label != null && isLabelPositionSet(label.Position) && !isEdgePosition(label.Position)) {
        throw invariantNew(`edge ${edgeIDValue(edge)} ${name} has an invalid edge position`);
      }
    }
    validateNode(edge.From, `edge ${edgeIDValue(edge)} source`);
    validateNode(edge.To, `edge ${edgeIDValue(edge)} target`);
    for (const point of points) {
      guard.step();
      if (point == null) {
        throw new Error(`TALA ${guard.location} edge ${edgeIDValue(edge)} contains a nil route point`);
      }
      if (!finite(point.X) || !finite(point.Y)) {
        throw new Error(`TALA ${guard.location} edge ${edgeIDValue(edge)} has a non-finite route point`);
      }
    }
  };
  for (const edge of g.Edges ?? []) {
    validateEdge(edge, true);
  }
  for (const node of nodes) {
    for (const edge of node.Edges ?? []) {
      validateEdge(edge, false);
    }
  }
  for (const edge of extras) {
    validateEdge(edge, false);
  }
  guard.finish();
}

/**
 * routeStageGraphBoundingBox preserves Graph.BoundingBox geometry while
 * charging the stage aggregate for node extremity scans and every route
 * scan the legacy helpers perform. Returns [topLeft, bottomRight].
 */
export function routeStageGraphBoundingBox(g, guard) {
  if (g == null || guard == null) {
    throw new Error('TALA EdgeRouting bounding box requires a graph and work guard');
  }
  const [topLeft, bottomRight] = FixedBoundingBox(g.Nodes, guard);
  if (topLeft == null || bottomRight == null) {
    throw invariantNew('EdgeRouting bounding box contains an unplaced node');
  }
  let minX = topLeft.X;
  let minY = topLeft.Y;
  let maxX = bottomRight.X;
  let maxY = bottomRight.Y;
  for (const edge of g.Edges ?? []) {
    guard.step();
    const pointCount = (edge.Points ?? []).length;
    guard.add(pointCount);
    const chargeRouteScans = (scans) => {
      for (let scan = 0; scan < scans; scan++) {
        guard.add(pointCount);
      }
    };
    if (pointCount !== 0 && edge.Label != null && isLabelPositionSet(edge.Label.Position)) {
      chargeRouteScans(2);
    }
    if (pointCount !== 0 && edge.SourceArrowheadLabel != null) {
      chargeRouteScans(3);
    }
    if (pointCount !== 0 && edge.TargetArrowheadLabel != null) {
      chargeRouteScans(3);
    }
    const [edgeTopLeft, edgeBottomRight] = edge.BoundingBoxValues();
    if (edgeTopLeft.X !== Infinity && edgeTopLeft.X !== -Infinity) {
      minX = goMin(minX, edgeTopLeft.X);
      minY = goMin(minY, edgeTopLeft.Y);
      maxX = goMax(maxX, edgeBottomRight.X);
      maxY = goMax(maxY, edgeBottomRight.Y);
    }
  }
  guard.finish();
  return [new Point(goRound(minX), goRound(minY)), new Point(goRound(maxX), goRound(maxY))];
}

/**
 * runAtomicRouteStage: topology preflight, then a fresh work guard and the
 * exact mutation boundary around fn(guard).
 */
export function runAtomicRouteStage(ctx, location, g, extraEdges, workLimit, fn) {
  Validate(ctx, location, g);
  runAtomicRouteStageAfterPreflight(ctx, location, g, extraEdges, workLimit, fn);
}

export function runAtomicRouteStageAfterPreflight(ctx, location, g, extraEdges, workLimit, fn) {
  const guard = newRouteWorkGuard(ctx, location, workLimit);
  runAtomicRouteStageWithGuard(g, extraEdges, guard, fn);
}

/**
 * runAtomicRouteStageWithGuard shares the caller's work budget with the
 * mutation boundary. The caller owns the topology preflight.
 */
export function runAtomicRouteStageWithGuard(g, extraEdges, guard, fn) {
  validateRouteStageGeometry(g, extraEdges, guard);
  runAtomicRouteStageWithValidatedGeometry(g, extraEdges, guard, fn);
}

/**
 * runAtomicRouteStageWithValidatedGeometry captures the exact route state,
 * runs fn, and finishes the guard. Any thrown value (Go error or panic)
 * restores the snapshot and is then rethrown unchanged.
 */
export function runAtomicRouteStageWithValidatedGeometry(g, extraEdges, guard, fn) {
  const snapshot = captureRouteMutations(g, extraEdges, guard);
  try {
    fn(guard);
    guard.finish();
  } catch (thrown) {
    snapshot.restore();
    throw thrown;
  }
}

/**
 * stableSortRouteValues is a cancellable bottom-up stable merge sort that
 * sorts `values` in place, preferring the left value on ties.
 */
export function stableSortRouteValues(values, less, guard) {
  const n = values.length;
  if (n < 2) {
    guard.step();
    return;
  }
  const temporary = new Array(n);
  for (let width = 1; width < n;) {
    for (let start = 0; start < n; start += 2 * width) {
      const middle = Math.min(start + width, n);
      const end = Math.min(start + 2 * width, n);
      let left = start;
      let right = middle;
      let output = start;
      while (left < middle && right < end) {
        guard.step();
        if (less(values[right], values[left])) {
          temporary[output] = values[right];
          right++;
        } else {
          temporary[output] = values[left];
          left++;
        }
        output++;
      }
      while (left < middle) {
        guard.step();
        temporary[output] = values[left];
        left++;
        output++;
      }
      while (right < end) {
        guard.step();
        temporary[output] = values[right];
        right++;
        output++;
      }
    }
    guard.add(n);
    for (let i = 0; i < n; i++) {
      values[i] = temporary[i];
    }
    if (width > Math.floor(n / 2)) {
      break;
    }
    width *= 2;
  }
}
