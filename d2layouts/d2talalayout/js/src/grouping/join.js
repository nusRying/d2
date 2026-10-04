// Slice 46 — grouping.JoinDistancedClusters.
//
// Pinned reference: d2layouts/d2talalayout/internal/grouping/join.go

import { Point, getMedianPoint } from '../geometry/point.js';
import { euclideanDistance } from '../geometry/math.js';
import { Orientation } from '../geometry/orientation.js';
import { WorkGuard } from '../limits/work-guard.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../limits/constants.js';
import { existingTransactionWorkGuard } from '../limits/transaction-guard.js';
import { getContextError } from '../limits/work-context.js';
import {
  distanceClustersWithWorkGuard,
  nodesBoundsWithWorkGuard,
  nodesCenterWithWorkGuard,
  wouldOverlapWithWorkGuard,
} from '../graph/structural-access.js';

function placeNodesContextError(ctx) {
  const err = getContextError(ctx);
  if (err != null) {
    return new Error(`PlaceNodes: ${err.message ?? String(err)}`, { cause: err });
  }
  return null;
}

/**
 * JoinPositionJournal keeps capture order because separate nodes may share a
 * TopLeft object and first reach the journal after different movements.
 */
export class JoinPositionJournal {
  constructor() {
    this.captured = new Set();
    this.snapshots = [];
  }

  capture(node) {
    if (node == null || this.captured.has(node)) return false;
    this.captured.add(node);
    const pointer = node.TopLeft;
    this.snapshots.push({
      node,
      pointer,
      x: pointer != null ? pointer.X : 0,
      y: pointer != null ? pointer.Y : 0,
    });
    return true;
  }

  moveWithChildren(node, dx, dy, guard) {
    if (dx === 0 && dy === 0) return;
    const firstCapture = this.capture(node);
    if (node.Graph == null) {
      guard.Step();
      // Preserve the legacy malformed-node failure after journaling the root.
      node.MoveWithChildren(dx, dy);
      guard.Finish();
      return;
    }
    const graph = node.Graph;
    let hasDescendants = node.IsContainer() && (graph.Containers.get(node)?.length ?? 0) > 0;
    if (node.IsClusterVessel()) {
      const cluster = graph.Clusters.get(node);
      hasDescendants = hasDescendants || (cluster != null && cluster.Nodes.length > 0);
    }
    const sequence = graph.Sequences.get(node);
    hasDescendants = hasDescendants || (sequence != null && sequence.Nodes.length > 0);
    let descendants = [];
    if (hasDescendants) {
      descendants = graph.AllDescendantNodesWithWorkGuard(node, true, guard);
    }
    if (firstCapture) {
      for (const descendant of descendants) this.capture(descendant);
    }
    // Reject the complete translation before changing any shared point.
    guard.Add(1 + descendants.length);
    node.Translate(dx, dy);
    for (const descendant of descendants) descendant.Translate(dx, dy);
  }

  restore() {
    // Reverse capture order restores shared points through every intermediate
    // value before returning them to their original value.
    for (let index = this.snapshots.length - 1; index >= 0; index--) {
      const snapshot = this.snapshots[index];
      snapshot.node.TopLeft = snapshot.pointer;
      if (snapshot.pointer != null) {
        snapshot.pointer.X = snapshot.x;
        snapshot.pointer.Y = snapshot.y;
      }
    }
  }
}

export function joinMedian(points, guard) {
  guard.Add(2 * points.length);
  for (let width = 1; width < points.length; width *= 2) {
    guard.Add(2 * points.length);
    if (width > Math.trunc(points.length / 2)) break;
  }
  return getMedianPoint(points);
}

export function joinContainerFixedOrigin(graph, container, guard) {
  for (const node of graph.Nodes) {
    guard.Step();
    if (node.OwningContainer() !== container) continue;
    const origin = node.FixedOrigin();
    if (origin != null) return origin;
  }
  return null;
}

/**
 * JoinDistancedClusters incrementally pulls disconnected placement islands
 * toward their common center without introducing overlap. Every failure
 * restores all moved positions.
 */
