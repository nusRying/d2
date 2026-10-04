// Slice 47 — Orthogonal Visibility Graph (OVG) construction.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/ovg.go
// (methods defined in ovg_resource.go and ovg_hierarchy.go are delegated to
// ovg-resource.js / ovg-hierarchy.js).
//
// Representation:
//   NodesInsideBoundingBox — layoutgraph.Node[] (null for Go nil)
//   Nodes, Edges           — arrays
//   OccupiedPoints         — GoPointMap<geo.Point value, OVGNode>
//   VerticalEdges / HorizontalEdges — GoFloatMap<float64, OVGEdge[]>
//   Ports                  — Map<layoutgraph.Node, OVGNode[]>
//   Centers                — Map<layoutgraph.Node, OVGNode>
//   fixedOverlapsCache     — FixedOverlapsCacheEntry[] (Go's mutex is moot)
//   buildGuard             — OVGBuildGuard | null
// Errors and Go panics are thrown (panics with Go's runtime message).
//
// Go map iteration (Ports, Containers, port owners, float-keyed candidate
// sets) uses JS Map insertion order; Go's order is unspecified. The node set,
// edge list (order included), ports, centers, port metadata, containers and
// near-port flags are independent of that order. The ORDER of ovg.Nodes (and
// therefore OVGNode.Index) is not: boundary-layer, boundary-connection and
// hierarchy-port insertion follow Ports map order. Work totals are
// order-independent unless a candidate aligns with more port owners than it
// needs (hasUnobstructedLineToPorts stops early) or a point has several port
// owners (isRestrictedSequencePort / isMisdirectedPortPair stop early).

import { Point } from '../geometry/point.js';
import { goRound, euclideanDistance } from '../geometry/math.js';
import { goMax, goMin } from '../geometry/go-math.js';
import { Orientation, getOpposite } from '../geometry/orientation.js';
import { nodeCenterPortIndices, nodeSnapPointPercentages } from '../shape/ports.js';
import {
  EXTRA_INTERESTING_POINT_LAYERS,
  NODE_PROXIMITY_THRESHOLD,
  OVERSHOOT_AMOUNT,
  OVG_PADDING,
} from './tuning.js';
import { OVGNode, NewOVGNode, portDirectionSetAny, portDirectionSetHas } from './ovg-node.js';
import { NewOVGEdge } from './ovg-edge.js';
import {
  checkedOVGEdgeCapacity,
  checkedOVGIntersectionCount,
  checkedOVGSliceCapacity,
  fixedOverlapsForBuild,
  maxIntAsUint64,
  newOVGBuildGuard,
  newOVGPointProximityIndex,
  newOVGPortIndex,
} from './ovg-resource.js';
import {
  addBoundaryNodesAboveLevelNodes,
  addHierarchyLevelNodes,
  addLevelNodes,
  addPortAlignedNodes,
  newOVGForHierarchy,
  transformHierarchyOVGNodes,
  transposeOVG,
} from './ovg-hierarchy.js';
import { buildTunnels } from './tunnel.js';
import { isSentinelEdgeSource, treeEdgePathForBuild } from './tree-routes.js';
import {
  GoFloatMap,
  GoPointMap,
  goFormatPointValue,
  goIndex,
  goJSONFloat,
  goSortFloat64s,
  goSortSlice,
  mapAppend,
  subUint64,
} from './ovg-go-support.js';
import { MIN_PORT_CLEARANCE, edgeIsLoop, nodeContainsPointOnBox } from './layoutgraph-routing-support.js';

function floatMapAppend(map, key, value) {
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, [value]);
  } else {
    current.push(value);
    map.set(key, current);
  }
}

export class OVG {
  constructor(nodesInsideBoundingBox = null) {
    this.NodesInsideBoundingBox = nodesInsideBoundingBox;
    this.Nodes = [];
    this.OccupiedPoints = new GoPointMap();
    this.Edges = [];
    this.VerticalEdges = new GoFloatMap();
    this.HorizontalEdges = new GoFloatMap();
    this.Ports = new Map();
    this.Centers = new Map();

    this.fixedOverlapsCache = [];
    this.buildGuard = null;
  }

  AddNodeUnchecked(node) {
    this.Nodes.push(node);
    this.OccupiedPoints.set(node.Point, node);
  }

  AddNode(node) {
    const occupant = this.OccupiedPoints.get(node.Point);
    if (occupant !== undefined) {
      return occupant;
    }
    this.AddNodeUnchecked(node);
    return node;
  }

  /** → the new OVGEdge, or null when a center would connect to a non-port. */
  Connect(nodeA, nodeB) {
    if ((nodeA.IsNodeCenter && !nodeB.isPort()) || (nodeB.IsNodeCenter && !nodeA.isPort())) {
      // only ports can connect to center
      return null;
    }

    const edge = NewOVGEdge(nodeA, nodeB);
    this.Edges.push(edge);
    nodeA.addEdge(edge);
    nodeB.addEdge(edge);
    if (edge.isVertical()) {
      floatMapAppend(this.VerticalEdges, nodeA.X, edge);
    } else if (edge.isHorizontal()) {
      floatMapAppend(this.HorizontalEdges, nodeA.Y, edge);
    }
    // OVG nodes never move, so the distance is precomputed for routing.
    edge.Distance = euclideanDistance(nodeA.X, nodeA.Y, nodeB.X, nodeB.Y);
    return edge;
  }

  removeIsolatedNodes(guard) {
    guard.check();
    const newNodes = [];
    for (const n of this.Nodes) {
      guard.step();
      if (n.Edges.length > 0) {
        newNodes.push(n);
      }
    }
    this.Nodes = newNodes;
    guard.check();
  }

  reindexOccupiedPoints() {
    this.OccupiedPoints = new GoPointMap();
    for (const node of this.Nodes) {
      this.OccupiedPoints.set(node.Point, node);
    }
  }

