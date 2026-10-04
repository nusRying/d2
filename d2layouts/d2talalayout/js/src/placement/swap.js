/**
 * Swap optimization — exchange sibling positions when that lowers cost.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/swap.go
 *   swapPositions, smartSwapPositions, swapOptimize
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { precisionCompare, PRECISION } from '../geometry/math.js';
import { Orientation } from '../geometry/orientation.js';
import { isCandidateRejection } from '../graph/transaction.js';
import { hasLeakyEdge } from '../graph/structural-access.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { edgeLength, graphEdgeCrossings } from '../placementcost/graph.js';
import { nodeEdgeLength } from '../placementcost/edge-length.js';
import { columnCrossingCost, nodeSymmetryExport } from '../placementcost/symmetry.js';

/** Pinned Go: placement.swapPositions */
export function swapPositions(nodeA, nodeB) {
  const tmpX = nodeA.TopLeft.X;
  const tmpY = nodeA.TopLeft.Y;

  nodeA.MoveWithChildren(
    nodeB.TopLeft.X - nodeA.TopLeft.X,
    nodeB.TopLeft.Y - nodeA.TopLeft.Y,
  );

  nodeB.MoveWithChildren(
    tmpX - nodeB.TopLeft.X,
    tmpY - nodeB.TopLeft.Y,
  );
}

/** Pinned Go: placement.smartSwapPositions (keeps facing sides aligned). */
export function smartSwapPositions(nodeA, nodeB) {
  const tmpX = nodeA.TopLeft.X;
  const tmpY = nodeA.TopLeft.Y;

  const o = nodeA.orientation(nodeB);
  if (o === Orientation.Left) {
    nodeA.MoveAbsWithChildren(nodeB.TopLeft.X + nodeB.Width - nodeA.Width, nodeA.TopLeft.Y);
    nodeB.MoveAbsWithChildren(tmpX, nodeB.TopLeft.Y);
  } else if (o === Orientation.Right) {
    nodeA.MoveAbsWithChildren(nodeB.TopLeft.X, nodeA.TopLeft.Y);
    nodeB.MoveAbsWithChildren(tmpX + nodeA.Width - nodeB.Width, nodeB.TopLeft.Y);
  } else if (o === Orientation.Top) {
    nodeA.MoveAbsWithChildren(nodeA.TopLeft.X, nodeB.TopLeft.Y + nodeB.Height - nodeA.Height);
    nodeB.MoveAbsWithChildren(nodeB.TopLeft.X, tmpY);
  } else if (o === Orientation.Bottom) {
    nodeA.MoveAbsWithChildren(nodeA.TopLeft.X, nodeB.TopLeft.Y);
    nodeB.MoveAbsWithChildren(nodeB.TopLeft.X, tmpY + nodeA.Height - nodeB.Height);
  } else if (o === Orientation.TopLeft) {
    nodeA.MoveAbsWithChildren(nodeB.TopLeft.X + nodeB.Width - nodeA.Width, nodeB.TopLeft.Y + nodeB.Height - nodeA.Height);
    nodeB.MoveAbsWithChildren(tmpX, tmpY);
  } else if (o === Orientation.TopRight) {
    nodeA.MoveAbsWithChildren(nodeB.TopLeft.X, nodeB.TopLeft.Y + nodeB.Height - nodeA.Height);
    nodeB.MoveAbsWithChildren(tmpX + nodeA.Width - nodeB.Width, tmpY);
  } else if (o === Orientation.BottomLeft) {
    nodeA.MoveAbsWithChildren(nodeB.TopLeft.X + nodeB.Width - nodeA.Width, nodeB.TopLeft.Y);
    nodeB.MoveAbsWithChildren(tmpX, tmpY + nodeA.Height - nodeB.Height);
  } else if (o === Orientation.BottomRight) {
    nodeA.MoveAbsWithChildren(nodeB.TopLeft.X, nodeB.TopLeft.Y);
    nodeB.MoveAbsWithChildren(tmpX + nodeA.Width - nodeB.Width, tmpY + nodeA.Height - nodeB.Height);
  }
}

