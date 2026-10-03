/**
 * Axis alignment — slide connected nodes so edges become axis-aligned.
 *
 * Pinned Go: d2layouts/d2talalayout/internal/placement/alignment.go
 *   alignAxes, alignmentDeltas, tryMove, attemptShift
 * Pinned Go authority: 01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579
 *
 * Error conventions: Go-returned errors are thrown; Transaction Commit and
 * UpdateState return errors (null on success).
 *
 * BROWSER-SAFE: No fs, path, crypto, process, Math.random, node: imports.
 */

import { Point } from '../geometry/point.js';
import { goRound, precisionCompare, PRECISION } from '../geometry/math.js';
import { isHorizontal, isVertical } from '../geometry/orientation.js';
import { ErrInvalidCandidate, isCandidateRejection } from '../graph/transaction.js';
import {
  addIsolatedTreeEdges,
  isAxisAligned,
  orthogonalDistanceTo,
  treeEdgeMap,
} from '../graph/structural-access.js';
import { getContextError } from '../limits/work-context.js';
import { edgeLength } from '../placementcost/graph.js';
import { CONNECTED_NODE_GAP } from '../placementcost/geometry.js';
import { intersectsOtherNode, withinMaxSize } from './metrics.js';
import { containerAlignmentCost } from '../placementcost/graph.js';

function alignmentScoringOptions(edgeAbductions) {
  return {
    EdgeAbductions: edgeAbductions,
    IncludeNodeSizes: true,
    EnforceMinimumGap: false,
    PenalizeDirection: true,
  };
}

/**
 * alignAxes tries to align connected nodes that currently differ on both axes.
 *
 * Pinned Go: placement.alignAxes
 * @returns {boolean} changed. Errors throw.
 */
export function alignAxes(ctx, g, txn) {
  const ctxErr = getContextError(ctx);
  if (ctxErr != null) {
    throw ctxErr;
  }
  let changed = false;

  const fixedNodes = g.FixedNodes();

  // The edge from the root sentinel to a tree root is not excluded: moving the
  // root moves its whole connected tree with it.
  const isTreeEdge = treeEdgeMap(g);
  addIsolatedTreeEdges(g, isTreeEdge);
  // Tree nodes may be containers, so exclude them from connected-node search.
  const excluded = [];
  for (const n of g.Nodes) {
    if (g.NodeToTree.has(n)) {
      excluded.push(n);
    }
  }
  excluded.push(...fixedNodes);
  excluded.push(null); // last entry is replaced with e.To/e.From below

  // Go ranges over the g.Sequences map (unordered); JS uses Map insertion
  // order. Go append of empty abduction lists onto nil stays nil.
  let edgeAbductions = null;
  for (const seq of g.Sequences.values()) {
    if (seq.EdgeAbductions != null && seq.EdgeAbductions.length > 0) {
      if (edgeAbductions == null) edgeAbductions = [];
      edgeAbductions.push(...seq.EdgeAbductions);
    }
  }
  const scoring = alignmentScoringOptions(edgeAbductions);

  // Computed up front: aligning one edge may align others.
  let hasTableColumns = false;
  const initialLength = edgeLength(ctx, g, scoring);
  let nInitialAlignedTableColumns = 0;
  for (const e of g.Edges) {
    if (e.hasTableColumn()) {
      hasTableColumns = true;
      if (isAxisAligned(e)) {
        nInitialAlignedTableColumns++;
      }
    }
  }

  // Go ranges over the slice header captured at loop entry.
  const edges = g.Edges;
  const edgeCount = edges.length;
  for (let index = 0; index < edgeCount; index++) {
    const e = edges[index];
    if (isTreeEdge.has(e)) {
      continue;
    }
    if (isAxisAligned(e)) {
      continue;
    }
    if (e.From.Hierarchy != null || e.To.Hierarchy != null) {
      continue;
    }
    txn.Clear();
    const stateErr = txn.UpdateState();
    if (stateErr != null) {
      throw stateErr;
    }

    const [xDiff, yDiff] = alignmentDeltas(e, g);

    let dxBest = 0;
    let dyBest = 0;
    let bestNodes = null;
    let bestEdgeLength = edgeLength(ctx, g, scoring);
    const containerAlignment = containerAlignmentCost(ctx, g);
    bestEdgeLength += containerAlignment;
    // Try to move e.From
    {
      excluded[excluded.length - 1] = e.To;
      const connectedNodes = e.From.connectedNodeSet(excluded, g);
      const [length, dx, dy] = tryMove(ctx, txn, g, e, connectedNodes, edgeAbductions, xDiff, yDiff);
      if (precisionCompare(length, bestEdgeLength, PRECISION) < 0) {
        bestEdgeLength = length;
        dxBest = dx;
        dyBest = dy;
        bestNodes = connectedNodes;
      } else if (e.hasTableColumn() && precisionCompare(length, bestEdgeLength, PRECISION) === 0) {
        // Table port alignment can be a micro-movement whose length is equal
        // at our precision, but aligned ports still look better.
        bestEdgeLength = length;
        dxBest = dx;
        dyBest = dy;
        bestNodes = connectedNodes;
      }
    }

    // Try to move e.To
    {
      excluded[excluded.length - 1] = e.From;
      const connectedNodes = e.To.connectedNodeSet(excluded, g);
      const [length, dx, dy] = tryMove(ctx, txn, g, e, connectedNodes, edgeAbductions, -xDiff, -yDiff);
      if (precisionCompare(length, bestEdgeLength, PRECISION) < 0) {
        dxBest = dx;
        dyBest = dy;
        bestNodes = connectedNodes;
      } else if (e.hasTableColumn() && precisionCompare(length, bestEdgeLength, PRECISION) === 0) {
        dxBest = dx;
        dyBest = dy;
        bestNodes = connectedNodes;
      }
    }

    if (bestNodes != null && bestNodes.length > 0) {
      const nodes = bestNodes;
      const dx = dxBest;
      const dy = dyBest;
      txn.AddOp(() => {
        changed = true;
        for (const n of nodes) {
          n.Translate(dx, dy);
        }
        return null;
      });
      const commitErr = txn.Commit(ctx);
      if (commitErr != null) {
        throw commitErr;
      }
    }
  }

  if (hasTableColumns && changed) {
    // Column alignment can produce sub-precision edge-length changes, so also
    // count aligned table-column edges.
    let nAlignedTableColumns = 0;
    for (const e of g.Edges) {
      if (e.hasTableColumn() && isAxisAligned(e)) {
        nAlignedTableColumns++;
      }
    }
    // Without more aligned columns, accept only a strict edge-length improvement.
    if (nAlignedTableColumns <= nInitialAlignedTableColumns) {
      let length = edgeLength(ctx, g, scoring);
      const containerAlignment = containerAlignmentCost(ctx, g);
      length += containerAlignment;
      changed = precisionCompare(length, initialLength, PRECISION) === -1;
    }
  }

  return changed;
}

