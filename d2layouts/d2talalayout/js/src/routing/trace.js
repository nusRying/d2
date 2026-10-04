// Slice 47 — trims route endpoints to the rendered shape border.
//
// Pinned references:
//   d2layouts/d2talalayout/internal/routing/trace.go
//   lib/shape/shape.go TraceToShapeBorder
//
// Rectangular shapes ("" and Square, RealSquare, Image, Text, Code, Class,
// Table) keep the rectangular border point exactly as D2 does. Tracing a
// non-rectangular shape needs D2's per-shape perimeter geometry
// (Shape.Perimeter, SVG path intersection), which is not ported yet; that
// path throws a descriptive error instead of guessing.

import { Point, intersectionPoint } from '../geometry/point.js';
import { Orientation } from '../geometry/orientation.js';
import { MAX_ROUTE_STAGE_WORK_UNITS } from './route-guards.js';
import { nodePortOrientation } from './layoutgraph-route-support.js';
import { runAtomicRouteStage } from './route-stage.js';
import { traceToShapeBorderGuarded } from './standalone-route-guard.js';

const RECTANGULAR_SHAPES = new Set(['', 'Square', 'RealSquare', 'Image', 'Text', 'Code', 'Class', 'Table']);

/** shape.TraceToShapeBorder for the node's shape. */
export function shapeTraceToShapeBorder(node, rectBorderPoint, prevPoint) {
  const shapeType = node._shapeType ?? '';
  if (RECTANGULAR_SHAPES.has(shapeType)) {
    return rectBorderPoint;
  }
  throw new Error(`TALA JS: tracing to the border of shape ${JSON.stringify(shapeType)} requires D2 shape perimeters, which are not ported yet`);
}

/** TraceEdgesToShapeBorder trims every route endpoint to the rendered shape. */
export function TraceEdgesToShapeBorder(ctx, graph) {
  traceEdgesToShapeBorderWithWorkLimit(ctx, graph, MAX_ROUTE_STAGE_WORK_UNITS);
}

export function traceEdgesToShapeBorderWithWorkLimit(ctx, graph, workLimit) {
  runAtomicRouteStage(ctx, 'TraceEdgesToShapeBorder', graph, null, workLimit, (guard) => {
    for (const edge of graph.Edges ?? []) {
      traceToShapeBorderGuarded(edge, guard);
    }
  });
}

// geo.Point.AddVector(geo.Vector{dx, dy}).
function addVector(point, dx, dy) {
  return new Point(point.X + dx, point.Y + dy);
}

export function traceToShapeBorder(edge) {
  if (edge == null || edge.From == null || edge.To == null || edge.Points == null || edge.Points.length < 2) {
    return;
  }
  const fromNode = edge.From;
  const toNode = edge.To;
  let originalFromTopLeft = null;
  let originalToTopLeft = null;
  let originalFromPointer = null;
  let originalToPointer = null;
  try {
    // If an edge passes through a 3D/multiple modifier, use the offset box
    // for tracing to the rendered border.
    {
      const [dx, dy] = edge.From.ModifierElementAdjustments();
      if (dx !== 0 || dy !== 0) {
        const start = edge.Points[0];
        if (start.X > edge.From.TopLeft.X + dx &&
          start.Y < edge.From.TopLeft.Y + edge.From.Height - dy) {
          originalFromPointer = edge.From.TopLeft;
          originalFromTopLeft = edge.From.TopLeft.Copy();
          const orientation = nodePortOrientation(edge.From, start);

          // Connected to the top or right side: move the segment back
          // before tracing to the border.
          const next = edge.Points[1];
          if (orientation === Orientation.Right || start.X === originalFromTopLeft.X + edge.From.Width) {
            edge.From.TopLeft.X += dx;
            const topRight = addVector(edge.From.TopLeft, edge.From.Width, 0);
            const bottomRight = addVector(topRight, 0, edge.From.Height);
            const newStart = intersectionPoint(start, next, topRight, bottomRight);
            if (newStart != null) {
              start.X = newStart.X;
              start.Y = newStart.Y;
            }
          } else if (orientation === Orientation.Top || start.Y === originalFromTopLeft.Y) {
            edge.From.TopLeft.Y -= dy;
            const topRight = addVector(edge.From.TopLeft, edge.From.Width, 0);
            const newStart = intersectionPoint(start, next, edge.From.TopLeft, topRight);
            if (newStart != null) {
              start.X = newStart.X;
              start.Y = newStart.Y;
            }
          }
        }
      }
    }
    {
      const [dx, dy] = edge.To.ModifierElementAdjustments();
      if (dx !== 0 || dy !== 0) {
        const end = edge.Points[edge.Points.length - 1];
        if (end.X > edge.To.TopLeft.X + dx &&
          end.Y < edge.To.TopLeft.Y + edge.To.Height - dy) {
          originalToPointer = edge.To.TopLeft;
          originalToTopLeft = edge.To.TopLeft.Copy();
          const orientation = nodePortOrientation(edge.To, end);

          const previous = edge.Points[edge.Points.length - 2];
          if (orientation === Orientation.Right || end.X === originalToTopLeft.X + edge.To.Width) {
            edge.To.TopLeft.X += dx;
            const topRight = addVector(edge.To.TopLeft, edge.To.Width, 0);
            const bottomRight = addVector(topRight, 0, edge.To.Height);
            const newEnd = intersectionPoint(end, previous, topRight, bottomRight);
            if (newEnd != null) {
              end.X = newEnd.X;
              end.Y = newEnd.Y;
            }
          } else if (orientation === Orientation.Top || end.Y === originalToTopLeft.Y) {
            edge.To.TopLeft.Y -= dy;
            const topRight = addVector(edge.To.TopLeft, edge.To.Width, 0);
            const newEnd = intersectionPoint(end, previous, edge.To.TopLeft, topRight);
            if (newEnd != null) {
              end.X = newEnd.X;
              end.Y = newEnd.Y;
            }
          }
        }
      }
    }

    let borderPoint = shapeTraceToShapeBorder(edge.From, edge.Points[0], edge.Points[1]);
    if (borderPoint != null) {
      edge.Points[0] = borderPoint;
    }
    borderPoint = shapeTraceToShapeBorder(edge.To, edge.Points[edge.Points.length - 1], edge.Points[edge.Points.length - 2]);
    if (borderPoint != null) {
      edge.Points[edge.Points.length - 1] = borderPoint;
    }
  } finally {
    // Restore in reverse mutation order in case both endpoints share a node.
    if (originalToTopLeft != null) {
      originalToPointer.X = originalToTopLeft.X;
      originalToPointer.Y = originalToTopLeft.Y;
      toNode.TopLeft = originalToPointer;
    }
    if (originalFromTopLeft != null) {
      originalFromPointer.X = originalFromTopLeft.X;
      originalFromPointer.Y = originalFromTopLeft.Y;
      fromNode.TopLeft = originalFromPointer;
    }
  }
}
