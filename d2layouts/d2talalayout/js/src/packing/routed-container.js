// Slice 46 — routed-container compaction proof.
// Pinned reference: d2layouts/d2talalayout/internal/packing/routed_container.go
//
// Routes are only inspected here, never cleared or rewritten: a proposed box
// is accepted only when every affected route provably keeps its geometry.

import { canContain } from '../graph/structural-access.js';
import { binPackIsDescendantOf } from './guard.js';
import { goHypot, goParseFloat64 } from './go-support.js';

export const RoutedContainerBoxDecision = Object.freeze({
  DeferToSideConstraints: 0,
  KeepOriginalBox: 1,
  UseProposedBox: 2,
});

const ROUTED_CONTAINER_TOP = 1 << 0;
const ROUTED_CONTAINER_LEFT = 1 << 1;
const ROUTED_CONTAINER_BOTTOM = 1 << 2;
const ROUTED_CONTAINER_RIGHT = 1 << 3;

// D2 renders an edge with this corner radius when no explicit edge style
// overrides it (d2target.BaseConnection().BorderRadius).
export const ROUTED_CONTAINER_DEFAULT_EDGE_BORDER_RADIUS = 10.0;
export const ROUTED_CONTAINER_MAX_BORDER_RADIUS_TEXT_BYTES = 64;

// nodeshape: Square ("" kind), RealSquare, Image, Text, Class, Table and Code
// wrap a d2 lib/shape square/real-square/image whose IsRectangular is true.
const RECTANGULAR_SHAPES = new Set(['', 'Square', 'RealSquare', 'Image', 'Text', 'Class', 'Table', 'Code']);

function shapeIsRectangular(node) {
  return RECTANGULAR_SHAPES.has(node.shapeType());
}

// Go len(string) counts UTF-8 bytes.
function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

const { DeferToSideConstraints, KeepOriginalBox, UseProposedBox } = RoutedContainerBoxDecision;

/**
 * binPackCanUseRoutedContainerBox reports whether the box currently proposed
 * on root preserves every affected routed segment and supported root route
 * attachment from original.
 */
export function binPackCanUseRoutedContainerBox(graph, root, original, graphIncidentEdges, guard) {
  guard.Step();
  if (graph == null || root == null || root.Graph !== graph) {
    return KeepOriginalBox;
  }
  const incident = graphIncidentEdges ?? [];
  if (incident.length === 0) {
    guard.Finish();
    return DeferToSideConstraints;
  }
  // root.Shape is never nil for a JS Node (NewNode always sets a shape).
  if (root.TopLeft == null || original == null || original.TopLeft == null) {
    return KeepOriginalBox;
  }

  const descendants = graph.allDescendantNodesGuarded(root, true, guard);
  const descendantSet = new Set();
  for (const node of descendants) {
    guard.Step();
    if (node == null) {
      return KeepOriginalBox;
    }
    descendantSet.add(node);
  }

  const affectedEdges = [];
  const affectedEdgeSet = new Set();
  for (const edge of graph.Edges) {
    guard.Step();
    if (edge == null || edge.From == null || edge.To == null) {
      return KeepOriginalBox;
    }
    const fromDescendant = descendantSet.has(edge.From);
    const toDescendant = descendantSet.has(edge.To);
    if (edge.From !== root && edge.To !== root && !fromDescendant && !toDescendant) {
      continue;
    }
    if (affectedEdgeSet.has(edge)) {
      return KeepOriginalBox;
    }
    affectedEdgeSet.add(edge);
    affectedEdges.push(edge);
  }
  const graphEdges = new Set();
  for (const edge of incident) {
    guard.Step();
    if (edge == null || (edge.From !== root && edge.To !== root)) {
      return KeepOriginalBox;
    }
    if (graphEdges.has(edge)) {
      return KeepOriginalBox;
    }
    if (!affectedEdgeSet.has(edge)) {
      return KeepOriginalBox;
    }
    graphEdges.add(edge);
  }
  if (!root.isContainer || !canContain(root) || !shapeIsRectangular(root)) {
    return KeepOriginalBox;
  }
  const [dx, dy] = root.modifierElementAdjustments();
  if (dx !== 0 || dy !== 0) {
    return KeepOriginalBox;
  }
  if (!routedContainerBoxIsFinite(root.Box) || !routedContainerBoxIsFinite(original)) {
    return KeepOriginalBox;
  }
  if (!routedContainerBoxCovers(original, root.Box)) {
    return KeepOriginalBox;
  }
  if (root.FixedTopLeft != null &&
    (root.TopLeft.X !== original.TopLeft.X || root.TopLeft.Y !== original.TopLeft.Y)) {
    return KeepOriginalBox;
  }

  let checkedEndpoint = false;
  const rootEdges = new Set();
  for (const edge of root.Edges) {
    guard.Step();
    const points = edge?.Points ?? [];
    if (edge == null || edge.From == null || edge.To == null || edge.From === edge.To || points.length < 2) {
      return KeepOriginalBox;
    }
    if (!graphEdges.has(edge)) {
      return KeepOriginalBox;
    }
    if (rootEdges.has(edge)) {
      return KeepOriginalBox;
    }
    rootEdges.add(edge);
    let isIncident = false;
    if (edge.From === root) {
      isIncident = true;
      checkedEndpoint = true;
      guard.Step();
      if (!routedContainerEndpointKeepsSides(original, root.Box, points[0])) {
        return KeepOriginalBox;
      }
    }
    if (edge.To === root) {
      isIncident = true;
      checkedEndpoint = true;
      guard.Step();
      if (!routedContainerEndpointKeepsSides(original, root.Box, points[points.length - 1])) {
        return KeepOriginalBox;
      }
    }
    if (!isIncident) {
      return KeepOriginalBox;
    }
    let adjacent = edge.From;
    if (adjacent === root) {
      adjacent = edge.To;
    }
    if (binPackIsDescendantOf(adjacent, root, guard)) {
      // A route to a descendant may leave and re-enter the proposed
      // box even while its root endpoint remains attached.
      return KeepOriginalBox;
    }
  }
  if (rootEdges.size !== graphEdges.size || !checkedEndpoint) {
    return KeepOriginalBox;
  }
  const routesPreserved = routedContainerRoutesStayInsideShrink(affectedEdges, original, root.Box, guard);
  guard.Finish();
  if (routesPreserved) {
    return UseProposedBox;
  }
  return KeepOriginalBox;
}

