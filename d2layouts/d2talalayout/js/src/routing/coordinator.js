// Slice 47 — Route coordinator.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/coordinator.go

import { intersects } from './geometry.js';
import {
  edgeEquivalentStyles,
  edgeMatchingArrowheads,
  edgeOwnArrowheadsMatch,
  PointValueMap,
} from './layoutgraph-route-support.js';
import { Orientation, getOpposite, isVertical } from '../geometry/orientation.js';
import { Edge } from '../graph/edge.js';
import { precisionCompare, PRECISION } from '../geometry/math.js';
import { PositionArrowheadLabel } from '../labeling/arrowhead.js';
import { MIN_STRAIGHT_EDGE_ANGLE, NON_ORTHOGONAL_FACTOR } from './tuning.js';
import { ErrInvalidCandidate } from '../graph/transaction.js';
import { goSortSlice } from '../packing/go-support.js';
import { invariantNew } from '../hierarchy/layoutgraph-support.js';
import { Route } from './route.js';
import { NewOVGNode } from './ovg-node.js';
import { nonNilEquals } from './ovg-edge.js';
import { treeEdgePath } from './tree-routes.js';
import { routeLoops } from '../loops/loops.js';
import { buildOVGFromGraphWithGuard, buildOVGFromGraphWithLimits } from './ovg.js';
import { newOVGEdgeRouterWithWorkLimit } from './ovg-edge-router.js';
import {
  MAX_ROUTE_SEARCH_FLAVORS,
  MAX_ROUTE_SEARCH_WORK_UNITS,
  errRouteStageWorkLimit,
  errRouteSearchWorkLimit,
  errorIs,
} from './route-guards.js';
import {
  portEdgesGuarded,
  edgeHasDuplicateInGuarded,
  overlappingEdgesGuarded,
  sourceAndTargetClusterNodesGuarded,
  filterEdgeAncestorsGuarded,
  positionedArrowheadLabelCostGuarded,
  edgeCanOverlapEdgesGuarded,
} from './standalone-route-guard.js';
import {
  routeIntersectsNodeGuarded,
  estimateRouteCostGuarded,
} from './cluster-route-guard.js';
import { positionedArrowheadLabelCost } from './slingshot.js';

export const AxisAlignmentTolerance = 1.0;

export const RouteGenerationFlavor = Object.freeze({
  ShortestToLongest: 'ShortestToLongest',
  LongestToShortest: 'LongestToShortest',
  Default: 'Default',
  TopDownLeftRight: 'TopDownLeftRight',
});

export class GenerateRouteResponse {
  constructor() {
    this.Routes = [];
    this.Distance = 0.0;
    this.Err = null;
    this.Flavor = RouteGenerationFlavor.ShortestToLongest;
    this.work = null;
  }
}

export class RouteWorkerPanic {
  constructor(flavor) {
    this.flavor = flavor;
  }

  asError() {
    return invariantNew(`edge routing flavor ${this.flavor} violated an invariant`);
  }
}

export function runRouteFlavorWorker(
  ctx,
  index,
  router,
  straightLineFallback,
  worker = null,
) {
  let flavor = null;
  if (router != null) {
    flavor = router.flavor;
  }
  const result = {
    index,
    response: new GenerateRouteResponse(),
    workerPanic: null,
  };
  result.response.Flavor = flavor;

  try {
    const fn = worker ?? ((r, c, s) => r.generateRoutes(c, s));
    result.response = fn(router, ctx, straightLineFallback);
  } catch (err) {
    result.response = new GenerateRouteResponse();
    result.workerPanic = new RouteWorkerPanic(flavor);
  }
  result.response.Flavor = flavor;
  return result;
}

export function generateRouteFlavorResponses(ctx, routers, straightLineFallback) {
  return generateRouteFlavorResponsesWith(ctx, routers, straightLineFallback, (r, c, s) => r.generateRoutes(c, s));
}

export function generateRouteFlavorResponsesWith(
  ctx,
  routers,
  straightLineFallback,
  worker,
) {
  const routerList = routers ?? [];
  if (routerList.length > MAX_ROUTE_SEARCH_FLAVORS) {
    throw new Error(
      `${errRouteSearchWorkLimit.message}: edge routing declared ${routerList.length} flavors; limit ${MAX_ROUTE_SEARCH_FLAVORS}`,
      { cause: errRouteSearchWorkLimit }
    );
  }

  const results = [];
  for (let i = 0; i < routerList.length; i++) {
    results.push(runRouteFlavorWorker(ctx, i, routerList[i], straightLineFallback, worker));
  }

  // Worker completion order is scheduler-dependent in Go; restore declared order:
  goSortSlice(results, (a, b) => a.index < b.index);

  for (const result of results) {
    if (result.workerPanic != null) {
      throw result.workerPanic.asError();
    }
  }

  if (ctx?.Err != null && ctx.Err() != null) {
    throw new Error(`EdgeRouting: ${ctx.Err().message ?? String(ctx.Err())}`, { cause: ctx.Err() });
  }

  const responses = new Array(results.length);
  for (let i = 0; i < results.length; i++) {
    responses[i] = results[i].response;
  }
  return responses;
}