  // ── ovg_resource.go methods ────────────────────────────────────────────────

  fixedOverlapsForBuild(graph, nodes, guard) {
    return fixedOverlapsForBuild(this, graph, nodes, guard);
  }

  // ── ovg_hierarchy.go methods ───────────────────────────────────────────────

  addHierarchyLevelNodes(g, hierarchy, guard) {
    addHierarchyLevelNodes(this, g, hierarchy, guard);
  }

  addBoundaryNodesAboveLevelNodes(nodesAbove, nodesBelow, leftX, rightX, guard) {
    return addBoundaryNodesAboveLevelNodes(this, nodesAbove, nodesBelow, leftX, rightX, guard);
  }

  addPortAlignedNodes(nodesAbove, nodesBelow, ys, guard) {
    addPortAlignedNodes(this, nodesAbove, nodesBelow, ys, guard);
  }

  addLevelNodes(levelToNodes, minXBound, maxXBound, guard) {
    return addLevelNodes(this, levelToNodes, minXBound, maxXBound, guard);
  }

  transpose() {
    transposeOVG(this);
  }

  transformHierarchyOVGNodes(transformPoint, transformDirection) {
    transformHierarchyOVGNodes(this, transformPoint, transformDirection);
  }

  // ── construction ───────────────────────────────────────────────────────────

  /** For each graph node, add its snap points as OVG port nodes. */
  addPorts(g, guard) {
    guard.check();
    // Children of a container without connections need no pathing.
    const skipPathing = new Set();
    for (const children of g.Containers.values()) {
      guard.step();
      let has = false;
      for (const child of children) {
        guard.step();
        if (child.Edges.length > 0) {
          has = true;
          break;
        }
      }
      if (!has) {
        for (const child of children) {
          guard.step();
          skipPathing.add(child);
        }
      }
    }

    for (const node of this.NodesInsideBoundingBox ?? []) {
      guard.step();
      if (skipPathing.has(node)) {
        continue;
      }
      const ports = [];
      this.Ports.set(node, ports);
      const groups = nodeSnapPointPercentages(node);
      for (let i = 0; i < groups.length; i++) {
        guard.step();
        for (const point of groups[i]) {
          guard.step();
          const port = guard.addPoint(this, new Point(
            node.TopLeft.X + goRound(node.Width * point.XPercentage),
            node.TopLeft.Y + goRound(node.Height * point.YPercentage),
          ));
          ports.push(port);
          let direction = Orientation.TopLeft; // Go zero value
          if (i === 0) {
            direction = Orientation.Top;
          } else if (i === 1) {
            direction = Orientation.Left;
          } else if (i === 2) {
            direction = Orientation.Bottom;
          } else if (i === 3) {
            direction = Orientation.Right;
          }
          port.addPortOwner(node, direction, false);
        }
      }

      for (const index of nodeCenterPortIndices(node) ?? []) {
        guard.step();
        goIndex(ports, index).setCenterPort(node);
      }
    }
    guard.check();
  }

  /** Cartesian product of all port coordinates as candidate OVG nodes. */
  addNodesIntersections(g, guard) {
    guard.check();
    const xCandidates = new GoFloatMap();
    const yCandidates = new GoFloatMap();

    for (const node of this.Nodes) {
      guard.step();
      xCandidates.set(node.Point.X, true);
      yCandidates.set(node.Point.Y, true);
    }

    this.addIntersections(g, xCandidates, yCandidates, guard);
  }

  /**
   * xs / ys are Go map[float64]struct{} sets: GoFloatMap (or any object with
   * `size` and `keys()`).
   */
  addIntersections(g, xs, ys, guard) {
    guard.check();
    const candidateCount = checkedOVGIntersectionCount(xs.size, ys.size);
    // Reserve the complete Cartesian product before allocating its orderings.
    guard.reserveCandidates(candidateCount);
    guard.reserveWork(candidateCount);

    const xOrder = [];
    for (const x of xs.keys()) {
      guard.check();
      xOrder.push(x);
    }
    guard.reserveSortWork(xOrder.length);
    goSortFloat64s(xOrder);

    const yOrder = [];
    for (const y of ys.keys()) {
      guard.check();
      yOrder.push(y);
    }
    guard.reserveSortWork(yOrder.length);
    goSortFloat64s(yOrder);

    const fixedOverlaps = this.fixedOverlapsForBuild(g, g.Nodes, guard);
    const portIndex = newOVGPortIndex(this.Ports, g, fixedOverlaps, guard);
    const proximityIndex = newOVGPointProximityIndex(g, xOrder, guard);

    for (const px of xOrder) {
      guard.check();
      for (const py of yOrder) {
        guard.check();
        // Can't be too close to any port or node
        if (portIndex.tooClose(px, py, MIN_PORT_CLEARANCE, guard)) {
          continue;
        }
        // Charge candidate inspection before any geometry.
        guard.step();
        const candidatePoint = new Point(px, py);
        if (proximityIndex.pointNear(px, py, guard)) {
          continue;
        }
        const candidate = new OVGNode(candidatePoint);
        if (candidate.hasUnobstructedLineToPorts(this, portIndex, 2, guard)) {
          guard.addNode(this, NewOVGNode(new Point(px, py)));
        }
      }
    }
    guard.check();
  }

