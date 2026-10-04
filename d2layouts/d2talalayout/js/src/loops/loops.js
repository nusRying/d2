import { Point } from '../geometry/point.js';
import { euclideanDistance, goRound } from '../geometry/math.js';
import { Orientation, isVertical } from '../geometry/orientation.js';
import { LabelPosition } from '../graph/label-position.js';
import { nodePorts, nodePortIndices } from '../shape/ports.js';
import { nonNilEquals } from './geometry.js';
import { goSortStableFunc } from './stable-sort.js';

// Pinned Go: internal/loops/loops.go. Computes deterministic self-edge routes
// and the node extents those routes reserve during placement.

export const SHARED_PORT_LOOP_GAP = 30.0;

/** computeOffsets refreshes loop extents for every graph node. */
export function computeOffsets(g) {
  for (const node of g.Nodes) {
    updateOffsets(node);
  }
}

/** updateOffsets refreshes the space reserved around node for self-edge routes. */
export function updateOffsets(node) {
  // The node position is required to get the ports, which are required for routing.
  const tlIsNil = node.TopLeft == null;
  if (tlIsNil) {
    node.TopLeft = new Point(0, 0);
  }
  computeNodeOffsets(node);
  if (tlIsNil) {
    node.TopLeft = null;
  }
}

function computeNodeOffsets(node) {
  node.LoopOffsets = new Map();

  const [tl, br] = node.bounds(null);
  const [loopTL, loopBR] = node.bounds(null);
  for (const edge of routeLoops(node)) {
    if (!(edge != null && edge.isLoop())) {
      continue;
    }
    const [eTL, eBR] = edge.boundingBoxValues();
    loopTL.X = Math.min(loopTL.X, eTL.X);
    loopTL.Y = Math.min(loopTL.Y, eTL.Y);
    loopBR.X = Math.max(loopBR.X, eBR.X);
    loopBR.Y = Math.max(loopBR.Y, eBR.Y);
    // Reset: points computed at a provisional origin must not survive while
    // nodes move during placement. Go sets edge.Points = nil; the JS Edge
    // models a nil route as an empty array (same length/iteration semantics).
    edge.Points = [];
  }

  if (nonNilEquals(tl, loopTL) && nonNilEquals(br, loopBR)) {
    return;
  }

  const offsets = node.LoopOffsets;
  offsets.set(Orientation.Left, goRound(Math.abs(tl.X - loopTL.X)));
  offsets.set(Orientation.Right, goRound(Math.abs(br.X - loopBR.X)));
  offsets.set(Orientation.Top, goRound(Math.abs(tl.Y - loopTL.Y)));
  offsets.set(Orientation.Bottom, goRound(Math.abs(br.Y - loopBR.Y)));

  offsets.set(Orientation.TopLeft, Math.max(offsets.get(Orientation.Top), offsets.get(Orientation.Left)));
  offsets.set(Orientation.TopRight, Math.max(offsets.get(Orientation.Top), offsets.get(Orientation.Right)));
  offsets.set(Orientation.BottomLeft, Math.max(offsets.get(Orientation.Bottom), offsets.get(Orientation.Left)));
  offsets.set(Orientation.BottomRight, Math.max(offsets.get(Orientation.Bottom), offsets.get(Orientation.Right)));
}

// loopPorts is the routing context for one port pair.
function newLoopPorts(from, to, fromDirection, toDirection) {
  return {
    verticalOffset: 0.0,
    horizontalOffset: 0.0,
    hasSourceArrowhead: null,
    hasTargetArrowhead: null,
    sourceArrowhead: "",
    targetArrowhead: "",
    from,
    fromDirection,
    to,
    toDirection,
  };
}

/** route computes every self-edge route for node (Go loops.Route). */
export function route(n) {
  return routeLoops(n);
}

