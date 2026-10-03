/**
 * Gap reduction — pull connected neighbors closer when a large gap separates
 * them, while keeping every speculative move transactional.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/gapreduction.go
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * Errors throw. Every transaction refresh is checked; a failed refresh rolls
 * back to the previous valid rollback point (Transaction.UpdateState) and the
 * error propagates before any accepted geometry can be reported.
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { getContextError } from '../limits/work-context.js';
import { edgeLength } from '../placementcost/graph.js';
import { IDEAL_GAP_SIZE } from '../placementcost/geometry.js';
import {
  axisValid,
  axisIsHorizontal,
  directionValid,
  directionIsForward,
  oppositeDirection,
} from './axis.js';
import {
  isCandidateRejection,
  isInvalidCandidate,
  isNonImprovingCandidate,
  ErrNonImprovingCandidate,
} from '../graph/transaction.js';
import { precisionCompare, PRECISION } from '../geometry/math.js';

// Pinned Go: placement/tuning.go largeGapThreshold
const largeGapThreshold = 0.5;

const SCORING_OPTIONS = Object.freeze({
  EdgeAbductions: null,
  IncludeNodeSizes: true,
  EnforceMinimumGap: false,
  PenalizeDirection: false,
});

function compareIDs(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Assumes ahead is ahead of behind when forwards is true.
 * Pinned Go: placement.isBetween
 */
export function isBetween(node, behind, ahead, isHorizontal, forwards) {
  const delta = behind.deltaTo(node, behind.TopLeft);
  if (isHorizontal) {
    if (node.TopLeft.Y + node.Height < behind.TopLeft.Y - delta) {
      return false;
    }
    if (node.TopLeft.Y > behind.TopLeft.Y + behind.Height + delta) {
      return false;
    }
    if (!forwards) {
      [behind, ahead] = [ahead, behind];
    }
    // n is behind behind
    if (node.TopLeft.X + node.Width < behind.TopLeft.X + behind.Width) {
      return false;
    }
    // n is ahead of ahead
    if (node.TopLeft.X > ahead.TopLeft.X) {
      return false;
    }
  } else {
    if (node.TopLeft.X + node.Width < behind.TopLeft.X - delta) {
      return false;
    }
    if (node.TopLeft.X > behind.TopLeft.X + behind.Width + delta) {
      return false;
    }
    if (!forwards) {
      [behind, ahead] = [ahead, behind];
    }
    if (node.TopLeft.Y + node.Height < behind.TopLeft.Y + behind.Height) {
      return false;
    }
    if (node.TopLeft.Y > ahead.TopLeft.Y) {
      return false;
    }
  }
  return true;
}

export const IsBetween = isBetween;

/**
 * Assumes ahead is ahead of behind when forwards is true. The first node wins
 * ties, so callers must pass the order-preserving ConnectedNodes traversal.
 * Pinned Go: placement.nearestBetween
 */
export function nearestBetween(nodes, behind, ahead, inContainer, isHorizontal, forwards) {
  let nearest = null;
  for (const n of nodes) {
    if (n === behind || n === ahead) {
      continue;
    }
    if (n.owningContainer() !== inContainer) {
      continue;
    }
    if (!isBetween(n, behind, ahead, isHorizontal, forwards)) {
      continue;
    }
    if (nearest == null) {
      nearest = n;
      continue;
    }
    if (isHorizontal) {
      if (forwards) {
        if (n.TopLeft.X < nearest.TopLeft.X) {
          nearest = n;
        }
      } else if (n.TopLeft.X + n.Width > nearest.TopLeft.X + nearest.Width) {
        nearest = n;
      }
    } else if (forwards) {
      if (n.TopLeft.Y < nearest.TopLeft.Y) {
        nearest = n;
      }
    } else if (n.TopLeft.Y + n.Height > nearest.TopLeft.Y + nearest.Height) {
      nearest = n;
    }
  }
  return nearest;
}

export const NearestBetween = nearestBetween;