export function successfulRouteFlavorResponses(responses) {
  const successful = new Map();
  let firstError = null;
  for (const response of responses ?? []) {
    if (response.Err != null) {
      if (errorIs(response.Err, errRouteStageWorkLimit)) {
        throw response.Err;
      }
      if (firstError == null) {
        firstError = response.Err;
      }
      continue;
    }
    successful.set(response.Flavor, response);
  }

  if (successful.size > 0) {
    return successful;
  }
  if (firstError != null) {
    throw firstError;
  }
  throw invariantNew('edge routing produced no flavor responses');
}

export function finalizeSelectedRoutes(ctx, g, routes, selectedEdges, work, reorderParallelEdges) {
  if (work == null) {
    throw invariantNew('selected edge-routing flavor has no work guard');
  }
  if (g == null) {
    throw invariantNew('selected edge-routing flavor has no graph');
  }
  work.bind(ctx);
  let finished = false;
  try {
    let activeRoutes = routes ?? [];
    if (selectedEdges != null) {
      const selectedRoutes = [];
      const found = new Set();
      for (const route of activeRoutes) {
        work.step();
        if (route == null) {
          throw invariantNew('selected edge-routing flavor produced a nil route');
        }
        if (!selectedEdges.has(route.GEdge)) {
          continue;
        }
        if (found.has(route.GEdge)) {
          throw invariantNew('selected edge-routing flavor produced duplicate routes for an edge');
        }
        found.add(route.GEdge);
        selectedRoutes.push(route);
      }
      if (found.size !== selectedEdges.size) {
        throw invariantNew('selected edge-routing flavor omitted a requested edge');
      }
      activeRoutes = selectedRoutes;
    }

    for (const route of activeRoutes) {
      work.step();
      if (route == null || route.GEdge == null || route.GEdge.From == null || route.GEdge.To == null || (route.OVGNodes?.length ?? 0) < 2) {
        throw invariantNew('selected edge-routing flavor produced an invalid route');
      }
      for (const node of route.OVGNodes) {
        work.step();
        if (node == null || node.Point == null) {
          throw invariantNew('selected edge-routing flavor produced an invalid route node');
        }
      }
    }

    if (reorderParallelEdges) {
      reorderSelectedRoutes(g, activeRoutes, work);
    }

    work.add(activeRoutes.length);
    const updates = [];
    for (const route of activeRoutes) {
      work.step();
      work.add(route.OVGNodes.length);
      updates.push({
        edge: route.GEdge,
        points: route.createSegmentEndpoints(),
      });
    }
    work.finish();

    for (const update of updates) {
      update.edge.Points = update.points;
    }
    finished = true;
  } finally {
    if (!finished) {
      try {
        work.finish();
      } catch (_) {
        // ignore in finally
      }
    }
  }
}

export function reorderSelectedRoutes(g, routes, work) {
  work.add(routes.length);
  const buckets = [];
  const grouped = new Set();
  for (let index = 0; index < routes.length; index++) {
    work.step();
    const route = routes[index];
    if (grouped.has(route)) {
      continue;
    }
    const bucket = [route];
    grouped.add(route);
    for (let j = index + 1; j < routes.length; j++) {
      work.step();
      const other = routes[j];
      if (grouped.has(other)) {
        continue;
      }
      const canSwap = route.canSwapEdgesGuarded(other, routes, work);
      if (canSwap) {
        bucket.push(other);
        grouped.add(other);
      }
    }
    if (bucket.length > 1) {
      buckets.push(bucket);
    }
  }

  work.add(g.Edges.length);
  const edgeIndices = new Map();
  for (let index = 0; index < g.Edges.length; index++) {
    work.step();
    edgeIndices.set(g.Edges[index], index);
  }

  for (const bucket of buckets) {
    work.step();
    work.reserveSort(bucket.length);
    // Sort bucket from left-right or top-bottom.
    goSortSlice(bucket, (e1, e2) => {
      const n1 = e1.GEdge.From;
      const n2 = e1.GEdge.To;
      if (isVertical(n1.Orientation(n2))) {
        if (e1.GEdge.From === e2.GEdge.From) {
          return e1.FromPort.X < e2.FromPort.X;
        }
        return e1.FromPort.X < e2.ToPort.X;
      }
      if (e1.GEdge.From === e2.GEdge.From) {
        return e1.FromPort.Y < e2.FromPort.Y;
      }
      return e1.FromPort.Y < e2.ToPort.Y;
    });

    work.add(bucket.length);
    const edges = new Array(bucket.length);
    for (let index = 0; index < bucket.length; index++) {
      work.step();
      edges[index] = bucket[index].GEdge;
    }
    work.reserveSort(edges.length);
    goSortSlice(edges, (leftEdge, rightEdge) => {
      const left = edgeIndices.has(leftEdge) ? edgeIndices.get(leftEdge) : -1;
      const right = edgeIndices.has(rightEdge) ? edgeIndices.get(rightEdge) : -1;
      return left < right;
    });

    for (let index = 0; index < bucket.length; index++) {
      work.step();
      const route = bucket[index];
      if (route.GEdge.From !== edges[index].From) {
        work.add(route.OVGNodes.length);
        const tmpPort = route.FromPort;
        route.FromPort = route.ToPort;
        route.ToPort = tmpPort;
        route.OVGNodes.reverse();
      }
      route.GEdge = edges[index];
    }
  }
  work.check();
}

