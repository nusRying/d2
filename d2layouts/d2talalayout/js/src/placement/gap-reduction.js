import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { edgeLength } from '../placementcost/graph.js';
import { IDEAL_GAP_SIZE } from '../placementcost/geometry.js';
import {
  LayoutAxis,
  TraversalDirection,
  axisValid,
  axisIsHorizontal,
  directionValid,
  directionIsForward,
  oppositeDirection,
} from './axis.js';
import { isCandidateRejection, ErrNonImprovingCandidate, ErrInvalidCandidate } from '../graph/transaction.js';
import { precisionCompare, PRECISION } from '../geometry/math.js';

const largeGapThreshold = 0.5;

/**
 * Assumes ahead is ahead of behind when forwards is true.
 * Pinned Go: placement.isBetween
 *
 * @param {import('../graph/node.js').Node} node
 * @param {import('../graph/node.js').Node} behind
 * @param {import('../graph/node.js').Node} ahead
 * @param {boolean} isHorizontal
 * @param {boolean} forwards
 * @returns {boolean}
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

    let b = behind;
    let a = ahead;
    if (!forwards) {
      b = ahead;
      a = behind;
    }
    if (node.TopLeft.X + node.Width < b.TopLeft.X + b.Width) {
      return false;
    }
    if (node.TopLeft.X > a.TopLeft.X) {
      return false;
    }
  } else {
    if (node.TopLeft.X + node.Width < behind.TopLeft.X - delta) {
      return false;
    }
    if (node.TopLeft.X > behind.TopLeft.X + behind.Width + delta) {
      return false;
    }

    let b = behind;
    let a = ahead;
    if (!forwards) {
      b = ahead;
      a = behind;
    }
    if (node.TopLeft.Y + node.Height < b.TopLeft.Y + b.Height) {
      return false;
    }
    if (node.TopLeft.Y > a.TopLeft.Y) {
      return false;
    }
  }
  return true;
}

export const IsBetween = isBetween;

/**
 * Assumes otherNode is ahead of node when forwards is true.
 * Pinned Go: placement.nearestBetween
 *
 * @param {import('../graph/node.js').Node[]} nodes
 * @param {import('../graph/node.js').Node} behind
 * @param {import('../graph/node.js').Node} ahead
 * @param {import('../graph/node.js').Node} inContainer
 * @param {boolean} isHorizontal
 * @param {boolean} forwards
 * @returns {import('../graph/node.js').Node|null}
 */
export function nearestBetween(nodes, behind, ahead, inContainer, isHorizontal, forwards) {
  let nearest = null;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
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
      } else {
        if (n.TopLeft.X + n.Width > nearest.TopLeft.X + nearest.Width) {
          nearest = n;
        }
      }
    } else {
      if (forwards) {
        if (n.TopLeft.Y < nearest.TopLeft.Y) {
          nearest = n;
        }
      } else {
        if (n.TopLeft.Y + n.Height > nearest.TopLeft.Y + nearest.Height) {
          nearest = n;
        }
      }
    }
  }

  return nearest;
}

export const NearestBetween = nearestBetween;

/**
 * nearestConnectedAhead finds the nearest connected node in the specified traversal direction.
 * Pinned Go: placement.nearestConnectedAhead
 *
 * @param {import('../graph/node.js').Node} node
 * @param {boolean} isHorizontal
 * @param {boolean} forwards
 * @returns {import('../graph/node.js').Node|null}
 */