  /** Perimeter and halfway points for every edge's bounding box. */
  addEdgesNodes(g, guard) {
    guard.check();
    const fixedOverlaps = this.fixedOverlapsForBuild(g, g.Nodes, guard);
    const portIndex = newOVGPortIndex(this.Ports, g, fixedOverlaps, guard);
    for (const edge of g.Edges) {
      guard.step();
      if (edgeIsLoop(edge)) {
        continue;
      }
      if (edge.From.Hierarchy != null && edge.To.Hierarchy != null && edge.To.Hierarchy === edge.From.Hierarchy) {
        // same-hierarchy edges were handled by the hierarchical OVG
        continue;
      }
      const fillPoints = this.perimeterPoints(edge.From, edge.To, guard);
      const halfwayPoints = this.halfwayPoints(edge.From, edge.To, guard);
      fillPoints.push(...halfwayPoints);
      for (const fillPoint of fillPoints) {
        guard.step();
        guard.step();
        if (guard.pointNearGraphNode(g, fillPoint)) {
          continue;
        }
        const candidate = new OVGNode(fillPoint);
        if (candidate.hasUnobstructedLineToPorts(this, portIndex, 1, guard)) {
          guard.addNode(this, NewOVGNode(fillPoint));
        }
      }
    }
    guard.check();
  }

  perimeterPoints(node, otherNode, guard) {
    const fillPoints = [];
    const top = goMin(node.TopLeft.Y, otherNode.TopLeft.Y) - OVERSHOOT_AMOUNT;
    const bottom = goMax(node.TopLeft.Y + node.Height, otherNode.TopLeft.Y + otherNode.Height) + OVERSHOOT_AMOUNT;
    const left = goMin(node.TopLeft.X, otherNode.TopLeft.X) - OVERSHOOT_AMOUNT;
    const right = goMax(node.TopLeft.X + node.Width, otherNode.TopLeft.X + otherNode.Width) + OVERSHOOT_AMOUNT;

    for (const graphNode of [node, otherNode]) {
      guard.step();
      for (const portNode of guard.portsByOrientation(this, graphNode, Orientation.Top)) {
        guard.step();
        fillPoints.push(new Point(portNode.Point.X, top));
      }
      for (const portNode of guard.portsByOrientation(this, graphNode, Orientation.Bottom)) {
        guard.step();
        fillPoints.push(new Point(portNode.Point.X, bottom));
      }
      for (const portNode of guard.portsByOrientation(this, graphNode, Orientation.Left)) {
        guard.step();
        fillPoints.push(new Point(left, portNode.Point.Y));
      }
      for (const portNode of guard.portsByOrientation(this, graphNode, Orientation.Right)) {
        guard.step();
        fillPoints.push(new Point(right, portNode.Point.Y));
      }
    }

    fillPoints.push(new Point(left, top));
    fillPoints.push(new Point(right, top));
    fillPoints.push(new Point(left, bottom));
    fillPoints.push(new Point(right, bottom));
    guard.check();
    return fillPoints;
  }

  /** Points halfway between node and otherNode. */
  halfwayPoints(node, otherNode, guard) {
    const fillPoints = [];
    const orientation = node.Orientation(otherNode);
    if (orientation === Orientation.NONE) {
      guard.check();
      return fillPoints;
    }
    // Fill from node towards otherNode.
    let fillTop = false;
    let fillRight = false;
    let fillBottom = false;
    let fillLeft = false;
    switch (orientation) {
      case Orientation.Top:
        fillBottom = true;
        break;
      case Orientation.TopLeft:
        fillBottom = true;
        fillRight = true;
        break;
      case Orientation.TopRight:
        fillBottom = true;
        fillLeft = true;
        break;
      case Orientation.Bottom:
        fillTop = true;
        break;
      case Orientation.BottomLeft:
        fillTop = true;
        fillRight = true;
        break;
      case Orientation.BottomRight:
        fillTop = true;
        fillLeft = true;
        break;
      case Orientation.Left:
        fillRight = true;
        break;
      case Orientation.Right:
        fillLeft = true;
        break;
      default:
        break;
    }

    let nodeTL = node.TopLeft.copy();
    let nodeBR = new Point(goRound(nodeTL.X + node.Width), goRound(nodeTL.Y + node.Height));

    let otherNodeTL = otherNode.TopLeft.copy();
    let otherNodeBR = new Point(goRound(otherNodeTL.X + otherNode.Width), goRound(otherNodeTL.Y + otherNode.Height));

    // cluster nodes share halfway points based on the whole cluster
    if (node.Cluster != null) {
      [nodeTL, nodeBR] = guard.tightBoundingBox(node.Cluster.Nodes);
    }
    if (otherNode.Cluster != null) {
      [otherNodeTL, otherNodeBR] = guard.tightBoundingBox(otherNode.Cluster.Nodes);
    }

    let nodePorts = this.Ports.get(node) ?? [];
    let otherNodePorts = this.Ports.get(otherNode) ?? [];
    if (node.Sequence != null) {
      [nodeTL, nodeBR] = guard.tightBoundingBox(node.Sequence.Nodes);
      for (const n of node.Sequence.Nodes) {
        guard.step();
        if (n !== node) {
          nodePorts = nodePorts.concat(this.Ports.get(n) ?? []);
        }
      }
    }
    if (otherNode.Sequence != null) {
      [otherNodeTL, otherNodeBR] = guard.tightBoundingBox(otherNode.Sequence.Nodes);
      for (const n of otherNode.Sequence.Nodes) {
        guard.step();
        if (n !== otherNode) {
          otherNodePorts = otherNodePorts.concat(this.Ports.get(n) ?? []);
        }
      }
    }

    if (fillTop) {
      const y = (nodeTL.Y + otherNodeBR.Y) / 2;
      for (const portNode of nodePorts) {
        guard.step();
        fillPoints.push(new Point(portNode.Point.X, y));
      }
      for (const portNode of otherNodePorts) {
        guard.step();
        fillPoints.push(new Point(portNode.Point.X, y));
      }
    }
    if (fillBottom) {
      const y = (otherNodeTL.Y + nodeBR.Y) / 2;
      for (const portNode of nodePorts) {
        guard.step();
        fillPoints.push(new Point(portNode.Point.X, y));
      }
      for (const portNode of otherNodePorts) {
        guard.step();
        fillPoints.push(new Point(portNode.Point.X, y));
      }
    }
    if (fillLeft) {
      const x = (nodeTL.X + otherNodeBR.X) / 2;
      for (const portNode of nodePorts) {
        guard.step();
        fillPoints.push(new Point(x, portNode.Point.Y));
      }
      for (const portNode of otherNodePorts) {
        guard.step();
        fillPoints.push(new Point(x, portNode.Point.Y));
      }
    }
    if (fillRight) {
      const x = (otherNodeTL.X + nodeBR.X) / 2;
      for (const portNode of nodePorts) {
        guard.step();
        fillPoints.push(new Point(x, portNode.Point.Y));
      }
      for (const portNode of otherNodePorts) {
        guard.step();
        fillPoints.push(new Point(x, portNode.Point.Y));
      }
    }

    // corner points of the halfway fill points
    if (fillRight && fillBottom) {
      fillPoints.push(new Point((otherNodeTL.X + nodeBR.X) / 2, (otherNodeTL.Y + nodeBR.Y) / 2));
    }
    if (fillRight && fillTop) {
      fillPoints.push(new Point((otherNodeTL.X + nodeBR.X) / 2, (nodeTL.Y + otherNodeBR.Y) / 2));
    }
    if (fillLeft && fillTop) {
      fillPoints.push(new Point((nodeTL.X + otherNodeBR.X) / 2, (nodeTL.Y + otherNodeBR.Y) / 2));
    }
    if (fillLeft && fillBottom) {
      fillPoints.push(new Point((nodeTL.X + otherNodeBR.X) / 2, (otherNodeTL.Y + nodeBR.Y) / 2));
    }
    guard.check();
    return fillPoints;
  }

