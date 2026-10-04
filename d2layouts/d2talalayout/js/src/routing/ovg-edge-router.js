// Slice 47 — OVG edge router and search.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/ovg_edge_router.go

import { Point } from '../geometry/point.js';
import { euclideanDistance, precisionCompare } from '../geometry/math.js';
import { Box } from '../geometry/box.js';
import { Orientation, isDiagonal, getOpposite } from '../geometry/orientation.js';
import { PositionArrowheadLabel } from '../labeling/arrowhead.js';
import { Node } from '../graph/node.js';
import { Edge } from '../graph/edge.js';
import { ClusterArrangement } from '../graph/cluster.js';
import { ErrInvalidCandidate, isCandidateRejection } from '../graph/transaction.js';
import { PriorityQueue } from './priority-queue.js';
import { Route } from './route.js';
import { NewOVGNode, portDirectionSetAny } from './ovg-node.js';
import { NewOVGEdge } from './ovg-edge.js';
import { newOvgEdgeSet } from './ovg-edge-set.js';
import { PointValueMap } from './layoutgraph-route-support.js';
import { edgeIsLoop } from './layoutgraph-routing-support.js';
import {
  BASICALLY_INFINITY,
  IDEAL_TURN_AXIS_TOLERANCE,
  IDEAL_TURN_MULTIPLIER,
  IDEAL_TURN_EVEN_CLUSTER_MULTIPLIER,
  NODE_PROXIMITY_PENALTY,
  TURN_ENDPOINT_CLEARANCE,
  PATH_NODE_PROXIMITY_FLOOR,
} from './tuning.js';
import { idealTurnAxes } from './turns.js';
import { tablePortIndex } from '../shape/table-ports.js';
import { nodePortIndices } from '../shape/ports.js';
import { segmentIntersectsBox } from './geometry.js';
import {
  RouteSearchWorkGuard,
  MAX_ROUTE_SEARCH_WORK_UNITS,
  routeSearchIsDescendantOf,
  fixedOverlapsForRoute,
} from './route-guards.js';
import {
  filterEdgeAncestorsGuarded,
  positionedArrowheadLabelCostGuarded,
  sourceAndTargetClusterNodesGuarded,
  edgeCanOverlapEdgesGuarded,
} from './standalone-route-guard.js';
import {
  routeLineChecked,
  RouteGenerationFlavor,
  GenerateRouteResponse,
} from './coordinator.js';
import { slingshot } from './slingshot.js';

export { RouteGenerationFlavor, GenerateRouteResponse };

export const MinRouteNodeClearance = 20.0;
export const MinArrowheadClearance = 20.0;

class SearchNodeContext {
  constructor() {
    this.verticalDistance = Infinity;
    this.horizontalDistance = Infinity;
    this.verticalEntry = null;
    this.horizontalEntry = null;
  }
}

export function sortEdges(flavor, edges, clusterNodes) {
  const clusterNodeHas = (n) => {
    if (clusterNodes == null) return false;
    if (typeof clusterNodes.has === 'function') return clusterNodes.has(n);
    return Boolean(clusterNodes[n]);
  };

  switch (flavor) {
    case RouteGenerationFlavor.ShortestToLongest:
      edges.sort((a, b) => {
        const aDistance = a.EuclideanDistance();
        const bDistance = b.EuclideanDistance();
        if (aDistance < bDistance) return -1;
        if (bDistance < aDistance) return 1;
        return 0;
      });
      break;
    case RouteGenerationFlavor.LongestToShortest:
      edges.sort((a, b) => {
        const aDistance = a.EuclideanDistance();
        const bDistance = b.EuclideanDistance();
        if (aDistance > bDistance) return -1;
        if (bDistance > aDistance) return 1;
        return 0;
      });
      break;
    case RouteGenerationFlavor.TopDownLeftRight:
      edges.sort((a, b) => {
        let aFrom = a.From;
        let aTo = a.To;
        if (aFrom.TopLeft.Y > aTo.TopLeft.Y) {
          [aFrom, aTo] = [aTo, aFrom];
        }
        let bFrom = b.From;
        let bTo = b.To;
        if (bFrom.TopLeft.Y > bTo.TopLeft.Y) {
          [bFrom, bTo] = [bTo, bFrom];
        }

        if (aFrom.TopLeft.Y !== bFrom.TopLeft.Y) {
          if (aFrom.TopLeft.Y < bFrom.TopLeft.Y) return -1;
          if (bFrom.TopLeft.Y < aFrom.TopLeft.Y) return 1;
          return 0;
        }
        if (aFrom !== bFrom) {
          if (aFrom.TopLeft.X < bFrom.TopLeft.X) return -1;
          if (bFrom.TopLeft.X < aFrom.TopLeft.X) return 1;
          return 0;
        }
        if (aTo.TopLeft.Y === bTo.TopLeft.Y) {
          if (aTo.TopLeft.X < bTo.TopLeft.X) return -1;
          if (bTo.TopLeft.X < aTo.TopLeft.X) return 1;
          return 0;
        }
        if (aTo.TopLeft.Y < bTo.TopLeft.Y) return -1;
        if (bTo.TopLeft.Y < aTo.TopLeft.Y) return 1;
        return 0;
      });
      break;
  }

  // Clusters go first, looks best
  edges.sort((a, b) => {
    let connectedA = clusterNodeHas(a.From) || clusterNodeHas(a.To);
    let connectedB = clusterNodeHas(b.From) || clusterNodeHas(b.To);
    if (connectedA && !connectedB) return -1;
    if (!connectedA && connectedB) return 1;
    return 0;
  });
}

export function clusterHasDesirableArrangementTo(cluster, node) {
  let bounds = cluster.Vessel;
  if (!cluster.IsActive || !cluster.IsActive()) {
    const nodes = cluster.Nodes ?? [];
    if (nodes.length > 0) {
      const topLeft = nodes[0].TopLeft.Copy();
      const last = nodes[nodes.length - 1];
      const bottomRight = last.TopLeft.Copy();
      bottomRight.X += last.Width;
      bottomRight.Y += last.Height;
      bounds = new Node(0n);
      bounds.Box = new Box(topLeft, bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y);
    }
  }
  if (bounds == null) {
    return false;
  }
  const o = bounds.Orientation(node);
  switch (o) {
    case Orientation.Top:
    case Orientation.Bottom:
      return cluster.Arrangement === ClusterArrangement.Row || cluster.Arrangement === 'Row';
    case Orientation.Left:
    case Orientation.Right:
      return cluster.Arrangement === ClusterArrangement.Column || cluster.Arrangement === 'Column';
    default:
      return false;
  }
}

