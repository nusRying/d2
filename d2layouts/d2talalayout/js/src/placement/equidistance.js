/**
 * Equidistance — center nodes between their aligned connected neighbors.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/equidistance.go
 *   Equidistance, equidistanceNodeGuarded
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { goRound, precisionCompare, PRECISION } from '../geometry/math.js';
import { isHorizontal, isVertical } from '../geometry/orientation.js';
import { isCandidateRejection } from '../graph/transaction.js';
import { Validate } from '../graph/topology-preflight.js';
import { MAX_ENGINE_WORK_UNITS } from '../limits/constants.js';
import { ensureTransactionWorkGuard } from '../limits/transaction-guard.js';
import { WorkGuard } from '../limits/work-guard.js';
import { getContextError } from '../limits/work-context.js';
import { edgeLength } from '../placementcost/graph.js';
import { restoreNodePositions, snapshotNodePositionsContext } from './types.js';

function equidistanceScoring() {
  return { EdgeAbductions: null, IncludeNodeSizes: true, EnforceMinimumGap: false, PenalizeDirection: true };
}

/**
 * Equidistance centers nodes between aligned neighbors
 * (A ---------- B -- C moves B to the midpoint of A and C).
 * Atomic: any failure restores every node position (pointer and value).
 *
 * Pinned Go: placement.Equidistance
 * @returns {boolean} whether any node moved. Errors throw.
 */
export function equidistance(ctx, g) {
  [ctx] = ensureTransactionWorkGuard(ctx, 'EquidistanceTransactions');
  Validate(ctx, 'Equidistance', g);
  const originalPositions = snapshotNodePositionsContext(ctx, 'Equidistance', g.Nodes);
  let complete = false;
  try {
    const reachabilityGuard = new WorkGuard(ctx, 'EquidistanceReachability', MAX_ENGINE_WORK_UNITS);
    let movedHorizontally = false;
    let movedVertically = false;
    for (const n of g.Nodes) {
      const movedHorizontally2 = equidistanceNodeGuarded(ctx, n, g, true, reachabilityGuard);
      const movedVertically2 = equidistanceNodeGuarded(ctx, n, g, false, reachabilityGuard);
      if (movedHorizontally2) {
        movedHorizontally = true;
      }
      if (movedVertically2) {
        movedVertically = true;
      }
    }
    // Try multiple times: moving one node may create symmetries for others.
    if (movedHorizontally) {
      let movedAgain = false;
      for (let i = 0; i < 5; i++) {
        for (const n of g.Nodes) {
          if (equidistanceNodeGuarded(ctx, n, g, true, reachabilityGuard)) {
            movedAgain = true;
          }
        }
        if (!movedAgain) {
          break;
        }
        movedAgain = false;
      }
    }
    if (movedVertically) {
      let movedAgain = false;
      for (let i = 0; i < 5; i++) {
        for (const n of g.Nodes) {
          if (equidistanceNodeGuarded(ctx, n, g, false, reachabilityGuard)) {
            movedAgain = true;
          }
        }
        if (!movedAgain) {
          break;
        }
        movedAgain = false;
      }
    }

    reachabilityGuard.Finish();
    complete = true;
    return movedHorizontally || movedVertically;
  } finally {
    if (!complete) {
      restoreNodePositions(originalPositions);
    }
  }
}

export const Equidistance = equidistance;

/**
 * equidistanceNodeGuarded centers one node (or its owning container) between
 * its nearest connected neighbors along one axis.
 *
 * Pinned Go: placement.equidistanceNodeGuarded
 * @returns {boolean} whether the node moved. Errors throw.
 */