/** routedContainerRoutesStayInsideShrink */
export function routedContainerRoutesStayInsideShrink(edges, original, proposed, guard) {
  for (const edge of edges) {
    guard.Step();
    const points = edge?.Points ?? [];
    if (edge == null || edge.From == null || edge.To == null || points.length < 2 || edge.IsCurve === true) {
      return false;
    }
    for (const point of points) {
      guard.Step();
      if (!routedContainerPointIsFinite(point)) {
        return false;
      }
    }
    if (!routedContainerRoundedCornersStayInsideShrink(edge, original, proposed, guard)) {
      return false;
    }
    for (let index = 0; index < points.length - 1; index++) {
      guard.Step();
      if (!routedContainerSegmentStaysInsideShrink(original, proposed, points[index], points[index + 1], guard)) {
        return false;
      }
    }
  }
  guard.Finish();
  return true;
}

/** routedContainerRoundedCornersStayInsideShrink */
export function routedContainerRoundedCornersStayInsideShrink(edge, original, proposed, guard) {
  let radius = ROUTED_CONTAINER_DEFAULT_EDGE_BORDER_RADIUS;
  const borderRadius = edge.Style?.BorderRadius ?? null;
  if (borderRadius != null) {
    const text = borderRadius.Value ?? '';
    if (utf8ByteLength(text) > ROUTED_CONTAINER_MAX_BORDER_RADIUS_TEXT_BYTES) {
      return false;
    }
    const parsed = goParseFloat64(text);
    if (!parsed.ok) {
      return false;
    }
    radius = parsed.value;
  }
  if (!routedContainerCoordinateIsFinite(radius) || radius < 0) {
    return false;
  }

  const points = edge.Points;
  for (let index = 1; index < points.length - 1; index++) {
    guard.Step();
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incomingX = corner.X - previous.X;
    const incomingY = corner.Y - previous.Y;
    const outgoingX = next.X - corner.X;
    const outgoingY = next.Y - corner.Y;
    const incomingLength = goHypot(incomingX, incomingY);
    const outgoingLength = goHypot(outgoingX, outgoingY);
    if (!routedContainerCoordinateIsFinite(incomingLength) || incomingLength <= 0 ||
      !routedContainerCoordinateIsFinite(outgoingLength) || outgoingLength <= 0) {
      return false;
    }
    if (radius === 0) {
      continue;
    }
    if (incomingLength < radius || outgoingLength / 2 < radius) {
      // Short corners use a different effective radius and may combine
      // controls across vertices. This proof only admits the normal branch.
      return false;
    }
    const entry = {
      X: corner.X - incomingX / incomingLength * radius,
      Y: corner.Y - incomingY / incomingLength * radius,
    };
    const exit = {
      X: corner.X + outgoingX / outgoingLength * radius,
      Y: corner.Y + outgoingY / outgoingLength * radius,
    };
    if (!routedContainerPointIsFinite(entry) || !routedContainerPointIsFinite(exit) ||
      !routedContainerControlHullIsPreserved(original, proposed, [entry, corner, exit])) {
      return false;
    }
  }
  return true;
}