/** isVerticalOrHorizontalOverlap: parallel axis-aligned segments that touch. */
export function isVerticalOrHorizontalOverlap(start, end, otherStart, otherEnd) {
  const bothVertical = start.X === end.X && otherStart.X === otherEnd.X;
  const bothHorizontal = start.Y === end.Y && otherStart.Y === otherEnd.Y;
  if (bothVertical || bothHorizontal) {
    if (intersects(otherStart, otherEnd, start, end)) {
      return true;
    }
  }
  return false;
}

export function findOverlappingEdges(start, end, otherEdges) {
  const overlappingEdges = [];
  for (const e of otherEdges ?? []) {
    const points = e.Points ?? [];
    for (let i = 0; i < points.length - 1; i++) {
      if (isVerticalOrHorizontalOverlap(start, end, points[i], points[i + 1])) {
        overlappingEdges.push(e);
        break;
      }
    }
  }
  return overlappingEdges;
}

/**
 * edgeCanOverlapEdges reports whether `edge` may share route segments with
 * every edge in otherEdges. The cluster-node maps are Sets (or Maps) keyed by
 * node; only membership and size are read.
 */
export function edgeCanOverlapEdges(edge, otherEdges, sourceClusterNodes, targetClusterNodes) {
  const others = otherEdges ?? [];
  if (others.length === 0) {
    return true;
  }
  if (edge.TargetArrowheadLabel != null || edge.SourceArrowheadLabel != null) {
    return false;
  }
  for (const e of others) {
    if (e.TargetArrowheadLabel != null || e.SourceArrowheadLabel != null) {
      return false;
    }
    if (!edgeEquivalentStyles(edge, e)) {
      return false;
    }
  }

  const sourceSize = sourceClusterNodes == null ? 0 : (sourceClusterNodes.size ?? Object.keys(sourceClusterNodes).length);
  const targetSize = targetClusterNodes == null ? 0 : (targetClusterNodes.size ?? Object.keys(targetClusterNodes).length);
  const sourceHas = (n) => sourceClusterNodes != null && (typeof sourceClusterNodes.has === 'function' ? sourceClusterNodes.has(n) : Boolean(sourceClusterNodes[n]));
  const targetHas = (n) => targetClusterNodes != null && (typeof targetClusterNodes.has === 'function' ? targetClusterNodes.has(n) : Boolean(targetClusterNodes[n]));

  let isClusterEdge = false;
  if (sourceSize > 0) {
    let hasNonSourceClusterEdge = false;
    for (const otherEdge of others) {
      const isFromSourceCluster = sourceHas(otherEdge.From);
      const isToSourceCluster = sourceHas(otherEdge.To);
      if (!isFromSourceCluster && !isToSourceCluster) {
        hasNonSourceClusterEdge = true;
        break;
      }
    }
    if (!hasNonSourceClusterEdge) {
      isClusterEdge = true;
    }
  }
  if (!isClusterEdge && targetSize > 0) {
    let hasNonTargetClusterEdge = false;
    for (const otherEdge of others) {
      const isFromTargetCluster = targetHas(otherEdge.From);
      const isToTargetCluster = targetHas(otherEdge.To);
      if (!isFromTargetCluster && !isToTargetCluster) {
        hasNonTargetClusterEdge = true;
        break;
      }
    }
    if (!hasNonTargetClusterEdge) {
      isClusterEdge = true;
    }
  }

  // If directed edges share a source or target, they can share an edge.
  let allMatchingDirected = edge.IsDirected();
  if (allMatchingDirected) {
    for (const otherEdge of others) {
      if (!otherEdge.IsDirected()) {
        allMatchingDirected = false;
        break;
      }
      if (!(edge.To === otherEdge.To || edge.From === otherEdge.From)) {
        allMatchingDirected = false;
        break;
      }
      if (edge.TargetArrowhead !== otherEdge.TargetArrowhead || edge.SourceArrowhead !== otherEdge.SourceArrowhead) {
        allMatchingDirected = false;
        break;
      }
    }
  }
  if (allMatchingDirected) {
    return true;
  }

  let allUndirected = false;
  const allBidirectional = edge.IsBidirectional() && edgeOwnArrowheadsMatch(edge);
  if (allBidirectional) {
    for (const otherEdge of others) {
      if (!otherEdge.IsBidirectional() || !edgeMatchingArrowheads(edge, otherEdge)) {
        return false;
      }
    }
  } else {
    allUndirected = edge.IsUndirected();
    if (allUndirected) {
      for (const otherEdge of others) {
        if (!otherEdge.IsUndirected()) {
          return false;
        }
      }
    }
  }
  if (!allBidirectional && !allUndirected) {
    return false;
  }

  if (isClusterEdge) {
    return true;
  }

  // Assuming no self-loops (node appears once per edge).
  const nodeCounts = new Map();
  const bump = (node) => nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);
  bump(edge.From);
  bump(edge.To);
  for (const otherEdge of others) {
    bump(otherEdge.From);
    bump(otherEdge.To);
  }
  // Order-independent: any node shared by every edge proves the overlap safe.
  const totalEdgeCount = others.length + 1;
  for (const count of nodeCounts.values()) {
    if (count === totalEdgeCount) {
      return true;
    }
  }
  return false;
}

