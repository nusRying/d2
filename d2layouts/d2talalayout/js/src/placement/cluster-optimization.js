/**
 * Cluster optimization — flip clusters perpendicular to their connections and
 * align them with their external neighbors.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/cluster_optimization.go
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * Errors throw. Every nested transaction, score, and gap reduction runs under
 * the context returned by EnsureTransactionWorkGuard so a stage shares one
 * transaction budget.
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { MAX_TOPOLOGY_REFERENCES } from '../limits/constants.js';
import { edgeLength } from '../placementcost/graph.js';
import { clusterExternalConnectedNodes } from './cluster-connections.js';
import { axisForArrangement, TraversalDirection } from './axis.js';
import { reduceGapToNeighbors } from './gap-reduction.js';
import { isCandidateRejection, restoreGraphState } from '../graph/transaction.js';
import { ClusterArrangement } from '../graph/cluster.js';
import { nodesFixedBounds } from '../graph/node-bounds.js';
import { paddingBetween } from '../grouping/clusters-orchestration.js';
import { goRound, precisionCompare, PRECISION } from '../geometry/math.js';
import { Orientation } from '../geometry/orientation.js';

const SCORING_OPTIONS = Object.freeze({
  EdgeAbductions: null,
  IncludeNodeSizes: true,
  EnforceMinimumGap: false,
  PenalizeDirection: true,
});

/**
 * Stage-owned rollback journal for OptimizeClusters.
 * Pinned Go: placement.optimizeClustersRollback
 */
export class OptimizeClustersRollback {
  constructor(graph, cellSize) {
    this.graph = graph;
    this.cellSize = cellSize;
    this.graphState = null;
    this.desiredArrangement = {
      cluster: null,
      arrangement: null,
      set: false,
    };
    this.costs = null;
  }

  recordDesiredArrangement(cluster, arrangement) {
    // The first transaction snapshot contains every later cluster's entry value.
    // Only a change made before that snapshot exists needs a separate journal.
    if (this.graphState != null || this.desiredArrangement.set || cluster.DesiredArrangement === arrangement) {
      return;
    }
    this.desiredArrangement = {
      cluster,
      arrangement: cluster.DesiredArrangement,
      set: true,
    };
  }

  recordGraphState(txn) {
    if (this.graphState != null) {
      return false;
    }
    this.graphState = txn.PriorGraphState;
    return true;
  }

  /** WorkGuard failures throw. */
  capturePlacementCosts(guard) {
    if (this.costs != null) {
      return;
    }
    const cacheEntries = this.graph.edgeLengthCacheEntries();
    if (cacheEntries > MAX_TOPOLOGY_REFERENCES) {
      throw new Error(`TALA OptimizeClustersTransactions edge-length cache entries exceed limit ${MAX_TOPOLOGY_REFERENCES}`);
    }
    for (let i = 0; i < cacheEntries; i++) {
      guard.Step();
    }
    const costs = this.graph.snapshotPlacementCosts();
    guard.Finish();
    this.costs = costs;
  }

  restore() {
    if (this.graphState != null) {
      restoreGraphState(this.graph, this.graphState);
    }
    if (this.desiredArrangement.set) {
      this.desiredArrangement.cluster.DesiredArrangement = this.desiredArrangement.arrangement;
    }
    this.graph.CellSize = this.cellSize;
    if (this.costs != null) {
      this.costs.restore();
    }
  }
}

/**
 * alignConnectedNodes aligns connected external nodes with cluster center.
 * Pinned Go: placement.alignConnectedNodes
 */
export function alignConnectedNodes(c, horizontally) {
  const externalNodes = clusterExternalConnectedNodes(c);
  if (externalNodes.length === 0) {
    return;
  }

  // align every node center with cluster center
  for (const n of externalNodes) {
    if (n.FixedTopLeft != null) {
      continue;
    }
    // Don't want it to travel too far
    if (!n.overlapsAlongDimension(c.Vessel, !horizontally, true)) {
      continue;
    }
    let xDelta = 0;
    let yDelta = 0;
    if (horizontally) {
      xDelta = goRound(c.Vessel.TopLeft.X + c.Vessel.Width / 2 - n.TopLeft.X - n.Width / 2);
    } else {
      yDelta = goRound(c.Vessel.TopLeft.Y + c.Vessel.Height / 2 - n.TopLeft.Y - n.Height / 2);
    }
    n.moveWithChildren(xDelta, yDelta);
  }
}

export const AlignConnectedNodes = alignConnectedNodes;

/**
 * alignVessel aligns cluster vessel with the average center of connected external nodes.
 * Pinned Go: placement.alignVessel
 */