  addTreeNodes(g, guard) {
    guard.check();
    // Map<OVGNode, Set<Arrowhead>>
    const portArrowheads = new Map();
    // Trees in this subgraph get OVG nodes for their specific edge routes.
    for (const node of g.Nodes) {
      guard.step();
      if (g.NodeToTree == null || !g.NodeToTree.has(node)) {
        continue;
      }
      const tree = g.NodeToTree.get(node);
      const treePath = treeEdgePathForBuild(tree, this.Ports, portArrowheads, guard);

      guard.addPoint(this, treePath.SourceMidpoint);
      guard.addPoint(this, treePath.TargetMidpoint);
      // misaligned centers may use a new parent-aligned port, added here
      if (isSentinelEdgeSource(tree)) {
        const port = guard.addNode(this, treePath.SourcePortNode);
        if (!port.isPortOf(node)) {
          mapAppend(this.Ports, node, port);
          port.addPortOwner(node, getOpposite(treePath.SourceOrientationToTarget), false);
        }
        let arrowheads = portArrowheads.get(treePath.TargetPortNode);
        if (arrowheads === undefined) {
          arrowheads = new Set();
          portArrowheads.set(treePath.TargetPortNode, arrowheads);
        }
        arrowheads.add(tree.SentinelEdge.TargetArrowhead);
      } else {
        const port = guard.addNode(this, treePath.TargetPortNode);
        if (!port.isPortOf(node)) {
          mapAppend(this.Ports, node, port);
          port.addPortOwner(node, treePath.SourceOrientationToTarget, false);
        }
        let arrowheads = portArrowheads.get(treePath.SourcePortNode);
        if (arrowheads === undefined) {
          arrowheads = new Set();
          portArrowheads.set(treePath.SourcePortNode, arrowheads);
        }
        arrowheads.add(tree.SentinelEdge.SourceArrowhead);
      }
    }
    guard.check();
  }

  /** addNewBoundaryLayers pads the graph boundary with layers of points. */
  addNewBoundaryLayers(g, tl, br, guard) {
    guard.check();
    for (let i = 0.0; i < EXTRA_INTERESTING_POINT_LAYERS; i++) {
      guard.step();
      // Go ranges over the slice header captured at loop start.
      const nodes = this.Nodes;
      const count = nodes.length;
      for (let k = 0; k < count; k++) {
        const node = nodes[k];
        guard.step();
        let point = null;
        if (node.Point.Y === tl.Y) {
          point = new Point(node.Point.X, node.Point.Y - (OVG_PADDING * (i + 1)));
        }
        if (node.Point.Y === br.Y) {
          point = new Point(node.Point.X, node.Point.Y + (OVG_PADDING * (i + 1)));
        }
        if (node.Point.X === tl.X) {
          point = new Point(node.Point.X - (OVG_PADDING * (i + 1)), node.Point.Y);
        }
        if (node.Point.X === br.X) {
          point = new Point(node.Point.X + (OVG_PADDING * (i + 1)), node.Point.Y);
        }

        if (point != null) {
          if (!guard.pointNearGraphNode(g, point)) {
            guard.addPoint(this, point);
          }
        }
      }
    }
  }