export function sourceAndTargetClusterNodes(g, source, target) {
  const sourceClusterNodes = new Map();
  const targetClusterNodes = new Map();

  const clusters = g.Clusters instanceof Map ? Array.from(g.Clusters.values()) : Object.values(g.Clusters ?? {});
  for (const cluster of clusters) {
    let isSource = false;
    let isTarget = false;
    for (const clusterNode of cluster.Nodes ?? []) {
      if (clusterNode === source) isSource = true;
      if (clusterNode === target) isTarget = true;
    }
    if (isSource) {
      for (const clusterNode of cluster.Nodes ?? []) {
        if (clusterNode !== source) {
          sourceClusterNodes.set(clusterNode, true);
        }
      }
    }
    if (isTarget) {
      for (const clusterNode of cluster.Nodes ?? []) {
        if (clusterNode !== target) {
          targetClusterNodes.set(clusterNode, true);
        }
      }
    }
  }
  return [sourceClusterNodes, targetClusterNodes];
}

export function maxSideLength(node, orientation) {
  if (orientation === Orientation.Top || orientation === Orientation.Bottom) {
    return node.Width;
  }
  if (orientation === Orientation.Left || orientation === Orientation.Right) {
    return node.Height;
  }
  return Math.max(node.Width, node.Height);
}

export function hasSharpAngleToBorder(fromPoint, toPoint, orientation) {
  if (orientation === Orientation.Top || orientation === Orientation.Bottom) {
    const dx = toPoint.X - fromPoint.X;
    const dy = toPoint.Y - fromPoint.Y;
    let angle = Math.abs(180 * Math.atan2(dy, dx) / Math.PI);
    if (angle > 90) {
      angle = 180 - angle;
    }
    return angle < MIN_STRAIGHT_EDGE_ANGLE;
  }
  if (orientation === Orientation.Left || orientation === Orientation.Right) {
    const dx = toPoint.X - fromPoint.X;
    const dy = toPoint.Y - fromPoint.Y;
    let angle = Math.abs(180 * Math.atan2(dx, dy) / Math.PI);
    if (angle > 90) {
      angle = 180 - angle;
    }
    return angle < MIN_STRAIGHT_EDGE_ANGLE;
  }
  return false;
}

export function routeLine(ctx, g, edge, allEdges, routes) {
  return routeLineChecked(g, edge, allEdges, routes, null, null);
}

export function routeLineGuarded(g, edge, allEdges, routes, guard) {
  return routeLineChecked(g, edge, allEdges, routes, guard ? () => guard.step() : null, guard);
}