// routeLoops routes loops rule-based and sets the edge label position. There
// are 4 possible positions for loops, one at each corner.
function routeLoops(n) {
  const availablePorts = makeLoopPorts(n);

  let routedEdges = null; // Go nil slice when no loop is routed
  for (const e of edgesInOrder(n.Edges)) {
    if (!(e != null && e.isLoop())) {
      continue;
    }
    if (routedEdges === null) routedEdges = [];
    routedEdges.push(e);
    const portsPair = findLoopPortsForEdge(e, availablePorts);
    e.Points = routeLoop(portsPair);
    if (e.Label != null) {
      e.Label.Position = LabelPosition.OutsideTopCenter;
    }
    [portsPair.verticalOffset, portsPair.horizontalOffset] = computeEdgeOffset(e);
    portsPair.hasSourceArrowhead = e.hasSourceArrow();
    portsPair.hasTargetArrowhead = e.hasTargetArrow();
    portsPair.sourceArrowhead = e.SourceArrowhead;
    portsPair.targetArrowhead = e.TargetArrowhead;
  }
  return routedEdges ?? [];
}

function arrowheadScore(e) {
  // ->
  if (e.hasSourceArrow() !== e.hasTargetArrow()) {
    return 0;
  } else if (e.hasSourceArrow()) {
    return 1;
  }
  return 2;
}

function compareEdges(a, b) {
  // 1st ->, 2nd <->, 3rd --
  if (a.hasSourceArrow() !== b.hasSourceArrow() || a.hasTargetArrow() !== b.hasTargetArrow()) {
    const aScore = arrowheadScore(a);
    const bScore = arrowheadScore(b);
    if (aScore < bScore) return -1;
    if (bScore < aScore) return 1;
    return 0;
  }
  // If arrowheads are equal, sort by label area.
  let aArea = 0.0;
  let bArea = 0.0;
  if (a.Label != null) {
    aArea = a.Label.Width * a.Label.Height;
  }
  if (b.Label != null) {
    bArea = b.Label.Width * b.Label.Height;
  }
  if (aArea < bArea) return -1;
  if (bArea < aArea) return 1;
  return 0;
}

/**
 * edgesInOrder returns a stably sorted copy of edges: arrowhead category
 * first, then label area. Uses Go's exact SortStableFunc algorithm because the
 * comparator is not a strict weak order.
 */
export function edgesInOrder(edges) {
  const sortedEdges = edges.slice();
  goSortStableFunc(sortedEdges, compareEdges);
  return sortedEdges;
}

// findLoopPortsForEdge finds the ports pair already using the same arrowheads.
function findLoopPortsForEdge(e, availablePorts) {
  // First find a matching set if it exists.
  for (const ports of availablePorts) {
    if (ports.hasSourceArrowhead !== null && ports.hasTargetArrowhead !== null) {
      if (ports.sourceArrowhead === e.SourceArrowhead && ports.targetArrowhead === e.TargetArrowhead) {
        return ports;
      }
    }
  }
  // Look for an open pair.
  for (const ports of availablePorts) {
    if (ports.hasSourceArrowhead === null && ports.hasTargetArrowhead === null) {
      return ports;
    }
  }
  // Find a pair that has arrows at the same ends.
  for (const ports of availablePorts) {
    if (ports.hasSourceArrowhead !== null && ports.hasTargetArrowhead !== null &&
      ports.hasSourceArrowhead === e.hasSourceArrow() && ports.hasTargetArrowhead === e.hasTargetArrow()) {
      return ports;
    }
  }
  return null;
}

