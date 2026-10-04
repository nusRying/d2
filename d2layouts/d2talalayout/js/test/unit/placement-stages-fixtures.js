// Shared Slice 46 placement-stage scenario builders. Mirrors s46stSpec.build,
// s46stBuilt.state, and the stage op table in
// internal/placement/go_slice46_stages_oracle_test.go. Not a test file.
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Tree } from '../../src/graph/tree.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation, orientationToString } from '../../src/geometry/orientation.js';
import { ensureTransactionWorkGuard, contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { alignAxes } from '../../src/placement/alignment.js';
import { direct, mirrorAxes } from '../../src/placement/direct.js';
import { swapOptimize } from '../../src/placement/swap.js';
import { equidistance } from '../../src/placement/equidistance.js';
import { dejitter } from '../../src/placement/dejitter.js';
import { balanceSymmetry } from '../../src/placement/symmetry.js';
import { align, swap } from '../../src/placement/stage-wrappers.js';
import { bg } from './sized-optimizer-fixtures.js';

/** Mirrors s46stSpec.build. */
export function buildStageSpec(spec) {
  const g = new Graph();
  g.CellSize = spec.cellSize ?? 0;
  const nodes = new Map();
  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), ns.w, ns.h);
    if (ns.placed) n.TopLeft = new Point(ns.x, ns.y);
    if (ns.fixed) n.FixedTopLeft = new Point(ns.fx ?? 0, ns.fy ?? 0);
    const container = ns.container ? nodes.get(ns.container) : null;
    g.addNewNodeToContainer(container, n);
    nodes.set(ns.id, n);
  }
  for (const ts of spec.tables ?? []) {
    nodes.get(ts.id).setShape('Table');
    nodes.get(ts.id).setNumColumns(ts.columns);
  }
  for (const es of spec.edges ?? []) {
    const e = g.connect(nodes.get(es.from), nodes.get(es.to));
    const pts = es.points ?? [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      e.Points.push(new Point(pts[i], pts[i + 1]));
    }
    if (es.fromCol != null) e.FromTableColumnIndex = es.fromCol;
    if (es.toCol != null) e.ToTableColumnIndex = es.toCol;
    if (es.srcArrow) e.SourceArrowhead = 'triangle';
    if (es.tgtArrow) e.TargetArrowhead = 'triangle';
  }
  for (const d of spec.directions ?? []) {
    g.Directions.set(d.node ? nodes.get(d.node) : null, Orientation[d.orientation]);
  }
  const trees = [];
  if ((spec.trees ?? []).length > 0) {
    g.NodeToTree = new Map();
    for (const ts of spec.trees) {
      const tree = new Tree(nodes.get(ts.node));
      tree.Orientation = Orientation[ts.orientation];
      g.NodeToTree.set(nodes.get(ts.node), tree);
      trees.push(tree);
    }
  }
  return { g, nodes, trees };
}

/** Mirrors s46stBuilt.state (Go omitempty drops an empty tree list). */
export function stageState(built) {
  const st = {
    boxes: built.g.Nodes.map((n) => ({
      id: Number(n.ID),
      placed: n.TopLeft != null,
      x: n.TopLeft != null ? n.TopLeft.X : 0,
      y: n.TopLeft != null ? n.TopLeft.Y : 0,
      w: n.Width,
      h: n.Height,
    })),
    routes: built.g.Edges.map((e) => e.Points.flatMap((p) => [p.X, p.Y])),
  };
  if (built.trees.length > 0) {
    st.trees = built.trees.map((t) => orientationToString(t.Orientation));
  }
  return st;
}

/** Mirrors s44Guard: a limited aggregate transaction guard on context. */
export function limitedStageGuard(limit) {
  const guard = new WorkGuard(bg, 'Slice44PlacementOracle', limit);
  return { guard, ctx: contextWithTransactionWorkGuard(bg, guard) };
}

/** Mirrors s46stOps. Each op returns a boolean (false for void stages). */
export const STAGE_OPS = {
  align(ctx, b) {
    align(ctx, b.g);
    return false;
  },
  alignAxes(ctx, b) {
    [ctx] = ensureTransactionWorkGuard(ctx, 'Slice46AlignAxes');
    const [txn, err] = b.g.NewRequestTransaction(ctx, { AffectContainers: true });
    if (err != null) throw err;
    return alignAxes(ctx, b.g, txn);
  },
  swap(ctx, b) {
    swap(ctx, b.g);
    return false;
  },
  swapOptimize(ctx, b) {
    return swapOptimize(ctx, b.g.Nodes, b.g);
  },
  direct(ctx, b) {
    direct(ctx, b.g, b.g.Nodes, null, {});
    return false;
  },
  directCheck(ctx, b) {
    direct(ctx, b.g, b.g.Nodes, null, { checkEdgeLength: true });
    return false;
  },
  mirrorX(ctx, b) {
    mirrorAxes(ctx, b.g, true, false);
    return false;
  },
  mirrorXY(ctx, b) {
    mirrorAxes(ctx, b.g, true, true);
    return false;
  },
  equidistance(ctx, b) {
    return equidistance(ctx, b.g);
  },
  dejitter(ctx, b) {
    return dejitter(ctx, b.g);
  },
  balance(ctx, b) {
    balanceSymmetry(ctx, b.g);
    return false;
  },
};

/** Runs op on a fresh build; captures result, error, and final state. */
export function runStage(op, spec, ctx) {
  const built = buildStageSpec(spec);
  let result = false;
  let error = null;
  try {
    result = STAGE_OPS[op](ctx, built);
  } catch (err) {
    error = err;
  }
  return { built, result, error, state: stageState(built) };
}