export function routeLineChecked(
  g,
  edge,
  allEdges,
  routes,
  checkWork,
  guard,
) {
  if (checkWork) {
    checkWork();
  }
  const fromOrientation = edge.From.Orientation(edge.To);
  if (fromOrientation === Orientation.None) {
    throw ErrInvalidCandidate;
  }
  const fromPorts = edge.From.PortsByOrientation(getOpposite(fromOrientation));

  const toOrientation = edge.To.Orientation(edge.From);
  if (toOrientation === Orientation.None) {
    throw ErrInvalidCandidate;
  }
  const toPorts = edge.To.PortsByOrientation(getOpposite(toOrientation));

  let fromPortEdges;
  let toPortEdges;
  const noopGuard = { step() {}, add() {}, check() {} };
  if (guard == null) {
    fromPortEdges = portEdgesGuarded(allEdges, edge.From, noopGuard);
    toPortEdges = portEdgesGuarded(allEdges, edge.To, noopGuard);
  } else {
    fromPortEdges = portEdgesGuarded(allEdges, edge.From, guard);
    toPortEdges = portEdgesGuarded(allEdges, edge.To, guard);
  }

  const filterEdge = (portEdgesList) => {
    const filteredEdges = [];
    for (const e of portEdgesList ?? []) {
      if (checkWork) checkWork();
      if (e !== edge) {
        filteredEdges.push(e);
      }
    }
    return filteredEdges;
  };

  if (fromPortEdges instanceof PointValueMap) {
    for (const [fromPort, portEdgesList] of fromPortEdges.entries()) {
      fromPortEdges.set(fromPort, filterEdge(portEdgesList));
    }
  }
  if (toPortEdges instanceof PointValueMap) {
    for (const [toPort, portEdgesList] of toPortEdges.entries()) {
      toPortEdges.set(toPort, filterEdge(portEdgesList));
    }
  }

  const fromNodeCenterPorts = new PointValueMap();
  for (const centerPort of edge.From.CenterPorts()) {
    fromNodeCenterPorts.set(centerPort, true);
  }
  const toNodeCenterPorts = new PointValueMap();
  for (const centerPort of edge.To.CenterPorts()) {
    toNodeCenterPorts.set(centerPort, true);
  }

  let sourceClusterNodes;
  let targetClusterNodes;
  if (guard == null) {
    [sourceClusterNodes, targetClusterNodes] = sourceAndTargetClusterNodes(g, edge.From, edge.To);
  } else {
    [sourceClusterNodes, targetClusterNodes] = sourceAndTargetClusterNodesGuarded(g, edge.From, edge.To, guard);
  }

  let nonAncestors = null;
  if (edge.SourceArrowheadLabel != null || edge.TargetArrowheadLabel != null) {
    if (guard == null) {
      nonAncestors = filterEdgeAncestorsGuarded(edge, g.Nodes, noopGuard);
    } else {
      nonAncestors = filterEdgeAncestorsGuarded(edge, g.Nodes, guard);
    }
  }

  const positionedLabels = [];
  const edgesList = allEdges ?? [];
  for (let i = 0; i < edgesList.length; i++) {
    if (checkWork) checkWork();
    const e = edgesList[i];
    if (e === edge) {
      continue;
    }
    let route;
    if (routes != null) {
      route = routes[i].createSegmentEndpoints();
    } else {
      route = e.Points;
    }
    if (route == null || route.length === 0) {
      continue;
    }
    if (guard != null) {
      guard.add(route.length);
    }
    const palSource = PositionArrowheadLabel(e, false, route);
    if (palSource != null) {
      positionedLabels.push(palSource);
    }
    const palTarget = PositionArrowheadLabel(e, true, route);
    if (palTarget != null) {
      positionedLabels.push(palTarget);
    }
  }

  let bestCost = Infinity;
  let bestFromPort = null;
  let bestToPort = null;

  for (let fromI = 0; fromI < fromPorts.length; fromI++) {
    if (checkWork) checkWork();
    const fromPort = fromPorts[fromI];
    let fromPortCost = 0.0;

    const currentFromPortEdges = fromPortEdges.get(fromPort);
    if (currentFromPortEdges != null && currentFromPortEdges.length > 0) {
      let duplicate = false;
      if (guard == null) {
        duplicate = edgeHasDuplicateInGuarded(edge, currentFromPortEdges, noopGuard);
      } else {
        duplicate = edgeHasDuplicateInGuarded(edge, currentFromPortEdges, guard);
      }
      if (duplicate) {
        continue;
      }

      let allMatch = true;
      for (const otherFromPortEdge of currentFromPortEdges) {
        if (checkWork) checkWork();
        if (otherFromPortEdge.From === edge.From) {
          if (edge.SourceArrowhead !== otherFromPortEdge.SourceArrowhead) {
            allMatch = false;
            break;
          }
        } else {
          if (edge.SourceArrowhead !== otherFromPortEdge.TargetArrowhead) {
            allMatch = false;
            break;
          }
        }
      }
      if (!allMatch) {
        continue;
      }

      if (edge.HasSourceArrow()) {
        fromPortCost = maxSideLength(edge.From, fromOrientation) / 2.0;
      }
    }

    for (let toI = 0; toI < toPorts.length; toI++) {
      if (checkWork) checkWork();
      const toPort = toPorts[toI];
      let toPortCost = 0.0;

      const currentToPortEdges = toPortEdges.get(toPort);
      if (currentToPortEdges != null && currentToPortEdges.length > 0) {
        let duplicate = false;
        if (guard == null) {
          duplicate = edgeHasDuplicateInGuarded(edge, currentToPortEdges, noopGuard);
        } else {
          duplicate = edgeHasDuplicateInGuarded(edge, currentToPortEdges, guard);
        }
        if (duplicate) {
          continue;
        }

        let allMatch = true;
        for (const otherToPortEdge of currentToPortEdges) {
          if (checkWork) checkWork();
          if (otherToPortEdge.To === edge.To) {
            if (edge.TargetArrowhead !== otherToPortEdge.TargetArrowhead) {
              allMatch = false;
              break;
            }
          } else {
            if (edge.TargetArrowhead !== otherToPortEdge.SourceArrowhead) {
              allMatch = false;
              break;
            }
          }
        }
        if (!allMatch) {
          continue;
        }

        toPortCost = maxSideLength(edge.To, toOrientation) / 2.0;
      }

      const edgeOption = new Edge(edge.From, edge.To);
      edgeOption.Points = [fromPort, toPort];

      let intersectsNode = false;
      if (guard == null) {
        intersectsNode = routeIntersectsNodeGuarded(g.Nodes, edgeOption, noopGuard);
      } else {
        intersectsNode = routeIntersectsNodeGuarded(g.Nodes, edgeOption, guard);
      }
      if (intersectsNode) {
        continue;
      }

      const otherEdges = filterEdge(allEdges);

      let overlappingEdges;
      if (guard == null) {
        overlappingEdges = findOverlappingEdges(fromPort, toPort, otherEdges);
      } else {
        overlappingEdges = overlappingEdgesGuarded(fromPort, toPort, otherEdges, guard);
      }
      if (overlappingEdges.length > 0) {
        let canOverlap = false;
        if (guard == null) {
          canOverlap = edgeCanOverlapEdges(edge, overlappingEdges, sourceClusterNodes, targetClusterNodes);
        } else {
          canOverlap = edgeCanOverlapEdgesGuarded(edge, overlappingEdges, sourceClusterNodes, targetClusterNodes, guard);
        }
        if (!canOverlap) {
          continue;
        }
      }

      let routeCost;
      if (guard == null) {
        routeCost = estimateRouteCostGuarded(otherEdges, edgeOption, noopGuard);
      } else {
        routeCost = estimateRouteCostGuarded(otherEdges, edgeOption, guard);
      }
      let cost = fromPortCost + toPortCost + routeCost;

      if (fromPort.X !== toPort.X && fromPort.Y !== toPort.Y) {
        let isAxisAligned = false;
        if (precisionCompare(fromPort.X, toPort.X, AxisAlignmentTolerance) === 0) {
          isAxisAligned = true;
        }
        if (precisionCompare(fromPort.Y, toPort.Y, AxisAlignmentTolerance) === 0) {
          isAxisAligned = true;
        }
        if (!isAxisAligned) {
          cost *= NON_ORTHOGONAL_FACTOR;
        }
      }

      if (hasSharpAngleToBorder(fromPort, toPort, fromOrientation)) {
        continue;
      }
      if (hasSharpAngleToBorder(fromPort, toPort, toOrientation)) {
        continue;
      }

      if (!fromNodeCenterPorts.has(fromPort)) {
        cost += g.NonCenterPortCost();
      }
      if (!toNodeCenterPorts.has(toPort)) {
        cost += g.NonCenterPortCost();
      }

      if (edge.SourceArrowheadLabel != null) {
        const routePoints = [fromPort, toPort];
        const pal = PositionArrowheadLabel(edge, false, routePoints);
        if (guard == null) {
          cost += positionedArrowheadLabelCost(pal, nonAncestors, positionedLabels, null, otherEdges);
        } else {
          const labelCost = positionedArrowheadLabelCostGuarded(pal, nonAncestors, positionedLabels, null, otherEdges, guard);
          cost += labelCost;
        }
      }
      if (edge.TargetArrowheadLabel != null) {
        const routePoints = [fromPort, toPort];
        const pal = PositionArrowheadLabel(edge, true, routePoints);
        if (guard == null) {
          cost += positionedArrowheadLabelCost(pal, nonAncestors, positionedLabels, null, otherEdges);
        } else {
          const labelCost = positionedArrowheadLabelCostGuarded(pal, nonAncestors, positionedLabels, null, otherEdges, guard);
          cost += labelCost;
        }
      }

      if (cost < bestCost) {
        bestFromPort = fromPort;
        bestToPort = toPort;
        bestCost = cost;
      }
    }
  }

  if (bestCost === Infinity) {
    throw ErrInvalidCandidate;
  }

  return [bestFromPort, bestToPort, bestCost];
}