export class OVGEdgeRouter {
  constructor(flavor, graph, ovg, orderedEdges, workGuard) {
    this.flavor = flavor;
    this.graph = graph;
    this.ovg = ovg;
    this.routes = [];
    this.routedEdges = [];
    this.positionedLabels = [];
    this.edges = orderedEdges;
    this.pointToRoute = new PointValueMap();
    this.turnCost = graph.TurnCost();
    this.crossingCost = graph.CrossingCost();
    this.nonCenterPortCost = graph.NonCenterPortCost();
    this.edgeSet = newOvgEdgeSet();
    this.hasNearbyEdge = new Set();
    this.overlappingRoutes = new Map();
    this.fixedOverlaps = new Set();
    this.fixedOverlapsSet = false;
    this.verticalHops = [];
    this.horizontalHops = [];
    this.nodeContext = [];
    this.searchQueue = new PriorityQueue();
    this.considerNodeLabels = false;
    this.work = workGuard;
  }

  bindWork(ctx) {
    if (this.work == null) {
      this.work = new RouteSearchWorkGuard(ctx, this.flavor, MAX_ROUTE_SEARCH_WORK_UNITS);
      return;
    }
    this.work.bind(ctx);
  }

  routeLine(ctx, edge) {
    this.bindWork(ctx);
    try {
      const [fromPort, toPort, cost] = routeLineChecked(
        this.graph,
        edge,
        this.routedEdges,
        this.routes,
        () => this.work.step(),
        this.work
      );
      const fromCenter = this.ovg.Centers.get(edge.From);
      const toCenter = this.ovg.Centers.get(edge.To);
      const ovgNodes = [
        fromCenter,
        this.ovg.OccupiedPoints.get(fromPort) ?? NewOVGNode(fromPort),
        this.ovg.OccupiedPoints.get(toPort) ?? NewOVGNode(toPort),
        toCenter,
      ];
      return [ovgNodes, cost];
    } catch (err) {
      if (isCandidateRejection(err) || err === ErrInvalidCandidate) {
        const fromCenter = this.ovg.Centers.get(edge.From);
        const toCenter = this.ovg.Centers.get(edge.To);
        let fromPort = null;
        let toPort = null;
        const segment = { Start: fromCenter.Point, End: toCenter.Point };
        if (edge.From.Intersections) {
          const intersections = edge.From.Intersections(segment);
          if (intersections.length > 0) {
            fromPort = intersections[0];
            segment.Start = fromPort;
          }
        }
        if (edge.To.Intersections) {
          const intersections = edge.To.Intersections(segment);
          if (intersections.length > 0) {
            toPort = intersections[0];
          }
        }
        if (fromPort == null) fromPort = fromCenter.Point;
        if (toPort == null) toPort = toCenter.Point;
        const ovgNodes = [fromCenter, NewOVGNode(fromPort), NewOVGNode(toPort), toCenter];
        return [ovgNodes, euclideanDistance(fromCenter.X, fromCenter.Y, toCenter.X, toCenter.Y)];
      }
      throw err;
    }
  }

  generateRoutes(ctx, straightLineFallback = false) {
    const resp = new GenerateRouteResponse();
    resp.Flavor = this.flavor;
    try {
      this.bindWork(ctx);
    } catch (err) {
      resp.Err = err;
      if (this.work != null) {
        try { this.work.finish(); } catch {}
      }
      return resp;
    }
    resp.work = this.work;

    let totalDistance = 0.0;
    try {
      for (const edge of this.edges) {
        this.work.step();
        let distance = 0.0;
        let ovgNodes = null;

        try {
          [ovgNodes, distance] = this.slingshot(ctx, edge);
        } catch (err) {
          if (straightLineFallback) {
            try {
              [ovgNodes, distance] = this.routeLine(ctx, edge);
            } catch (slErr) {
              resp.Err = slErr;
              return resp;
            }
          } else {
            resp.Err = err;
            return resp;
          }
        }

        if (ovgNodes == null || ovgNodes.length <= 1) {
          try {
            [ovgNodes, distance] = this.search(ctx, edge);
          } catch (err) {
            if (this.work.isContextCanceled && this.work.isContextCanceled()) {
              resp.Err = err;
              return resp;
            }
            if (straightLineFallback) {
              try {
                [ovgNodes, distance] = this.routeLine(ctx, edge);
              } catch (slErr) {
                resp.Err = slErr;
                return resp;
              }
            } else {
              resp.Err = err;
              return resp;
            }
          }

          if (ovgNodes == null || ovgNodes.length <= 1) {
            const edgeID = edge.DebugID ? edge.DebugID() : `${edge.From?.ID}->${edge.To?.ID}`;
            resp.Err = new Error(`Route '${edgeID}' has size ${ovgNodes?.length ?? 0}`);
            return resp;
          }
        }

        totalDistance += distance;
        this.addRoute(new Route({
          GEdge: edge,
          OVGNodes: ovgNodes,
          FromPort: ovgNodes[1].Point,
          ToPort: ovgNodes[ovgNodes.length - 2].Point,
        }));
      }

      resp.Routes = this.routes;
      resp.Distance = totalDistance;
    } catch (err) {
      resp.Err = err;
      return resp;
    } finally {
      try {
        this.work.finish();
      } catch (err) {
        if (resp.Err == null) {
          resp.Err = err;
          resp.Routes = null;
        }
      }
    }

    return resp;
  }

  centerSymmetricalPorts(ctx, gSource, gTarget, sourcePortsUsed, targetPortsUsed) {
    const nodeIsCenterSymmetricalPort = new Set();
    const sourcePorts = this.ovg.Ports.get(gSource) ?? [];
    const targetPorts = this.ovg.Ports.get(gTarget) ?? [];
    this.work.reserveSum(sourcePorts.length, targetPorts.length);

    const sourceMirroredPorts = gSource.MirroredPorts instanceof Map ? gSource.MirroredPorts : (gSource.MirroredPorts ? gSource.MirroredPorts() : new Map());
    const targetMirroredPorts = gTarget.MirroredPorts instanceof Map ? gTarget.MirroredPorts : (gTarget.MirroredPorts ? gTarget.MirroredPorts() : new Map());

    for (const port of sourcePorts) {
      this.work.step();
      let mirroredPort = sourceMirroredPorts instanceof PointValueMap || sourceMirroredPorts instanceof Map
        ? sourceMirroredPorts.get(port.Point)
        : sourceMirroredPorts?.[port.Point];
      if (mirroredPort != null) {
        if (sourcePortsUsed.has(mirroredPort)) {
          nodeIsCenterSymmetricalPort.add(port);
        }
      }
    }

    for (const port of targetPorts) {
      this.work.step();
      let mirroredPort = targetMirroredPorts instanceof PointValueMap || targetMirroredPorts instanceof Map
        ? targetMirroredPorts.get(port.Point)
        : targetMirroredPorts?.[port.Point];
      if (mirroredPort != null) {
        if (targetPortsUsed.has(mirroredPort)) {
          nodeIsCenterSymmetricalPort.add(port);
        }
      }
    }

    this.work.check();
    return nodeIsCenterSymmetricalPort;
  }