export function alignVessel(c, horizontally) {
  const externalNodes = clusterExternalConnectedNodes(c);
  if (externalNodes.length === 0) {
    return;
  }

  let avgExternalX = 0;
  let avgExternalY = 0;
  for (const n of externalNodes) {
    avgExternalX += n.center().X;
    avgExternalY += n.center().Y;
  }
  avgExternalX /= externalNodes.length;
  avgExternalY /= externalNodes.length;

  let xDelta = 0;
  let yDelta = 0;
  // align cluster center with avg external node center
  if (horizontally) {
    xDelta = avgExternalX - c.Vessel.Width / 2 - c.Vessel.TopLeft.X;
  } else {
    yDelta = avgExternalY - c.Vessel.Height / 2 - c.Vessel.TopLeft.Y;
  }

  c.Vessel.TopLeft.X += goRound(xDelta);
  c.Vessel.TopLeft.Y += goRound(yDelta);
}

export const AlignVessel = alignVessel;

/**
 * optimizeCluster optimizes a single cluster's orientation and alignment.
 * Pinned Go: placement.optimizeCluster
 * @returns {boolean}
 */
export function optimizeCluster(ctx, c, onlyFlip) {
  return optimizeClusterWithRollback(ctx, c, onlyFlip, null);
}

export const OptimizeCluster = optimizeCluster;

function alignOp(c, align) {
  return () => {
    switch (c.Arrangement) {
      case ClusterArrangement.Column:
        align(c, false);
        break;
      case ClusterArrangement.Row:
        align(c, true);
        break;
    }
    return null;
  };
}

/**
 * optimizeClusterWithRollback optimizes cluster orientation/alignment with
 * optional stage rollback journaling.
 *
 * Pinned Go: placement.optimizeClusterWithRollback
 * @returns {boolean} changed. Errors throw (Go returns them with `changed`;
 *   every Go caller discards `changed` on error).
 */
export function optimizeClusterWithRollback(ctx, c, onlyFlip, rollback = null) {
  let guard;
  [ctx, guard] = ensureTransactionWorkGuard(ctx, 'OptimizeClusterTransactions');
  let horizontalCount = 0;
  let verticalCount = 0;
  let changed = false;
  for (const externalNode of clusterExternalConnectedNodes(c)) {
    const orientation = c.Vessel.orientation(externalNode);
    if (orientation === Orientation.NONE) {
      continue;
    }

    switch (orientation) {
      case Orientation.Left:
      case Orientation.Right:
        horizontalCount++;
        break;
      case Orientation.Top:
      case Orientation.Bottom:
        verticalCount++;
        break;
      default: {
        // Diagonal
        const xDistance = Math.abs(externalNode.center().X - c.Vessel.center().X);
        const yDistance = Math.abs(externalNode.center().Y - c.Vessel.center().Y);
        if (xDistance > yDistance) {
          horizontalCount++;
        } else if (yDistance > xDistance) {
          verticalCount++;
        }
        break;
      }
    }
  }

  let desiredArrangement = c.DesiredArrangement;
  if (verticalCount > horizontalCount) {
    desiredArrangement = ClusterArrangement.Row;
  } else if (horizontalCount > verticalCount) {
    desiredArrangement = ClusterArrangement.Column;
  }
  if (rollback != null) {
    rollback.recordDesiredArrangement(c, desiredArrangement);
  }
  c.DesiredArrangement = desiredArrangement;

  let txn = null;
  let ownsRollbackState = false;
  if (c.Arrangement !== desiredArrangement) {
    const [created, transactionErr] = c.Graph.newRequestTransaction(ctx, { AffectContainers: true });
    if (transactionErr != null) {
      throw transactionErr;
    }
    txn = created;
    if (rollback != null) {
      ownsRollbackState = rollback.recordGraphState(txn);
    }
    // first try flipping around center, if that fails try flipping around top left
    let tryCenter = true;
    const flipTxn = txn;
    txn.addOp(() => {
      switch (c.Arrangement) {
        case ClusterArrangement.Column:
          c.Arrangement = ClusterArrangement.Row;
          break;
        case ClusterArrangement.Row:
          c.Arrangement = ClusterArrangement.Column;
          break;
      }
      c.Padding = paddingBetween(c, true);
      c.syncGeometry();

      if (tryCenter) {
        switch (c.Arrangement) {
          case ClusterArrangement.Column: {
            const [, originalHeight] = flipTxn.originalDimensions(c.Vessel);
            const heightDelta = originalHeight - c.Vessel.Height;
            c.Vessel.moveWithChildren(0, goRound(heightDelta / 2));
            break;
          }
          case ClusterArrangement.Row: {
            const [originalWidth] = flipTxn.originalDimensions(c.Vessel);
            const widthDelta = originalWidth - c.Vessel.Width;
            c.Vessel.moveWithChildren(goRound(widthDelta / 2), 0);
            break;
          }
        }
      }

      if (c.Container != null && c.Container.TopLeft != null) {
        const children = c.Graph.Containers.get(c.Container) ?? [];
        const [childrenTL, childrenBR] = nodesFixedBounds(children);
        const padding = c.Graph.containerPadding(c.Container, false);
        c.Container.fitToBoundingBox(childrenTL, childrenBR, padding);
        c.Container.positionContainerChildren(true);
      }
      return null;
    });
    const err = txn.commit(ctx);
    if (err != null) {
      if (!isCandidateRejection(err)) {
        throw err;
      }
      tryCenter = false;
      const retryErr = txn.commit(ctx);
      if (retryErr != null) {
        if (!isCandidateRejection(retryErr)) {
          throw retryErr;
        }
        return changed;
      }
    }
    const updateErr = txn.updateState(); // refresh-site: after-flip
    if (updateErr != null) {
      throw updateErr;
    }
    txn.clear();
    changed = true;
  }

  if (!onlyFlip && c.Arrangement === desiredArrangement) {
    // There's two ways alignment can happen, vessel moves or external nodes move
    // First try vessel move
    if (txn == null) {
      const [created, transactionErr] = c.Graph.newRequestTransaction(ctx, { AffectContainers: true });
      if (transactionErr != null) {
        throw transactionErr;
      }
      txn = created;
      if (rollback != null) {
        ownsRollbackState = rollback.recordGraphState(txn);
      }
    }
    if (rollback != null) {
      rollback.capturePlacementCosts(guard);
    }
    let bestLength = edgeLength(ctx, c.Graph, SCORING_OPTIONS);
    let moveVessel = false;
    let moveNodes = false;

    txn.addOp(alignOp(c, alignVessel));
    let err = txn.commit(ctx);
    if (err == null) {
      let length;
      try {
        length = edgeLength(ctx, c.Graph, SCORING_OPTIONS);
      } catch (scoreErr) {
        txn.rollback();
        txn.clear();
        throw scoreErr;
      }
      if (precisionCompare(length, bestLength, PRECISION) < 0) {
        bestLength = length;
        moveVessel = true;
      }
    } else if (!isCandidateRejection(err)) {
      throw err;
    }
    txn.rollback();
    txn.clear();

    txn.addOp(alignOp(c, alignConnectedNodes));
    err = txn.commit(ctx);
    if (err == null) {
      let length;
      try {
        length = edgeLength(ctx, c.Graph, SCORING_OPTIONS);
      } catch (scoreErr) {
        txn.rollback();
        txn.clear();
        throw scoreErr;
      }
      if (precisionCompare(length, bestLength, PRECISION) < 0) {
        moveNodes = true;
      }
    } else if (!isCandidateRejection(err)) {
      throw err;
    }
    txn.rollback();
    txn.clear();

    if (moveNodes) {
      txn.addOp(alignOp(c, alignConnectedNodes));
      const replayErr = txn.commit(ctx);
      if (replayErr != null) {
        throw replayErr;
      }
      changed = true;
    } else if (moveVessel) {
      txn.addOp(alignOp(c, alignVessel));
      const replayErr = txn.commit(ctx);
      if (replayErr != null) {
        throw replayErr;
      }
      changed = true;
    }

    if (moveNodes || moveVessel) {
      // after flipping we may need to pull connected nodes closer
      txn.clear();
      if (ownsRollbackState) {
        // The first transaction's original graph state is the stage rollback
        // point. Detach before a second refresh could recycle that state as
        // transaction scratch.
        const [cloned, cloneErr] = txn.cloneGeometryContext();
        if (cloneErr != null) {
          throw cloneErr;
        }
        txn = cloned;
      }
      const updateErr = txn.updateState(); // refresh-site: before-gap-reduction
      if (updateErr != null) {
        throw updateErr;
      }
      txn.addOp(() => {
        reduceGapToNeighbors(ctx, c.Vessel, null, {
          axis: axisForArrangement(c.Arrangement),
          direction: TraversalDirection.Forward,
          attemptRecoverSymmetry: true,
        });
        return null;
      });
      const gapErr = txn.commit(ctx);
      if (gapErr != null && !isCandidateRejection(gapErr)) {
        throw gapErr;
      }
    }
  }

  return changed;
}