export function routeInSShape(treePath) {
  const sourceOrientationToTarget = treePath.SourceOrientationToTarget;
  let current = treePath.SourcePortNode;
  const getAdjInDirection = (currentOrientationToAdjacent) => {
    let closestAdjNodeInDirection = null;
    for (const e of current.Edges ?? []) {
      const adjNode = current.adjacent(e);
      switch (currentOrientationToAdjacent) {
        case Orientation.Left:
          if (current.Point.Y === adjNode.Point.Y && adjNode.Point.X > current.Point.X) {
            if (closestAdjNodeInDirection == null || adjNode.Point.X < closestAdjNodeInDirection.Point.X) {
              closestAdjNodeInDirection = adjNode;
            }
          }
          break;
        case Orientation.Right:
          if (current.Point.Y === adjNode.Point.Y && adjNode.Point.X < current.Point.X) {
            if (closestAdjNodeInDirection == null || adjNode.Point.X > closestAdjNodeInDirection.Point.X) {
              closestAdjNodeInDirection = adjNode;
            }
          }
          break;
        case Orientation.Top:
          if (current.Point.X === adjNode.Point.X && adjNode.Point.Y > current.Point.Y) {
            if (closestAdjNodeInDirection == null || adjNode.Point.Y < closestAdjNodeInDirection.Point.Y) {
              closestAdjNodeInDirection = adjNode;
            }
          }
          break;
        default:
          if (current.Point.X === adjNode.Point.X && adjNode.Point.Y < current.Point.Y) {
            if (closestAdjNodeInDirection == null || adjNode.Point.Y > closestAdjNodeInDirection.Point.Y) {
              closestAdjNodeInDirection = adjNode;
            }
          }
          break;
      }
    }
    return closestAdjNodeInDirection;
  };

  const nodes = [treePath.SourcePortNode];

  // Step 1. source port to source midpoint
  while (!nonNilEquals(current.Point, treePath.SourceMidpoint)) {
    current = getAdjInDirection(sourceOrientationToTarget);
    if (current == null) {
      throw invariantNew("couldn't find s shaped route (source port to source midpoint)");
    }
    nodes.push(current);
  }

  // Step 2. source midpoint to target midpoint
  let crossDirection;
  if (sourceOrientationToTarget === Orientation.Left || sourceOrientationToTarget === Orientation.Right) {
    if (treePath.SourcePortNode.Point.Y < treePath.TargetPortNode.Point.Y) {
      crossDirection = Orientation.Top;
    } else {
      crossDirection = Orientation.Bottom;
    }
  } else {
    if (treePath.SourcePortNode.Point.X < treePath.TargetPortNode.Point.X) {
      crossDirection = Orientation.Left;
    } else {
      crossDirection = Orientation.Right;
    }
  }

  while (!nonNilEquals(current.Point, treePath.TargetMidpoint)) {
    current = getAdjInDirection(crossDirection);
    if (current == null) {
      throw invariantNew("couldn't find s shaped route (source midpoint to target midpoint)");
    }
    nodes.push(current);
  }

  // Step 3. target midpoint to target port
  while (!nonNilEquals(current.Point, treePath.TargetPortNode.Point)) {
    current = getAdjInDirection(sourceOrientationToTarget);
    if (current == null) {
      throw invariantNew("couldn't find s shaped route (target midpoint to target port)");
    }
    nodes.push(current);
  }

  return nodes;
}

