/**
 * Transpose — rotate a one- or two-edge node's side of the graph around its
 * neighbor when that shortens edges.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/transpose.go
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { WorkGuard } from '../limits/work-guard.js';
import { MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { edgeLength } from '../placementcost/graph.js';
import { nodeEdgeLength } from '../placementcost/edge-length.js';
import { isCandidateRejection } from '../graph/transaction.js';
import { roundToNearestCellSize } from './types.js';
import { goRound, precisionCompare, PRECISION } from '../geometry/math.js';
import { isDiagonal } from '../geometry/orientation.js';
import { optimizeCluster } from './cluster-optimization.js';

/**
 * rotateAround rotates a node 90 degrees counterclockwise around a center node.
 * Pinned Go: placement.rotateAround
 */
export function rotateAround(n, g, centerNode, times, round) {
  for (let i = 0; i < times; i++) {
    const nodeCenter = n.center();

    // Translate node center to origin
    const translatedX = nodeCenter.X - centerNode.TopLeft.X - centerNode.Width / 2;
    const translatedY = nodeCenter.Y - centerNode.TopLeft.Y - centerNode.Height / 2;

    // Rotate 90 degrees counterclockwise
    const rotatedX = -translatedY;
    const rotatedY = translatedX;

    // Translate back
    const newCenterX = rotatedX + centerNode.TopLeft.X + centerNode.Width / 2;
    const newCenterY = rotatedY + centerNode.TopLeft.Y + centerNode.Height / 2;

    // Calculate new top-left position
    let newTopLeftX = goRound(newCenterX - n.Width / 2);
    let newTopLeftY = goRound(newCenterY - n.Height / 2);

    if (round) {
      if (Math.trunc(newTopLeftX) % Math.trunc(g.CellSize) !== 0) {
        newTopLeftX = roundToNearestCellSize(newTopLeftX, g.CellSize);
      }
      if (Math.trunc(newTopLeftY) % Math.trunc(g.CellSize) !== 0) {
        newTopLeftY = roundToNearestCellSize(newTopLeftY, g.CellSize);
      }
    }

    n.moveAbsWithChildren(newTopLeftX, newTopLeftY);
  }
}

export const RotateAround = rotateAround;

/**
 * transpose attempts to rotate a 1- or 2-edge node around its neighbor to
 * improve symmetry. All nested work (reachability, scoring, transactions and
 * nested cluster optimization) runs under the context returned by
 * EnsureTransactionWorkGuard, so the whole stage shares one transaction budget.
 *
 * Pinned Go: placement.transpose
 * @returns {boolean} whether a rotation was committed. Errors throw.
 */
