import { euclideanDistance } from '../geometry/math.js';
import { Point } from '../geometry/point.js';
import { Orientation } from '../geometry/orientation.js';
import { nodesBounds } from '../graph/node-bounds.js';

export const SCORING_CANCELLATION_CHECK_INTERVAL = 64;
export const SIZELESS_DIRECTION_DELTA_FACTOR = 0.25;
export const SYMMETRY_TOLERANCE_BAND = 1.0;

export const SIDE_EDGE_SPACING = 40.0;
export const CONNECTED_NODE_GAP = 60.0;
export const IDEAL_GAP_SIZE = 2.5 * CONNECTED_NODE_GAP; // 150.0

export function checkScoringCancellation(ctx) {
  if (ctx == null) {
    return null;
  }
  let err = null;
  if (typeof ctx.Err === 'function') {
    err = ctx.Err();
  } else if (typeof ctx.err === 'function') {
    err = ctx.err();
  }
  if (err != null) {
    return new Error(`EdgeLength: context canceled`);
  }
  return null;
}

export function scoringCancellationError(ctx, iteration) {
  if (iteration % SCORING_CANCELLATION_CHECK_INTERVAL !== 0) {
    return null;
  }
  return checkScoringCancellation(ctx);
}

export function directionCompass(direction) {
  switch (direction) {
    case Orientation.BottomLeft:
      return -3;
    case Orientation.Left:
      return -2;
    case Orientation.TopLeft:
      return -1;
    case Orientation.Top:
      return 0;
    case Orientation.TopRight:
      return 1;
    case Orientation.Right:
      return 2;
    case Orientation.BottomRight:
      return 3;
    case Orientation.Bottom:
      return 4;
    default:
      return 0;
  }
}

export function compassDelta(first, second) {
  let delta = second - first;
  if (delta > 4) {
    delta -= 8;
  } else if (delta < -4) {
    delta += 8;
  }
  return delta;
}

export function compassAxisDelta(first, second) {
  first = (first + 4) % 4;
  second = (second + 4) % 4;
  const delta = second - first;
  if (delta === 3) {
    return -1;
  }
  return delta;
}

export function intervalGap(firstStart, firstEnd, secondStart, secondEnd) {
  if (firstEnd < secondStart) {
    return secondStart - firstEnd;
  }
  if (secondEnd < firstStart) {
    return firstStart - secondEnd;
  }
  return 0;
}

export function distanceBetweenBoxes(first, second) {
  const dx = intervalGap(first.TopLeft.X, first.TopLeft.X + first.Width, second.TopLeft.X, second.TopLeft.X + second.Width);
  const dy = intervalGap(first.TopLeft.Y, first.TopLeft.Y + first.Height, second.TopLeft.Y, second.TopLeft.Y + second.Height);
  return euclideanDistance(0, 0, dx, dy);
}

export function distanceToPoint(node, point, includeSizes) {
  const box = { TopLeft: node.TopLeft, Width: 0, Height: 0 };
  if (includeSizes) {
    box.Width = node.Width;
    box.Height = node.Height;
  }
  const pointBox = { TopLeft: point, Width: 0, Height: 0 };
  return distanceBetweenBoxes(box, pointBox);
}

export function placementDistance(first, second, includeSizes) {
  const distance = first.DistanceTo(second, includeSizes);
  let xCenter = Math.abs(first.TopLeft.X - second.TopLeft.X);
  let yCenter = Math.abs(first.TopLeft.Y - second.TopLeft.Y);
  if (includeSizes) {
    xCenter = Math.abs((first.TopLeft.X + first.Width / 2) - (second.TopLeft.X + second.Width / 2)) / (first.Width + second.Width);
    yCenter = Math.abs((first.TopLeft.Y + first.Height / 2) - (second.TopLeft.Y + second.Height / 2)) / (first.Height + second.Height);
  }
  return distance + Math.min(xCenter, yCenter) / 20;
}

export function sizelessOrientation(node, other) {
  if (node == null || node.TopLeft == null || other == null || other.TopLeft == null) {
    return Orientation.NONE;
  }
  if (node.TopLeft.Y < other.TopLeft.Y) {
    if (node.TopLeft.X < other.TopLeft.X) {
      return Orientation.TopLeft;
    }
    if (other.TopLeft.X < node.TopLeft.X) {
      return Orientation.TopRight;
    }
    return Orientation.Top;
  }
  if (other.TopLeft.Y < node.TopLeft.Y) {
    if (node.TopLeft.X < other.TopLeft.X) {
      return Orientation.BottomLeft;
    }
    if (other.TopLeft.X < node.TopLeft.X) {
      return Orientation.BottomRight;
    }
    return Orientation.Bottom;
  }
  if (other.TopLeft.X < node.TopLeft.X) {
    return Orientation.Right;
  }
  if (node.TopLeft.X < other.TopLeft.X) {
    return Orientation.Left;
  }
  return Orientation.NONE;
}

export function depth(node) {
  if (node == null) {
    return 0;
  }
  return 1 + depth(node.Container);
}

export function distanceBetweenTableColumns(graph, edge, from, to) {
  const [fromPort, toPort, hasFromPort, hasToPort, orientation] = edge.FacingTablePortValues(from, to);
  if (orientation === Orientation.NONE) {
    if (from == null) {
      from = edge.From;
    }
    if (to == null) {
      to = edge.To;
    }
    const [topLeft, bottomRight] = nodesBounds([from, to]);
    return 2 * euclideanDistance(topLeft.X, topLeft.Y, bottomRight.X, bottomRight.Y);
  }
  let multiplier = 2.0;
  if (orientation === Orientation.Left || orientation === Orientation.Right) {
    multiplier = 1.0;
  }
  let fp = fromPort;
  let tp = toPort;
  if (!hasFromPort) {
    fp = new Point(
      from.TopLeft.X + from.Width / 2,
      from.TopLeft.Y + from.Height / 2,
    );
  }
  if (!hasToPort) {
    tp = new Point(
      to.TopLeft.X + to.Width / 2,
      to.TopLeft.Y + to.Height / 2,
    );
  }
  let gapCost = 0.0;
  if (Math.abs(fp.X - tp.X) < IDEAL_GAP_SIZE) {
    gapCost = 2 * graph.CellSize;
  }
  return multiplier * (gapCost + euclideanDistance(fp.X, fp.Y, tp.X, tp.Y));
}