  usedPorts(
    ctx,
    gSource,
    gTarget,
    source,
    target,
    sourceClusterNodes,
    targetClusterNodes,
    undesirableClusterArrangement,
  ) {
    const sourcePortsUsed = new PointValueMap();
    const targetPortsUsed = new PointValueMap();
    const duplicateSourcePortsUsed = new PointValueMap();
    const duplicateTargetPortsUsed = new PointValueMap();
    const sharedClusterSourcePortsUsed = new PointValueMap();
    const sharedClusterTargetPortsUsed = new PointValueMap();

    const isSourceClusterNode = (n) => sourceClusterNodes != null && (typeof sourceClusterNodes.has === 'function' ? sourceClusterNodes.has(n) : Boolean(sourceClusterNodes[n]));
    const isTargetClusterNode = (n) => targetClusterNodes != null && (typeof targetClusterNodes.has === 'function' ? targetClusterNodes.has(n) : Boolean(targetClusterNodes[n]));

    for (const node of [source, target]) {
      this.work.step();
      const pointRoutes = this.pointToRoute.get(node.Point) ?? [];
      for (const route of pointRoutes) {
        this.work.step();
        if (
          route.GEdge.From !== gSource &&
          route.GEdge.To !== gSource &&
          route.GEdge.From !== gTarget &&
          route.GEdge.To !== gTarget
        ) {
          continue;
        }

        if (route.GEdge.From === gSource && route.GEdge.To === gTarget) {
          duplicateSourcePortsUsed.set(route.FromPort, true);
          duplicateTargetPortsUsed.set(route.ToPort, true);
        }

        if (!undesirableClusterArrangement) {
          if (route.GEdge.To === gTarget) {
            if (isSourceClusterNode(route.GEdge.From)) {
              sharedClusterTargetPortsUsed.set(route.ToPort, true);
            }
          }
          if (route.GEdge.From === gSource) {
            if (isTargetClusterNode(route.GEdge.To)) {
              sharedClusterSourcePortsUsed.set(route.FromPort, true);
            }
          }
        }

        for (const routeNode of route.OVGNodes ?? []) {
          this.work.step();
          for (const portNode of this.ovg.Ports.get(gSource) ?? []) {
            this.work.step();
            if (routeNode === portNode) {
              sourcePortsUsed.set(portNode.Point, true);
              break;
            }
          }
          for (const portNode of this.ovg.Ports.get(gTarget) ?? []) {
            this.work.step();
            if (routeNode === portNode) {
              targetPortsUsed.set(portNode.Point, true);
              break;
            }
          }
        }
      }
    }

    this.work.check();
    return [
      sourcePortsUsed,
      targetPortsUsed,
      duplicateSourcePortsUsed,
      duplicateTargetPortsUsed,
      sharedClusterSourcePortsUsed,
      sharedClusterTargetPortsUsed,
    ];
  }

  isUndesirableClusterArrangement(gSource, gTarget) {
    if (gSource.Cluster != null) {
      if (!clusterHasDesirableArrangementTo(gSource.Cluster, gTarget)) {
        return true;
      }
    }
    if (gTarget.Cluster != null) {
      if (!clusterHasDesirableArrangementTo(gTarget.Cluster, gSource)) {
        return true;
      }
    }
    return false;
  }

  tablePorts(edge, source, target, facingPorts) {
    const getPorts = (node, columnIndex, orientations) => {
      const ports = new Set();
      for (const o of orientations) {
        this.work.add((node.Edges?.length ?? 0) + 1);
        let [portIndex, isTableSide] = tablePortIndex(node, o, columnIndex);
        if (!isTableSide) {
          const indices = nodePortIndices(node, o);
          portIndex = indices[columnIndex];
        }
        const nodePortsList = this.ovg.Ports.get(node) ?? [];
        if (nodePortsList[portIndex] != null) {
          ports.add(nodePortsList[portIndex]);
        }
      }
      return ports;
    };

    let sourceOrientations;
    let targetOrientations;
    if (!facingPorts) {
      sourceOrientations = [Orientation.Right, Orientation.Left];
      targetOrientations = [Orientation.Right, Orientation.Left];
    } else {
      switch (source.Orientation(target)) {
        case Orientation.Left:
        case Orientation.TopLeft:
        case Orientation.BottomLeft:
          sourceOrientations = [Orientation.Right];
          targetOrientations = [Orientation.Left];
          break;
        case Orientation.Right:
        case Orientation.TopRight:
        case Orientation.BottomRight:
          sourceOrientations = [Orientation.Left];
          targetOrientations = [Orientation.Right];
          break;
      }
    }

    let sourcePorts = new Set();
    let targetPorts = new Set();
    if (edge.FromTableColumnIndex != null) {
      sourcePorts = getPorts(source, edge.FromTableColumnIndex, sourceOrientations ?? [Orientation.Right, Orientation.Left]);
    }
    if (edge.ToTableColumnIndex != null) {
      targetPorts = getPorts(target, edge.ToTableColumnIndex, targetOrientations ?? [Orientation.Right, Orientation.Left]);
    }
    return [sourcePorts, targetPorts];
  }

  quickRoute(ctx, gEdge, overlap, fromOrientation) {
    this.bindWork(ctx);
    this.work.check();

    const gSource = gEdge.From;
    const gTarget = gEdge.To;
    const source = this.ovg.Centers.get(gSource);
    const target = this.ovg.Centers.get(gTarget);

    if (
      !overlap &&
      !isDiagonal(fromOrientation) &&
      gSource.DistanceTo(gTarget, true) < 2 * (MinRouteNodeClearance + 1) &&
      gSource.DistanceTo(gTarget, true) > MinArrowheadClearance
    ) {
      const edges = [];
      for (const route of this.routes) {
        this.work.add((route.OVGNodes?.length ?? 0) + 1);
        const edge = new Edge(route.GEdge.From, route.GEdge.To);
        edge.Points = route.createSegmentEndpoints();
        edge.SourceArrowhead = route.GEdge.SourceArrowhead;
        edge.TargetArrowhead = route.GEdge.TargetArrowhead;
        edge.SourceArrowheadLabel = route.GEdge.SourceArrowheadLabel;
        edge.TargetArrowheadLabel = route.GEdge.TargetArrowheadLabel;
        edge.Label = route.GEdge.Label;
        edges.push(edge);
      }
      this.work.check();

      try {
        const [sourcePort, targetPort, lineCost] = routeLineChecked(
          this.graph,
          gEdge,
          edges,
          null,
          () => this.work.step(),
          this.work
        );
        return [
          [
            source,
            NewOVGNode(sourcePort),
            NewOVGNode(targetPort),
            target,
          ],
          lineCost,
        ];
      } catch (err) {
        if (isCandidateRejection(err) || err === ErrInvalidCandidate) {
          return [null, 0];
        }
        throw err;
      }
    }
    return [null, 0];
  }

  slingshot(ctx, gEdge) {
    return slingshot(this, ctx, gEdge);
  }