/**
 * nearestConnectedAhead finds the nearest connected node in the traversal
 * direction. Pinned Go: placement.nearestConnectedAhead
 */
export function nearestConnectedAhead(node, isHorizontal, forwards) {
  let nearest = null;
  for (const e of node.Edges) {
    const adj = node.adjacent(e);
    if (isHorizontal) {
      if (forwards) {
        // if adj's left is behind node's right its not ahead
        if (adj.TopLeft.X < node.TopLeft.X + node.Width) {
          continue;
        }
        if (nearest == null || adj.TopLeft.X < nearest.TopLeft.X) {
          nearest = adj;
        }
      } else {
        // if adj's right is ahead of node's left its not behind
        if (adj.TopLeft.X + adj.Width > node.TopLeft.X) {
          continue;
        }
        if (nearest == null || adj.TopLeft.X + adj.Width > nearest.TopLeft.X + nearest.Width) {
          nearest = adj;
        }
      }
    } else if (forwards) {
      if (adj.TopLeft.Y < node.TopLeft.Y + node.Height) {
        continue;
      }
      if (nearest == null || adj.TopLeft.Y < nearest.TopLeft.Y) {
        nearest = adj;
      }
    } else {
      if (adj.TopLeft.Y + adj.Height > node.TopLeft.Y) {
        continue;
      }
      if (nearest == null || adj.TopLeft.Y + adj.Height > nearest.TopLeft.Y + nearest.Height) {
        nearest = adj;
      }
    }
  }
  return nearest;
}

export const NearestConnectedAhead = nearestConnectedAhead;

function newGapTransaction(ctx, g) {
  const [txn, err] = g.newRequestTransaction(ctx, { AffectContainers: true });
  if (err != null) {
    throw err;
  }
  return txn;
}

function refresh(txn) {
  txn.clear();
  const err = txn.updateState();
  if (err != null) {
    throw err;
  }
}

/**
 * reduceGapToNeighbors attempts to reduce the gap between this node and its
 * neighbors in front of it.
 *
 * Pinned Go: placement.reduceGapToNeighbors
 * @returns {[boolean, number]} [changed, newEdgeLength]. Errors throw.
 */