export const OptimizeClusterWithRollback = optimizeClusterWithRollback;

/**
 * optimizeClustersAtomic executes cluster optimization with all-or-nothing
 * rollback: a failure in a later cluster restores mutations accepted for
 * earlier clusters, the computed CellSize, and placement costs.
 *
 * Pinned Go: placement.optimizeClustersAtomic
 * @returns {boolean}
 */
export function optimizeClustersAtomic(ctx, g, order) {
  const rollback = new OptimizeClustersRollback(g, g.CellSize);
  let complete = false;
  try {
    let changed = false;
    for (const vessel of order) {
      const cluster = g.Clusters.get(vessel);
      if (optimizeClusterWithRollback(ctx, cluster, false, rollback)) {
        changed = true;
      }
    }
    complete = true;
    return changed;
  } finally {
    if (!complete) {
      rollback.restore();
    }
  }
}

export const OptimizeClustersAtomic = optimizeClustersAtomic;

/**
 * OptimizeClusters makes clusters horizontal if cluster connections are above
 * or below the cluster.
 *
 * Pinned Go: placement.OptimizeClusters
 * @returns {boolean}
 */
export function optimizeClusters(ctx, g) {
  [ctx] = ensureTransactionWorkGuard(ctx, 'OptimizeClustersTransactions');
  const order = g.clusterRDFSOrder();
  if (order.length === 0) {
    return false;
  }
  return optimizeClustersAtomic(ctx, g, order);
}

export const OptimizeClusters = optimizeClusters;
