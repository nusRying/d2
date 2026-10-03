// TEMPORARY: replace with js/src/graphbounds import at integration.
//
// Slice 46 — the subset of internal/graphbounds packing needs
// (NodeBoundingBox, BoundingBox, FixedBoundingBox and their private helpers).
// Pinned reference: d2layouts/d2talalayout/internal/graphbounds/bounds.go
//
// Every scan is charged to the caller's guard (Step/Finish throw).

import { Point } from '../geometry/point.js';
import { Orientation, orientationToString } from '../geometry/orientation.js';
import { goRound } from '../geometry/math.js';
import { getPointOnBox, isOutsideLabelPosition } from '../graph/label-position.js';
import { goMax, goMin, invariantError, LABEL_PADDING, MAX_ICON_SIZE } from './go-support.js';

// node.LoopOffsets[orientation] with Go nil-map semantics (missing → 0).
function loopOffset(node, orientation) {
  const offsets = node.LoopOffsets;
  if (offsets == null) return 0;
  if (offsets instanceof Map) {
    if (offsets.has(orientation)) return offsets.get(orientation);
    const name = orientationToString(orientation);
    return offsets.has(name) ? offsets.get(name) : 0;
  }
  if (offsets[orientation] !== undefined) return offsets[orientation];
  const name = orientationToString(orientation);
  return offsets[name] !== undefined ? offsets[name] : 0;
}

// Node.LabelTopLeft for an outside position: GetPointOnBox(node.GetBox(), label.PADDING, ...).
function labelTopLeft(node, position, width, height) {
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

/** graphbounds.NodeBoundingBox */
export function nodeBoundingBox(node, allNodes, guard) {
  guard.Step();
  if (node == null || node.TopLeft == null) {
    throw invariantError('BinPack bounding box contains an unplaced node');
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
    const lbl = labelTopLeft(node, node.Label.Position, node.Label.Width, node.Label.Height);
    const boundaryPadding = LABEL_PADDING;
    const outsidePadding = 2 * LABEL_PADDING;
    if (lbl.X < topLeft.X) {
      const extreme = isExtreme(allNodes, node, (other) => other.TopLeft.X < node.TopLeft.X, guard);
      const padding = extreme ? boundaryPadding : outsidePadding;
      topLeft.X = Math.floor(lbl.X - padding);
    }
    if (lbl.Y < topLeft.Y) {
      const extreme = isExtreme(allNodes, node, (other) => other.TopLeft.Y < node.TopLeft.Y, guard);
      const padding = extreme ? boundaryPadding : outsidePadding;
      topLeft.Y = Math.floor(lbl.Y - padding);
    }
    if (lbl.X > bottomRight.X) {
      const extreme = isExtreme(
        allNodes, node, (other) => other.TopLeft.X + other.Width > node.TopLeft.X + node.Width, guard,
      );
      const padding = extreme ? boundaryPadding : outsidePadding;
      bottomRight.X = Math.ceil(lbl.X + node.Label.Width + padding);
    }
    if (lbl.Y > bottomRight.Y) {
      const extreme = isExtreme(
        allNodes, node, (other) => other.TopLeft.Y + other.Height > node.TopLeft.Y + node.Height, guard,
      );
      const padding = extreme ? boundaryPadding : outsidePadding;
      bottomRight.Y = Math.ceil(lbl.Y + node.Label.Height + padding);
    }
  }
  if (node.Icon != null && node.shapeType() !== 'Image' && isOutsideLabelPosition(node.Icon.Position) && allNodes != null) {
    const iconSize = MAX_ICON_SIZE;
    const iconTopLeft = labelTopLeft(node, node.Icon.Position, iconSize, iconSize);
    const outsidePadding = 2 * LABEL_PADDING;
    topLeft.X = goMin(topLeft.X, Math.floor(iconTopLeft.X - outsidePadding));
    topLeft.Y = goMin(topLeft.Y, Math.floor(iconTopLeft.Y - outsidePadding));
    bottomRight.X = goMax(bottomRight.X, Math.ceil(iconTopLeft.X + iconSize + outsidePadding));
    bottomRight.Y = goMax(bottomRight.Y, Math.ceil(iconTopLeft.Y + iconSize + outsidePadding));
  }
  return [topLeft, bottomRight];
}

/** graphbounds.BoundingBox */
export function boundingBox(nodes, guard) {
  if (nodes == null || nodes.length === 0) {
    guard.Finish();
    return [new Point(-Infinity, -Infinity), new Point(Infinity, Infinity)];
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const [topLeft, bottomRight] = nodeBoundingBox(node, nodes, guard);
    minX = goMin(minX, topLeft.X);
    minY = goMin(minY, topLeft.Y);
    maxX = goMax(maxX, bottomRight.X);
    maxY = goMax(maxY, bottomRight.Y);
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
      throw invariantError('BinPack found a cycle in container ancestry');
    }
    seen.add(current);
    level++;
  }
  return level;
}

function fixedOrigin(nodes, guard) {
  let container = null;
  let minimumLevel = Number.MAX_SAFE_INTEGER;
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
    if (child.owningContainer() !== container) {
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

/** graphbounds.FixedBoundingBox */
export function fixedBoundingBox(nodes, guard) {
  let [topLeft, bottomRight] = boundingBox(nodes, guard);
  const origin = fixedOrigin(nodes ?? [], guard);
  if (origin != null) {
    topLeft = origin;
  }
  guard.Finish();
  return [topLeft, bottomRight];
}
