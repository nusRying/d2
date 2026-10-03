/**
 * Align and Swap placement stage wrappers.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/stages.go (Align, Swap)
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { alignAxes } from './alignment.js';
import { direct } from './direct.js';
import { swapOptimize } from './swap.js';

/**
 * Align runs up to 100 alignAxes passes over one shared transaction until a
 * pass reports no change. Not atomic (pinned Go keeps committed passes).
 *
 * Pinned Go: placement.Align
 * Errors throw.
 */
export function align(ctx, graph) {
  [ctx] = ensureTransactionWorkGuard(ctx, 'AlignAxesTransactions');
  if (graph.CellSize === 0) {
    graph.computeCellSize();
  }
  const [txn, txnErr] = graph.NewRequestTransaction(ctx, { AffectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }
  for (let i = 0; i < 100; i++) {
    const changed = alignAxes(ctx, graph, txn);
    if (!changed) {
      break;
    }
  }
}

export const Align = align;

/**
 * Swap runs up to four swapOptimize passes, then mirrors the whole graph
 * toward its dominant direction when that does not lengthen edges.
 *
 * Pinned Go: placement.Swap
 * Errors throw.
 */
export function swap(ctx, graph) {
  [ctx] = ensureTransactionWorkGuard(ctx, 'SwapStuffTransactions');
  graph.computeCellSize();
  for (let i = 0; i < 4; i++) {
    const changed = swapOptimize(ctx, graph.Nodes, graph);
    if (!changed) {
      break;
    }
  }
  direct(ctx, graph, graph.Nodes, null, { checkEdgeLength: true });
}

export const Swap = swap;