// makeLoopPorts makes the 4 possible port pairs, one at each corner, using the
// closest ports for each combination.
function makeLoopPorts(n) {
  const ports = nodePorts(n);
  const topIndices = nodePortIndices(n, Orientation.Top);
  const rightIndices = nodePortIndices(n, Orientation.Right);
  const bottomIndices = nodePortIndices(n, Orientation.Bottom);
  const leftIndices = nodePortIndices(n, Orientation.Left);

  const [trTop, trRight] = closestPorts(ports, topIndices, rightIndices);
  const [blBottom, blLeft] = closestPorts(ports, bottomIndices, leftIndices);
  const [ltLeft, ltTop] = closestPorts(ports, leftIndices, topIndices);
  const [brRight, brBottom] = closestPorts(ports, rightIndices, bottomIndices);

  return [
    newLoopPorts(ltLeft, ltTop, Orientation.Left, Orientation.Top),
    newLoopPorts(trTop, trRight, Orientation.Top, Orientation.Right),
    newLoopPorts(blBottom, blLeft, Orientation.Bottom, Orientation.Left),
    newLoopPorts(brRight, brBottom, Orientation.Right, Orientation.Bottom),
  ];
}

function closestPorts(ports, sideA, sideB) {
  let closestA = new Point(0, 0);
  let closestB = new Point(0, 0);
  let minDistance = Infinity;

  for (const indexA of sideA) {
    for (const indexB of sideB) {
      const pa = ports[indexA];
      const pb = ports[indexB];
      if (pa === undefined || pb === undefined) {
        // Go panics: index out of range.
        throw new RangeError(`index out of range [${pa === undefined ? indexA : indexB}] with length ${ports.length}`);
      }
      const d = euclideanDistance(pa.X, pa.Y, pb.X, pb.Y);
      if (d < minDistance) {
        minDistance = d;
        closestA = new Point(pa.X, pa.Y);
        closestB = new Point(pb.X, pb.Y);
      }
    }
  }
  return [closestA, closestB];
}

// routeLoop creates the 5-point route: port, bend, intersection, bend, port.
function routeLoop(ports) {
  if (ports == null) {
    // Go dereferences a nil *loopPorts and panics.
    throw new TypeError("loops: no port pair available for self-edge (nil pointer dereference)");
  }
  const p1 = makeBendPoint(ports.from, ports.fromDirection, ports.verticalOffset, ports.horizontalOffset);
  const p2 = makeBendPoint(ports.to, ports.toDirection, ports.verticalOffset, ports.horizontalOffset);
  const intersection = makeIntersectionPoint(p1, p2, ports.fromDirection);
  return [ports.from, p1, intersection, p2, ports.to];
}

function makeBendPoint(port, direction, verticalOffset, horizontalOffset) {
  switch (direction) {
    case Orientation.Top:
      return new Point(port.X, port.Y - verticalOffset - SHARED_PORT_LOOP_GAP);
    case Orientation.Bottom:
      return new Point(port.X, port.Y + verticalOffset + SHARED_PORT_LOOP_GAP);
    case Orientation.Left:
      return new Point(port.X - horizontalOffset - SHARED_PORT_LOOP_GAP, port.Y);
    case Orientation.Right:
      return new Point(port.X + horizontalOffset + SHARED_PORT_LOOP_GAP, port.Y);
    default:
      return null;
  }
}

function makeIntersectionPoint(from, to, fromDirection) {
  if (!isVertical(fromDirection)) {
    return new Point(from.X, to.Y);
  }
  return new Point(to.X, from.Y);
}

// computeEdgeOffset computes the offset to place the next loop considering the
// current edge and its label.
function computeEdgeOffset(edge) {
  let verticalOffset;
  let horizontalOffset;
  const points = edge.Points;
  if (edge.Points[0].X === edge.Points[1].X) {
    verticalOffset = Math.abs(points[0].Y - points[1].Y);
    horizontalOffset = Math.abs(points[points.length - 1].X - points[points.length - 2].X);
  } else {
    verticalOffset = Math.abs(points[points.length - 1].Y - points[points.length - 2].Y);
    horizontalOffset = Math.abs(points[0].X - points[1].X);
  }
  if (edge.Label != null) {
    verticalOffset += edge.Label.Height;
    horizontalOffset += edge.Label.Width;
  }
  return [verticalOffset, horizontalOffset];
}

export const ComputeOffsets = computeOffsets;
export const UpdateOffsets = updateOffsets;
export const Route = routeLoops;
export { routeLoops };