export function routeSentinelEdge(tree, portNodes, centers, portArrowheads) {
  const edge = tree.SentinelEdge;
  const path = treeEdgePath(tree, portNodes, portArrowheads);

  const nodesFromSourcePortToTargetPort = routeInSShape(path);

  // validate route
  for (const n of nodesFromSourcePortToTargetPort) {
    if (n.isPort()) {
      let validOwner = false;
      for (const owner of n.portOwners().keys()) {
        if (edge.From.IsDescendantOf(owner) || edge.To.IsDescendantOf(owner)) {
          validOwner = true;
          break;
        }
      }
      if (!validOwner) {
        throw new Error("routing through other node's port");
      }
    }
  }

  const ovgNodes = [];
  ovgNodes.push(centers.get(edge.From));
  ovgNodes.push(...nodesFromSourcePortToTargetPort);
  ovgNodes.push(centers.get(edge.To));

  return new Route({
    GEdge: edge,
    OVGNodes: ovgNodes,
    FromPort: path.SourcePortNode.Point.Copy(),
    ToPort: path.TargetPortNode.Point.Copy(),
  });
}

export function makeLoopRoute(e, ovg) {
  const nodes = [];
  nodes.push(ovg.Centers.get(e.From));
  for (const p of e.Points ?? []) {
    nodes.push(NewOVGNode(p));
  }
  nodes.push(ovg.Centers.get(e.To));
  return new Route({
    GEdge: e,
    FromPort: e.Points[0].Copy(),
    ToPort: e.Points[e.Points.length - 1].Copy(),
    OVGNodes: nodes,
  });
}

export function routeEdgesWithResourceGuards(ctx, g, nearbyNodes, ovgGuard, searchWorkLimit) {
  const ovg = buildOVGFromGraphWithGuard(g, nearbyNodes, ovgGuard);

  // Route all tree edges first, then route the remaining edges
  const existingRoutes = [];
  const isTreeEdge = g.TreeEdgeMap();
  g.AddIsolatedTreeEdges(isTreeEdge);

  const existingPortArrowheads = new Map();
  const isRouted = new Set();
  for (const node of g.Nodes ?? []) {
    if (g.NodeToTree?.has(node)) {
      const tree = g.NodeToTree.get(node);
      if (!isTreeEdge.has(tree.SentinelEdge)) {
        continue;
      }
      let route;
      try {
        route = routeSentinelEdge(tree, ovg.Ports, ovg.Centers, existingPortArrowheads);
      } catch (err) {
        continue;
      }
      existingRoutes.push(route);
      const fromPort = route.OVGNodes[1];
      const toPort = route.OVGNodes[route.OVGNodes.length - 2];
      if (!existingPortArrowheads.has(fromPort)) {
        existingPortArrowheads.set(fromPort, new Set());
      }
      if (!existingPortArrowheads.has(toPort)) {
        existingPortArrowheads.set(toPort, new Set());
      }
      existingPortArrowheads.get(fromPort).add(tree.SentinelEdge.SourceArrowhead);
      existingPortArrowheads.get(toPort).add(tree.SentinelEdge.TargetArrowhead);
      isRouted.add(tree.SentinelEdge);
    } else {
      for (const routedEdge of routeLoops(node)) {
        existingRoutes.push(makeLoopRoute(routedEdge, ovg));
        isRouted.add(routedEdge);
      }
    }
  }

  const unroutedEdges = [];
  for (const e of g.Edges ?? []) {
    if (!isRouted.has(e)) {
      unroutedEdges.push(e);
    }
  }

  // cache these ahead of time
  g.CrossingCost();
  g.TurnCost();
  g.NonCenterPortCost();

  let flavors = [
    RouteGenerationFlavor.ShortestToLongest,
    RouteGenerationFlavor.LongestToShortest,
    RouteGenerationFlavor.Default,
  ];
  if (g.Nodes?.[0]?.Hierarchy != null) {
    flavors = [RouteGenerationFlavor.TopDownLeftRight];
  }
  const routers = [];
  for (const flavor of flavors) {
    const router = newOVGEdgeRouterWithWorkLimit(ctx, flavor, ovg, g, existingRoutes, unroutedEdges, searchWorkLimit);
    routers.push(router);
  }
  const responses = generateRouteFlavorResponses(ctx, routers, true);

  let bestRoutes = null;
  let bestWork = null;
  let leastDistance = Infinity;

  const flavorToResponse = successfulRouteFlavorResponses(responses);

  for (const flavor of flavors) {
    if (flavorToResponse.has(flavor)) {
      const response = flavorToResponse.get(flavor);
      if (precisionCompare(response.Distance, leastDistance, PRECISION) < 0) {
        leastDistance = response.Distance;
        bestRoutes = response.Routes;
        bestWork = response.work;
      }
    }
  }

  finalizeSelectedRoutes(ctx, g, bestRoutes, null, bestWork, true);
  return ovg;
}