  search(ctx, gEdge) {
    this.bindWork(ctx);
    const g = this.ovg;
    const originalGraph = this.graph;
    const gSource = gEdge.From;
    const gTarget = gEdge.To;
    const source = g.Centers.get(gSource);
    const target = g.Centers.get(gTarget);

    const nodeCount = g.Nodes.length;
    this.work.reserveProduct(nodeCount, 3);

    const fromFacingPorts = new PointValueMap();
    const toFacingPorts = new PointValueMap();

    if (this.verticalHops.length < nodeCount) {
      this.verticalHops = new Array(nodeCount).fill(null);
    } else {
      this.verticalHops.fill(null, 0, nodeCount);
    }
    if (this.horizontalHops.length < nodeCount) {
      this.horizontalHops = new Array(nodeCount).fill(null);
    } else {
      this.horizontalHops.fill(null, 0, nodeCount);
    }
    if (this.nodeContext.length < nodeCount) {
      this.nodeContext = new Array(nodeCount).fill(null);
    } else {
      this.nodeContext.fill(null, 0, nodeCount);
    }

    const verticalHops = this.verticalHops;
    const horizontalHops = this.horizontalHops;
    const nodeContext = this.nodeContext;

    const occupiedEdges = [];
    const overlappingEdges = [];
    const nodeLabelBoxes = [];

    if (this.considerNodeLabels) {
      for (const n of originalGraph.Nodes ?? []) {
        this.work.step();
        if (n === gSource || n === gTarget) continue;
        if (n.Label != null && n.Label.Text !== '') {
          const fakeLabelNode = new Node(0n);
          fakeLabelNode.Box = new Box(
            n.LabelTopLeft(n.Label.Position, n.Label.Width, n.Label.Height),
            n.Label.Width,
            n.Label.Height
          );
          fakeLabelNode.Graph = originalGraph;
          nodeLabelBoxes.push(fakeLabelNode);
        }
      }
    }

    let overlap = false;
    const fromOrientation = gSource.Orientation(gTarget);
    if (fromOrientation === Orientation.None) {
      overlap = true;
    }
    const toOrientation = gTarget.Orientation(gSource);
    if (toOrientation === Orientation.None) {
      overlap = true;
    }

    const [quickRouteNodes, quickDistance] = this.quickRoute(ctx, gEdge, overlap, fromOrientation);
    if (quickRouteNodes != null) {
      return [quickRouteNodes, quickDistance];
    }

    let nonAncestors = null;
    if (gEdge.SourceArrowheadLabel != null || gEdge.TargetArrowheadLabel != null) {
      nonAncestors = filterEdgeAncestorsGuarded(gEdge, this.graph.Nodes, this.work);
    }

    const sourceContainer = gSource.Container;
    const targetContainer = gTarget.Container;
    const isSourceDescendantOfTarget = routeSearchIsDescendantOf(this.work, gSource, gTarget);
    const isTargetDescendantOfSource = routeSearchIsDescendantOf(this.work, gTarget, gSource);

    const [sourceClusterNodes, targetClusterNodes] = sourceAndTargetClusterNodesGuarded(originalGraph, gSource, gTarget, this.work);
    const isSourceCluster = sourceClusterNodes.size > 0;
    const isTargetCluster = targetClusterNodes.size > 0;

    const undesirableClusterArrangement = this.isUndesirableClusterArrangement(gSource, gTarget);

    let allowSrcPortSharing = false;
    let allowDstPortSharing = false;
    let preferFacingPorts = false;
    let nonFacingPortsCost = 0.0;
    if ((isSourceCluster || isTargetCluster) && !undesirableClusterArrangement) {
      preferFacingPorts = true;
      nonFacingPortsCost = this.turnCost * 2;
      allowSrcPortSharing = true;
      allowDstPortSharing = true;
      for (const port of gSource.PortsByOrientation(getOpposite(fromOrientation))) {
        this.work.step();
        fromFacingPorts.set(port, true);
      }
      for (const port of gTarget.PortsByOrientation(getOpposite(toOrientation))) {
        this.work.step();
        toFacingPorts.set(port, true);
      }
    }

    let sharedRouteCost = BASICALLY_INFINITY;
    const blockedSourcePorts = new PointValueMap();
    const blockedTargetPorts = new PointValueMap();

    const hasTableColumn = typeof gEdge.HasTableColumn === 'function' ? gEdge.HasTableColumn() : (gEdge.FromTableColumnIndex != null || gEdge.ToTableColumnIndex != null);
    if (!hasTableColumn) {
      const sPortsCount = (g.Ports.get(gSource) ?? []).length;
      const tPortsCount = (g.Ports.get(gTarget) ?? []).length;
      this.work.reserveProduct(sPortsCount, tPortsCount);
      const sourceOverlaps = gSource.OverlappingPorts(gTarget);
      for (const [p, v] of (sourceOverlaps instanceof PointValueMap || sourceOverlaps instanceof Map ? sourceOverlaps.entries() : Object.entries(sourceOverlaps))) {
        blockedSourcePorts.set(p, v);
      }
      const targetOverlaps = gTarget.OverlappingPorts(gSource);
      for (const [p, v] of (targetOverlaps instanceof PointValueMap || targetOverlaps instanceof Map ? targetOverlaps.entries() : Object.entries(targetOverlaps))) {
        blockedTargetPorts.set(p, v);
      }
    } else {
      const [sourcePorts, targetPorts] = this.tablePorts(gEdge, gSource, gTarget, false);
      const isBetweenTableColumns = typeof gEdge.IsBetweenTableColumns === 'function' ? gEdge.IsBetweenTableColumns() : (gEdge.FromTableColumnIndex != null && gEdge.ToTableColumnIndex != null);
      if (isBetweenTableColumns) {
        sharedRouteCost = BASICALLY_INFINITY / 10;
        allowSrcPortSharing = true;
        allowDstPortSharing = true;
        for (const port of g.Ports.get(gSource) ?? []) {
          this.work.step();
          if (!sourcePorts.has(port)) {
            blockedSourcePorts.set(port.Point, true);
          }
        }
        for (const port of g.Ports.get(gTarget) ?? []) {
          this.work.step();
          if (!targetPorts.has(port)) {
            blockedTargetPorts.set(port.Point, true);
          }
        }
        for (const e of gSource.Edges ?? []) {
          this.work.step();
          targetClusterNodes.set(gSource.Adjacent(e), true);
        }
        for (const e of gTarget.Edges ?? []) {
          this.work.step();
          sourceClusterNodes.set(gTarget.Adjacent(e), true);
        }
      } else if (gEdge.FromTableColumnIndex != null) {
        allowSrcPortSharing = true;
        for (const port of g.Ports.get(gSource) ?? []) {
          this.work.step();
          if (!sourcePorts.has(port)) {
            blockedSourcePorts.set(port.Point, true);
          }
        }
        for (const e of gTarget.Edges ?? []) {
          this.work.step();
          sourceClusterNodes.set(gTarget.Adjacent(e), true);
        }
      } else if (gEdge.ToTableColumnIndex != null) {
        allowDstPortSharing = true;
        for (const port of g.Ports.get(gTarget) ?? []) {
          this.work.step();
          if (!targetPorts.has(port)) {
            blockedTargetPorts.set(port.Point, true);
          }
        }
        for (const e of gSource.Edges ?? []) {
          this.work.step();
          targetClusterNodes.set(gSource.Adjacent(e), true);
        }
      }
    }

    const idealAxes = idealTurnAxes(gSource, gTarget);

    const [
      sourcePortsUsed,
      targetPortsUsed,
      duplicateSourcePortsUsed,
      duplicateTargetPortsUsed,
      sharedClusterSourcePortsUsed,
      sharedClusterTargetPortsUsed,
    ] = this.usedPorts(
      ctx,
      gSource,
      gTarget,
      source,
      target,
      sourceClusterNodes,
      targetClusterNodes,
      undesirableClusterArrangement
    );

    const nodeIsCenterSymmetricalPort = this.centerSymmetricalPorts(
      ctx,
      gSource,
      gTarget,
      sourcePortsUsed,
      targetPortsUsed
    );

    if (!this.fixedOverlapsSet) {
      this.fixedOverlaps = fixedOverlapsForRoute(originalGraph.Nodes, this.work);
      this.fixedOverlapsSet = true;
    }
    const fixedOverlaps = this.fixedOverlaps;

    const sourceContext = new SearchNodeContext();
    nodeContext[source.Index] = sourceContext;

    this.searchQueue.reset();
    const pq = this.searchQueue;

    pq.push(0, source, false, this.work);
    pq.push(0, source, true, this.work);

    while (!pq.empty()) {
      this.work.step();
      const leastDistanceEntry = pq.pop(this.work);
      const isFromHorizontal = leastDistanceEntry.isHorizontal;
      const leastDistanceNode = leastDistanceEntry.node;
      const leastDistance = leastDistanceEntry.priority;

      if (leastDistanceNode === target) {
        const routeNodes = this.bestRoute(
          ctx,
          gSource,
          gTarget,
          source,
          target,
          nodeContext,
          verticalHops,
          horizontalHops
        );
        return [routeNodes, leastDistance];
      }

      let lastNode = null;
      if (isFromHorizontal) {
        lastNode = horizontalHops[leastDistanceNode.Index];
      } else {
        lastNode = verticalHops[leastDistanceNode.Index];
      }

      occupiedEdges.length = 0;
      if (leastDistanceNode !== source && leastDistanceNode !== target) {
        const pointRoutes = this.pointToRoute.get(leastDistanceNode.Point) ?? [];
        for (const route of pointRoutes) {
          this.work.step();
          occupiedEdges.push(route.GEdge);
        }
      }

      const isOnNodeOfRoute = occupiedEdges.length > 0;
      const areAllOccupiedRoutesShareable = edgeCanOverlapEdgesGuarded(
        gEdge,
        occupiedEdges,
        sourceClusterNodes,
        targetClusterNodes,
        this.work
      );

      for (const e of leastDistanceNode.Edges ?? []) {
        this.work.step();
        const adjacentNode = leastDistanceNode.Adjacent(e);
        if (adjacentNode === lastNode) {
          continue;
        }

        const [sourcePort, hasSourcePort] = leastDistanceNode.portMetadataFor(gSource);
        if (hasSourcePort) {
          const validExit = portDirectionSetAny(sourcePort.directions, (direction) => {
            if (overlap) {
              switch (direction) {
                case Orientation.Top:
                case Orientation.Bottom:
                  return adjacentNode.Point.Y !== leastDistanceNode.Point.Y;
                case Orientation.Right:
                case Orientation.Left:
                  return adjacentNode.Point.X !== leastDistanceNode.Point.X;
                default:
                  return true;
              }
            }
            switch (direction) {
              case Orientation.Top:
                return adjacentNode.Point.Y < leastDistanceNode.Point.Y;
              case Orientation.Bottom:
                return adjacentNode.Point.Y > leastDistanceNode.Point.Y;
              case Orientation.Right:
                return adjacentNode.Point.X > leastDistanceNode.Point.X;
              case Orientation.Left:
                return adjacentNode.Point.X < leastDistanceNode.Point.X;
              default:
                return true;
            }
          });
          if (!validExit) {
            continue;
          }
        }

        const [targetPort, hasTargetPort] = adjacentNode.portMetadataFor(gTarget);
        if (hasTargetPort) {
          if (blockedTargetPorts.has(adjacentNode.Point)) {
            continue;
          }
          const validApproach = portDirectionSetAny(targetPort.directions, (direction) => {
            if (overlap) {
              switch (direction) {
                case Orientation.Top:
                case Orientation.Bottom:
                  return adjacentNode.Point.Y !== leastDistanceNode.Point.Y;
                case Orientation.Right:
                case Orientation.Left:
                  return adjacentNode.Point.X !== leastDistanceNode.Point.X;
                default:
                  return true;
              }
            }
            switch (direction) {
              case Orientation.Top:
                return adjacentNode.Point.Y > leastDistanceNode.Point.Y;
              case Orientation.Bottom:
                return adjacentNode.Point.Y < leastDistanceNode.Point.Y;
              case Orientation.Right:
                return adjacentNode.Point.X < leastDistanceNode.Point.X;
              case Orientation.Left:
                return adjacentNode.Point.X > leastDistanceNode.Point.X;
              default:
                return true;
            }
          });
          if (!validApproach) {
            continue;
          }
        }

        if (
          leastDistanceNode !== source &&
          adjacentNode !== target &&
          !adjacentNode.isPortOf(gSource) &&
          !adjacentNode.isPortOf(gTarget)
        ) {
          if (adjacentNode.Container != null) {
            const sourceInside = routeSearchIsDescendantOf(this.work, sourceContainer, adjacentNode.Container);
            const targetInside = routeSearchIsDescendantOf(this.work, targetContainer, adjacentNode.Container);
            if (!sourceInside && !targetInside) {
              if (!fixedOverlaps.has(adjacentNode.Container)) {
                continue;
              }
            }
          }
        }

        if (adjacentNode !== target && leastDistanceNode !== source) {
          if (adjacentNode.Point.X !== leastDistanceNode.Point.X && adjacentNode.Point.Y !== leastDistanceNode.Point.Y) {
            continue;
          }
        }

        if (adjacentNode.isPortOf(gSource)) {
          if (blockedSourcePorts.has(adjacentNode.Point)) {
            continue;
          }
        }

        let nextDistance = 0.0;
        if (leastDistanceNode === source) {
          nextDistance = 1;
          if (!allowSrcPortSharing && duplicateSourcePortsUsed.has(adjacentNode.Point)) {
            nextDistance = BASICALLY_INFINITY;
          }
          if (sharedClusterSourcePortsUsed.size > 0) {
            if (!sharedClusterSourcePortsUsed.has(adjacentNode.Point)) {
              nextDistance += 2 * this.turnCost;
            }
          }
          if (!fromFacingPorts.has(adjacentNode.Point) && preferFacingPorts) {
            nextDistance += nonFacingPortsCost;
          }
          if (!adjacentNode.isCenterPortOf(gSource)) {
            nextDistance += this.nonCenterPortCost;
          } else {
            if (!nodeIsCenterSymmetricalPort.has(adjacentNode)) {
              nextDistance += 1;
            }
          }
        } else {
          nextDistance = e.Distance;
        }

        if (
          sourceContainer != null &&
          sourceContainer === targetContainer &&
          !(isSourceDescendantOfTarget || isTargetDescendantOfSource)
        ) {
          if (adjacentNode.Container == null || adjacentNode.Container !== sourceContainer) {
            if (leastDistanceNode.Container !== adjacentNode.Container) {
              nextDistance += this.turnCost * 4;
            }
          }
        }

        if (leastDistanceNode.sharesPortOwner(adjacentNode)) {
          nextDistance += this.turnCost * 4;
        }

        // SPECIAL WEIGHTS
        if (adjacentNode === target) {
          nextDistance = 1;
          if (!allowDstPortSharing && duplicateTargetPortsUsed.has(leastDistanceNode.Point)) {
            nextDistance = BASICALLY_INFINITY;
          }
          if (sharedClusterTargetPortsUsed.size > 0) {
            if (!sharedClusterTargetPortsUsed.has(leastDistanceNode.Point)) {
              nextDistance += 2 * this.turnCost;
            }
          }
          if (!toFacingPorts.has(leastDistanceNode.Point) && preferFacingPorts) {
            nextDistance += nonFacingPortsCost;
          }
          if (leastDistanceNode.isPortOf(gTarget)) {
            if (!leastDistanceNode.isCenterPortOf(gTarget)) {
              nextDistance += this.nonCenterPortCost;
            } else {
              if (!nodeIsCenterSymmetricalPort.has(leastDistanceNode)) {
                nextDistance += 1;
              }
            }
          }
        } else if (adjacentNode.IsNodeCenter) {
          nextDistance = BASICALLY_INFINITY;
        } else {
          overlappingEdges.length = 0;
          let isProhibitedSharing = false;

          if (leastDistanceNode !== source && leastDistanceNode !== target) {
            const routesOnEdge = this.overlappingRoutes.get(e) ?? [];
            for (const route of routesOnEdge) {
              this.work.reserveProduct((route.OVGNodes?.length ?? 0) + 1, 2);
              overlappingEdges.push(route.GEdge);
              if (gEdge.IsDirected() && route.isOpposingColinear(leastDistanceNode, adjacentNode)) {
                isProhibitedSharing = true;
                break;
              }
              if (adjacentNode.IsTunnel) {
                if (route.isEntireColinear(adjacentNode, leastDistanceNode) || route.isEntireColinear(leastDistanceNode, adjacentNode)) {
                  isProhibitedSharing = true;
                  break;
                }
              }
            }
          }

          if (!isProhibitedSharing) {
            const canOverlap = edgeCanOverlapEdgesGuarded(
              gEdge,
              overlappingEdges,
              sourceClusterNodes,
              targetClusterNodes,
              this.work
            );
            isProhibitedSharing = overlappingEdges.length > 0 && !canOverlap;
          }

          let isAdjacentNodeOnRoute = false;
          if (!isProhibitedSharing && leastDistanceNode !== source && leastDistanceNode !== target) {
            isAdjacentNodeOnRoute = (this.pointToRoute.get(adjacentNode.Point)?.length ?? 0) > 0;
          }

          if (!isProhibitedSharing && !isOnNodeOfRoute && !isAdjacentNodeOnRoute && leastDistanceNode !== source) {
            if (this.hasNearbyEdge.has(e)) {
              isProhibitedSharing = true;
            }
          }

          if (isProhibitedSharing) {
            nextDistance = sharedRouteCost;
          } else {
            let isCrossing = false;
            if (isOnNodeOfRoute && !isAdjacentNodeOnRoute && !areAllOccupiedRoutesShareable) {
              isCrossing = true;
            }
            if (!isCrossing && leastDistanceNode !== source) {
              isCrossing = this.edgeSet.intersectsWithGuarded(e, this.work);
            }
            if (isCrossing) {
              nextDistance += this.crossingCost;
            }
          }
        }

        for (let i = 0; i < this.positionedLabels.length; i++) {
          this.work.step();
          if (segmentIntersectsBox(e.From.Point, e.To.Point, this.positionedLabels[i].Box)) {
            nextDistance += BASICALLY_INFINITY;
            break;
          }
        }

        for (const labelBox of nodeLabelBoxes) {
          this.work.step();
          if (segmentIntersectsBox(e.From.Point, e.To.Point, labelBox.Box)) {
            nextDistance += this.turnCost;
          }
        }

        if (leastDistanceNode.isPortOf(gSource)) {
          if (gEdge.SourceArrowheadLabel != null) {
            const routePoints = [leastDistanceNode.Point, adjacentNode.Point];
            const al = PositionArrowheadLabel(gEdge, false, routePoints);
            const labelCost = positionedArrowheadLabelCostGuarded(al, nonAncestors, this.positionedLabels, this.routes, null, this.work);
            nextDistance += labelCost;
          }
        }
        if (adjacentNode.isPortOf(gTarget)) {
          if (gEdge.TargetArrowheadLabel != null) {
            const routePoints = [leastDistanceNode.Point, adjacentNode.Point];
            const al = PositionArrowheadLabel(gEdge, true, routePoints);
            const labelCost = positionedArrowheadLabelCostGuarded(al, nonAncestors, this.positionedLabels, this.routes, null, this.work);
            nextDistance += labelCost;
          }
        }

        if (lastNode != null && (adjacentNode !== target && leastDistanceNode !== source) && (lastNode !== source)) {
          const turns = (!isFromHorizontal && (adjacentNode.Point.X !== leastDistanceNode.Point.X)) ||
                        (isFromHorizontal && (adjacentNode.Point.Y !== leastDistanceNode.Point.Y));
          if (turns) {
            let multiplier = 1.0;
            for (const idealTurnAxis of idealAxes) {
              this.work.step();
              if (idealTurnAxis.isX) {
                if (Math.abs(adjacentNode.Point.X - idealTurnAxis.val) <= IDEAL_TURN_AXIS_TOLERANCE) {
                  multiplier = IDEAL_TURN_MULTIPLIER;
                  break;
                }
              } else {
                if (Math.abs(adjacentNode.Point.Y - idealTurnAxis.val) <= IDEAL_TURN_AXIS_TOLERANCE) {
                  multiplier = IDEAL_TURN_MULTIPLIER;
                  break;
                }
              }
            }
            if (multiplier !== 1.0) {
              if (gEdge.From.Cluster != null && (gSource.Cluster.Arrangement === gSource.Cluster.DesiredArrangement) && (gEdge.From.Cluster.Nodes?.length ?? 0) % 2 === 0) {
                multiplier = IDEAL_TURN_EVEN_CLUSTER_MULTIPLIER;
              }
            }

            if (!isFromHorizontal && (adjacentNode.Point.X !== leastDistanceNode.Point.X)) {
              nextDistance += (this.turnCost * multiplier);
              if (!(isSourceDescendantOfTarget || isTargetDescendantOfSource)) {
                if (leastDistanceNode.distanceToBoundary(gTarget) <= TURN_ENDPOINT_CLEARANCE) {
                  nextDistance += this.turnCost;
                }
                if (leastDistanceNode.distanceToBoundary(gSource) <= TURN_ENDPOINT_CLEARANCE) {
                  nextDistance += this.turnCost;
                }
              }
            }

            if (isFromHorizontal && (adjacentNode.Point.Y !== leastDistanceNode.Point.Y)) {
              nextDistance += (this.turnCost * multiplier);
              if (!(isSourceDescendantOfTarget || isTargetDescendantOfSource)) {
                if (leastDistanceNode.distanceToBoundary(gTarget) <= TURN_ENDPOINT_CLEARANCE) {
                  nextDistance += this.turnCost;
                }
                if (leastDistanceNode.distanceToBoundary(gSource) <= TURN_ENDPOINT_CLEARANCE) {
                  nextDistance += this.turnCost;
                }
              }
            }
          }
        }

        if (leastDistanceNode !== source && adjacentNode !== target && (adjacentNode.IsNearPort?.size ?? 0) > 0) {
          if (adjacentNode.IsNearPort.has(gSource) || adjacentNode.IsNearPort.has(gTarget)) {
            nextDistance += NODE_PROXIMITY_PENALTY;
          }
        }

        const maybeNewDistance = leastDistance + nextDistance;

        if (nodeContext[adjacentNode.Index] == null) {
          nodeContext[adjacentNode.Index] = new SearchNodeContext();
        }

        if (adjacentNode.Point.Y === leastDistanceNode.Point.Y) {
          // Horizontal path
          if (maybeNewDistance < nodeContext[adjacentNode.Index].horizontalDistance) {
            if (horizontalHops[adjacentNode.Index] != null) {
              pq.push(
                nodeContext[horizontalHops[adjacentNode.Index].Index].horizontalDistance,
                horizontalHops[adjacentNode.Index],
                true,
                this.work
              );
            }
            if (nodeContext[adjacentNode.Index].horizontalEntry == null) {
              const horizontalEntry = pq.push(maybeNewDistance, adjacentNode, true, this.work);
              nodeContext[adjacentNode.Index].horizontalEntry = horizontalEntry;
            } else {
              pq.decrease(nodeContext[adjacentNode.Index].horizontalEntry, maybeNewDistance, this.work);
            }
            nodeContext[adjacentNode.Index].horizontalDistance = maybeNewDistance;
            horizontalHops[adjacentNode.Index] = leastDistanceNode;
          }
        } else {
          // Vertical path
          if (maybeNewDistance < nodeContext[adjacentNode.Index].verticalDistance) {
            if (verticalHops[adjacentNode.Index] != null) {
              pq.push(
                nodeContext[verticalHops[adjacentNode.Index].Index].verticalDistance,
                verticalHops[adjacentNode.Index],
                false,
                this.work
              );
            }
            if (nodeContext[adjacentNode.Index].verticalEntry == null) {
              const verticalEntry = pq.push(maybeNewDistance, adjacentNode, false, this.work);
              nodeContext[adjacentNode.Index].verticalEntry = verticalEntry;
            } else {
              pq.decrease(nodeContext[adjacentNode.Index].verticalEntry, maybeNewDistance, this.work);
            }
            nodeContext[adjacentNode.Index].verticalDistance = maybeNewDistance;
            verticalHops[adjacentNode.Index] = leastDistanceNode;
          }
        }
      }
    }

    const debugID = gEdge.DebugID ? gEdge.DebugID() : `${gEdge.From?.ID}->${gEdge.To?.ID}`;
    throw new Error(`path not found for '${debugID}'. Queue is empty`);
  }

