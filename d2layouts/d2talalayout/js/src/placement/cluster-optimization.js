import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { MAX_TOPOLOGY_REFERENCES } from '../limits/constants.js';
import { edgeLength } from '../placementcost/graph.js';
import { clusterExternalConnectedNodes } from './cluster-connections.js';
import { axisForArrangement, TraversalDirection } from './axis.js';
import { reduceGapToNeighbors } from './gap-reduction.js';
import { isCandidateRejection, restoreGraphState } from '../graph/transaction.js';
import { ClusterArrangement } from '../graph/cluster.js';
import { paddingBetween } from '../grouping/clusters-orchestration.js';
import { goRound, precisionCompare, PRECISION } from '../geometry/math.js';
import { Orientation } from '../geometry/orientation.js';

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

  capturePlacementCosts(guard) {
    if (this.costs != null) {
      return;
    }
    const cacheEntries = typeof this.graph.edgeLengthCacheEntries === 'function'
      ? this.graph.edgeLengthCacheEntries()
      : 0;
    if (BigInt(cacheEntries) > BigInt(MAX_TOPOLOGY_REFERENCES)) {
      throw new Error(`TALA OptimizeClustersTransactions edge-length cache entries exceed limit ${MAX_TOPOLOGY_REFERENCES}`);
    }
    if (guard) {
      for (let i = 0; i < cacheEntries; i++) {
        guard.step();
      }
      guard.finish();
    }
    this.costs = typeof this.graph.snapshotPlacementCosts === 'function'
      ? this.graph.snapshotPlacementCosts()
      : null;
  }

  restore() {
    if (this.graphState != null) {
      restoreGraphState(this.graph, this.graphState);
    }
    if (this.desiredArrangement.set && this.desiredArrangement.cluster) {
      this.desiredArrangement.cluster.DesiredArrangement = this.desiredArrangement.arrangement;
    }
    this.graph.CellSize = this.cellSize;
    if (this.costs != null && typeof this.costs.restore === 'function') {
      this.costs.restore();
    }
  }
}

/**
 * alignConnectedNodes aligns connected external nodes with cluster center.
 * Pinned Go: placement.alignConnectedNodes
 *
 * @param {import('../graph/cluster.js').Cluster} c
 * @param {boolean} horizontally
 */