export function nearestConnectedAhead(node, isHorizontal, forwards) {
  let nearest = null;
  const edges = node.Edges || [];

  for (let i = 0; i < edges.length; i++) {
    const adj = node.adjacent(edges[i]);
    if (adj == null || adj.TopLeft == null) {
      continue;
    }
    if (isHorizontal) {
      if (forwards) {
        // if adj's left is behind node's right it's not ahead
        if (adj.TopLeft.X < node.TopLeft.X + node.Width) {
          continue;
        }
        if (nearest == null || adj.TopLeft.X < nearest.TopLeft.X) {
          nearest = adj;
        }
      } else {
        // if adj's right is ahead of node's left it's not behind
        if (adj.TopLeft.X + adj.Width > node.TopLeft.X) {
          continue;
        }
        if (nearest == null || adj.TopLeft.X + adj.Width > nearest.TopLeft.X + nearest.Width) {
          nearest = adj;
        }
      }
    } else {
      if (forwards) {
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
  }

  return nearest;
}

export const NearestConnectedAhead = nearestConnectedAhead;

/**
 * reduceGapToNeighbors attempts to reduce the gap between this node and its neighbors in front of it.
 * Pinned Go: placement.reduceGapToNeighbors
 *
 * @param {object} ctx
 * @param {import('../graph/node.js').Node} node
 * @param {import('../graph/transaction.js').Transaction|null} txn
 * @param {{ axis: number, direction: number, attemptRecoverSymmetry?: boolean, costTxn?: import('../graph/transaction.js').Transaction }} options
 * @returns {[boolean, number]} [changed, newEdgeLength]
 */
export function reduceGapToNeighbors(ctx, node, txn, options) {
  if (ctx.Err && ctx.Err() != null) {
    throw ctx.Err();
  }
  if (!axisValid(options.axis)) {
    throw new Error('TALA gap reduction requires an axis');
  }
  if (!directionValid(options.direction)) {
    throw new Error('TALA gap reduction requires a direction');
  }

  const isHorizontal = axisIsHorizontal(options.axis);
  const forwards = directionIsForward(options.direction);
  const attemptRecoverSymmetry = options.attemptRecoverSymmetry ?? false;

  if (node.Graph.CellSize === 0 && typeof node.Graph.computeCellSize === 'function') {
    node.Graph.computeCellSize();
  }

  const nearestAhead = nearestConnectedAhead(node, isHorizontal, forwards);
  if (nearestAhead == null) {
    return [false, 0];
  }

  // if nearest ahead is fixed or is within a fixed node, we can't pull it closer
  for (let c = nearestAhead.Container; c != null; c = c.Container) {
    if (c.FixedTopLeft != null) {
      return [false, 0];
    }
  }

  let excluded = [node];
  if (node.HerdAssignment != null) {
    const containerNodes = node.Graph.Containers instanceof Map
      ? (node.Graph.Containers.get(node.Container) || [])
      : (node.Graph.Containers?.[node.Container] || []);

    for (let i = 0; i < containerNodes.length; i++) {
      const sibling = containerNodes[i];
      if (sibling === node || sibling.HerdAssignment == null || nearestAhead.isDescendantOf(sibling)) {
        continue;
      }
      if (sibling.HerdAssignment.Orientation === node.HerdAssignment.Orientation) {
        excluded.push(sibling);
      }
    }
  }

  const sharedContainer = node.nearestSharedAncestor(nearestAhead);
  const connectedToNearest = nearestAhead.connectedNodes(excluded, node.Graph);
  const nearestBetweenNode = nearestBetween(
    connectedToNearest,
    node,
    nearestAhead,
    sharedContainer,
    isHorizontal,
    forwards
  );

  const fixedNodes = typeof node.Graph.fixedNodes === 'function' ? node.Graph.fixedNodes() : [];
  excluded = [...excluded, ...fixedNodes];
  const connectedNodes = nearestAhead.connectedNodeSet(excluded, node.Graph);

  let effectiveNearestAhead = nearestAhead;
  if (nearestBetweenNode != null) {
    effectiveNearestAhead = nearestBetweenNode;
  }

  if (options.costTxn) {
    options.costTxn.capturePlacementCosts('GapNormalizationTransactions');
  }

  const oldEdgeLength = edgeLength(ctx, node.Graph, {
    EdgeAbductions: null,
    IncludeNodeSizes: true,
    EnforceMinimumGap: false,
    PenalizeDirection: false,
  });
  let newEdgeLength = oldEdgeLength;

  const nodesInBetween = [];
  const allNodes = node.Graph.Nodes || [];
  for (let i = 0; i < allNodes.length; i++) {
    const n = allNodes[i];
    if (n === node || n === effectiveNearestAhead) {
      continue;
    }
    const isAConnectedNode = connectedNodes.includes(n);
    if (isAConnectedNode) {
      continue;
    }
    if (forwards) {
      if (n.isBlocked(node, effectiveNearestAhead, true, isHorizontal)) {
        nodesInBetween.push(n);
      }
    } else {
      if (n.isBlocked(effectiveNearestAhead, node, true, isHorizontal)) {
        nodesInBetween.push(n);
      }
    }
  }

  let backwardTxn = null;
  const candidateNodes = [node, ...nodesInBetween];

  for (let ci = 0; ci < candidateNodes.length; ci++) {
    let candidateNode = candidateNodes[ci];
    while (candidateNode.owningContainer() !== effectiveNearestAhead.owningContainer()) {
      candidateNode = candidateNode.owningContainer();
      if (candidateNode == null) {
        break;
      }
    }
    if (candidateNode == null) {
      continue;
    }

    let gapSize = 0;
    if (isHorizontal) {
      if (forwards) {
        gapSize = effectiveNearestAhead.TopLeft.X - (candidateNode.TopLeft.X + candidateNode.Width);
      } else {
        gapSize = candidateNode.TopLeft.X - (effectiveNearestAhead.TopLeft.X + effectiveNearestAhead.Width);
      }
    } else {
      if (forwards) {
        gapSize = effectiveNearestAhead.TopLeft.Y - (candidateNode.TopLeft.Y + candidateNode.Height);
      } else {
        gapSize = candidateNode.TopLeft.Y - (effectiveNearestAhead.TopLeft.Y + effectiveNearestAhead.Height);
      }
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
    let localTxn = txn;
    if (localTxn == null) {
      const [t, err] = node.Graph.newRequestTransaction(ctx, { affectContainers: true });
      if (err != null) {
        throw err;
      }
      localTxn = t;
    } else {
      localTxn.clear();
      localTxn.updateState();
    }

    localTxn.addOp(() => {
      for (let j = 0; j < connectedNodes.length; j++) {
        const cn = connectedNodes[j];
        if (isHorizontal) {
          cn.translate(delta, 0);
        } else {
          cn.translate(0, delta);
        }
      }
      if (typeof node.Graph.syncClusters === 'function') {
        node.Graph.syncClusters();
      }
      if (typeof node.Graph.syncSequences === 'function') {
        node.Graph.syncSequences();
      }

      candidateEdgeLength = edgeLength(ctx, node.Graph, {
        EdgeAbductions: null,
        IncludeNodeSizes: true,
        EnforceMinimumGap: false,
        PenalizeDirection: false,
      });

      if (attemptRecoverSymmetry) {
        if (backwardTxn == null) {
          const [bt, bErr] = localTxn.cloneGeometryContext();
          if (bErr != null) {
            throw bErr;
          }
          backwardTxn = bt;
        }
        backwardTxn.clear();
        backwardTxn.updateState();

        const [mirroredTxn, cloneErr] = backwardTxn.cloneGeometryContext();
        if (cloneErr != null) {
          throw cloneErr;
        }

        backwardTxn.addOp(() => {
          const [moved, mirroredEdgeLength] = reduceGapToNeighbors(ctx, node, mirroredTxn, {
            axis: options.axis,
            direction: oppositeDirection(options.direction),
            costTxn: options.costTxn,
          });

          if (moved && mirroredEdgeLength < candidateEdgeLength && mirroredEdgeLength < oldEdgeLength) {
            return;
          }
          return ErrNonImprovingCandidate;
        });

        const commitErr = backwardTxn.commit(ctx);
        if (commitErr != null) {
          if (!isCandidateRejection(commitErr)) {
            throw commitErr;
          }
        } else {
          return;
        }
      }

      if (candidateEdgeLength >= oldEdgeLength) {
        return ErrNonImprovingCandidate;
      }
    });

    const commitErr = localTxn.commit(ctx);
    if (commitErr != null) {
      localTxn.clear();
      if (commitErr instanceof ErrNonImprovingCandidate.constructor || commitErr === ErrNonImprovingCandidate) {
        break;
      }
      if (!(commitErr instanceof ErrInvalidCandidate.constructor || commitErr === ErrInvalidCandidate)) {
        throw commitErr;
      }
    } else {
      newEdgeLength = candidateEdgeLength;
      localTxn.clear();
      localTxn.updateState();
      break;
    }
  }

  // Try moving non-fixed node to the side of its container
  let movingNode = node;
  if (movingNode.Container != null && movingNode.Container !== effectiveNearestAhead.Container && movingNode.FixedTopLeft == null) {
    while (movingNode.owningContainer() !== effectiveNearestAhead.owningContainer()) {
      const innerBox = movingNode.Container.innerBox();

      let gapSize = 0;
      if (isHorizontal) {
        if (forwards) {
          gapSize = innerBox.TopLeft.X + innerBox.Width - (movingNode.TopLeft.X + movingNode.Width);
        } else {
          gapSize = movingNode.TopLeft.X - innerBox.TopLeft.X;
        }
      } else {
        if (forwards) {
          gapSize = innerBox.TopLeft.Y + innerBox.Height - (movingNode.TopLeft.Y + movingNode.Height);
        } else {
          gapSize = movingNode.TopLeft.Y - innerBox.TopLeft.Y;
        }
      }

      const padding = movingNode.Graph.containerPadding(movingNode.Container, true);
      let delta = gapSize;
      if (isHorizontal) {
        if (forwards) {
          delta -= typeof padding.right === 'function' ? padding.right() : (padding.right ?? 0);
        } else {
          delta -= typeof padding.left === 'function' ? padding.left() : (padding.left ?? 0);
        }
      } else {
        if (forwards) {
          delta -= typeof padding.bottom === 'function' ? padding.bottom() : (padding.bottom ?? 0);
        } else {
          delta -= typeof padding.top === 'function' ? padding.top() : (padding.top ?? 0);
        }
      }

      if (!forwards) {
        delta = -delta;
      }

      if (gapSize > largeGapThreshold * movingNode.Graph.CellSize && delta !== 0) {
        let localTxn = txn;
        if (localTxn == null) {
          const [t, err] = movingNode.Graph.newRequestTransaction(ctx, { affectContainers: true });
          if (err != null) {
            throw err;
          }
          localTxn = t;
        } else {
          localTxn.clear();
          localTxn.updateState();
        }

        const nodeToMove = movingNode;
        localTxn.addOp(() => {
          if (isHorizontal) {
            nodeToMove.moveWithChildren(delta, 0);
          } else {
            nodeToMove.moveWithChildren(0, delta);
          }
        });

        let rolledBack = false;
        const commitErr = localTxn.commit(ctx);
        if (commitErr != null) {
          if (!isCandidateRejection(commitErr)) {
            throw commitErr;
          }
          rolledBack = true;
        } else {
          const movedEdgeLength = edgeLength(ctx, movingNode.Graph, {
            EdgeAbductions: null,
            IncludeNodeSizes: true,
            EnforceMinimumGap: false,
            PenalizeDirection: false,
          });
          if (precisionCompare(movedEdgeLength, newEdgeLength, PRECISION) >= 0) {
            localTxn.rollback();
            rolledBack = true;
          } else {
            newEdgeLength = movedEdgeLength;
          }
        }

        if (rolledBack) {
          localTxn.clear();
          let leastDistance = Infinity;
          const containerNodes = movingNode.Graph.Containers instanceof Map
            ? (movingNode.Graph.Containers.get(movingNode.owningContainer()) || [])
            : (movingNode.Graph.Containers?.[movingNode.owningContainer()] || []);

          for (let i = 0; i < containerNodes.length; i++) {
            const otherNode = containerNodes[i];
            if (movingNode === otherNode) {
              continue;
            }
            if (isHorizontal) {
              if (forwards) {
                const x = otherNode.TopLeft.X - IDEAL_GAP_SIZE;
                if (x > movingNode.TopLeft.X + movingNode.Width) {
                  if (x - (movingNode.TopLeft.X + movingNode.Width) < leastDistance) {
                    leastDistance = x - (movingNode.TopLeft.X + movingNode.Width);
                  }
                }
              } else {
                const x = otherNode.TopLeft.X + otherNode.Width + IDEAL_GAP_SIZE;
                if (x < movingNode.TopLeft.X) {
                  if (movingNode.TopLeft.X - x < leastDistance) {
                    leastDistance = movingNode.TopLeft.X - x;
                  }
                }
              }
            } else {
              if (forwards) {
                const y = otherNode.TopLeft.Y - IDEAL_GAP_SIZE;
                if (y > movingNode.TopLeft.Y + movingNode.Height) {
                  if (y - (movingNode.TopLeft.Y + movingNode.Height) < leastDistance) {
                    leastDistance = y - (movingNode.TopLeft.Y + movingNode.Height);
                  }
                }
              } else {
                const y = otherNode.TopLeft.Y + otherNode.Height + IDEAL_GAP_SIZE;
                if (y < movingNode.TopLeft.Y) {
                  if (movingNode.TopLeft.Y - y < leastDistance) {
                    leastDistance = movingNode.TopLeft.Y - y;
                  }
                }
              }
            }
          }

          if (Number.isFinite(leastDistance)) {
            let altDelta = leastDistance;
            if (!forwards) {
              altDelta = -altDelta;
            }
            localTxn.addOp(() => {
              if (isHorizontal) {
                nodeToMove.moveWithChildren(altDelta, 0);
              } else {
                nodeToMove.moveWithChildren(0, altDelta);
              }
            });

            const altCommitErr = localTxn.commit(ctx);
            if (altCommitErr != null) {
              if (!isCandidateRejection(altCommitErr)) {
                throw altCommitErr;
              }
            } else {
              const movedEdgeLength = edgeLength(ctx, movingNode.Graph, {
                EdgeAbductions: null,
                IncludeNodeSizes: true,
                EnforceMinimumGap: false,
                PenalizeDirection: false,
              });
              if (precisionCompare(movedEdgeLength, newEdgeLength, PRECISION) >= 0) {
                localTxn.rollback();
              } else {
                newEdgeLength = movedEdgeLength;
                localTxn.clear();
                localTxn.updateState();
              }
            }
          }
        }
      }

      movingNode = movingNode.owningContainer();
      if (movingNode.Container == null) {
        break;
      }
    }
  }

  return [newEdgeLength !== oldEdgeLength, newEdgeLength];
}

export const ReduceGapToNeighbors = reduceGapToNeighbors;

/**
 * gapNormalization runs gap reduction on a set of nodes in connection-count order.
 * Pinned Go: placement.gapNormalization
 *
 * @param {object} ctx
 * @param {import('../graph/node.js').Node[]} nodes
 * @param {import('../graph/transaction.js').Transaction} txn
 * @param {import('../graph/graph.js').Graph} g
 * @param {{ axis: number, direction: number, costTxn?: import('../graph/transaction.js').Transaction }} options
 * @returns {boolean}
 */
export function gapNormalization(ctx, nodes, txn, g, options) {
  if (!axisValid(options.axis)) {
    throw new Error('TALA GapNormalization requires an axis');
  }
  if (!directionValid(options.direction)) {
    throw new Error('TALA GapNormalization requires a direction');
  }

  ensureTransactionWorkGuard(ctx, 'GapNormalizationTransactions');

  const sortedByConnections = [...nodes];
  sortedByConnections.sort((a, b) => {
    const aLen = a.Edges ? a.Edges.length : 0;
    const bLen = b.Edges ? b.Edges.length : 0;
    if (bLen !== aLen) {
      return bLen - aLen;
    }
    return Number(a.ID - b.ID);
  });

  let changed = false;

  for (let i = 0; i < sortedByConnections.length; i++) {
    const node = sortedByConnections[i];
    if (g.NodeToTree && (g.NodeToTree instanceof Map ? g.NodeToTree.has(node) : g.NodeToTree[node] != null)) {
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
    });

    const commitErr = txn.commit(ctx);
    if (commitErr != null) {
      if (!isCandidateRejection(commitErr)) {
        throw commitErr;
      }
    } else {
      txn.updateState();
      changed = true;
    }
    txn.clear();
  }

  return changed;
}

export const GapNormalization = gapNormalization;