export function reduceGapToNeighbors(ctx, node, txn, options) {
  const ctxErr = getContextError(ctx);
  if (ctxErr != null) {
    throw ctxErr;
  }
  if (!axisValid(options.axis)) {
    throw new Error('TALA gap reduction requires an axis');
  }
  if (!directionValid(options.direction)) {
    throw new Error('TALA gap reduction requires a direction');
  }
  const isHorizontal = axisIsHorizontal(options.axis);
  const forwards = directionIsForward(options.direction);
  const attemptRecoverSymmetry = Boolean(options.attemptRecoverSymmetry);
  // Needed for calculating partial symmetry
  if (node.Graph.CellSize === 0) {
    node.Graph.computeCellSize();
  }

  let nearestAhead = nearestConnectedAhead(node, isHorizontal, forwards);
  if (nearestAhead == null) {
    return [false, 0];
  }
  // if nearest ahead is fixed or is within a fixed node, we can't pull it closer
  for (let c = nearestAhead.Container; c != null; c = c.Container) {
    if (c.FixedTopLeft != null) {
      return [false, 0];
    }
  }
  const excluded = [node];
  if (node.HerdAssignment != null) {
    // Siblings herded on the same side would lose their alignment if the
    // connected set were pulled towards this node.
    for (const sibling of node.Graph.Containers.get(node.Container) ?? []) {
      if (sibling === node || sibling.HerdAssignment == null || nearestAhead.isDescendantOf(sibling)) {
        continue;
      }
      if (sibling.HerdAssignment.Orientation === node.HerdAssignment.Orientation) {
        excluded.push(sibling);
      }
    }
  }

  const sharedContainer = node.nearestSharedAncestor(nearestAhead);
  const nearestBetweenNode = nearestBetween(
    nearestAhead.connectedNodes(excluded, node.Graph),
    node,
    nearestAhead,
    sharedContainer,
    isHorizontal,
    forwards,
  );

  // we don't want fixed nodes preventing us from getting the actual nearest
  // between, but we only want to move connected nodes up until a fixed node
  excluded.push(...node.Graph.fixedNodes());
  const connectedNodes = nearestAhead.connectedNodeSet(excluded, node.Graph);

  if (nearestBetweenNode != null) {
    nearestAhead = nearestBetweenNode;
  }

  if (options.costTxn != null) {
    const captureErr = options.costTxn.capturePlacementCosts('GapNormalizationTransactions');
    if (captureErr != null) {
      throw captureErr;
    }
  }
  const oldEdgeLength = edgeLength(ctx, node.Graph, SCORING_OPTIONS);
  let newEdgeLength = oldEdgeLength;

  const nodesInBetween = [];
  for (const n of node.Graph.Nodes) {
    if (n === node || n === nearestAhead) {
      continue;
    }
    if (connectedNodes.includes(n)) {
      continue;
    }
    if (forwards) {
      if (n.isBlocked(node, nearestAhead, true, isHorizontal)) {
        nodesInBetween.push(n);
      }
    } else if (n.isBlocked(nearestAhead, node, true, isHorizontal)) {
      nodesInBetween.push(n);
    }
  }

  let backwardTxn = null;
  // We try pulling the nearest ahead to any nodes in between
  for (let candidateNode of [node, ...nodesInBetween]) {
    // if nearest ahead is less nested, only move it to the candidate's ancestor
    // in the same container
    while (candidateNode.owningContainer() !== nearestAhead.owningContainer()) {
      candidateNode = candidateNode.owningContainer();
      if (candidateNode == null) {
        break;
      }
    }
    if (candidateNode == null) {
      continue;
    }
    let gapSize;
    if (isHorizontal) {
      gapSize = forwards
        ? nearestAhead.TopLeft.X - (candidateNode.TopLeft.X + candidateNode.Width)
        : candidateNode.TopLeft.X - (nearestAhead.TopLeft.X + nearestAhead.Width);
    } else {
      gapSize = forwards
        ? nearestAhead.TopLeft.Y - (candidateNode.TopLeft.Y + candidateNode.Height)
        : candidateNode.TopLeft.Y - (nearestAhead.TopLeft.Y + nearestAhead.Height);
    }

    if (gapSize <= largeGapThreshold * node.Graph.CellSize) {
      continue;
    }

    let delta = IDEAL_GAP_SIZE - gapSize;
    if (!forwards) {
      delta = -delta;
    }
    if (delta === 0) {
      continue;
    }

    let candidateEdgeLength = 0;
    if (txn == null) {
      txn = newGapTransaction(ctx, node.Graph);
    } else {
      refresh(txn); // refresh-site: candidate
    }
    const candidateTxn = txn;
    txn.addOp(() => {
      for (const n of connectedNodes) {
        if (isHorizontal) {
          n.translate(delta, 0);
        } else {
          n.translate(0, delta);
        }
      }
      node.Graph.syncClusters();
      node.Graph.syncSequences();
      candidateEdgeLength = edgeLength(ctx, node.Graph, SCORING_OPTIONS);

      // Before we commit to anything, try to "recover symmetry" by running gap
      // reduction on the opposite side.
      if (attemptRecoverSymmetry) {
        if (backwardTxn == null) {
          const [cloned, cloneErr] = candidateTxn.cloneGeometryContext();
          if (cloneErr != null) {
            return cloneErr;
          }
          backwardTxn = cloned;
        }
        backwardTxn.clear();
        const updateErr = backwardTxn.updateState(); // refresh-site: backward
        if (updateErr != null) {
          return updateErr;
        }
        const [mirroredTxn, cloneErr] = backwardTxn.cloneGeometryContext();
        if (cloneErr != null) {
          return cloneErr;
        }
        backwardTxn.addOp(() => {
          const [moved, mirroredEdgeLength] = reduceGapToNeighbors(ctx, node, mirroredTxn, {
            axis: options.axis,
            direction: oppositeDirection(options.direction),
            costTxn: options.costTxn,
          });
          if (moved && mirroredEdgeLength < candidateEdgeLength && mirroredEdgeLength < oldEdgeLength) {
            return null;
          }
          return ErrNonImprovingCandidate;
        });
        const backwardErr = backwardTxn.commit(ctx);
        if (backwardErr != null) {
          if (!isCandidateRejection(backwardErr)) {
            return backwardErr;
          }
        } else {
          // If the backward commit was successful, it means it was optimal
          return null;
        }
      }

      if (candidateEdgeLength >= oldEdgeLength) {
        return ErrNonImprovingCandidate;
      }
      return null;
    });
    const err = txn.commit(ctx);
    if (err != null) {
      txn.clear();
      // Continue searching after an invalid candidate. A non-improving
      // candidate cannot get better by searching farther forward.
      if (isNonImprovingCandidate(err)) {
        break;
      }
      if (!isInvalidCandidate(err)) {
        throw err;
      }
    } else {
      newEdgeLength = candidateEdgeLength;
      refresh(txn); // refresh-site: accepted
      break;
    }
  }

  // try moving non-fixed node to the side of its container
  if (node.Container != null && node.Container !== nearestAhead.Container && node.FixedTopLeft == null) {
    while (node.owningContainer() !== nearestAhead.owningContainer()) {
      const innerBox = node.Container.innerBox();

      let gapSize;
      if (isHorizontal) {
        gapSize = forwards
          ? innerBox.TopLeft.X + innerBox.Width - (node.TopLeft.X + node.Width)
          : node.TopLeft.X - innerBox.TopLeft.X;
      } else {
        gapSize = forwards
          ? innerBox.TopLeft.Y + innerBox.Height - (node.TopLeft.Y + node.Height)
          : node.TopLeft.Y - innerBox.TopLeft.Y;
      }

      const padding = node.Graph.containerPadding(node.Container, true);
      let delta = gapSize;
      if (isHorizontal) {
        delta -= forwards ? padding.Right() : padding.Left();
      } else {
        delta -= forwards ? padding.Bottom() : padding.Top();
      }
      if (!forwards) {
        delta = -delta;
      }
      if (gapSize > largeGapThreshold * node.Graph.CellSize && delta !== 0) {
        if (txn == null) {
          txn = newGapTransaction(ctx, node.Graph);
        } else {
          refresh(txn); // refresh-site: container-side
        }
        const moving = node;
        const sideDelta = delta;
        txn.addOp(() => {
          if (isHorizontal) {
            moving.moveWithChildren(sideDelta, 0);
          } else {
            moving.moveWithChildren(0, sideDelta);
          }
          return null;
        });
        let rolledBack = false;
        const err = txn.commit(ctx);
        if (err != null) {
          if (!isCandidateRejection(err)) {
            throw err;
          }
          rolledBack = true;
        } else {
          let movedEdgeLength;
          try {
            movedEdgeLength = edgeLength(ctx, node.Graph, SCORING_OPTIONS);
          } catch (scoreErr) {
            txn.rollback();
            throw scoreErr;
          }
          if (precisionCompare(movedEdgeLength, newEdgeLength, PRECISION) >= 0) {
            txn.rollback();
            rolledBack = true;
          } else {
            newEdgeLength = movedEdgeLength;
          }
        }
        if (rolledBack) {
          txn.clear();
          // If moving to the side of the container obstructs something, move
          // to IdealGapSize away from the next thing along that axis.
          let leastDistance = Infinity;
          for (const otherNode of node.Graph.Containers.get(node.owningContainer()) ?? []) {
            if (node === otherNode) {
              continue;
            }
            if (isHorizontal) {
              if (forwards) {
                const x = otherNode.TopLeft.X - IDEAL_GAP_SIZE;
                if (x > node.TopLeft.X + node.Width && x - (node.TopLeft.X + node.Width) < leastDistance) {
                  leastDistance = x - (node.TopLeft.X + node.Width);
                }
              } else {
                const x = otherNode.TopLeft.X + otherNode.Width + IDEAL_GAP_SIZE;
                if (x < node.TopLeft.X && node.TopLeft.X - x < leastDistance) {
                  leastDistance = node.TopLeft.X - x;
                }
              }
            } else if (forwards) {
              const y = otherNode.TopLeft.Y - IDEAL_GAP_SIZE;
              if (y > node.TopLeft.Y + node.Height && y - (node.TopLeft.Y + node.Height) < leastDistance) {
                leastDistance = y - (node.TopLeft.Y + node.Height);
              }
            } else {
              const y = otherNode.TopLeft.Y + otherNode.Height + IDEAL_GAP_SIZE;
              if (y < node.TopLeft.Y && node.TopLeft.Y - y < leastDistance) {
                leastDistance = node.TopLeft.Y - y;
              }
            }
          }
          if (leastDistance !== Infinity) {
            let nearDelta = leastDistance;
            if (!forwards) {
              nearDelta = -nearDelta;
            }
            txn.addOp(() => {
              if (isHorizontal) {
                moving.moveWithChildren(nearDelta, 0);
              } else {
                moving.moveWithChildren(0, nearDelta);
              }
              return null;
            });
            const nearErr = txn.commit(ctx);
            if (nearErr != null) {
              if (!isCandidateRejection(nearErr)) {
                throw nearErr;
              }
            } else {
              let movedEdgeLength;
              try {
                movedEdgeLength = edgeLength(ctx, node.Graph, SCORING_OPTIONS);
              } catch (scoreErr) {
                txn.rollback();
                throw scoreErr;
              }
              if (precisionCompare(movedEdgeLength, newEdgeLength, PRECISION) >= 0) {
                txn.rollback();
              } else {
                newEdgeLength = movedEdgeLength;
                refresh(txn); // refresh-site: container-side-accepted
              }
            }
          }
        }
      }
      node = node.owningContainer();
      if (node.Container == null) {
        break;
      }
    }
  }
  return [newEdgeLength !== oldEdgeLength, newEdgeLength];
}