// geo.Box.Contains
function boxContains(box, p) {
  return !(p.X < box.TopLeft.X || box.TopLeft.X + box.Width < p.X ||
    p.Y < box.TopLeft.Y || box.TopLeft.Y + box.Height < p.Y);
}

/** routedContainerControlHullIsPreserved */
export function routedContainerControlHullIsPreserved(original, proposed, points) {
  let allInsideProposed = true;
  let allLeft = true;
  let allTop = true;
  let allRight = true;
  let allBottom = true;
  const originalLeft = original.TopLeft.X;
  const originalTop = original.TopLeft.Y;
  const originalRight = originalLeft + original.Width;
  const originalBottom = originalTop + original.Height;
  for (const point of points) {
    if (!routedContainerPointIsFinite(point)) {
      return false;
    }
    allInsideProposed = allInsideProposed && boxContains(proposed, point);
    allLeft = allLeft && point.X < originalLeft;
    allTop = allTop && point.Y < originalTop;
    allRight = allRight && point.X > originalRight;
    allBottom = allBottom && point.Y > originalBottom;
  }
  return allInsideProposed || allLeft || allTop || allRight || allBottom;
}

/** routedContainerSegmentStaysInsideShrink (Liang-Barsky clipping). */
export function routedContainerSegmentStaysInsideShrink(original, proposed, start, end, guard) {
  if (!routedContainerBoxIsFinite(original) || !routedContainerBoxIsFinite(proposed) ||
    !routedContainerPointIsFinite(start) || !routedContainerPointIsFinite(end)) {
    return false;
  }
  if (start.X === end.X && start.Y === end.Y) {
    return false;
  }
  const originalInterval = routedContainerSegmentBoxInterval(original, start, end, guard);
  if (!originalInterval.valid) {
    return false;
  }
  if (!originalInterval.intersects) {
    return true;
  }
  const proposedInterval = routedContainerSegmentBoxInterval(proposed, start, end, guard);
  if (!proposedInterval.valid) {
    return false;
  }
  return proposedInterval.intersects && proposedInterval.enter <= originalInterval.enter &&
    proposedInterval.exit >= originalInterval.exit;
}

/** routedContainerSegmentBoxInterval */
export function routedContainerSegmentBoxInterval(box, start, end, guard) {
  const dx = end.X - start.X;
  const dy = end.Y - start.Y;
  if (!routedContainerCoordinateIsFinite(dx) || !routedContainerCoordinateIsFinite(dy)) {
    return { enter: 0, exit: 0, intersects: false, valid: false };
  }
  const left = box.TopLeft.X;
  const top = box.TopLeft.Y;
  const right = left + box.Width;
  const bottom = top + box.Height;
  const constraints = [
    [-dx, start.X - left],
    [dx, right - start.X],
    [-dy, start.Y - top],
    [dy, bottom - start.Y],
  ];
  let tEnter = 0;
  let tExit = 1;
  for (const [p, q] of constraints) {
    guard.Step();
    if (p === 0) {
      if (q < 0) {
        return { enter: 0, exit: 0, intersects: false, valid: true };
      }
      continue;
    }
    const ratio = q / p;
    if (!routedContainerCoordinateIsFinite(ratio)) {
      return { enter: 0, exit: 0, intersects: false, valid: false };
    }
    if (p < 0) {
      if (ratio > tExit) {
        return { enter: 0, exit: 0, intersects: false, valid: true };
      }
      if (ratio > tEnter) {
        tEnter = ratio;
      }
    } else {
      if (ratio < tEnter) {
        return { enter: 0, exit: 0, intersects: false, valid: true };
      }
      if (ratio < tExit) {
        tExit = ratio;
      }
    }
  }
  return { enter: tEnter, exit: tExit, intersects: true, valid: true };
}

