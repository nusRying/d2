import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { Orientation, orientationToString } from '../geometry/orientation.js';
import { LABEL_PADDING, isOutsideLabelPosition, getPointOnBox } from '../graph/label-position.js';

// Pinned Go: internal/graphbounds/bounds.go.
//
// Every scan is charged to the caller's WorkStepper (Step/Finish). JS
// convention: guard failures throw; Go's returned invariant errors throw
// `new Error(sameMessage)`. Points are returned as [topLeft, bottomRight].

const MAX_ICON_SIZE = 64; // layoutgraph.MaxIconSize

const UNPLACED_NODE = "layout invariant violated: BinPack bounding box contains an unplaced node";
const ANCESTRY_CYCLE = "layout invariant violated: BinPack found a cycle in container ancestry";

// Go map lookup node.LoopOffsets[o] (missing key or nil map -> 0).
function loopOffset(node, orientation) {
  const offsets = node.LoopOffsets;
  if (offsets == null) return 0;
  if (offsets instanceof Map) {
    if (offsets.has(orientation)) return offsets.get(orientation);
    const name = orientationToString(orientation);
    if (name && offsets.has(name)) return offsets.get(name);
    return 0;
  }
  if (typeof offsets === "object") {
    if (offsets[orientation] !== undefined) return offsets[orientation];
    const name = orientationToString(orientation);
    if (name && offsets[name] !== undefined) return offsets[name];
    return 0;
  }
  return 0;
}

// Node.LabelTopLeft for an outside position: the label is placed against the
// node's own box (GetBox). Bounds only ever ask for outside positions.
function outsideLabelTopLeft(node, position, width, height) {
  return getPointOnBox(position, node.Box, LABEL_PADDING, width, height);
}

function isExtreme(nodes, node, disqualifies, guard) {
  for (const other of nodes) {
    guard.Step();
    if (other === node || other.TopLeft == null) {
      continue;
    }
    if (disqualifies(other)) {
      return false;
    }
  }
  return true;
}

/**
 * nodeBoundingBox computes the packing-compatible bounds for one placed node.
 * When allNodes is non-null, outside labels and icons reserve their exact
 * boundary space and outside-label extremity scans consume the shared budget.
 *
 * @returns {[Point, Point]}
 */
export function nodeBoundingBox(node, allNodes, guard) {
  guard.Step();
  if (node == null || node.TopLeft == null) {
    throw new Error(UNPLACED_NODE);
  }
  const topLeft = node.TopLeft.copy();
  const bottomRight = new Point(goRound(topLeft.X + node.Width), goRound(topLeft.Y + node.Height));
  const [dx, dy] = node.modifierElementAdjustments();
  if (dx !== 0 || dy !== 0) {
    topLeft.Y -= dy;
    bottomRight.X += dx;
  }
  topLeft.X -= loopOffset(node, Orientation.Left);
  topLeft.Y -= loopOffset(node, Orientation.Top);
  bottomRight.X += loopOffset(node, Orientation.Right);
  bottomRight.Y += loopOffset(node, Orientation.Bottom);

  if (node.Label != null && isOutsideLabelPosition(node.Label.Position) && allNodes != null) {
    const labelTopLeft = outsideLabelTopLeft(node, node.Label.Position, node.Label.Width, node.Label.Height);
    const boundaryPadding = LABEL_PADDING;
    const outsidePadding = 2 * LABEL_PADDING;
    if (labelTopLeft.X < topLeft.X) {
      const extreme = isExtreme(allNodes, node, (other) => other.TopLeft.X < node.TopLeft.X, guard);
      const padding = extreme ? boundaryPadding : outsidePadding;
      topLeft.X = Math.floor(labelTopLeft.X - padding);
    }
    if (labelTopLeft.Y < topLeft.Y) {
      const extreme = isExtreme(allNodes, node, (other) => other.TopLeft.Y < node.TopLeft.Y, guard);
      const padding = extreme ? boundaryPadding : outsidePadding;
      topLeft.Y = Math.floor(labelTopLeft.Y - padding);
    }
    if (labelTopLeft.X > bottomRight.X) {
      const extreme = isExtreme(
        allNodes,
        node,
        (other) => other.TopLeft.X + other.Width > node.TopLeft.X + node.Width,
        guard,
      );
      const padding = extreme ? boundaryPadding : outsidePadding;
      bottomRight.X = Math.ceil(labelTopLeft.X + node.Label.Width + padding);
    }
    if (labelTopLeft.Y > bottomRight.Y) {
      const extreme = isExtreme(
        allNodes,
        node,
        (other) => other.TopLeft.Y + other.Height > node.TopLeft.Y + node.Height,
        guard,
      );
      const padding = extreme ? boundaryPadding : outsidePadding;
      bottomRight.Y = Math.ceil(labelTopLeft.Y + node.Label.Height + padding);
    }
  }
  if (node.Icon != null && node._shapeType !== "Image" && isOutsideLabelPosition(node.Icon.Position) && allNodes != null) {
    const iconSize = MAX_ICON_SIZE;
    const iconTopLeft = outsideLabelTopLeft(node, node.Icon.Position, iconSize, iconSize);
    const outsidePadding = 2 * LABEL_PADDING;
    topLeft.X = Math.min(topLeft.X, Math.floor(iconTopLeft.X - outsidePadding));
    topLeft.Y = Math.min(topLeft.Y, Math.floor(iconTopLeft.Y - outsidePadding));
    bottomRight.X = Math.max(bottomRight.X, Math.ceil(iconTopLeft.X + iconSize + outsidePadding));
    bottomRight.Y = Math.max(bottomRight.Y, Math.ceil(iconTopLeft.Y + iconSize + outsidePadding));
  }
  return [topLeft, bottomRight];
}