export const ReduceGapToNeighbors = reduceGapToNeighbors;

/**
 * gapNormalization runs gap reduction on nodes in connection-count order.
 * Pinned Go: placement.gapNormalization
 * @returns {boolean}
 */
export function gapNormalization(ctx, nodes, txn, g, options) {
  if (!axisValid(options.axis)) {
    throw new Error('TALA GapNormalization requires an axis');
  }
  if (!directionValid(options.direction)) {
    throw new Error('TALA GapNormalization requires a direction');
  }
  [ctx] = ensureTransactionWorkGuard(ctx, 'GapNormalizationTransactions');
  // Most-connected nodes first so central areas attract isolated nodes.
  const sortedByConnections = [...(nodes ?? [])];
  sortedByConnections.sort((a, b) => {
    if (b.Edges.length !== a.Edges.length) {
      return b.Edges.length < a.Edges.length ? -1 : 1;
    }
    return compareIDs(a.ID, b.ID);
  });

  let changed = false;
  // whole trees can move towards other nodes but we don't want to move within trees
  for (const node of sortedByConnections) {
    if (g.NodeToTree.has(node)) {
      continue;
    }
    if (node.Hierarchy != null) {
      continue;
    }
    const [candidateTxn, cloneErr] = txn.cloneGeometryContext();
    if (cloneErr != null) {
      throw cloneErr;
    }
    txn.addOp(() => {
      reduceGapToNeighbors(ctx, node, candidateTxn, {
        axis: options.axis,
        direction: options.direction,
        attemptRecoverSymmetry: true,
        costTxn: options.costTxn,
      });
      return null;
    });
    const err = txn.commit(ctx);
    if (err != null) {
      if (!isCandidateRejection(err)) {
        throw err;
      }
    } else {
      const updateErr = txn.updateState(); // refresh-site: gap-normalization
      if (updateErr != null) {
        throw updateErr;
      }
      changed = true;
    }
    txn.clear();
  }
  return changed;
}

export const GapNormalization = gapNormalization;