export function transpose(ctx, g, node, edgeAbductions = null) {
  [ctx] = ensureTransactionWorkGuard(ctx, 'TransposeTransactions');
  if (node.Hierarchy != null) {
    return false;
  }
  if (g.NodeToTree.has(node)) {
    return false;
  }
  if (g.isTreeSentinel(node)) {
    return false;
  }
  if (node.FixedTopLeft != null) {
    return false;
  }
  // Maybe re-enable when I see a use case
  for (const e of edgeAbductions ?? []) {
    if (e.OriginallyFrom === node || e.OriginallyTo === node) {
      return false;
    }
    if (e.CurrentFrom === node || e.CurrentTo === node) {
      return false;
    }
  }
  if (node.Edges.length !== 2 && node.Edges.length !== 1) {
    return false;
  }
  const reachabilityGuard = new WorkGuard(ctx, 'TransposeReachability', MAX_ENGINE_WORK_UNITS);
  const reachableFrom = (start, includeContainers, ignore) =>
    start.allReachableNodesContext(includeContainers, false, true, ignore, reachabilityGuard);

  let transposeNodes;
  let centerNode;
  if (node.Edges.length === 1) {
    const nodeA = node.adjacent(node.Edges[0]);
    if (nodeA.isDescendantOf(node) || node.isDescendantOf(nodeA)) {
      return false;
    }
    if (isDiagonal(node.orientation(nodeA))) {
      return false;
    }
    const ancestor = node.nearestSharedAncestor(nodeA);

    centerNode = nodeA;
    if (edgeAbductions == null) {
      let curr = node;
      while (curr.owningContainer() !== ancestor) {
        curr = curr.owningContainer();
      }
      transposeNodes = reachableFrom(curr, false, new Set([nodeA]));
      if (transposeNodes.some((n) => nodeA.isDescendantOf(n))) {
        return false;
      }
    } else {
      transposeNodes = [node];
    }
  } else {
    const nodeA = node.adjacent(node.Edges[0]);
    const nodeB = node.adjacent(node.Edges[1]);

    if (nodeA.isDescendantOf(node) || node.isDescendantOf(nodeA)) {
      return false;
    }
    if (nodeB.isDescendantOf(node) || node.isDescendantOf(nodeB)) {
      return false;
    }

    const ancestorA = node.nearestSharedAncestor(nodeA);
    const ancestorB = node.nearestSharedAncestor(nodeB);

    const connectedToA = reachableFrom(nodeA, true, new Set([node, ancestorA]));
    if (connectedToA.includes(nodeB)) {
      return false;
    }

    const nodeAOrientation = node.orientation(nodeA);
    const nodeBOrientation = node.orientation(nodeB);
    if (isDiagonal(nodeAOrientation) || isDiagonal(nodeBOrientation)) {
      return false;
    }

    const reachableNodesA = reachableFrom(nodeA, false, new Set([node, ancestorA]));
    const reachableNodesB = reachableFrom(nodeB, false, new Set([node, ancestorB]));

    // Rotate the side with less nodes around the side with more nodes
    if (reachableNodesA.length >= reachableNodesB.length) {
      if (edgeAbductions == null) {
        let curr = node;
        while (curr.owningContainer() !== ancestorB) {
          curr = curr.owningContainer();
        }
        transposeNodes = reachableFrom(curr, false, new Set([nodeA]));
        if (transposeNodes.some((n) => nodeA.isDescendantOf(n))) {
          return false;
        }
      } else {
        transposeNodes = [...reachableNodesB, node];
      }
      centerNode = nodeA;
    } else {
      if (edgeAbductions == null) {
        let curr = node;
        while (curr.owningContainer() !== ancestorA) {
          curr = curr.owningContainer();
        }
        transposeNodes = reachableFrom(curr, false, new Set([nodeB]));
        if (transposeNodes.some((n) => nodeB.isDescendantOf(n))) {
          return false;
        }
      } else {
        transposeNodes = [...reachableNodesA, node];
      }
      centerNode = nodeB;
    }
  }
  reachabilityGuard.Finish();

  for (const n of transposeNodes) {
    if (n.fixedOrigin() != null) {
      return false;
    }
  }

  const scoringOptions = {
    EdgeAbductions: edgeAbductions,
    IncludeNodeSizes: true,
    EnforceMinimumGap: false,
    PenalizeDirection: true,
  };
  const calcLength = () => {
    if (edgeAbductions == null) {
      return edgeLength(ctx, g, { ...scoringOptions, EdgeAbductions: null });
    }
    let sum = nodeEdgeLength(ctx, node, scoringOptions);
    for (const e of node.Edges) {
      sum += nodeEdgeLength(ctx, node.adjacent(e), scoringOptions);
    }
    return sum;
  };

  let bestLength = calcLength();
  let bestRotations = -1;

  const [txn, txnErr] = g.newRequestTransaction(ctx, { AffectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }

  const rotateAll = (times) => () => {
    for (const n of transposeNodes) {
      rotateAround(n, g, centerNode, times, edgeAbductions != null);
      if (n.IsClusterVessel()) {
        optimizeCluster(ctx, g.Clusters.get(n), true);
      }
    }
    return null;
  };

  // Rotate all around
  for (let i = 0; i < 3; i++) {
    txn.addOp(rotateAll(i + 1));
    const err = txn.commit(ctx);
    if (err == null) {
      let length;
      try {
        length = calcLength();
      } catch (scoreErr) {
        txn.rollback();
        txn.clear();
        throw scoreErr;
      }
      if (precisionCompare(length, bestLength, PRECISION) < 0) {
        bestLength = length;
        bestRotations = i + 1;
      }
    } else if (!isCandidateRejection(err)) {
      throw err;
    }

    txn.rollback();
    txn.clear();
  }

  if (bestRotations !== -1) {
    txn.addOp(rotateAll(bestRotations));
    const err = txn.commit(ctx);
    if (err != null) {
      throw err;
    }
    return true;
  }

  return false;
}

export const Transpose = transpose;
