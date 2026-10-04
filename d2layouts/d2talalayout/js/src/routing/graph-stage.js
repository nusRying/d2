// Slice 47 — whole-graph route stage.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/graph_stage.go

import { Validate } from '../graph/topology-preflight.js';
import { SplitOptions } from '../graph/structural-access.js';
import { invariantNew } from '../hierarchy/layoutgraph-support.js';
import { edgeIDValue } from './layoutgraph-route-support.js';
import { OVERSHOOT_AMOUNT } from './tuning.js';
import { defaultOVGBuildLimits, newOVGBuildGuard } from './ovg-resource.js';
import {
  newRouteWorkGuard,
  contextWithRouteAggregateWork,
  MAX_EDGE_ROUTING_STAGE_WORK_UNITS,
  MAX_ROUTE_SEARCH_WORK_UNITS,
} from './route-guards.js';
import {
  validateRouteStageGeometry,
  routeStageGraphBoundingBox,
  runAtomicRouteStageWithValidatedGeometry,
} from './route-stage.js';
import { routeEdgesWithResourceGuards } from './coordinator.js';
import { hasCompleteEdgeRoute } from './standalone-router.js';

export class GraphRouteOptions {
  constructor({
    ForceReroute = false,
    RoutesPreviouslyCompleted = false,
    Observer = null,
    CompletionObserver = null,
  } = {}) {
    this.ForceReroute = ForceReroute;
    this.RoutesPreviouslyCompleted = RoutesPreviouslyCompleted;
    this.Observer = Observer;
    this.CompletionObserver = CompletionObserver;
  }
}

export function RouteGraph(ctx, graph, options = {}) {
  return RouteGraphWithWorkLimit(ctx, graph, options, MAX_EDGE_ROUTING_STAGE_WORK_UNITS);
}

export function RouteGraphWithWorkLimit(ctx, graph, options = {}, workLimit = MAX_EDGE_ROUTING_STAGE_WORK_UNITS) {
  let routingComplete = Boolean(options.RoutesPreviouslyCompleted);
  if (graph == null) {
    throw new Error('TALA EdgeRouting requires a graph');
  }
  const guard = newRouteWorkGuard(ctx, 'EdgeRouting', workLimit);

  Validate(ctx, 'EdgeRouting', graph);
  validateRouteStageGeometry(graph, null, guard);
  if (graph.Edges == null || graph.Edges.length === 0) {
    guard.finish();
    return routingComplete;
  }

  if (!options.ForceReroute && options.RoutesPreviouslyCompleted) {
    let routedEdges = 0;
    for (const edge of graph.Edges) {
      guard.step();
      if (edge.Points == null || edge.Points.length === 0) {
        continue;
      }
      if (!hasCompleteEdgeRoute(edge)) {
        throw invariantNew(
          `edge ${edgeIDValue(edge)} has an incomplete route: expected at least two non-nil points, got ${edge.Points.length}`,
        );
      }
      routedEdges++;
    }
    if (routedEdges === graph.Edges.length) {
      routingComplete = true;
      if (options.CompletionObserver != null && typeof options.CompletionObserver.RoutingCompleted === 'function') {
        options.CompletionObserver.RoutingCompleted();
      }
      guard.finish();
      return routingComplete;
    }
    if (routedEdges !== 0) {
      throw invariantNew(
        `graph is partially routed: ${routedEdges} of ${graph.Edges.length} edges have routes`,
      );
    }
  }

  runAtomicRouteStageWithValidatedGeometry(graph, null, guard, (stageGuard) => {
    const routingCtx = contextWithRouteAggregateWork(ctx, stageGuard);
    const ovgGuard = newOVGBuildGuard(routingCtx, defaultOVGBuildLimits());

    const [subgraphs, splitOwnership] = graph.SplitSubgraphsTracked(ctx, new SplitOptions({
      IncludeContainers: true,
      IncludeNears: true,
    }), stageGuard);

    try {
      stageGuard.add(subgraphs.length);
      for (const subgraph of subgraphs) {
        stageGuard.step();
        if (subgraph.Edges == null || subgraph.Edges.length === 0) {
          continue;
        }
        stageGuard.add(subgraph.Nodes.length);
        const [topLeft, bottomRight] = routeStageGraphBoundingBox(subgraph, stageGuard);
        topLeft.X -= OVERSHOOT_AMOUNT;
        topLeft.Y -= OVERSHOOT_AMOUNT;
        bottomRight.X += OVERSHOOT_AMOUNT;
        bottomRight.Y += OVERSHOOT_AMOUNT;
        const nodesInBoundingBox = [];
        for (const otherSubgraph of subgraphs) {
          stageGuard.step();
          if (otherSubgraph === subgraph) {
            continue;
          }
          for (const node of otherSubgraph.Nodes ?? []) {
            stageGuard.step();
            if (node.isWithinBounds(topLeft, bottomRight)) {
              let overlapsSubgraph = false;
              for (const subgraphNode of subgraph.Nodes ?? []) {
                stageGuard.step();
                if (node.doesOverlapExact(subgraphNode)) {
                  overlapsSubgraph = true;
                  break;
                }
              }
              if (!overlapsSubgraph) {
                nodesInBoundingBox.push(node);
              }
            }
          }
        }

        stageGuard.add(subgraph.Nodes.length + subgraph.Edges.length);
        subgraph.ComputeCellSize();
        const ovg = routeEdgesWithResourceGuards(routingCtx, subgraph, nodesInBoundingBox, ovgGuard, MAX_ROUTE_SEARCH_WORK_UNITS);

        stageGuard.step();
        if (options.Observer != null && typeof options.Observer.SubgraphRouted === 'function') {
          const obsErr = options.Observer.SubgraphRouted(ovg);
          if (obsErr != null) {
            throw obsErr;
          }
        }
      }

      const seenNodes = new Set();
      const nodesToRestore = [];
      const enqueue = (node) => {
        stageGuard.step();
        if (node == null) {
          return;
        }
        if (seenNodes.has(node)) {
          return;
        }
        seenNodes.add(node);
        nodesToRestore.push(node);
      };
      for (const subgraph of subgraphs) {
        for (const node of subgraph.Nodes ?? []) {
          enqueue(node);
        }
      }
      for (let index = 0; index < nodesToRestore.length; index++) {
        const node = nodesToRestore[index];
        const [originalGraph, captured] = splitOwnership.OriginalGraph(node);
        if (captured) {
          node.Graph = originalGraph;
        } else {
          node.Graph = graph;
        }
        if (node.isContainer) {
          for (const child of graph.Containers?.get(node) ?? []) {
            enqueue(child);
          }
        }
        if (node.isClusterVessel) {
          const cluster = graph.Clusters?.get(node);
          if (cluster != null) {
            for (const child of cluster.Nodes ?? []) {
              enqueue(child);
            }
          }
        }
        const sequence = graph.Sequences?.get(node);
        if (sequence != null) {
          for (const child of sequence.Nodes ?? []) {
            enqueue(child);
          }
        }
      }

      routingComplete = true;
      if (options.CompletionObserver != null && typeof options.CompletionObserver.RoutingCompleted === 'function') {
        options.CompletionObserver.RoutingCompleted();
      }
    } finally {
      splitOwnership.Restore();
    }
  });

  return routingComplete;
}