  /** Boundary nodes in direct line with each port. */
  addPortConnectionNodesAtBoundaries(g, tl, br, guard) {
    guard.check();
    for (let i = 0.0; i < EXTRA_INTERESTING_POINT_LAYERS; i++) {
      guard.step();
      for (const [node, ports] of this.Ports) {
        guard.step();
        let added = false;
        const seenPorts = new Set();
        for (const portNode of ports) {
          guard.step();
          if (seenPorts.has(portNode)) {
            continue;
          }
          seenPorts.add(portNode);
          const [portDirections] = portNode.portDirectionsFor(node);
          portDirectionSetAny(portDirections, (portDirection) => {
            guard.step();
            const topPoint = new Point(portNode.Point.X, tl.Y - (OVG_PADDING * (i + 1)));
            const bottomPoint = new Point(portNode.Point.X, br.Y + (OVG_PADDING * (i + 1)));
            const leftPoint = new Point(tl.X - (OVG_PADDING * (i + 1)), portNode.Point.Y);
            const rightPoint = new Point(br.X + (OVG_PADDING * (i + 1)), portNode.Point.Y);

            for (const boundaryPoint of [topPoint, bottomPoint, leftPoint, rightPoint]) {
              guard.step();
              let passesThroughARectangle = false;
              for (const rectangle of this.NodesInsideBoundingBox ?? []) {
                guard.step();
                const passesThrough = guard.passesThroughAllowingPorts(rectangle, portNode.Point, boundaryPoint, portDirection, this.Ports.get(rectangle));
                if (passesThrough) {
                  // containers of the port's node are an exception
                  let isRectangleNodeContainer = false;
                  if (rectangle.IsContainer()) {
                    if (guard.isDescendantOf(node, rectangle)) {
                      isRectangleNodeContainer = true;
                    }
                  }
                  if (!isRectangleNodeContainer) {
                    passesThroughARectangle = true;
                    break;
                  }
                }
              }
              if (passesThroughARectangle) {
                continue;
              }
              if (!guard.pointNearGraphNode(g, boundaryPoint)) {
                guard.addPoint(this, boundaryPoint);
                added = true;
              }
            }
            return false;
          });
        }
        if (!added) {
          this.createPortsConnectionsToBoundaries(node, ports, tl, br, guard);
        }
      }
    }
  }

  addCornerNodes(g, tl, br, guard) {
    guard.check();
    for (let i = 0.0; i < EXTRA_INTERESTING_POINT_LAYERS; i++) {
      guard.step();
      const points = [
        new Point(tl.X - (OVG_PADDING * (i + 1)), tl.Y - (OVG_PADDING * (i + 1))),
        new Point(br.X + (OVG_PADDING * (i + 1)), tl.Y - (OVG_PADDING * (i + 1))),
        new Point(br.X + (OVG_PADDING * (i + 1)), br.Y + (OVG_PADDING * (i + 1))),
        new Point(tl.X - (OVG_PADDING * (i + 1)), br.Y + (OVG_PADDING * (i + 1))),
      ];

      for (const point of points) {
        if (!guard.pointNearGraphNode(g, point)) {
          guard.addPoint(this, point);
        }
      }
    }
    guard.check();
  }

  addTunnels(g, guard) {
    guard.check();
    const tunnels = buildTunnels(g, guard);
    for (const tunnel of tunnels) {
      guard.step();
      for (const entry of [tunnel.EntryA, tunnel.EntryB]) {
        guard.step();
        const candidate = entry.OVGNode;
        const canonical = guard.addNode(this, candidate);
        if (canonical !== candidate) {
          for (const [owner, metadata] of candidate.portOwners()) {
            guard.step();
            canonical.addPortMetadata(owner, metadata);
          }
          entry.OVGNode = canonical;
        }
        entry.OVGNode.IsTunnel = true;
        mapAppend(this.Ports, entry.Node, entry.OVGNode);
      }

      guard.connect(this, tunnel.EntryA.OVGNode, tunnel.EntryB.OVGNode);
    }
    guard.check();
  }

  connectPortsToCenter(guard) {
    guard.check();
    for (const node of this.NodesInsideBoundingBox ?? []) {
      guard.step();
      const centerNode = guard.newCandidateNode(node.Center());
      this.Centers.set(node, centerNode);
      // an invisible node's center is not special
      if (!node.IsInvisible) {
        centerNode.IsNodeCenter = true;
      }
      guard.addNodeUnchecked(this, centerNode);
      for (const portNode of this.Ports.get(node) ?? []) {
        guard.connect(this, centerNode, portNode);
      }
    }
    guard.check();
  }

  mapNodesToContainer(g, guard) {
    guard.check();
    const dfsContainerOrder = guard.containerRDFSOrder(g, null);
    for (const ovgNode of this.Nodes) {
      guard.step();
      for (const container of dfsContainerOrder) {
        guard.step();
        if (nodeContainsPointOnBox(container, ovgNode.Point)) {
          ovgNode.Container = container;
          break;
        }
      }
    }
  }

  /**
   * connectNodes links every OVG node to its nearest neighbor on each axis
   * when the segment crosses no graph node (sweep line per row and column).
   */
  connectNodes(g, guard) {
    guard.check();
    if (this.Edges.length > guard.edges) {
      guard.reserveEdges(subUint64(this.Edges.length, guard.edges));
    }
    const horizontal = new GoFloatMap();
    const vertical = new GoFloatMap();
    let eligibleNodeCount = 0;
    for (const node of this.Nodes) {
      guard.step();
      // Tunnels only connect to each other (and to their node centers)
      if (node.IsTunnel) {
        continue;
      }
      // sequence steps only connect from certain sides
      if (guard.isRestrictedSequencePort(node)) {
        continue;
      }

      eligibleNodeCount++;
      floatMapAppend(horizontal, node.Y, node);
      floatMapAppend(vertical, node.X, node);
    }

    const sortLines = (lines) => {
      const coords = [];
      for (const coord of lines.keys()) {
        guard.step();
        coords.push(coord);
      }
      guard.reserveSortWork(coords.length);
      goSortFloat64s(coords);
      return coords;
    };

    // The two sweeps add at most (n-h) + (n-v) edges.
    checkedOVGEdgeCapacity(this.Edges.length, eligibleNodeCount, horizontal.size, vertical.size, guard.limits.edges, maxIntAsUint64());
    // Go copies the existing edges (e.g. tunnels) into a fresh slice.
    this.Edges = this.Edges.slice();
    const fixedOverlaps = this.fixedOverlapsForBuild(g, this.NodesInsideBoundingBox, guard);
    const horizontalLines = sortLines(horizontal);
    for (const y of horizontalLines) {
      guard.step();
      this.connectNodesOnSameLine(horizontal.get(y) ?? [], y, true, fixedOverlaps, guard);
    }

    const verticalLines = sortLines(vertical);
    for (const x of verticalLines) {
      guard.step();
      this.connectNodesOnSameLine(vertical.get(x) ?? [], x, false, fixedOverlaps, guard);
    }
  }