/**
 * boundingBox computes the packing-compatible bounds for a node set.
 *
 * @returns {[Point, Point]}
 */
export function boundingBox(nodes, guard) {
  if (nodes == null || nodes.length === 0) {
    const result = [new Point(-Infinity, -Infinity), new Point(Infinity, Infinity)];
    guard.Finish();
    return result;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const [topLeft, bottomRight] = nodeBoundingBox(node, nodes, guard);
    minX = Math.min(minX, topLeft.X);
    minY = Math.min(minY, topLeft.Y);
    maxX = Math.max(maxX, bottomRight.X);
    maxY = Math.max(maxY, bottomRight.Y);
  }
  guard.Finish();
  return [new Point(minX, minY), new Point(maxX, maxY)];
}

function containerLevel(node, guard) {
  let level = 0;
  const seen = new Set();
  for (let current = node; current != null; current = current.owningContainer()) {
    guard.Step();
    if (seen.has(current)) {
      throw new Error(ANCESTRY_CYCLE);
    }
    seen.add(current);
    level++;
  }
  return level;
}

function fixedOrigin(nodes, guard) {
  let container = null;
  let minimumLevel = Number.MAX_SAFE_INTEGER; // Go math.MaxInt; levels are bounded by the node count
  for (const node of nodes) {
    guard.Step();
    const current = node.owningContainer();
    if (current == null) {
      container = null;
      break;
    }
    const level = containerLevel(current, guard);
    if (level < minimumLevel) {
      minimumLevel = level;
      container = current;
    }
  }
  for (const child of nodes) {
    guard.Step();
    if ((child.owningContainer() ?? null) !== container) {
      continue;
    }
    const origin = child.fixedOrigin();
    if (origin != null) {
      return origin;
    }
  }
  guard.Finish();
  return null;
}

/**
 * fixedBoundingBox computes node-set bounds and substitutes the inherited
 * fixed origin used by packing when one of the relevant children is pinned.
 *
 * @returns {[Point, Point]}
 */
export function fixedBoundingBox(nodes, guard) {
  let [topLeft, bottomRight] = boundingBox(nodes, guard);
  const origin = fixedOrigin(nodes ?? [], guard);
  if (origin != null) {
    topLeft = origin;
  }
  guard.Finish();
  return [topLeft, bottomRight];
}

export const NodeBoundingBox = nodeBoundingBox;
export const BoundingBox = boundingBox;
export const FixedBoundingBox = fixedBoundingBox;