export function joinDistancedClusters(ctx, graph) {
  let ctxErr = placeNodesContextError(ctx);
  if (ctxErr != null) throw ctxErr;
  let [guard, sharedGuard] = existingTransactionWorkGuard(ctx, 'PlaceNodes');
  let preflightWork = graph.Nodes.length;
  if (sharedGuard) guard.Add(preflightWork);
  const fixedNodes = graph.FixedNodes() ?? [];
  if (graph.Nodes.length - fixedNodes.length <= 1) {
    if (sharedGuard) guard.Finish();
    return;
  }
  if (graph.Edges.length === 0) {
    preflightWork += graph.Nodes.length;
    if (sharedGuard) guard.Add(graph.Nodes.length);
    let hasJoinReference = false;
    for (const node of graph.Nodes) {
      if (node.Edges.length > 0 || node.Nears.size > 0) {
        hasJoinReference = true;
        break;
      }
    }
    if (!hasJoinReference) {
      if (sharedGuard) guard.Finish();
      return;
    }
  }
  if (!sharedGuard) {
    guard = new WorkGuard(ctx, 'PlaceNodes', MAX_TRANSACTION_WORK_UNITS);
    guard.Add(preflightWork);
  }

  const positions = new JoinPositionJournal();
  let complete = false;
  try {
    const finish = () => {
      guard.Finish();
      complete = true;
    };
    const clusters = distanceClustersWithWorkGuard(graph.Nodes, 3 * graph.CellSize, guard);
    if (clusters == null) {
      finish();
      return;
    }

    let target;
    if (fixedNodes.length > 0) {
      target = nodesCenterWithWorkGuard(fixedNodes, guard);
    } else {
      const centers = [];
      for (const cluster of clusters) centers.push(nodesCenterWithWorkGuard(cluster, guard));
      target = joinMedian(centers, guard);
    }

    const tryAxisMove = (cluster, fixedOrigin, dx, dy) => {
      let hasOverlap = false;
      for (const node of cluster) {
        const x = node.TopLeft.X + dx;
        const y = node.TopLeft.Y + dy;
        let overlaps = fixedOrigin != null && (x < fixedOrigin.X || y < fixedOrigin.Y);
        if (!overlaps) {
          overlaps = wouldOverlapWithWorkGuard(graph, node, new Point(x, y), cluster, null, guard);
        }
        if (overlaps) hasOverlap = true;
        positions.moveWithChildren(node, dx, dy, guard);
      }
      if (hasOverlap) {
        for (const node of cluster) positions.moveWithChildren(node, -dx, -dy, guard);
      }
      return hasOverlap;
    };

    const inchTowardsTarget = (cluster, fixedOrigin) => {
      const [topLeft, bottomRight] = nodesBoundsWithWorkGuard(cluster, guard);
      const center = new Point(topLeft.X + (bottomRight.X - topLeft.X) / 2, topLeft.Y + (bottomRight.Y - topLeft.Y) / 2);
      const distance = euclideanDistance(center.X, center.Y, target.X, target.Y);
      const length = Math.max(bottomRight.X - topLeft.X, bottomRight.Y - topLeft.Y);
      if (distance < length / 2) return false;
      let deltaX = 0;
      let deltaY = 0;
      const orientation = center.getOrientation(target);
      if (orientation === Orientation.NONE) {
        throw new Error('layout invariant violated: No orientation');
      }
      if (orientation === Orientation.Top || orientation === Orientation.TopLeft || orientation === Orientation.TopRight) deltaY = 1;
      if (orientation === Orientation.Bottom || orientation === Orientation.BottomLeft || orientation === Orientation.BottomRight) deltaY = -1;
      if (orientation === Orientation.Left || orientation === Orientation.BottomLeft || orientation === Orientation.TopLeft) deltaX = 1;
      if (orientation === Orientation.Right || orientation === Orientation.TopRight || orientation === Orientation.BottomRight) deltaX = -1;
      if (deltaX === 0 && deltaY === 0) return false;
      deltaX *= graph.CellSize;
      deltaY *= graph.CellSize;

      let hasOverlap = false;
      let hasOverlapX = false;
      let hasOverlapY = false;
      for (const node of cluster) {
        const x = node.TopLeft.X + deltaX;
        const y = node.TopLeft.Y + deltaY;
        if (!hasOverlap) {
          if (fixedOrigin != null) {
            if (x < fixedOrigin.X) {
              hasOverlapX = true;
              hasOverlap = true;
            }
            if (y < fixedOrigin.Y) {
              hasOverlapY = true;
              hasOverlap = true;
            }
          }
          if (!hasOverlap) {
            hasOverlap = wouldOverlapWithWorkGuard(graph, node, new Point(x, y), cluster, null, guard);
          }
        }
        positions.moveWithChildren(node, deltaX, deltaY, guard);
      }
      if (hasOverlap) {
        for (const node of cluster) positions.moveWithChildren(node, -deltaX, -deltaY, guard);
      }
      if (deltaX !== 0 && deltaY !== 0) {
        if (hasOverlapX && !hasOverlapY) {
          hasOverlap = tryAxisMove(cluster, fixedOrigin, 0, deltaY);
        } else if (!hasOverlapX && hasOverlapY) {
          hasOverlap = tryAxisMove(cluster, fixedOrigin, deltaX, 0);
        }
      }
      return !hasOverlap;
    };

    for (let i = 0; i < 1000; i++) {
      ctxErr = placeNodesContextError(ctx);
      if (ctxErr != null) throw ctxErr;
      guard.Add(1 + clusters.length);
      let moved = false;
      for (const cluster of clusters) {
        ctxErr = placeNodesContextError(ctx);
        if (ctxErr != null) throw ctxErr;
        let fixedOrigin = null;
        if (fixedNodes.length > 0) {
          fixedOrigin = joinContainerFixedOrigin(graph, cluster[0].OwningContainer(), guard);
        }
        if (inchTowardsTarget(cluster, fixedOrigin)) moved = true;
      }
      if (!moved) break;
    }
    ctxErr = placeNodesContextError(ctx);
    if (ctxErr != null) throw ctxErr;
    finish();
  } finally {
    if (!complete) positions.restore();
  }
}

export const JoinDistancedClusters = joinDistancedClusters;
