// Slice 47 — standalone route entry points.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/standalone_router.go

import { Validate } from '../graph/topology-preflight.js';
import { MaxTopologyReferences, edgeIDValue } from './layoutgraph-route-support.js';
import { defaultOVGBuildLimits } from './ovg-resource.js';
import { MAX_ROUTE_STAGE_WORK_UNITS } from './route-guards.js';
import { runAtomicRouteStageAfterPreflight } from './route-stage.js';
import { routeAdditionalEdgesWithLimits } from './coordinator.js';
import {
  tryStraightEdgeFallbackGuarded,
  reorderDuplicatesInEdgesGuarded,
  traceToShapeBorderGuarded,
} from './standalone-route-guard.js';
import {
  isSpecialEdgeForBalancing,
  balanceRegularEdgesGuarded,
} from './postprocess-balance.js';
import { PlaceNewEdges } from '../labeling/placement.js';

export function hasCompleteEdgeRoute(edge) {
  if (edge == null || edge.Points == null || edge.Points.length < 2) {
    return false;
  }
  for (const point of edge.Points) {
    if (point == null) {
      return false;
    }
  }
  return true;
}

export function RouteEdges(ctx, g, edges) {
  return routeEdgesWithBudgets(ctx, g, edges, defaultOVGBuildLimits(), MAX_ROUTE_STAGE_WORK_UNITS);
}

export function routeEdgesWithBudgets(ctx, g, edges, ovgLimits, workLimit) {
  if (g == null) {
    throw new Error('cannot route edges on a nil graph');
  }
  if (ctx == null) {
    throw new Error('cannot route edges without a context');
  }
  if (ctx.Err != null && ctx.Err() != null) {
    throw ctx.Err();
  }
  if (edges != null && edges.length > MaxTopologyReferences) {
    throw new Error(`TALA EdgeRouting selected edge references exceed limit ${MaxTopologyReferences}`);
  }
  Validate(ctx, 'RouteEdges', g);
  if (edges == null || edges.length === 0) {
    return;
  }
  if (g.Nodes == null || g.Nodes.length === 0) {
    throw new Error('cannot route edges on an empty graph');
  }
  if (edges.length > g.Edges.length) {
    throw new Error(`selected edge count ${edges.length} exceeds graph edge count ${g.Edges.length}`);
  }

  const graphNodes = new Set();
  for (let index = 0; index < g.Nodes.length; index++) {
    const node = g.Nodes[index];
    if (node == null) {
      throw new Error(`graph node at index ${index} is nil`);
    }
    graphNodes.add(node);
  }
  const graphEdges = new Set();
  for (let index = 0; index < g.Edges.length; index++) {
    const edge = g.Edges[index];
    if (edge == null) {
      throw new Error(`graph edge at index ${index} is nil`);
    }
    if (edge.From == null || edge.To == null || edge.From.TopLeft == null || edge.To.TopLeft == null) {
      throw new Error(`graph edge ${edgeIDValue(edge)} has unplaced or missing endpoints`);
    }
    if (!graphNodes.has(edge.From)) {
      throw new Error(`graph edge ${edgeIDValue(edge)} source node does not belong to the graph`);
    }
    if (!graphNodes.has(edge.To)) {
      throw new Error(`graph edge ${edgeIDValue(edge)} target node does not belong to the graph`);
    }
    graphEdges.add(edge);
  }
  const selected = new Set();
  for (const edge of edges) {
    if (edge == null) {
      throw new Error('cannot route a nil edge');
    }
    if (!graphEdges.has(edge)) {
      throw new Error(`edge ${edgeIDValue(edge)} does not belong to the graph`);
    }
    if (selected.has(edge)) {
      throw new Error(`edge ${edgeIDValue(edge)} was selected more than once`);
    }
    selected.add(edge);
  }
  for (const edge of g.Edges) {
    if (selected.has(edge)) {
      continue;
    }
    if (!hasCompleteEdgeRoute(edge)) {
      throw new Error(`unselected edge ${edgeIDValue(edge)} has no complete route`);
    }
  }

  return runAtomicRouteStageAfterPreflight(ctx, 'EdgeRouting', g, edges, workLimit, (guard) => {
    guard.add(g.Nodes.length);
    g.ComputeCellSize();

    routeAdditionalEdgesWithLimits(ctx, g, edges, ovgLimits);
    guard.step();

    for (const edge of edges) {
      if (edge.HasTableColumn()) {
        guard.step();
        continue;
      }
      tryStraightEdgeFallbackGuarded(g, edge, guard);
    }

    const lockedEdges = [];
    for (const edge of g.Edges) {
      guard.step();
      if (!selected.has(edge)) {
        lockedEdges.push(edge);
      }
    }
    const regularEdges = [];
    for (const edge of edges) {
      guard.step();
      if (isSpecialEdgeForBalancing(g, edge)) {
        lockedEdges.push(edge);
        continue;
      }
      regularEdges.push(edge);
    }
    balanceRegularEdgesGuarded(g, lockedEdges, regularEdges, guard);

    for (const edge of edges) {
      traceToShapeBorderGuarded(edge, guard);
    }
    reorderDuplicatesInEdgesGuarded(edges, guard);
    guard.step();
    PlaceNewEdges(ctx, g, edges);
    return guard.finish();
  });
}
