// Slice 45 — sized optimizer resources, cancellation, budgets, and determinism.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { OptimizationWorkGuard, isOptimizationResourceLimitError } from '../../src/limits/optimization.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { WorkContext } from '../../src/limits/work-context.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import {
  MAX_OPTIMIZATION_WORK_UNITS,
  MAX_TRANSACTION_WORK_UNITS,
} from '../../src/limits/constants.js';
import { MAX_OPTIMIZER_PLACEMENT_CANDIDATES } from '../../src/placement/optimizer-support.js';
import { newSizedOptimizer } from '../../src/placement/sized-optimizer.js';
import { bg, buildSpec, capture, newOptimizer } from './sized-optimizer-fixtures.js';

function simpleOptimizationGraph() {
  const g = new Graph();
  const nodes = [[0, 0], [200, 0], [400, 100]].map(([x, y], i) => {
    const n = new Node(BigInt(i + 1), 50, 50);
    n.TopLeft = new Point(x, y);
    g.addNodeUnchecked(n);
    return n;
  });
  g.connect(nodes[0], nodes[1]);
  g.connect(nodes[1], nodes[2]);
  g.computeCellSize();
  return g;
}

describe('Slice 45 — sized optimizer setup and cancellation', () => {
  it('honors a canceled context during setup (TestOptimizerSetupHonorsCanceledContext)', () => {
    const ctx = new WorkContext({ isCancelled: () => true });
    const result = capture(() => newSizedOptimizer(ctx, simpleOptimizationGraph(), null, null, new GoRand(1), null));
    expect(result.value).toBeUndefined();
    expect(result.err.message).toBe('LocalOptimizeSetup: context canceled');
    expect(result.err.cause).toBe(ctx.Err());
  });

  it('honors a canceled context before any optimizer work', () => {
    const g = simpleOptimizationGraph();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const ctx = new WorkContext({ isCancelled: () => true });
    const result = capture(() => optim.optimize(ctx, 0));
    expect(result.err.message).toBe('LocalOptimizeTransactions: context canceled');
    expect(result.err.cause).toBe(ctx.Err());
  });

  it('requires a random generator', () => {
    const g = simpleOptimizationGraph();
    const optim = newSizedOptimizer(bg, g, null, null, null, null);
    expect(() => optim.optimize(bg, 0)).toThrow('TALA LocalOptimize requires a random generator');
  });
});

describe('Slice 45 — sized optimizer resource limits', () => {
  it('classifies work-limit failures as optimization resource errors', () => {
    const optim = newSizedOptimizer(bg, simpleOptimizationGraph(), null, null, new GoRand(1), null);
    const result = capture(() => optim.optimizeWithLimit(bg, 0, 10));
    expect(isOptimizationResourceLimitError(result.err)).toBe(true);
    expect(result.err.message).toBe('TALA optimization resource limit exceeded: TALA LocalOptimize work exceeds limit 10');
  });

  it('enforces the checked-placement cache limit', () => {
    const g = simpleOptimizationGraph();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const node = g.Nodes[0];
    const guard = new OptimizationWorkGuard(bg, 'LocalOptimize', MAX_OPTIMIZATION_WORK_UNITS);
    optim.rebuildSpatialIndex(guard);
    const checked = new Map();
    for (let i = 0; i < MAX_OPTIMIZER_PLACEMENT_CANDIDATES; i++) checked.set(`k${i}`, true);
    const full = capture(() => optim.findUnoccupiedGuarded(5, 5, node.Width, node.Height, true, node, new Point(0, 0), checked, guard));
    expect(isOptimizationResourceLimitError(full.err)).toBe(true);
    expect(full.err.message).toBe(
      `TALA optimization resource limit exceeded: TALA LocalOptimize checked placement count exceeds limit ${MAX_OPTIMIZER_PLACEMENT_CANDIDATES}`,
    );
    checked.set('extra', true);
    const over = capture(() => optim.findClosestUnoccupiedDistanceGuarded(node, new Point(0, 0), true, checked, guard));
    expect(isOptimizationResourceLimitError(over.err)).toBe(true);
  });
});

describe('Slice 45 — sized optimizer budgets and determinism', () => {
  it('repeats identical runs for a fixed seed (TestOptimizerSuccessfulRunsRemainDeterministic)', () => {
    const results = [];
    for (let run = 0; run < 2; run++) {
      const g = simpleOptimizationGraph();
      const optim = newSizedOptimizer(bg, g, null, null, new GoRand(7), null);
      optim.optimize(bg, 0);
      results.push(g.Nodes.map((n) => [Number(n.ID), n.TopLeft.X, n.TopLeft.Y]));
    }
    expect(results[1]).toEqual(results[0]);
  });

  it('charges transpose fallback transactions to the caller transaction guard', () => {
    const built = buildSpec({ compute: true, nodes: [
      { id: 1, w: 50, h: 50, placed: true, x: 0, y: 0 },
      { id: 2, w: 50, h: 50, placed: true, x: 200, y: 0 },
      { id: 3, w: 50, h: 50, placed: true, x: 400, y: 100 },
    ], edges: [{ from: 1, to: 2 }, { from: 2, to: 3 }] });
    const { optim } = newOptimizer(built, 1);
    // Converge first so the measured pass leaves nodes in place and reaches the
    // transpose fallback.
    for (let i = 0; i < 4; i++) optim.optimize(bg, 0);
    const txGuard = new WorkGuard(bg, 'SizedOptimizerShared', MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, txGuard);
    const guards = new Set();
    const original = built.g.newRequestTransaction.bind(built.g);
    built.g.newRequestTransaction = (txCtx, options) => {
      const created = original(txCtx, options);
      guards.add(created[0].guard);
      return created;
    };
    expect(optim.optimize(ctx, 0)).toBe(false);
    expect(guards.size).toBeGreaterThan(0);
    expect([...guards]).toEqual([txGuard]);
    expect(Number(txGuard.Used())).toBeGreaterThan(0);
  });
});
