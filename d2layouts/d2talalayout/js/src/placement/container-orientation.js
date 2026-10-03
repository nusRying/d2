// Slice 46 — container interior orientation.
//
// Pinned reference: d2layouts/d2talalayout/internal/placement/container_orientation.go

import { Point } from '../geometry/point.js';
import { goRound } from '../geometry/math.js';
import { Orientation, isVertical } from '../geometry/orientation.js';
import { flipArrangement } from '../graph/cluster.js';
import {
  ErrInvalidCandidate,
  ErrNonImprovingCandidate,
  isCandidateRejection,
} from '../graph/transaction.js';
import { paddingBetween } from '../grouping/clusters-orchestration.js';
import { MAX_ENGINE_WORK_UNITS, MAX_GRAPH_SIZE } from '../limits/constants.js';
import { TransactionWorkContext } from '../limits/transaction-guard.js';
import { getContextError } from '../limits/work-context.js';
import { WorkGuard } from '../limits/work-guard.js';
import { LayoutAxis } from './axis.js';
import { compaction } from './compaction.js';

const CONTAINER_ORIENTATION_DISABLED = '_containerOrientationDisabled';

/**
 * contextWithOrientationDisabled mirrors
 * `context.WithValue(ctx, containerOrientationDisabled{}, true)`: Err and the
 * request transaction guard are forwarded from the parent unchanged.
 */
function contextWithOrientationDisabled(ctx) {
  const derived = new TransactionWorkContext(ctx, ctx?._transactionWorkGuard ?? null);
  derived[CONTAINER_ORIENTATION_DISABLED] = true;
  return derived;
}

/** ctx.Value(containerOrientationDisabled{}) == true, walking derived contexts. */
export function containerOrientationDisabled(ctx) {
  for (let current = ctx; current != null; current = current._parent) {
    if (Object.prototype.hasOwnProperty.call(current, CONTAINER_ORIENTATION_DISABLED)) {
      return current[CONTAINER_ORIENTATION_DISABLED] === true;
    }
  }
  return false;
}

/**
 * orientationContext disables container orientation for layouts with any
 * self loop. Returns the (possibly derived) context.
 */
export function orientationContext(ctx, g) {
  const guard = new WorkGuard(ctx, 'ContainerOrientationPreflight', MAX_ENGINE_WORK_UNITS);
  for (const e of g.Edges) {
    guard.Step();
    if (e != null && e.isLoop()) {
      return contextWithOrientationDisabled(ctx);
    }
  }
  guard.Finish();
  return ctx;
}

/** interiorFlow → {x, y, across, along}. */
export function interiorFlow(g, local, guard) {
  const flow = { x: 0, y: 0, across: 0, along: 0 };
  const seen = new Map();
  for (const e of g.Edges) {
    guard.Step();
    const [from, to, ok] = e.DirectedEndpoints();
    if (!ok || from === to || !local.get(from) || !local.get(to)) continue;
    let targets = seen.get(from);
    if (targets == null) {
      targets = new Set();
      seen.set(from, targets);
    }
    if (targets.has(to)) continue;
    targets.add(to);
    const a = from.Center();
    const b = to.Center();
    const dx = b.X - a.X;
    const dy = b.Y - a.Y;
    const length = Math.abs(dx) + Math.abs(dy);
    if (length === 0) continue;
    flow.x += dx / length;
    flow.across += Math.abs(dx) / length;
    flow.y += dy / length;
    flow.along += Math.abs(dy) / length;
  }
  guard.Finish();
  return flow;
}

/** orientationFootprintSize fits root around g, then restores its size. */
export function orientationFootprintSize(g, root) {
  const oldWidth = root.Width;
  const oldHeight = root.Height;
  try {
    root.FitToGraph(g, g.ContainerPadding(root, false));
    return [root.Width, root.Height];
  } finally {
    root.Width = oldWidth;
    root.Height = oldHeight;
  }
}

export function orientationFitsContainer(g, root) {
  const [width, height] = orientationFootprintSize(g, root);
  return width >= 0 && height >= 0 && width <= MAX_GRAPH_SIZE && height <= MAX_GRAPH_SIZE;
}

function hasPositiveLoopOffset(node) {
  const offsets = node.LoopOffsets;
  if (offsets == null) return false;
  const values = offsets instanceof Map ? offsets.values() : Object.values(offsets);
  for (const offset of values) {
    if (offset > 0) return true;
  }
  return false;
}