  bestRoute(
    ctx,
    gSource,
    gTarget,
    source,
    target,
    nodeContext,
    verticalHops,
    horizontalHops
  ) {
    this.bindWork(ctx);
    const sequence = [];
    const idealAxes = idealTurnAxes(gSource, gTarget);

    let curr = target;
    let prev = null;
    let next = null;
    const visited = new Set();

    while (curr != null) {
      this.work.step();
      if (visited.has(curr)) {
        break;
      }
      visited.add(curr);
      sequence.push(curr);

      let isHorizontal = false;
      const entry = nodeContext[curr.Index];
      const verticalDistance = entry ? entry.verticalDistance : Infinity;
      const horizontalDistance = entry ? entry.horizontalDistance : Infinity;

      if (verticalHops[curr.Index] != null && horizontalHops[curr.Index] != null) {
        if (verticalDistance < horizontalDistance) {
          next = verticalHops[curr.Index];
          isHorizontal = false;
        } else {
          next = horizontalHops[curr.Index];
          isHorizontal = true;
        }
      } else if (verticalHops[curr.Index] != null) {
        next = verticalHops[curr.Index];
        isHorizontal = false;
      } else {
        next = horizontalHops[curr.Index];
        isHorizontal = true;
      }

      if (prev != null && next != null && next !== source) {
        if (
          (prev.Point.X === curr.Point.X && isHorizontal) ||
          (prev.Point.Y === curr.Point.Y && !isHorizontal)
        ) {
          let alternativeDistance = 0.0;
          let alternative = null;
          let multiplier = 1.0;

          for (const idealTurnAxis of idealAxes) {
            this.work.step();
            if (idealTurnAxis.isX) {
              if (Math.abs(curr.Point.X - idealTurnAxis.val) <= IDEAL_TURN_AXIS_TOLERANCE) {
                multiplier = IDEAL_TURN_MULTIPLIER;
                break;
              }
            } else {
              if (Math.abs(curr.Point.Y - idealTurnAxis.val) <= IDEAL_TURN_AXIS_TOLERANCE) {
                multiplier = IDEAL_TURN_MULTIPLIER;
                break;
              }
            }
          }
          if (multiplier !== 1.0) {
            if (
              gSource.Cluster != null &&
              gSource.Cluster.Arrangement === gSource.Cluster.DesiredArrangement &&
              (gSource.Cluster.Nodes?.length ?? 0) % 2 === 0
            ) {
              multiplier = IDEAL_TURN_EVEN_CLUSTER_MULTIPLIER;
            }
          }

          if (
            isHorizontal &&
            precisionCompare(horizontalDistance + this.turnCost * multiplier, verticalDistance, 0.0001) > 0
          ) {
            alternativeDistance = verticalDistance;
            alternative = verticalHops[curr.Index];
          }
          if (
            !isHorizontal &&
            precisionCompare(verticalDistance + this.turnCost * multiplier, horizontalDistance, 0.0001) > 0
          ) {
            alternativeDistance = horizontalDistance;
            alternative = horizontalHops[curr.Index];
          }

          if (alternative != null && alternativeDistance < BASICALLY_INFINITY) {
            next = alternative;
          }
        }
      }

      prev = curr;
      curr = next;
    }

    for (let left = 0, right = sequence.length - 1; left < right; left++, right--) {
      this.work.step();
      const tmp = sequence[left];
      sequence[left] = sequence[right];
      sequence[right] = tmp;
    }
    return sequence;
  }

