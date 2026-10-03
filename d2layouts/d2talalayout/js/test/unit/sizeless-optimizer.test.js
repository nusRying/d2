import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Point } from '../../src/geometry/point.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import {
  SizelessOptimizer,
  newSizelessOptimizer,
  canOptimizeNodeGuarded,
} from '../../src/placement/sizeless-optimizer.js';
import {
  OptimizationWorkGuard,
} from '../../src/limits/optimization.js';
import {
  MAX_OPTIMIZATION_WORK_UNITS,
} from '../../src/limits/constants.js';

const bg = { Err: () => null, isCancelled: () => false };

function addTestEdge(g, from, to) {
  const e = new Edge(from, to);
  from.Edges.push(e);
  to.Edges.push(e);
  g.AddEdge(e);
  return e;
}

describe('Slice 42 — SizelessOptimizer Unit Tests', () => {
  it('validates graph preconditions upon construction', () => {
    // Requires a graph
    assert.throws(
      () => newSizelessOptimizer(bg, null, new GoRand(1n)),
      (err) => {
        assert(err.message.includes('TALA sizelessOptimizer requires a graph'));
        return true;
      }
    );

    // Mismatched CellSize between node and graph
    const g = new Graph();
    g.CellSize = 10;
    const n = g.AddNode(new Node(1, 10, 10));
    n.Graph = { CellSize: 20 };
    assert.throws(
      () => newSizelessOptimizer(bg, g, new GoRand(1n)),
      (err) => {
        assert(err.message.includes('mismatch of cell size'));
        return true;
      }
    );
  });

  it('canOptimizeNodeGuarded correctly filters fixed and isolated nodes', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    const nFixed = g.AddNode(new Node(3, 10, 10));
    nFixed.FixedTopLeft = new Point(100, 100);
    const nIsolated = g.AddNode(new Node(4, 10, 10));
    n1.TopLeft = new Point(0, 0);
    n2.TopLeft = new Point(1, 1);
    nFixed.TopLeft = new Point(100, 100);
    nIsolated.TopLeft = new Point(20, 20);
    addTestEdge(g, n1, n2);

    const guard = new OptimizationWorkGuard(bg, 'canOpt', MAX_OPTIMIZATION_WORK_UNITS);
    assert.strictEqual(canOptimizeNodeGuarded(n1, guard), true);
    assert.strictEqual(canOptimizeNodeGuarded(n2, guard), true);
    assert.strictEqual(canOptimizeNodeGuarded(nFixed, guard), false);
    assert.strictEqual(canOptimizeNodeGuarded(nIsolated, guard), false);
  });

  it('maintains occupancy map reference identity on swap and rollback', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n1.TopLeft = new Point(0, 0);
    n2.TopLeft = new Point(1, 1);
    addTestEdge(g, n1, n2);

    const opt = newSizelessOptimizer(bg, g, new GoRand(42n));
    const occupiedRef = opt.occupied;
    assert.notStrictEqual(occupiedRef, undefined);

    // Initial occupancy entries
    assert.strictEqual(opt.isOccupied(new Point(0, 0)), true);
    assert.strictEqual(opt.isOccupied(new Point(1, 1)), true);
    assert.strictEqual(opt.isOccupied(new Point(2, 2)), false);

    // After optimization, occupancy map reference identity must NOT change
    opt.optimize(bg, 1.0);
    assert.strictEqual(opt.occupied, occupiedRef);
  });

  it('finds best swap candidate among adjacent nodes', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    const n3 = g.AddNode(new Node(3, 10, 10));
    n1.TopLeft = new Point(0, 0);
    n2.TopLeft = new Point(1, 0);
    n3.TopLeft = new Point(2, 0);
    addTestEdge(g, n1, n2);
    addTestEdge(g, n2, n3);

    const opt = newSizelessOptimizer(bg, g, new GoRand(1n));
    const guard = new OptimizationWorkGuard(bg, 'swapTest', MAX_OPTIMIZATION_WORK_UNITS);

    const candidates = opt.swapCandidatesGuarded(n1, guard);
    assert(Array.isArray(candidates));
    const candIds = candidates.map((n) => n.ID);
    assert(candIds.includes(2), 'n2 should be candidate for n1');
  });

  it('rolls back exact node positions when optimize throws or is canceled', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n1.TopLeft = new Point(0, 0);
    n2.TopLeft = new Point(20, 20);
    addTestEdge(g, n1, n2);

    const opt = newSizelessOptimizer(bg, g, new GoRand(1n));
    const canceledCtx = { Err: () => new Error('canceled'), isCancelled: () => true };

    assert.throws(
      () => opt.optimize(canceledCtx, 1.0),
      (err) => {
        assert(err != null);
        return true;
      }
    );

    // Positions must be atomically restored to exact pre-optimize coordinates
    assert.strictEqual(n1.TopLeft.X, 0);
    assert.strictEqual(n1.TopLeft.Y, 0);
    assert.strictEqual(n2.TopLeft.X, 20);
    assert.strictEqual(n2.TopLeft.Y, 20);
  });
});