export function routeAdditionalEdgesWithLimits(ctx, g, edges, limits) {
  return routeAdditionalEdgesWithResourceLimits(ctx, g, edges, limits, MAX_ROUTE_SEARCH_WORK_UNITS);
}

export function routeAdditionalEdgesWithResourceLimits(
  ctx,
  g,
  edges,
  limits,
  searchWorkLimit = MAX_ROUTE_SEARCH_WORK_UNITS,
) {
  const newEdges = new Set();
  for (const e of edges ?? []) {
    newEdges.add(e);
  }

  const ovg = buildOVGFromGraphWithLimits(ctx, g, null, limits);
  const guard = ovg.buildGuard;

  const existingRoutes = [];
  for (const e of g.Edges ?? []) {
    guard.step();
    if (newEdges.has(e)) {
      continue;
    }

    const ovgNodes = [];
    let lastPoint = null;

    const addPoint = (p) => {
      guard.step();
      if (lastPoint != null && lastPoint.X === p.X && lastPoint.Y === p.Y) {
        return;
      }
      lastPoint = p;

      let ovgNode = ovg.OccupiedPoints.get(p);
      if (ovgNode !== undefined) {
        ovgNodes.push(ovgNode);
      } else {
        ovgNode = NewOVGNode(p);
        ovgNode.Index = ovg.Nodes.length;
        ovgNodes.push(ovgNode);
        guard.addNodeUnchecked(ovg, ovgNode);
      }

      if (ovgNodes.length > 1) {
        guard.connect(ovg, ovgNodes[ovgNodes.length - 2], ovgNodes[ovgNodes.length - 1]);
      }
    };

    addPoint(e.From.Center());
    for (const p of e.Points ?? []) {
      addPoint(p);
    }
    addPoint(e.To.Center());

    if (ovgNodes.length > 1) {
      const route = new Route({
        GEdge: e,
        OVGNodes: ovgNodes,
        FromPort: e.Points[0].Copy(),
        ToPort: e.Points[e.Points.length - 1].Copy(),
      });
      existingRoutes.push(route);
    }
  }

  g.CrossingCost();
  g.TurnCost();
  g.NonCenterPortCost();

  let flavors = [
    RouteGenerationFlavor.ShortestToLongest,
    RouteGenerationFlavor.LongestToShortest,
    RouteGenerationFlavor.Default,
  ];
  if (g.Nodes?.[0]?.Hierarchy != null) {
    flavors = [RouteGenerationFlavor.TopDownLeftRight];
  }
  const routers = [];
  for (const flavor of flavors) {
    const router = newOVGEdgeRouterWithWorkLimit(ctx, flavor, ovg, g, existingRoutes, edges, searchWorkLimit);
    router.considerNodeLabels = true;
    routers.push(router);
  }
  const responses = generateRouteFlavorResponses(ctx, routers, true);

  let bestRoutes = null;
  let bestWork = null;
  let leastDistance = Infinity;

  const flavorToResponse = successfulRouteFlavorResponses(responses);

  for (const flavor of flavors) {
    if (flavorToResponse.has(flavor)) {
      const response = flavorToResponse.get(flavor);
      if (precisionCompare(response.Distance, leastDistance, PRECISION) < 0) {
        leastDistance = response.Distance;
        bestRoutes = response.Routes;
        bestWork = response.work;
      }
    }
  }

  finalizeSelectedRoutes(ctx, g, bestRoutes, newEdges, bestWork, false);
  return ovg;
}