  findOverlappingRoutes(start, end) {
    const overlappingRoutes = [];
    const routeSet = new Set();

    const overlaps = this.edgeSet.overlappingEdgesGuarded(NewOVGEdge(start, end), this.work);
    for (const overlapping of overlaps) {
      this.work.step();
      const routesFrom = this.pointToRoute.get(overlapping.From.Point) ?? [];
      for (const rf of routesFrom) {
        this.work.step();
        const routesTo = this.pointToRoute.get(overlapping.To.Point) ?? [];
        for (const rt of routesTo) {
          this.work.step();
          if (!routeSet.has(rt) && rt === rf) {
            routeSet.add(rt);
            overlappingRoutes.push(rt);
          }
        }
      }
    }
    return overlappingRoutes;
  }

  addRoute(route) {
    const dups = new Set();
    let routeNodes = route.OVGNodes;
    const isLoop = typeof route.GEdge.IsLoop === 'function' ? route.GEdge.IsLoop() : edgeIsLoop(route.GEdge);
    if (isLoop) {
      routeNodes = routeNodes.slice(1);
    }
    for (let i = 0; i < routeNodes.length; i++) {
      this.work.step();
      const n = routeNodes[i];
      if (dups.has(n)) {
        const debugID = route.GEdge.DebugID ? route.GEdge.DebugID() : `${route.GEdge.From?.ID}->${route.GEdge.To?.ID}`;
        throw new Error(`found duplicate OVGNode (${JSON.stringify(n.Point)}) at index ${i} in route ${debugID}`);
      }
      dups.add(n);
    }

    if (route.GEdge.SourceArrowheadLabel != null) {
      this.work.add(route.OVGNodes.length);
      const routePoints = route.createSegmentEndpoints();
      const al = PositionArrowheadLabel(route.GEdge, false, routePoints);
      if (al != null) this.positionedLabels.push(al);
    }
    if (route.GEdge.TargetArrowheadLabel != null) {
      this.work.add(route.OVGNodes.length);
      const routePoints = route.createSegmentEndpoints();
      const al = PositionArrowheadLabel(route.GEdge, true, routePoints);
      if (al != null) this.positionedLabels.push(al);
    }

    this.routes.push(route);
    this.routedEdges.push(route.GEdge);

    for (let i = 0; i < route.OVGNodes.length; i++) {
      this.work.step();
      const start = route.OVGNodes[i];
      let pointRoutes = this.pointToRoute.get(start.Point);
      if (pointRoutes == null) {
        pointRoutes = [];
        this.pointToRoute.set(start.Point, pointRoutes);
      }
      pointRoutes.push(route);

      if (i > 0 && i < route.OVGNodes.length - 2) {
        const end = route.OVGNodes[i + 1];
        this.edgeSet.addGuarded(NewOVGEdge(start, end), this.work);
      }
    }

    if (!route.GEdge.IsInvisible) {
      for (let i = 1; i < route.OVGNodes.length - 2; i++) {
        this.work.step();
        const routeNode = route.OVGNodes[i];
        const nextRouteNode = route.OVGNodes[i + 1];
        if (routeNode.X === nextRouteNode.X) {
          // vertical
          let routeTop = routeNode.Y;
          let routeBottom = nextRouteNode.Y;
          if (routeBottom < routeTop) {
            [routeTop, routeBottom] = [routeBottom, routeTop];
          }
          const verticalEdgesMap = this.ovg.VerticalEdges?.entries ? this.ovg.VerticalEdges.entries() : [];
          for (const [xVal, ovgEdges] of verticalEdgesMap) {
            this.work.step();
            const x = typeof xVal === 'number' ? xVal : parseFloat(xVal);
            if (Math.abs(x - routeNode.X) > PATH_NODE_PROXIMITY_FLOOR) {
              continue;
            }
            for (const ovgEdge of ovgEdges ?? []) {
              this.work.step();
              let edgeTop = ovgEdge.From.Y;
              let edgeBottom = ovgEdge.To.Y;
              if (edgeBottom < edgeTop) {
                [edgeTop, edgeBottom] = [edgeBottom, edgeTop];
              }
              if (!(edgeBottom < routeTop || routeBottom < edgeTop)) {
                this.hasNearbyEdge.add(ovgEdge);
                if (x === routeNode.X) {
                  let edgeRoutes = this.overlappingRoutes.get(ovgEdge);
                  if (edgeRoutes == null) {
                    edgeRoutes = [];
                    this.overlappingRoutes.set(ovgEdge, edgeRoutes);
                  }
                  edgeRoutes.push(route);
                }
              }
            }
          }
        } else {
          // horizontal
          let routeLeft = routeNode.X;
          let routeRight = nextRouteNode.X;
          if (routeRight < routeLeft) {
            [routeLeft, routeRight] = [routeRight, routeLeft];
          }
          const horizontalEdgesMap = this.ovg.HorizontalEdges?.entries ? this.ovg.HorizontalEdges.entries() : [];
          for (const [yVal, ovgEdges] of horizontalEdgesMap) {
            this.work.step();
            const y = typeof yVal === 'number' ? yVal : parseFloat(yVal);
            if (Math.abs(y - routeNode.Y) > PATH_NODE_PROXIMITY_FLOOR) {
              continue;
            }
            for (const ovgEdge of ovgEdges ?? []) {
              this.work.step();
              let edgeLeft = ovgEdge.From.X;
              let edgeRight = ovgEdge.To.X;
              if (edgeRight < edgeLeft) {
                [edgeLeft, edgeRight] = [edgeRight, edgeLeft];
              }
              if (!(edgeRight < routeLeft || routeRight < edgeLeft)) {
                this.hasNearbyEdge.add(ovgEdge);
                if (y === routeNode.Y) {
                  let edgeRoutes = this.overlappingRoutes.get(ovgEdge);
                  if (edgeRoutes == null) {
                    edgeRoutes = [];
                    this.overlappingRoutes.set(ovgEdge, edgeRoutes);
                  }
                  edgeRoutes.push(route);
                }
              }
            }
          }
        }
      }
    }

    this.work.check();
  }
}

