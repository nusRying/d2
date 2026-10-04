/**
 * Dependency-closed placement stage wrappers.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/stages.go
 *   NormalizeGaps, TransposeAll
 * (Normalize and Pad live in stage-geometry.js since Slice 40.)
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { newRequestTransaction, restoreGraphState } from '../graph/transaction.js';
import { LayoutAxis, TraversalDirection } from './axis.js';
import { gapNormalization } from './gap-reduction.js';
import { transpose } from './transpose.js';

/**
 * NormalizeGaps runs bidirectional gap normalization for every container (in
 * reverse DFS order) and then the whole graph, horizontally then vertically.
 * The stage is atomic: any failure restores geometry, CellSize, and either the
 * captured placement costs or the entry routing costs.
 *
 * Pinned Go: placement.NormalizeGaps
 * @returns {boolean} changed. Errors throw.
 */
export function normalizeGaps(ctx, graph) {
  let guard;
  [ctx, guard] = ensureTransactionWorkGuard(ctx, 'GapNormalizationTransactions');
  const [txn, txnErr] = newRequestTransaction(graph, ctx, { AffectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }
  const rollback = {
    graphState: txn.PreservePriorGraphState(),
    cellSize: graph.CellSize,
    routingCosts: graph.routingCosts(),
  };
  let complete = false;
  try {
    const bidirectional = (nodes, axis) => {
      const forward = gapNormalization(ctx, nodes, txn, graph, {
        axis,
        direction: TraversalDirection.Forward,
        costTxn: txn,
      });
      const backward = gapNormalization(ctx, nodes, txn, graph, {
        axis,
        direction: TraversalDirection.Backward,
        costTxn: txn,
      });
      return forward || backward;
    };
    let changed = false;
    const containers = graph.ContainerRDFSOrder(null, guard);
    for (const container of containers) {
      const nodes = graph.allDescendantNodes(container, false);
      for (const axis of [LayoutAxis.Horizontal, LayoutAxis.Vertical]) {
        const current = bidirectional(nodes, axis);
        changed = changed || current;
      }
    }
    for (const axis of [LayoutAxis.Horizontal, LayoutAxis.Vertical]) {
      const current = bidirectional(graph.Nodes, axis);
      changed = changed || current;
    }
    graph.resetTurnCost();
    graph.syncSequences();
    graph.syncClusters();
    guard.Finish();
    complete = true;
    return changed;
  } finally {
    if (!complete) {
      restoreGraphState(graph, rollback.graphState);
      graph.CellSize = rollback.cellSize;
      if (!txn.RestorePlacementCosts()) {
        graph.restoreRoutingCosts(rollback.routingCosts);
      }
    }
  }
}

export const NormalizeGaps = normalizeGaps;

/**
 * TransposeAll tries transpose on every graph node in source order, sharing
 * one transaction budget.
 *
 * Pinned Go: placement.TransposeAll
 */
export function transposeAll(ctx, graph) {
  [ctx] = ensureTransactionWorkGuard(ctx, 'TransposeStageTransactions');
  graph.computeCellSize();
  // Go ranges over the slice header captured at loop entry.
  const nodes = graph.Nodes;
  const count = nodes.length;
  for (let i = 0; i < count; i++) {
    transpose(ctx, graph, nodes[i], null);
  }
}

export const TransposeAll = transposeAll;