export function alignConnectedNodes(c, horizontally) {
  const externalNodes = clusterExternalConnectedNodes(c);
  if (!externalNodes || externalNodes.length === 0) {
    return;
  }

  for (let i = 0; i < externalNodes.length; i++) {
    const n = externalNodes[i];
    if (n.FixedTopLeft != null) {
      continue;
    }
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
 *
 * @param {import('../graph/cluster.js').Cluster} c
 * @param {boolean} horizontally
 */
export function alignVessel(c, horizontally) {
  const externalNodes = clusterExternalConnectedNodes(c);
  if (!externalNodes || externalNodes.length === 0) {
    return;
  }

  let avgExternalX = 0;
  let avgExternalY = 0;
  for (let i = 0; i < externalNodes.length; i++) {
    const center = externalNodes[i].center();
    avgExternalX += center.X;
    avgExternalY += center.Y;
  }
  avgExternalX /= externalNodes.length;
  avgExternalY /= externalNodes.length;

  let xDelta = 0;
  let yDelta = 0;
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
 *
 * @param {object} ctx
 * @param {import('../graph/cluster.js').Cluster} c
 * @param {boolean} onlyFlip
 * @returns {boolean}
 */
export function optimizeCluster(ctx, c, onlyFlip) {
  return optimizeClusterWithRollback(ctx, c, onlyFlip, null);
}

export const OptimizeCluster = optimizeCluster;

/**
 * optimizeClusterWithRollback optimizes cluster orientation/alignment with optional rollback journaling.
 * Pinned Go: placement.optimizeClusterWithRollback
 *
 * @param {object} ctx
 * @param {import('../graph/cluster.js').Cluster} c
 * @param {boolean} onlyFlip
 * @param {OptimizeClustersRollback|null} rollback
 * @returns {boolean}
 */
export function optimizeClusterWithRollback(ctx, c, onlyFlip, rollback = null) {
  const [, guard] = ensureTransactionWorkGuard(ctx, 'OptimizeClusterTransactions');

  let horizontalCount = 0;
  let verticalCount = 0;
  let changed = false;

  const externalNodes = clusterExternalConnectedNodes(c);
  for (let i = 0; i < externalNodes.length; i++) {
    const externalNode = externalNodes[i];
    const orientation = c.Vessel.orientation(externalNode);
    if (orientation === Orientation.None) {
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
        const xDist = Math.abs(externalNode.center().X - c.Vessel.center().X);
        const yDist = Math.abs(externalNode.center().Y - c.Vessel.center().Y);
        if (xDist > yDist) {
          horizontalCount++;
        } else if (yDist > xDist) {
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
    const [t, tErr] = c.Graph.newRequestTransaction(ctx, { affectContainers: true });
    if (tErr != null) {
      throw tErr;
    }
    txn = t;

    if (rollback != null) {
      ownsRollbackState = rollback.recordGraphState(txn);
    }

    let tryCenter = true;
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
            const [, originalHeight] = txn.originalDimensions(c.Vessel);
            const heightDelta = originalHeight - c.Vessel.Height;
            c.Vessel.moveWithChildren(0, goRound(heightDelta / 2));
            break;
          }
          case ClusterArrangement.Row: {
            const [originalWidth] = txn.originalDimensions(c.Vessel);
            const widthDelta = originalWidth - c.Vessel.Width;
            c.Vessel.moveWithChildren(goRound(widthDelta / 2), 0);
            break;
          }
        }
      }

      if (c.Container != null && c.Container.TopLeft != null) {
        const children = c.Graph.Containers instanceof Map
          ? (c.Graph.Containers.get(c.Container) || [])
          : (c.Graph.Containers?.[c.Container] || []);

        const [childrenTL, childrenBR] = c.Container.fixedBoundingBox
          ? c.Container.fixedBoundingBox()
          : [c.Container.TopLeft, c.Container.BottomRight()];
        const padding = c.Graph.containerPadding(c.Container, false);
        c.Container.fitToBoundingBox(childrenTL, childrenBR, padding);
        c.Container.positionContainerChildren(true);
      }
    });

    const commitErr = txn.commit(ctx);
    if (commitErr != null) {
      if (!isCandidateRejection(commitErr)) {
        throw commitErr;
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

    txn.updateState();
    txn.clear();
    changed = true;
  }

  if (!onlyFlip && c.Arrangement === desiredArrangement) {
    if (txn == null) {
      const [t, tErr] = c.Graph.newRequestTransaction(ctx, { affectContainers: true });
      if (tErr != null) {
        throw tErr;
      }
      txn = t;
      if (rollback != null) {
        ownsRollbackState = rollback.recordGraphState(txn);
      }
    }

    if (rollback != null) {
      rollback.capturePlacementCosts(guard);
    }

    let bestLength = edgeLength(ctx, c.Graph, {
      EdgeAbductions: null,
      IncludeNodeSizes: true,
      EnforceMinimumGap: false,
      PenalizeDirection: true,
    });
    let moveVessel = false;
    let moveNodes = false;

    txn.addOp(() => {
      switch (c.Arrangement) {
        case ClusterArrangement.Column:
          alignVessel(c, false);
          break;
        case ClusterArrangement.Row:
          alignVessel(c, true);
          break;
      }
    });

    const vesselErr = txn.commit(ctx);
    if (vesselErr == null) {
      const length = edgeLength(ctx, c.Graph, {
        EdgeAbductions: null,
        IncludeNodeSizes: true,
        EnforceMinimumGap: false,
        PenalizeDirection: true,
      });
      if (precisionCompare(length, bestLength, PRECISION) < 0) {
        bestLength = length;
        moveVessel = true;
      }
    } else if (!isCandidateRejection(vesselErr)) {
      throw vesselErr;
    }
    txn.rollback();
    txn.clear();

    txn.addOp(() => {
      switch (c.Arrangement) {
        case ClusterArrangement.Column:
          alignConnectedNodes(c, false);
          break;
        case ClusterArrangement.Row:
          alignConnectedNodes(c, true);
          break;
      }
    });

    const nodesErr = txn.commit(ctx);
    if (nodesErr == null) {
      const length = edgeLength(ctx, c.Graph, {
        EdgeAbductions: null,
        IncludeNodeSizes: true,
        EnforceMinimumGap: false,
        PenalizeDirection: true,
      });
      if (precisionCompare(length, bestLength, PRECISION) < 0) {
        moveNodes = true;
      }
    } else if (!isCandidateRejection(nodesErr)) {
      throw nodesErr;
    }
    txn.rollback();
    txn.clear();

    if (moveNodes) {
      txn.addOp(() => {
        switch (c.Arrangement) {
          case ClusterArrangement.Column:
            alignConnectedNodes(c, false);
            break;
          case ClusterArrangement.Row:
            alignConnectedNodes(c, true);
            break;
        }
      });
      const cErr = txn.commit(ctx);
      if (cErr != null) {
        throw cErr;
      }
      changed = true;
    } else if (moveVessel) {
      txn.addOp(() => {
        switch (c.Arrangement) {
          case ClusterArrangement.Column:
            alignVessel(c, false);
            break;
          case ClusterArrangement.Row:
            alignVessel(c, true);
            break;
        }
      });
      const cErr = txn.commit(ctx);
      if (cErr != null) {
        throw cErr;
      }
      changed = true;
    }

    if (moveNodes || moveVessel) {
      txn.clear();
      if (ownsRollbackState) {
        const [clonedTxn, cloneErr] = txn.cloneGeometryContext();
        if (cloneErr != null) {
          throw cloneErr;
        }
        txn = clonedTxn;
      }
      txn.updateState();
      txn.addOp(() => {
        reduceGapToNeighbors(ctx, c.Vessel, null, {
          axis: axisForArrangement(c.Arrangement),
          direction: TraversalDirection.Forward,
          attemptRecoverSymmetry: true,
        });
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
 * optimizeClustersAtomic executes cluster optimization with all-or-nothing rollback semantics.
 * Pinned Go: placement.optimizeClustersAtomic
 *
 * @param {object} ctx
 * @param {import('../graph/graph.js').Graph} g
 * @param {import('../graph/node.js').Node[]} order
 * @returns {boolean}
 */
export function optimizeClustersAtomic(ctx, g, order) {
  const rollback = new OptimizeClustersRollback(g, g.CellSize);
  let complete = false;

  try {
    let changed = false;
    for (let i = 0; i < order.length; i++) {
      const vessel = order[i];
      const cluster = g.Clusters instanceof Map ? g.Clusters.get(vessel) : g.Clusters?.[vessel];
      if (cluster) {
        const changed2 = optimizeClusterWithRollback(ctx, cluster, false, rollback);
        if (changed2) {
          changed = true;
        }
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
 * OptimizeClusters optimizes all clusters in graph in RDFS order.
 * Pinned Go: placement.OptimizeClusters
 *
 * @param {object} ctx
 * @param {import('../graph/graph.js').Graph} g
 * @returns {boolean}
 */
export function optimizeClusters(ctx, g) {
  ensureTransactionWorkGuard(ctx, 'OptimizeClustersTransactions');
  const order = typeof g.clusterRDFSOrder === 'function'
    ? g.clusterRDFSOrder()
    : (g.ClusterRDFSOrder ? g.ClusterRDFSOrder() : []);
  if (!order || order.length === 0) {
    return false;
  }
  return optimizeClustersAtomic(ctx, g, order);
}

export const OptimizeClusters = optimizeClusters;