export function newOVGEdgeRouterWithWorkLimit(
  ctx,
  flavor,
  ovg,
  g,
  existingRoutes,
  edges,
  workLimit = MAX_ROUTE_SEARCH_WORK_UNITS
) {
  const guard = new RouteSearchWorkGuard(ctx, flavor, workLimit);
  try {
    guard.add(edges.length);
    const orderedEdges = edges.slice();

    const clusterNodes = new Set();
    const clusters = g.Clusters instanceof Map ? Array.from(g.Clusters.values()) : Object.values(g.Clusters ?? {});
    for (const c of clusters) {
      guard.step();
      for (const cn of c.Nodes ?? []) {
        guard.step();
        clusterNodes.add(cn);
      }
    }
    for (const edge of orderedEdges) {
      guard.step();
      if (edge == null || edge.From == null || edge.To == null) {
        continue;
      }
      guard.reserveSum((edge.From.Edges?.length ?? 0), (edge.To.Edges?.length ?? 0));
    }
    guard.reserveSort(orderedEdges.length);
    guard.reserveSort(orderedEdges.length);
    sortEdges(flavor, orderedEdges, clusterNodes);

    const router = new OVGEdgeRouter(flavor, g, ovg, orderedEdges, guard);

    for (const route of existingRoutes ?? []) {
      guard.step();
      router.addRoute(route);
    }

    guard.check();
    return router;
  } catch (err) {
    try { guard.finish(); } catch {}
    throw err;
  }
}