/**
 * orientSourceInterior aligns the internal flow of a small source container
 * with its surrounding flow, before the parent is fitted around the result.
 */
export function orientSourceInterior(ctx, g, root, obstacles) {
  const ctxErr = getContextError(ctx);
  if (ctxErr != null) throw ctxErr;
  if (
    containerOrientationDisabled(ctx) ||
    root == null ||
    g.Nodes.length < 3 ||
    g.Nodes.length > 16 ||
    (obstacles?.length ?? 0) !== 0 ||
    root.FixedTopLeft != null ||
    root.Cluster != null ||
    root.Sequence != null ||
    root.ForceHierarchy ||
    root.Graph.Direction(root) !== Orientation.NONE
  ) {
    return;
  }
  const direction = g.Direction(root.OwningContainer());
  if (!isVertical(direction) || root.Edges.length < 3) return;

  const guard = new WorkGuard(ctx, 'ContainerOrientation', MAX_ENGINE_WORK_UNITS);
  const destinations = new Set();
  for (const e of root.Edges) {
    guard.Step();
    const [from, to, ok] = e.DirectedEndpoints();
    if (!ok || from !== root || to === root) return;
    destinations.add(to);
  }
  if (destinations.size < 2) return;

  const local = new Map();
  for (const n of g.Nodes) {
    if (
      n.IsContainer() ||
      n.Hierarchy != null ||
      n.FixedTopLeft != null ||
      n.Sequence != null ||
      g.IsTreeSentinel(n) ||
      g.IsSequenceVessel(n) ||
      n.HerdAssignment != null
    ) {
      return;
    }
    if (hasPositiveLoopOffset(n)) return;
    local.set(n, true);
  }
  for (const n of g.Nodes) {
    for (const near of n.Nears) {
      if (!local.get(near)) return;
    }
  }
  const flow = interiorFlow(g, local, guard);
  if (flow.across <= flow.along + 1e-9 || Math.abs(flow.x) <= 1e-9) return;
  let turn = 1.0;
  if ((flow.x < 0) !== (direction === Orientation.Top)) turn = -1;

  const [beforeWidth, beforeHeight] = orientationFootprintSize(g, root);
  const [txn, txnErr] = g.NewRequestTransaction(ctx, { IgnoreContainerEscape: true });
  if (txnErr != null) throw txnErr;
  txn.AddOp(() => {
    const centers = new Map();
    for (const n of g.Nodes) centers.set(n, n.Center().copy());
    for (const n of g.Nodes) {
      guard.Step();
      const c = g.Clusters.get(n);
      if (c != null) {
        c.Arrangement = flipArrangement(c.Arrangement);
        c.DesiredArrangement = c.Arrangement;
        c.Padding = paddingBetween(c, true);
        c.Resize(n);
      }
      const p = centers.get(n);
      n.TopLeft = new Point(goRound(-turn * p.Y - n.Width / 2), goRound(turn * p.X - n.Height / 2));
    }
    g.SyncNestedGeometry();
    const oldCell = g.CellSize;
    g.CellSize = 1;
    try {
      for (const axis of [LayoutAxis.Horizontal, LayoutAxis.Vertical]) {
        compaction(ctx, g, { axis, includeSizes: true, factor: 1, transition: true });
      }
      g.SyncNestedGeometry();
      const [tl, br] = g.BoundingBox();
      const [width, height] = orientationFootprintSize(g, root);
      if (
        br.X - tl.X > MAX_GRAPH_SIZE ||
        br.Y - tl.Y > MAX_GRAPH_SIZE ||
        !(width >= 0 && height >= 0 && width <= MAX_GRAPH_SIZE && height <= MAX_GRAPH_SIZE)
      ) {
        return ErrInvalidCandidate;
      }
      if (width * height > 2 * beforeWidth * beforeHeight) {
        return ErrNonImprovingCandidate;
      }
      const after = interiorFlow(g, local, guard);
      const sign = direction === Orientation.Top ? -1 : 1;
      if (sign * after.y <= sign * flow.y + 1e-9) {
        return ErrNonImprovingCandidate;
      }
      guard.Finish();
      return null;
    } finally {
      g.CellSize = oldCell;
    }
  });
  const err = txn.Commit(ctx);
  if (err != null) {
    if (isCandidateRejection(err)) return;
    throw err;
  }
}
