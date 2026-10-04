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
import { Orientation, getOpposite } from '../geometry/orientation.js';
import { Edge } from '../graph/edge.js';
import { precisionCompare } from '../geometry/math.js';
import { PositionArrowheadLabel } from '../labeling/arrowhead.js';
import { MIN_STRAIGHT_EDGE_ANGLE, NON_ORTHOGONAL_FACTOR } from './tuning.js';
import { ErrInvalidCandidate } from '../graph/transaction.js';
import {
  portEdgesGuarded,
  edgeHasDuplicateInGuarded,
  overlappingEdgesGuarded,
  sourceAndTargetClusterNodesGuarded,
  filterEdgeAncestorsGuarded,
  positionedArrowheadLabelCostGuarded,
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
