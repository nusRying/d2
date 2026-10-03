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
 *
 * @param {import('../graph/node.js').Node} n
 * @param {import('../graph/graph.js').Graph} g
 * @param {import('../graph/node.js').Node} centerNode
 * @param {number} times
 * @param {boolean} round
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
 * transpose attempts to rotate a 1- or 2-edge node around its neighbor to improve symmetry.
 * Pinned Go: placement.transpose
 *
 * @param {object} ctx
 * @param {import('../graph/graph.js').Graph} g
 * @param {import('../graph/node.js').Node} node
 * @param {import('../graph/edge.js').EdgeAbduction[]} [edgeAbductions]
 * @returns {Promise<boolean>|boolean}
 */
export function transpose(ctx, g, node, edgeAbductions = null) {
  const [txnCtx] = ensureTransactionWorkGuard(ctx, 'TransposeTransactions');

  if (node.Hierarchy != null) {
    return false;
  }
  if (g.NodeToTree && (g.NodeToTree instanceof Map ? g.NodeToTree.has(node) : g.NodeToTree[node] != null)) {
    return false;
  }
  if (g.isTreeSentinel ? g.isTreeSentinel(node) : (g.IsTreeSentinel && g.IsTreeSentinel(node))) {
    return false;
  }
  if (node.FixedTopLeft != null) {
    return false;
  }

  if (edgeAbductions) {
    for (let i = 0; i < edgeAbductions.length; i++) {
      const e = edgeAbductions[i];
      if (e.OriginallyFrom === node || e.OriginallyTo === node) {
        return false;
      }
      if (e.CurrentFrom === node || e.CurrentTo === node) {
        return false;
      }
    }
  }

  const edgeCount = node.Edges ? node.Edges.length : 0;
  if (edgeCount !== 2 && edgeCount !== 1) {
    return false;
  }

  const reachabilityGuard = new WorkGuard(ctx, 'TransposeReachability', MAX_ENGINE_WORK_UNITS);

  const reachableFrom = (start, includeContainers, ignore) => {
    return start.allReachableNodesContext(includeContainers, false, true, ignore, reachabilityGuard);
  };

  let transposeNodes = [];
  let centerNode = null;

  if (edgeCount === 1) {
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

      const ignoreMap = new Set([nodeA]);
      transposeNodes = reachableFrom(curr, false, ignoreMap);
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

  const finishErr = reachabilityGuard.finish();
  if (finishErr != null) {
    throw finishErr;
  }

  for (let i = 0; i < transposeNodes.length; i++) {
    if (transposeNodes[i].fixedOrigin() != null) {
      return false;
    }
  }

  const calcLength = () => {
    if (edgeAbductions == null) {
      return edgeLength(ctx, g, {
        EdgeAbductions: null,
        IncludeNodeSizes: true,
        EnforceMinimumGap: false,
        PenalizeDirection: true,
      });
    }
    let sum = nodeEdgeLength(ctx, node, {
      EdgeAbductions: edgeAbductions,
      IncludeNodeSizes: true,
      EnforceMinimumGap: false,
      PenalizeDirection: true,
    });
    for (let i = 0; i < node.Edges.length; i++) {
      const e = node.Edges[i];
      const length = nodeEdgeLength(ctx, node.adjacent(e), {
        EdgeAbductions: edgeAbductions,
        IncludeNodeSizes: true,
        EnforceMinimumGap: false,
        PenalizeDirection: true,
      });
      sum += length;
    }
    return sum;
  };

  let bestLength = calcLength();
  let bestRotations = -1;

  const [txn, txnErr] = g.newRequestTransaction(txnCtx, { affectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }

  // Rotate all around
  for (let i = 0; i < 3; i++) {
    txn.addOp(() => {
      for (let j = 0; j < transposeNodes.length; j++) {
        const n = transposeNodes[j];
        rotateAround(n, g, centerNode, i + 1, edgeAbductions != null);
        if (typeof n.isClusterVessel === 'function' ? n.isClusterVessel() : Boolean(n.isClusterVessel)) {
          const cluster = g.Clusters instanceof Map ? g.Clusters.get(n) : g.Clusters?.[n];
          if (cluster) {
            optimizeCluster(ctx, cluster, true);
          }
        }
      }
    });

    const commitErr = txn.commit(ctx);
    if (commitErr == null) {
      const length = calcLength();
      if (precisionCompare(length, bestLength, PRECISION) < 0) {
        bestLength = length;
        bestRotations = i + 1;
      }
    } else if (!isCandidateRejection(commitErr)) {
      throw commitErr;
    }

    txn.rollback();
    txn.clear();
  }

  if (bestRotations !== -1) {
    txn.addOp(() => {
      for (let j = 0; j < transposeNodes.length; j++) {
        const n = transposeNodes[j];
        rotateAround(n, g, centerNode, bestRotations, edgeAbductions != null);
        if (typeof n.isClusterVessel === 'function' ? n.isClusterVessel() : Boolean(n.isClusterVessel)) {
          const cluster = g.Clusters instanceof Map ? g.Clusters.get(n) : g.Clusters?.[n];
          if (cluster) {
            optimizeCluster(ctx, cluster, true);
          }
        }
      }
    });
    const commitErr = txn.commit(ctx);
    if (commitErr != null) {
      throw commitErr;
    }
    return true;
  }

  return false;
}

export const Transpose = transpose;