/**
 * alignmentDeltas computes the X and Y deltas that center-align an edge's
 * endpoints (table columns align ports / left edges; sequences align with the
 * abducted step).
 *
 * Pinned Go: placement.alignmentDeltas
 * @returns {[number, number]}
 */
export function alignmentDeltas(e, g) {
  if (e.hasTableColumn()) {
    const ports = e.facingTablePorts(null, null);
    if (ports.hasFrom && ports.hasTo) {
      return [0, ports.to.Y - ports.from.Y];
    } else if (ports.hasFrom) {
      return [0, (e.To.TopLeft.Y + e.To.Height / 2) - ports.from.Y];
    } else if (ports.hasTo) {
      return [0, ports.to.Y - (e.From.TopLeft.Y + e.From.Height / 2)];
    }
    // Align tables to the left; center-aligning tables can route badly.
    return [e.To.TopLeft.X - e.From.TopLeft.X, 0];
  }
  let from = e.From;
  const fromSeq = g.Sequences.get(from);
  if (fromSeq !== undefined) {
    from = fromSeq.AbductedNodeByEdge(e);
  }
  let to = e.To;
  const toSeq = g.Sequences.get(to);
  if (toSeq !== undefined) {
    to = toSeq.AbductedNodeByEdge(e);
  }

  let yDiff = goRound((to.TopLeft.Y + to.Height / 2) - (from.TopLeft.Y + from.Height / 2));
  let xDiff = goRound((to.TopLeft.X + to.Width / 2) - (from.TopLeft.X + from.Width / 2));

  if (isHorizontal(e.From.orientation(e.To))) {
    xDiff = 0;
  } else if (isVertical(e.From.orientation(e.To))) {
    yDiff = 0;
  } else {
    const [xDiff2, yDiff2] = orthogonalDistanceTo(e.From, e.To);
    if (xDiff2 < CONNECTED_NODE_GAP) {
      yDiff = 0;
    }
    if (yDiff2 < CONNECTED_NODE_GAP) {
      xDiff = 0;
    }
  }
  return [xDiff, yDiff];
}

/**
 * tryMove commits each axis slide of connectedNodes in turn, scores it, and
 * rolls it back, returning the best length and its delta.
 *
 * Pinned Go: placement.tryMove
 * @returns {[number, number, number]} [bestLen, dx, dy]. Errors throw.
 */
export function tryMove(ctx, txn, g, e, connectedNodes, edgeAbductions, xDiff, yDiff) {
  let bestEdgeLength = Infinity;
  let bestAttempt = new Point(0, 0);
  const attempts = [];

  if (precisionCompare(yDiff, 0.0, PRECISION) !== 0) {
    // e.From tries to slide up or down to e.To
    attempts.push(new Point(0, yDiff));
  }

  if (precisionCompare(xDiff, 0.0, PRECISION) !== 0) {
    // e.From tries to slide left or right to e.To
    attempts.push(new Point(xDiff, 0));
  }

  const scoring = alignmentScoringOptions(edgeAbductions);
  for (const attempt of attempts) {
    txn.AddOp(() => {
      if (!attemptShift(g, e, connectedNodes, attempt.X, attempt.Y)) {
        return ErrInvalidCandidate;
      }
      return null;
    });

    const err = txn.Commit(ctx);
    if (err == null) {
      let length;
      try {
        length = edgeLength(ctx, g, scoring);
        length += containerAlignmentCost(ctx, g);
      } catch (scoreErr) {
        txn.Rollback();
        txn.Clear();
        throw scoreErr;
      }
      if (precisionCompare(length, bestEdgeLength, PRECISION) < 1) {
        bestEdgeLength = length;
        bestAttempt = new Point(attempt.X, attempt.Y);
      }
    } else if (!isCandidateRejection(err)) {
      throw err;
    }
    txn.Clear();
    txn.Rollback();
  }

  return [bestEdgeLength, bestAttempt.X, bestAttempt.Y];
}

/**
 * attemptShift translates nodes and reports whether the shift is acceptable:
 * the graph stays within bounds and the aligned edge is not obscured.
 *
 * Pinned Go: placement.attemptShift
 */
export function attemptShift(g, aligningEdge, nodes, x, y) {
  for (const n of nodes) {
    n.Translate(x, y);
  }

  if (!withinMaxSize(g)) {
    return false;
  }

  // Shifting is only useful when it yields a direct, unobscured line.
  if (intersectsOtherNode(g, aligningEdge.From, aligningEdge.To)) {
    return false;
  }

  return true;
}