export function equidistanceNodeGuarded(ctx, n, g, horizontal, reachabilityGuard) {
  const ctxErr = getContextError(ctx);
  if (ctxErr != null) {
    throw ctxErr;
  }
  if (n.Hierarchy != null) {
    return false;
  }
  if (g.NodeToTree.has(n)) {
    return false;
  }
  if (g.isTreeSentinel(n)) {
    return false;
  }
  if (n.FixedTopLeft != null) {
    return false;
  }

  let nearestBack = null;
  let nearestFront = null;

  for (const e of n.Edges) {
    const adj = n.adjacent(e);
    if (n.isDescendantOf(adj) || adj.isDescendantOf(n)) {
      return false;
    }
    if (horizontal) {
      // Left
      if (adj.TopLeft.X + adj.Width < n.TopLeft.X) {
        if (nearestBack == null || adj.TopLeft.X + adj.Width > nearestBack.TopLeft.X + nearestBack.Width) {
          nearestBack = adj;
        }
      }
      // Right
      if (adj.TopLeft.X > n.TopLeft.X + n.Width) {
        if (nearestFront == null || adj.TopLeft.X < nearestFront.TopLeft.X) {
          nearestFront = adj;
        }
      }
    } else {
      // Top
      if (adj.TopLeft.Y + adj.Height < n.TopLeft.Y) {
        if (nearestBack == null || adj.TopLeft.Y + adj.Height > nearestBack.TopLeft.Y + nearestBack.Height) {
          nearestBack = adj;
        }
      }
      // Bottom
      if (adj.TopLeft.Y > n.TopLeft.Y + n.Height) {
        if (nearestFront == null || adj.TopLeft.Y < nearestFront.TopLeft.Y) {
          nearestFront = adj;
        }
      }
    }
  }

  if (nearestBack == null || nearestFront == null) {
    return false;
  }

  let otherConnected = [];
  for (const e of n.Edges) {
    const adj = n.adjacent(e);
    if (adj === nearestBack || adj === nearestFront) {
      continue;
    }
    if (horizontal) {
      if (!isVertical(adj.orientation(n))) {
        continue;
      }
    } else if (!isHorizontal(adj.orientation(n))) {
      continue;
    }
    if (adj.isDescendantOf(nearestBack) || nearestBack.isDescendantOf(adj)) {
      continue;
    }
    if (adj.isDescendantOf(nearestFront) || nearestFront.isDescendantOf(adj)) {
      continue;
    }

    const reachable = adj.allReachableNodesContext(
      false,
      true,
      true,
      new Set([n, nearestBack, nearestFront]),
      reachabilityGuard,
    );

    // Pinned Go follows with a filter loop whose `continue`s have no effect;
    // it is pure (IsDescendantOf only), so it is omitted.

    for (const reachableN of reachable) {
      if (!otherConnected.includes(reachableN)) {
        otherConnected.push(reachableN);
      }
    }
  }

  for (const c of otherConnected) {
    if (c.FixedTopLeft != null) {
      otherConnected = [];
      break;
    }
  }

  const ancestorBack = n.nearestSharedAncestor(nearestBack);
  const ancestorFront = n.nearestSharedAncestor(nearestFront);

  // Move the whole owning container when neither neighbor is inside it.
  while (n.owningContainer() != null &&
    !nearestBack.isDescendantOf(n.owningContainer()) &&
    !nearestFront.isDescendantOf(n.owningContainer())) {
    n = n.owningContainer();
  }

  // A neighbor's container is the relevant boundary when it lies wholly on
  // the neighbor's side of n.
  while (nearestBack.owningContainer() !== ancestorBack) {
    const container = nearestBack.owningContainer();
    if (horizontal) {
      if (container.TopLeft.X + container.Width < n.TopLeft.X) {
        nearestBack = nearestBack.owningContainer();
      } else {
        break;
      }
    } else if (container.TopLeft.Y + container.Height < n.TopLeft.Y) {
      nearestBack = nearestBack.owningContainer();
    } else {
      break;
    }
  }
  while (nearestFront.owningContainer() !== ancestorFront) {
    const container = nearestFront.owningContainer();
    if (horizontal) {
      if (container.TopLeft.X > n.TopLeft.X + n.Width) {
        nearestFront = nearestFront.owningContainer();
      } else {
        break;
      }
    } else if (container.TopLeft.Y > n.TopLeft.Y + n.Height) {
      nearestFront = nearestFront.owningContainer();
    } else {
      break;
    }
  }

  const originalLength = edgeLength(ctx, g, equidistanceScoring());

  let diffX = 0;
  let diffY = 0;
  if (horizontal) {
    const x = goRound((nearestBack.TopLeft.X + nearestBack.Width + nearestFront.TopLeft.X) / 2 - n.Width / 2);
    diffX = x - n.TopLeft.X;
  } else {
    const y = goRound((nearestBack.TopLeft.Y + nearestBack.Height + nearestFront.TopLeft.Y) / 2 - n.Height / 2);
    diffY = y - n.TopLeft.Y;
  }

  const [txn, txnErr] = g.NewRequestTransaction(ctx, { AffectContainers: true });
  if (txnErr != null) {
    throw txnErr;
  }

  const moved = n;
  const moveConnected = () => {
    for (const n2 of [...otherConnected, moved]) {
      n2.MoveWithChildren(diffX, diffY);
    }
  };

  let rolledBack = false;
  let soloMoveLength = 0;
  let connectedMoveLength = 0;

  // First try moving just the node by itself
  txn.AddOp(() => {
    moved.MoveWithChildren(diffX, diffY);
    return null;
  });
  let commitErr = txn.Commit(ctx);
  if (commitErr != null) {
    if (!isCandidateRejection(commitErr)) {
      throw commitErr;
    }
    rolledBack = true;
  }
  if (!rolledBack) {
    let newLength;
    try {
      newLength = edgeLength(ctx, g, equidistanceScoring());
    } catch (err) {
      txn.Rollback();
      throw err;
    }
    if (precisionCompare(newLength, originalLength, PRECISION) <= 0) {
      soloMoveLength = newLength;
    }
    txn.Rollback();
  }

  txn.Clear();

  // Then try moving with connected
  if (otherConnected.length > 0) {
    rolledBack = false;
    txn.AddOp(() => {
      moveConnected();
      return null;
    });
    commitErr = txn.Commit(ctx);
    if (commitErr != null) {
      if (!isCandidateRejection(commitErr)) {
        throw commitErr;
      }
      rolledBack = true;
    }
    if (!rolledBack) {
      let newLength;
      try {
        newLength = edgeLength(ctx, g, equidistanceScoring());
      } catch (err) {
        txn.Rollback();
        throw err;
      }
      if (precisionCompare(newLength, originalLength, PRECISION) <= 0) {
        connectedMoveLength = newLength;
      }
      txn.Rollback();
    }
  }

  txn.Clear();

  // Then use the best global edge length and move it there
  if (soloMoveLength === 0 && connectedMoveLength === 0) {
    return false;
  }
  txn.AddOp(() => {
    if (soloMoveLength === 0 && connectedMoveLength > 0) {
      moveConnected();
    } else if (soloMoveLength > 0 && connectedMoveLength === 0) {
      moved.MoveWithChildren(diffX, diffY);
    } else if (precisionCompare(soloMoveLength, connectedMoveLength, PRECISION) < 0) {
      moved.MoveWithChildren(diffX, diffY);
    } else {
      moveConnected();
    }
    return null;
  });

  commitErr = txn.Commit(ctx);
  if (commitErr != null) {
    throw commitErr;
  }
  return true;
}