/** routedContainerEndpointKeepsSides */
export function routedContainerEndpointKeepsSides(original, proposed, point) {
  const originalSides = routedContainerPointSides(original, point);
  if (originalSides === 0) {
    return false;
  }
  const originalLeft = original.TopLeft.X;
  const originalTop = original.TopLeft.Y;
  const originalRight = originalLeft + original.Width;
  const originalBottom = originalTop + original.Height;
  const proposedLeft = proposed.TopLeft.X;
  const proposedTop = proposed.TopLeft.Y;
  const proposedRight = proposedLeft + proposed.Width;
  const proposedBottom = proposedTop + proposed.Height;

  if ((originalSides & ROUTED_CONTAINER_TOP) !== 0 &&
    (proposedTop !== originalTop || proposedLeft !== originalLeft || proposedRight !== originalRight)) {
    return false;
  }
  if ((originalSides & ROUTED_CONTAINER_LEFT) !== 0 &&
    (proposedLeft !== originalLeft || proposedTop !== originalTop || proposedBottom !== originalBottom)) {
    return false;
  }
  if ((originalSides & ROUTED_CONTAINER_BOTTOM) !== 0 &&
    (proposedBottom !== originalBottom || proposedLeft !== originalLeft || proposedRight !== originalRight)) {
    return false;
  }
  if ((originalSides & ROUTED_CONTAINER_RIGHT) !== 0 &&
    (proposedRight !== originalRight || proposedTop !== originalTop || proposedBottom !== originalBottom)) {
    return false;
  }
  return true;
}

/** routedContainerPointSides */
export function routedContainerPointSides(box, point) {
  if (!routedContainerBoxIsFinite(box) || !routedContainerPointIsFinite(point)) {
    return 0;
  }
  const left = box.TopLeft.X;
  const top = box.TopLeft.Y;
  const right = left + box.Width;
  const bottom = top + box.Height;
  let sides = 0;
  if (point.Y === top && point.X >= left && point.X <= right) sides |= ROUTED_CONTAINER_TOP;
  if (point.X === left && point.Y >= top && point.Y <= bottom) sides |= ROUTED_CONTAINER_LEFT;
  if (point.Y === bottom && point.X >= left && point.X <= right) sides |= ROUTED_CONTAINER_BOTTOM;
  if (point.X === right && point.Y >= top && point.Y <= bottom) sides |= ROUTED_CONTAINER_RIGHT;
  return sides;
}

export function routedContainerPointIsFinite(point) {
  return point != null && routedContainerCoordinateIsFinite(point.X) && routedContainerCoordinateIsFinite(point.Y);
}

export function routedContainerBoxCovers(outer, inner) {
  const outerRight = outer.TopLeft.X + outer.Width;
  const outerBottom = outer.TopLeft.Y + outer.Height;
  const innerRight = inner.TopLeft.X + inner.Width;
  const innerBottom = inner.TopLeft.Y + inner.Height;
  return inner.TopLeft.X >= outer.TopLeft.X && inner.TopLeft.Y >= outer.TopLeft.Y &&
    innerRight <= outerRight && innerBottom <= outerBottom;
}

export function routedContainerBoxIsFinite(box) {
  return box != null && box.TopLeft != null && box.Width > 0 && box.Height > 0 &&
    routedContainerCoordinateIsFinite(box.TopLeft.X) && routedContainerCoordinateIsFinite(box.TopLeft.Y) &&
    routedContainerCoordinateIsFinite(box.Width) && routedContainerCoordinateIsFinite(box.Height) &&
    routedContainerCoordinateIsFinite(box.TopLeft.X + box.Width) &&
    routedContainerCoordinateIsFinite(box.TopLeft.Y + box.Height);
}

export function routedContainerCoordinateIsFinite(value) {
  return Number.isFinite(value);
}