const SWAP_SCORING = Object.freeze({
  EdgeAbductions: null,
  IncludeNodeSizes: true,
  EnforceMinimumGap: false,
  PenalizeDirection: true,
});

function swapScoring() {
  return { ...SWAP_SCORING };
}

/**
 * swapOptimize swaps node positions (plain or side-aligned) when doing so
 * lowers placement cost without adding crossings.
 *
 * Pinned Go: placement.swapOptimize
 * @returns {boolean} whether any swap was committed. Errors throw.
 */
export function swapOptimize(ctx, nodes, g) {
  [ctx] = ensureTransactionWorkGuard(ctx, 'SwapOptimizeTransactions');
  const symmetryCost = g.CellSize;
  let swapMade = false;

  const measure = (n) => {
    let l = nodeEdgeLength(ctx, n, swapScoring());
    const crossingCost = columnCrossingCost(ctx, n, null);
    const symmetry = nodeSymmetryExport(ctx, n, null);
    l += crossingCost;
    l -= symmetry * symmetryCost * n.Edges.length;
    return l;
  };

  const [txn, txnErr] = g.NewRequestTransaction(ctx, { AffectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }
  // Go ranges over the slice header captured at loop entry.
  const count = nodes.length;
  for (let index = 0; index < count; index++) {
    const node = nodes[index];
    if (g.NodeToTree.has(node)) {
      continue;
    }
    if (node.Hierarchy != null) {
      continue;
    }
    if (node.FixedTopLeft != null) {
      continue;
    }
    if (node.Edges.length === 0 && !hasLeakyEdge(node)) {
      continue;
    }

    let bestSmartSwapped = false;
    let bestSwapCandidate = null;
    let bestSwapEdgeLength = Infinity;

    const currentGlobalL = edgeLength(ctx, g, swapScoring());
    const currentL1 = measure(node);
    const currentCrossings = graphEdgeCrossings(ctx, g);

    // Go ranges over g.Containers[node.Container] captured at loop entry.
    const siblings = g.Containers.get(node.Container ?? null) ?? [];
    const siblingCount = siblings.length;
    for (let s = 0; s < siblingCount; s++) {
      const swapCandidate = siblings[s];
      if (swapCandidate === node) {
        continue;
      }
      if (g.NodeToTree.has(swapCandidate)) {
        continue;
      }
      if (swapCandidate.Hierarchy != null) {
        continue;
      }
      if (swapCandidate.FixedTopLeft != null) {
        continue;
      }

      txn.AddOp(() => {
        swapPositions(node, swapCandidate);
        return null;
      });

      let swappedL1 = 0;
      let swappedGlobalL = 0;
      let swappedCrossings = 0;
      let err = txn.Commit(ctx);
      if (err == null) {
        try {
          swappedL1 = measure(node);
          swappedGlobalL = edgeLength(ctx, g, swapScoring());
          swappedCrossings = graphEdgeCrossings(ctx, g);
        } catch (scoreErr) {
          txn.Rollback();
          txn.Clear();
          throw scoreErr;
        }
      } else if (!isCandidateRejection(err)) {
        throw err;
      }

      txn.Rollback();
      txn.Clear();

      txn.AddOp(() => {
        smartSwapPositions(node, swapCandidate);
        return null;
      });

      err = txn.Commit(ctx);

      let smartSwappedL1 = 0;
      let smartSwappedGlobalL = 0;
      let smartSwappedCrossings = 0;
      if (err == null) {
        try {
          smartSwappedL1 = measure(node);
          smartSwappedGlobalL = edgeLength(ctx, g, swapScoring());
          smartSwappedCrossings = graphEdgeCrossings(ctx, g);
        } catch (scoreErr) {
          txn.Rollback();
          txn.Clear();
          throw scoreErr;
        }
      } else if (!isCandidateRejection(err)) {
        throw err;
      }

      txn.Rollback();
      txn.Clear();

      if (swappedGlobalL === 0 && smartSwappedGlobalL === 0) {
        continue;
      }
      if (swappedL1 !== 0 && smartSwappedL1 === 0) {
        if (swappedCrossings <= currentCrossings && precisionCompare(swappedL1, currentL1, PRECISION) < 0 && precisionCompare(swappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(swappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
          bestSwapEdgeLength = swappedGlobalL;
          bestSmartSwapped = false;
          bestSwapCandidate = swapCandidate;
        }
      } else if (smartSwappedL1 !== 0 && swappedL1 === 0) {
        if (smartSwappedCrossings <= currentCrossings && precisionCompare(smartSwappedL1, currentL1, PRECISION) < 0 && precisionCompare(smartSwappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(smartSwappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
          bestSwapEdgeLength = smartSwappedGlobalL;
          bestSmartSwapped = true;
          bestSwapCandidate = swapCandidate;
        }
      } else if (swappedL1 !== 0 && smartSwappedL1 !== 0) {
        if (precisionCompare(smartSwappedL1, swappedL1, PRECISION) < 0) {
          if (smartSwappedCrossings <= currentCrossings && precisionCompare(smartSwappedL1, currentL1, PRECISION) < 0 && precisionCompare(smartSwappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(smartSwappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
            bestSwapEdgeLength = smartSwappedGlobalL;
            bestSmartSwapped = true;
            bestSwapCandidate = swapCandidate;
          }
        } else if (swappedCrossings <= currentCrossings && precisionCompare(swappedL1, currentL1, PRECISION) < 0 && precisionCompare(swappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(swappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
          bestSwapEdgeLength = swappedGlobalL;
          bestSmartSwapped = false;
          bestSwapCandidate = swapCandidate;
        }
      } else if (swappedGlobalL !== 0 && smartSwappedGlobalL === 0) {
        // Both L1 values can be 0 for a bare container: compare globals.
        if (swappedCrossings <= currentCrossings && precisionCompare(swappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(swappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
          bestSwapEdgeLength = swappedGlobalL;
          bestSmartSwapped = false;
          bestSwapCandidate = swapCandidate;
        }
      } else if (swappedGlobalL === 0 && smartSwappedGlobalL !== 0) {
        if (smartSwappedCrossings <= currentCrossings && precisionCompare(smartSwappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(smartSwappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
          bestSwapEdgeLength = smartSwappedGlobalL;
          bestSmartSwapped = true;
          bestSwapCandidate = swapCandidate;
        }
      } else if (precisionCompare(swappedGlobalL, smartSwappedGlobalL, PRECISION) < 0) {
        if (swappedCrossings <= currentCrossings && precisionCompare(swappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(swappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
          bestSwapEdgeLength = swappedGlobalL;
          bestSmartSwapped = false;
          bestSwapCandidate = swapCandidate;
        }
      } else if (smartSwappedCrossings <= currentCrossings && precisionCompare(smartSwappedGlobalL, currentGlobalL, PRECISION) < 0 && precisionCompare(smartSwappedGlobalL, bestSwapEdgeLength, PRECISION) < 0) {
        bestSwapEdgeLength = smartSwappedGlobalL;
        bestSmartSwapped = true;
        bestSwapCandidate = swapCandidate;
      }
    }

    if (bestSwapCandidate != null) {
      swapMade = true;
      const candidate = bestSwapCandidate;
      const smart = bestSmartSwapped;
      txn.AddOp(() => {
        if (smart) {
          smartSwapPositions(node, candidate);
        } else {
          swapPositions(node, candidate);
        }
        return null;
      });
      const commitErr = txn.Commit(ctx);
      if (commitErr != null) {
        throw commitErr;
      }
      txn.Clear();
      const stateErr = txn.UpdateState();
      if (stateErr != null) {
        throw stateErr;
      }
    }
  }

  return swapMade;
}
