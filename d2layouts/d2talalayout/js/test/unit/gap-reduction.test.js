// Slice 44 — gap reduction. Ports the pinned Go tests in
// internal/placement/gapreduction_test.go and adds context/guard ownership
// checks. Exhaustive refresh-failure parity lives in slice44-oracle.test.js.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext, WorkContext } from '../../src/limits/work-context.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import { IDEAL_GAP_SIZE } from '../../src/placementcost/geometry.js';
import { LayoutAxis, TraversalDirection } from '../../src/placement/axis.js';
import { gapNormalization, reduceGapToNeighbors } from '../../src/placement/gap-reduction.js';
import { newTransactionWithOptionsContext } from '../../src/graph/transaction.js';

const bg = backgroundWorkContext();
const horizontal = { axis: LayoutAxis.Horizontal, direction: TraversalDirection.Forward };
const vertical = { axis: LayoutAxis.Vertical, direction: TraversalDirection.Forward };

function placed(g, id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  g.addNode(n);
  return n;
}

function mustNewTransaction(g, ctx = bg) {
  const [txn, err] = newTransactionWithOptionsContext(g, ctx, { AffectContainers: true }, null);
  expect(err).toBeNull();
  return txn;
}

describe('Slice 44 — gapNormalization (pinned Go tests)', () => {
  it('pulls a connected node to the ideal gap (TestGapNormalizationBasic)', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 10, 0, 0);
    const b = placed(g, 2, 10, 10, 1000, 0);
    g.connect(a, b);
    gapNormalization(bg, g.Nodes, mustNewTransaction(g), g, horizontal);
    expect(b.TopLeft.X).toBe(a.TopLeft.X + a.Width + IDEAL_GAP_SIZE);
  });

  it('rejects incomplete options (TestGapNormalizationRejectsIncompleteOptions)', () => {
    const g = new Graph();
    const txn = mustNewTransaction(g);
    expect(() => gapNormalization(bg, [], txn, g, { direction: TraversalDirection.Forward })).toThrow('TALA GapNormalization requires an axis');
    expect(() => gapNormalization(bg, [], txn, g, { axis: LayoutAxis.Horizontal })).toThrow('TALA GapNormalization requires a direction');
  });

  it('normalizes both axes independently (TestGapNormalizationBothDirections)', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 10, 0, 0);
    const b = placed(g, 2, 10, 10, 1000, 0);
    const c = placed(g, 3, 10, 10, 1000, 1000);
    g.connect(a, b);
    const txn = mustNewTransaction(g);
    gapNormalization(bg, g.Nodes, txn, g, horizontal);
    gapNormalization(bg, g.Nodes, txn, g, vertical);
    expect(b.TopLeft.X).toBe(a.TopLeft.X + a.Width + IDEAL_GAP_SIZE);
    expect(b.TopLeft.Y).toBe(0);
    expect(c.TopLeft.X).toBe(1000);
    expect(c.TopLeft.Y).toBe(1000);
  });

  it('moves a connected subgraph together (TestGapNormalizationMovesConnectedSubgraphTogether)', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 100, 0, 0);
    const b = placed(g, 2, 10, 10, 1000, 0);
    const c = placed(g, 3, 10, 10, 2000, 0);
    g.connect(a, b);
    g.connect(a, c);
    g.connect(b, c);
    const originalBCGap = c.TopLeft.X - b.TopLeft.X;
    gapNormalization(bg, g.Nodes, mustNewTransaction(g), g, horizontal);
    expect(b.TopLeft.X).toBe(a.TopLeft.X + a.Width + IDEAL_GAP_SIZE);
    expect(originalBCGap).toBe(1000);
    expect(c.TopLeft.X - b.TopLeft.X).toBe(originalBCGap);
  });
});

describe('Slice 44 — gap reduction context and budget ownership', () => {
  it('charges every nested transaction to the caller guard', () => {
    const g = new Graph();
    const a = placed(g, 1, 40, 40, 0, 0);
    const b = placed(g, 2, 40, 40, 900, 0);
    const c = placed(g, 3, 40, 40, 1800, 0);
    placed(g, 4, 40, 40, 900, 400);
    g.connect(a, b);
    g.connect(c, b);
    g.connect(b, g.Nodes[3]);
    const guard = new WorkGuard(bg, 'SharedGapGuard', MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    const guards = new Set();
    const original = g.newRequestTransaction.bind(g);
    g.newRequestTransaction = (txCtx, options) => {
      const created = original(txCtx, options);
      guards.add(created[0].guard);
      return created;
    };
    const [txn] = original(ctx, { AffectContainers: true });
    guards.add(txn.guard);
    expect(gapNormalization(ctx, g.Nodes, txn, g, horizontal)).toBe(true);
    expect([...guards]).toEqual([guard]);
  });

  it('reports a pre-canceled context with its exact identity before any work', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 10, 0, 0);
    const b = placed(g, 2, 10, 10, 1000, 0);
    g.connect(a, b);
    const ctx = new WorkContext({ isCancelled: () => true });
    let thrown = null;
    try {
      reduceGapToNeighbors(ctx, a, null, horizontal);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(ctx.Err());
    expect(b.TopLeft.X).toBe(1000);
  });

  it('rolls back the accepted move when cancellation follows the commit', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 10, 0, 0);
    const b = placed(g, 2, 10, 10, 1000, 0);
    g.connect(a, b);
    const original = b.TopLeft;
    const canceled = new Error('context canceled');
    let observed = false;
    const ctx = {
      Err() {
        if (b.TopLeft.X !== 1000) {
          observed = true;
          return canceled;
        }
        return null;
      },
    };
    const txn = mustNewTransaction(g);
    let thrown = null;
    try {
      gapNormalization(ctx, g.Nodes, txn, g, horizontal);
    } catch (err) {
      thrown = err;
    }
    expect(observed).toBe(true);
    for (let e = thrown; ; e = e.cause) {
      if (e === canceled) break;
      expect(e).not.toBeNull();
    }
    expect(b.TopLeft).toBe(original);
    expect(b.TopLeft.X).toBe(1000);
  });

  it('rolls back and rethrows a panic raised after the accepted move', () => {
    const g = new Graph();
    const a = placed(g, 1, 10, 10, 0, 0);
    const b = placed(g, 2, 10, 10, 1000, 0);
    g.connect(a, b);
    const sentinel = { name: 'gap panic' };
    const ctx = {
      Err() {
        if (b.TopLeft.X !== 1000) throw sentinel;
        return null;
      },
    };
    const txn = mustNewTransaction(g);
    let thrown = null;
    try {
      gapNormalization(ctx, g.Nodes, txn, g, horizontal);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(sentinel);
    expect(b.TopLeft.X).toBe(1000);
  });
});
