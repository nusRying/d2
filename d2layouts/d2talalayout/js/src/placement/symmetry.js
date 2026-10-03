/**
 * BalanceSymmetry — center simple nodes among neighbors aligned on one side.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/symmetry.go
 *   BalanceSymmetry, isSimple
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { isVertical, sameSide } from '../geometry/orientation.js';
import { isCandidateRejection, restoreGraphState } from '../graph/transaction.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { axisScore } from '../placementcost/axis.js';
import { nodesCenter } from './stage-support.js';

/**
 * BalanceSymmetry nudges each simple node with two or more same-side,
 * evenly sized, axis-aligned adjacents to the middle of that alignment.
 * Atomic: a later failure restores the first transaction's rollback point.
 *
 * Go builds the adjacent list by ranging over a map (unordered). JS uses
 * insertion order (first-seen edge order). With exactly two adjacents every
 * consumer (AxisScore, area checks, the pair orientation, Nodes.Center) is
 * order-independent; with three or more, AxisScore's largest-node tie-break
 * and the adjacents[0]/[1] orientation can depend on Go's map order.
 *
 * Pinned Go: placement.BalanceSymmetry
 * Errors throw.
 */
export function balanceSymmetry(ctx, g) {
  let guard;
  [ctx, guard] = ensureTransactionWorkGuard(ctx, 'BalanceSymmetryTransactions');
  if (g.Nodes.length === 0) {
    return;
  }
  let rollbackState = null;
  let complete = false;
  try {
    // Gap normalization handles adjacents on opposite ends; here we only
    // nudge nodes whose adjacents are all aligned on one end.
    for (const n of g.Nodes) {
      if (!isSimple(g, n)) {
        continue;
      }
      if (n.Edges.length < 2) {
        continue;
      }
      let sameSideAll = true;
      const adjacentsM = new Set();
      for (let i = 0; i < n.Edges.length - 1; i++) {
        const e1 = n.Edges[i];
        const e2 = n.Edges[i + 1];
        if (e1.FromTableColumnIndex != null || e1.ToTableColumnIndex != null) {
          continue;
        }
        if (e2.FromTableColumnIndex != null || e2.ToTableColumnIndex != null) {
          continue;
        }
        const adj1 = n.adjacent(e1);
        const adj2 = n.adjacent(e2);
        const o1 = n.orientation(adj1);
        const o2 = n.orientation(adj2);
        if (!sameSide(o1, o2)) {
          sameSideAll = false;
          break;
        }
        adjacentsM.add(adj1);
        adjacentsM.add(adj2);
      }
      if (!sameSideAll) {
        continue;
      }
      if (adjacentsM.size < 2) {
        continue;
      }
      const adjacents = [...adjacentsM];
      if (axisScore(adjacents) !== 1) {
        continue;
      }
      // Fails to look symmetrical if uneven adjacents
      let maxArea = -Infinity;
      for (const adj of adjacents) {
        maxArea = Math.max(maxArea, adj.Width * adj.Height);
      }
      let uneven = false;
      for (const adj of adjacents) {
        if (adj.Width * adj.Height < 0.5 * maxArea) {
          uneven = true;
          break;
        }
      }
      if (uneven) {
        continue;
      }
      let horizontal = true;
      if (isVertical(adjacents[0].orientation(adjacents[1]))) {
        horizontal = false;
      }
      const [txn, txnErr] = g.NewRequestTransactionWithWorkGuard(ctx, guard, { AffectContainers: true });
      if (txnErr != null) {
        throw txnErr;
      }
      if (rollbackState == null) {
        rollbackState = txn.PriorGraphState;
      }
      txn.AddOp(() => {
        const center = nodesCenter(adjacents);
        const nCenter = n.center();
        if (horizontal) {
          n.MoveWithChildren(Math.floor(center.X - nCenter.X), 0);
        } else {
          n.MoveWithChildren(0, Math.floor(center.Y - nCenter.Y));
        }
        return null;
      });
      const commitErr = txn.Commit(ctx);
      if (commitErr != null && !isCandidateRejection(commitErr)) {
        throw commitErr;
      }
    }
    complete = true;
  } finally {
    if (!complete && rollbackState != null) {
      restoreGraphState(g, rollbackState);
    }
  }
}

export const BalanceSymmetry = balanceSymmetry;

/**
 * isSimple reports whether node participates only as a regular placement
 * node, rather than as or inside one of the engine's structured graph forms.
 *
 * Pinned Go: placement.isSimple
 */
export function isSimple(graph, node) {
  return !(node.IsContainer() || graph.isTreeSentinel(node) || node.IsClusterVessel() ||
    graph.isSequenceVessel(node) || node.Cluster != null || node.Hierarchy != null);
}