  /** Connects consecutive nodes of one line (sorted in place). */
  connectNodesOnSameLine(nodes, linePosition, isHorizontal, fixedOverlaps, guard) {
    guard.check();

    const intersectCandidates = [];
    for (const node of this.NodesInsideBoundingBox ?? []) {
      guard.step();
      if (fixedOverlaps != null && fixedOverlaps.has(node)) {
        continue;
      }
      if (isHorizontal && node.TopLeft.Y <= linePosition && node.TopLeft.Y + node.Height >= linePosition) {
        intersectCandidates.push(node);
      } else if (!isHorizontal && node.TopLeft.X <= linePosition && node.TopLeft.X + node.Width >= linePosition) {
        intersectCandidates.push(node);
      }
    }
    guard.reserveSortWork(intersectCandidates.length);
    goSortSlice(intersectCandidates, (a, b) => {
      if (isHorizontal) {
        return a.TopLeft.X < b.TopLeft.X;
      }
      return a.TopLeft.Y < b.TopLeft.Y;
    });

    guard.reserveSortWork(nodes.length);
    goSortSlice(nodes, (a, b) => {
      if (isHorizontal) {
        return a.X < b.X;
      }
      return a.Y < b.Y;
    });

    let startIntersectionSearchAt = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      guard.step();
      const node = nodes[i];
      const closest = nodes[i + 1];
      if (this.isMisdirectedPortPair(node, closest, isHorizontal, guard)) {
        continue;
      }

      let shouldConnect = true;
      for (let j = startIntersectionSearchAt; j < intersectCandidates.length; j++) {
        guard.step();
        const rectangle = intersectCandidates[j];
        if ((isHorizontal && rectangle.TopLeft.X > closest.X) || (!isHorizontal && rectangle.TopLeft.Y > closest.Y)) {
          // sorted: no later rectangle can intersect
          break;
        }

        const passesThrough = (from, to) => {
          let passes = true;
          portDirectionSetAny(from.portDirectionsForObstacle(rectangle), (direction) => {
            if (!guard.passesThroughAllowingPorts(rectangle, from.Point, to.Point, direction, this.Ports.get(rectangle))) {
              passes = false;
              return true;
            }
            return false;
          });
          return passes;
        };
        const c1 = passesThrough(node, closest);
        const c2 = passesThrough(closest, node);
        if (c1 && c2) {
          if (rectangle.Sequence != null) {
            // sequence top/bottom ports overlapped by previous steps stay usable
            if (!isHorizontal) {
              if (rectangle.TopLeft.Y === closest.Y || rectangle.TopLeft.Y + rectangle.Height === node.Y) {
                continue;
              }
            }
          }
          // Passing through a container is fine when an endpoint is inside it
          let isContainerException = false;
          if (rectangle.IsContainer()) {
            if (nodeContainsPointOnBox(rectangle, node.Point) || nodeContainsPointOnBox(rectangle, closest.Point)) {
              isContainerException = true;
            }
          }

          if (!isContainerException) {
            shouldConnect = false;
            break;
          }
        } else {
          // this rectangle cannot affect later (sorted) OVG nodes' predecessors
          startIntersectionSearchAt = j;
        }
      }

      if (shouldConnect) {
        guard.connect(this, node, closest);
      }
    }
  }

  /** Assumes `first` is left of (horizontal) or above (vertical) `second`. */
  isMisdirectedPortPair(first, second, isHorizontal, guard) {
    guard.check();
    const firstOwners = first.portOwners();
    const secondOwners = second.portOwners();
    if (firstOwners.size === 0 || secondOwners.size === 0) {
      guard.check();
      return false;
    }

    // Reject only if every owner pair is misdirected.
    for (const [firstOwner, firstMetadata] of firstOwners) {
      guard.step();
      for (const [secondOwner, secondMetadata] of secondOwners) {
        guard.step();
        if (firstOwner === secondOwner) {
          return false;
        }

        let correctDirections = portDirectionSetHas(firstMetadata.directions, Orientation.Bottom) &&
          portDirectionSetHas(secondMetadata.directions, Orientation.Top);
        if (isHorizontal) {
          correctDirections = portDirectionSetHas(firstMetadata.directions, Orientation.Right) &&
            portDirectionSetHas(secondMetadata.directions, Orientation.Left);
        }
        // ports must face each other unless descendant and ancestor
        const firstBelowSecond = guard.isDescendantOf(firstOwner, secondOwner);
        const secondBelowFirst = guard.isDescendantOf(secondOwner, firstOwner);
        if (correctDirections || firstBelowSecond || secondBelowFirst) {
          return false;
        }
      }
    }
    guard.check();
    return true;
  }

  /**
   * createPortsConnectionsToBoundaries pads the ports of an isolated node and
   * adds boundary nodes they may connect to.
   */
  createPortsConnectionsToBoundaries(owner, ports, tl, br, guard) {
    guard.check();
    const seenPorts = new Set();
    for (const port of ports) {
      guard.step();
      if (seenPorts.has(port)) {
        continue;
      }
      seenPorts.add(port);
      const [portDirections] = port.portDirectionsFor(owner);
      portDirectionSetAny(portDirections, (portDirection) => {
        guard.step();
        let newPoint;
        switch (portDirection) {
          case Orientation.Top:
            newPoint = new Point(port.X, port.Y - MIN_PORT_CLEARANCE);
            break;
          case Orientation.Bottom:
            newPoint = new Point(port.X, port.Y + MIN_PORT_CLEARANCE);
            break;
          case Orientation.Left:
            newPoint = new Point(port.X - MIN_PORT_CLEARANCE, port.Y);
            break;
          case Orientation.Right:
            newPoint = new Point(port.X + MIN_PORT_CLEARANCE, port.Y);
            break;
          default:
            return false;
        }
        const newNode = guard.addPoint(this, newPoint);

        // boundary nodes that connect with the padded port
        for (let i = 1; i < EXTRA_INTERESTING_POINT_LAYERS + 1; i++) {
          guard.step();
          switch (portDirection) {
            case Orientation.Top:
            case Orientation.Bottom:
              guard.addPoint(this, new Point(tl.X - (OVG_PADDING * i), newNode.Y));
              guard.addPoint(this, new Point(br.X + (OVG_PADDING * i), newNode.Y));
              break;
            case Orientation.Left:
            case Orientation.Right:
              guard.addPoint(this, new Point(newNode.X, tl.Y - (OVG_PADDING * i)));
              guard.addPoint(this, new Point(newNode.X, br.Y + (OVG_PADDING * i)));
              break;
            default:
              break;
          }
        }
        return false;
      });
    }
    guard.check();
  }

  /**
   * flagNodesNearPorts flags OVG nodes aligned with and too close to a port,
   * following aligned adjacents breadth-first.
   */
  flagNodesNearPorts(guard) {
    guard.check();
    for (const [owner, ports] of this.Ports) {
      guard.step();
      for (const port of ports) {
        guard.step();
        const seen = new Set([port]);
        const queue = [];
        for (const e of port.Edges) {
          guard.step();
          const adj = port.adjacent(e);
          if (adj.X !== port.X && adj.Y !== port.Y) {
            continue;
          }
          queue.push(adj);
        }
        for (let head = 0; head < queue.length;) {
          guard.step();
          const curr = queue[head++];
          if (seen.has(curr)) {
            continue;
          }
          seen.add(curr);

          // only flag non-ports or other nodes' ports; follow own ports too
          if (!curr.isPortOf(owner)) {
            if (Math.abs(curr.Y - port.Y) >= NODE_PROXIMITY_THRESHOLD) {
              continue;
            }
            if (Math.abs(curr.X - port.X) >= NODE_PROXIMITY_THRESHOLD) {
              continue;
            }
            if (curr.IsNearPort == null) {
              curr.IsNearPort = new Set();
            }
            curr.IsNearPort.add(owner);
          }

          for (const e of curr.Edges) {
            guard.step();
            const adj = curr.adjacent(e);
            if (adj.X !== port.X && adj.Y !== port.Y) {
              continue;
            }
            queue.push(adj);
          }
        }
      }
    }
    guard.check();
  }

  /**
   * MarshalJSON → JSON text: nodes sorted by (X, Y), edges by From then To
   * (Go sort.Slice), nil slices as null. Throws for NaN/±Inf coordinates.
   */
  MarshalJSON() {
    const nodeOrder = (n1, n2) => {
      if (n1.X === n2.X) {
        return n1.Y < n2.Y;
      }
      return n1.X < n2.X;
    };

    const sortedNodes = this.Nodes.slice();
    goSortSlice(sortedNodes, nodeOrder);
    const nodes = sortedNodes.map((node) => `{"x":${goJSONFloat(node.X)},"y":${goJSONFloat(node.Y)}}`);

    const sortedEdges = this.Edges.slice();
    goSortSlice(sortedEdges, (a, b) => {
      if (a.From === b.From) {
        return nodeOrder(a.To, b.To);
      }
      return nodeOrder(a.From, b.From);
    });
    const edges = sortedEdges.map((edge) =>
      `{"from":{"x":${goJSONFloat(edge.From.X)},"y":${goJSONFloat(edge.From.Y)}},` +
      `"to":{"x":${goJSONFloat(edge.To.X)},"y":${goJSONFloat(edge.To.Y)}}}`);

    const nodesJSON = nodes.length === 0 ? 'null' : `[${nodes.join(',')}]`;
    const edgesJSON = edges.length === 0 ? 'null' : `[${edges.join(',')}]`;
    return `{"nodes":${nodesJSON},"edges":${edgesJSON}}`;
  }

  toJSON() {
    return JSON.parse(this.MarshalJSON());
  }

  /**
   * UnmarshalJSON(text) replaces this OVG with the serialized nodes/edges.
   * Field names match case-insensitively like encoding/json. Syntax and type
   * errors throw, but their messages are not byte-identical to Go's.
   */
  UnmarshalJSON(content) {
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    const serialized = decodeSerializedOVG(JSON.parse(text));

    Object.assign(this, new OVG(null));
    const positionToNode = new GoPointMap();
    for (const node of serialized.nodes) {
      const n = NewOVGNode(new Point(node.x, node.y));
      this.AddNodeUnchecked(n);
      positionToNode.set(n.Point, n);
    }

    for (const edge of serialized.edges) {
      const from = new Point(edge.from.x, edge.from.y);
      const to = new Point(edge.to.x, edge.to.y);

      const fromNode = positionToNode.get(from);
      const toNode = positionToNode.get(to);
      if (fromNode == null || toNode == null) {
        throw new Error(`OVG edge references a missing endpoint: ${goFormatPointValue(from)} -> ${goFormatPointValue(to)}`);
      }
      this.Connect(fromNode, toNode);
    }
  }

  mergePorts(other, guard) {
    guard.check();
    for (const [n, ports] of other.Ports) {
      guard.reserveWork(ports.length + 1);
      const canonicalPorts = new Array(ports.length);
      for (let i = 0; i < ports.length; i++) {
        const port = ports[i];
        const canonical = guard.addNode(this, port);
        if (canonical !== port) {
          for (const [owner, metadata] of port.portOwners()) {
            guard.step();
            canonical.addPortMetadata(owner, metadata);
          }
        }
        canonicalPorts[i] = canonical;
      }
      this.Ports.set(n, canonicalPorts);
    }
    const otherNodes = other.NodesInsideBoundingBox ?? [];
    guard.reserveWork(otherNodes.length);
    this.NodesInsideBoundingBox = (this.NodesInsideBoundingBox ?? []).concat(otherNodes);
    guard.check();
  }

  mergeNonPorts(other, guard) {
    guard.check();
    for (const n of other.Nodes) {
      guard.step();
      if (!n.isPort()) {
        guard.addNode(this, n);
      }
    }
    guard.check();
  }
}

