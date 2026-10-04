// Slice 47 — positioned-graph validation consumed by label placement.
//
// Pinned reference: d2layouts/d2talalayout/internal/layoutgraph/positioned_validation.go
// (lives under labeling/ because shared graph files belong to earlier slices).

import { validateEngineGraph } from '../graph/topology-preflight.js';
import { MAX_ENGINE_EDGES, MAX_ENGINE_NODES } from '../limits/constants.js';
import { contextErr, wrapContextError } from './guard.js';

export const maxPositionedRoutePoints = 1_000_000;

function entityID(edge) {
  return String(edge.entityID());
}

/**
 * ValidatePositionedGraphSelection checks the topology and positioned route
 * geometry consumed by label placement and completed-layout evaluation.
 * extraEdges may repeat graph edges once (the normal route-only selection),
 * but neither input list may contain aliases within itself. Throws the error
 * Go returns.
 */
export function ValidatePositionedGraphSelection(ctx, operation, graph, extraEdges) {
  // Keep the central topology preflight first: its graph-before-context error
  // order is part of the direct engine API contract.
  validateEngineGraph(ctx, operation, graph);
  if (ctx == null) {
    throw new Error(`TALA ${operation} requires a context`);
  }
  let err = contextErr(ctx);
  if (err != null) {
    throw wrapContextError(operation, err);
  }
  if (graph == null) {
    throw new Error(`TALA ${operation} requires a graph`);
  }
  const extras = extraEdges ?? [];
  if (graph.Nodes.length > MAX_ENGINE_NODES) {
    throw new Error(`TALA ${operation} node count exceeds limit ${MAX_ENGINE_NODES}`);
  }
  if (graph.Edges.length > MAX_ENGINE_EDGES) {
    throw new Error(`TALA ${operation} edge count exceeds limit ${MAX_ENGINE_EDGES}`);
  }
  if (extras.length > MAX_ENGINE_EDGES) {
    throw new Error(`TALA ${operation} requested edge count exceeds limit ${MAX_ENGINE_EDGES}`);
  }

  let checks = 0;
  const checkContext = () => {
    checks++;
    if (checks % 64 !== 0) {
      return;
    }
    const e = contextErr(ctx);
    if (e != null) {
      throw wrapContextError(operation, e);
    }
  };
  for (let index = 0; index < graph.Nodes.length; index++) {
    const node = graph.Nodes[index];
    checkContext();
    if (node == null) {
      throw new Error(`TALA ${operation} graph node at index ${index} is nil`);
    }
    if (node.TopLeft == null) {
      throw new Error(`TALA ${operation} graph node ${String(node.ID)} has no position`);
    }
    if (node.Cluster != null && node.Cluster.Vessel == null) {
      throw new Error(`TALA ${operation} graph node ${String(node.ID)} has a cluster without a vessel`);
    }
    if (node.Sequence != null && node.Sequence.Vessel == null) {
      throw new Error(`TALA ${operation} graph node ${String(node.ID)} has a sequence without a vessel`);
    }
  }

  const seenGraphEdges = new Set();
  const seenRequestedEdges = new Set();
  const validatedEdges = new Set();
  let routePoints = 0;
  const validateEdge = (edge, index, kind, seenInList) => {
    checkContext();
    if (edge == null) {
      throw new Error(`TALA ${operation} ${kind} at index ${index} is nil`);
    }
    if (seenInList.has(edge)) {
      throw new Error(`TALA ${operation} ${kind} at index ${index} repeats edge ${entityID(edge)}`);
    }
    seenInList.add(edge);
    if (validatedEdges.has(edge)) {
      return;
    }
    validatedEdges.add(edge);
    if (edge.From == null || edge.To == null) {
      throw new Error(`TALA ${operation} edge ${entityID(edge)} has missing endpoints`);
    }
    const points = edge.Points ?? [];
    if (points.length > maxPositionedRoutePoints - routePoints) {
      throw new Error(`TALA ${operation} route point count exceeds limit ${maxPositionedRoutePoints}`);
    }
    routePoints += points.length;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      checkContext();
      if (points[pointIndex] == null) {
        throw new Error(`TALA ${operation} edge ${entityID(edge)} route point at index ${pointIndex} is nil`);
      }
    }
    if ((edge.Label != null || edge.SourceArrowheadLabel != null || edge.TargetArrowheadLabel != null) && points.length < 2) {
      throw new Error(`TALA ${operation} labeled edge ${entityID(edge)} requires at least two route points`);
    }
  };
  for (let index = 0; index < graph.Edges.length; index++) {
    validateEdge(graph.Edges[index], index, 'graph edge', seenGraphEdges);
  }
  for (let index = 0; index < extras.length; index++) {
    validateEdge(extras[index], index, 'requested edge', seenRequestedEdges);
  }
  err = contextErr(ctx);
  if (err != null) {
    throw wrapContextError(operation, err);
  }
}