// ─── JSON decoding helpers ───────────────────────────────────────────────────

function jsonField(object, name) {
  // encoding/json: exact or ASCII case-insensitive key match; later keys win.
  let value;
  for (const key of Object.keys(object)) {
    if (key === name || key.toLowerCase() === name) {
      value = object[key];
    }
  }
  return value;
}

function jsonTypeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function decodeFloat(value, field) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number') {
    throw new Error(`json: cannot unmarshal ${jsonTypeName(value)} into Go struct field ${field} of type float64`);
  }
  return value;
}

function decodePoint(value, field) {
  if (value === undefined || value === null) return { x: 0, y: 0 };
  if (jsonTypeName(value) !== 'object') {
    throw new Error(`json: cannot unmarshal ${jsonTypeName(value)} into Go struct field ${field} of type routing.serializedOVGNode`);
  }
  return {
    x: decodeFloat(jsonField(value, 'x'), `${field}.x`),
    y: decodeFloat(jsonField(value, 'y'), `${field}.y`),
  };
}

function decodeArray(value, field, decodeItem) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`json: cannot unmarshal ${jsonTypeName(value)} into Go struct field serializedOVG.${field}`);
  }
  return value.map(decodeItem);
}

function decodeSerializedOVG(value) {
  if (value === null) return { nodes: [], edges: [] };
  if (jsonTypeName(value) !== 'object') {
    throw new Error(`json: cannot unmarshal ${jsonTypeName(value)} into Go value of type routing.serializedOVG`);
  }
  return {
    nodes: decodeArray(jsonField(value, 'nodes'), 'nodes', (node) => decodePoint(node, 'serializedOVG.nodes')),
    edges: decodeArray(jsonField(value, 'edges'), 'edges', (edge) => {
      if (edge === null) return { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
      if (jsonTypeName(edge) !== 'object') {
        throw new Error(`json: cannot unmarshal ${jsonTypeName(edge)} into Go struct field serializedOVG.edges of type routing.serializedOVGEdge`);
      }
      return {
        from: decodePoint(jsonField(edge, 'from'), 'serializedOVG.edges.from'),
        to: decodePoint(jsonField(edge, 'to'), 'serializedOVG.edges.to'),
      };
    }),
  };
}

// ─── constructors and builders ───────────────────────────────────────────────

export function NewOVG(nodesInsideBoundingBox = null) {
  return new OVG(nodesInsideBoundingBox);
}

export function newBuildOVG(nodesInsideBoundingBox, guard) {
  const ovg = NewOVG(nodesInsideBoundingBox);
  ovg.buildGuard = guard;
  return ovg;
}

/** buildOVGFromGraphWithLimits(ctx, g, nearbyNodes, limits) → OVG; throws. */
export function buildOVGFromGraphWithLimits(ctx, g, nearbyNodes, limits) {
  const guard = newOVGBuildGuard(ctx, limits);
  return buildOVGFromGraphWithGuard(g, nearbyNodes, guard);
}

/** buildOVGFromGraphWithGuard(g, nearbyNodes, guard) → OVG; throws. */
export function buildOVGFromGraphWithGuard(g, nearbyNodes, guard) {
  guard.check();
  const nearby = nearbyNodes ?? [];
  checkedOVGSliceCapacity(g.Nodes.length, nearby.length);
  const orthogonalNodes = nearby.slice();

  const hierarchyOVGs = [];
  const seenHierarchies = new Set();
  for (const n of g.Nodes) {
    guard.step();
    if (n.Hierarchy == null) {
      orthogonalNodes.push(n);
    } else if (!seenHierarchies.has(n.Hierarchy)) {
      seenHierarchies.add(n.Hierarchy);
      hierarchyOVGs.push(newOVGForHierarchy(g, n.Hierarchy, guard));
    }
  }

  const ovg = newBuildOVG(orthogonalNodes, guard);
  ovg.addPorts(g, guard);
  for (const hOVG of hierarchyOVGs) {
    guard.step();
    ovg.mergePorts(hOVG, guard);
  }
  ovg.addNodesIntersections(g, guard);
  for (const hOVG of hierarchyOVGs) {
    guard.step();
    ovg.mergeNonPorts(hOVG, guard);
  }

  ovg.addEdgesNodes(g, guard);
  ovg.addTreeNodes(g, guard);
  const [tl, br] = guard.tightBoundingBox(ovg.NodesInsideBoundingBox);
  ovg.addNewBoundaryLayers(g, tl, br, guard);
  ovg.addPortConnectionNodesAtBoundaries(g, tl, br, guard);
  ovg.addCornerNodes(g, tl, br, guard);
  ovg.addTunnels(g, guard);

  ovg.connectNodes(g, guard);
  ovg.connectPortsToCenter(guard);
  ovg.removeIsolatedNodes(guard);
  ovg.mapNodesToContainer(g, guard);
  ovg.flagNodesNearPorts(guard);
  for (let i = 0; i < ovg.Nodes.length; i++) {
    guard.step();
    ovg.Nodes[i].Index = i;
  }

  return ovg;
}
