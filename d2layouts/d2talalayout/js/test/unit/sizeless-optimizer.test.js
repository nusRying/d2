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

  it('canOptimizeNodeGuarded correctly checks nodes with g and guard', () => {
    const g = new Graph();
    g.CellSize = 10;
    const nEdge1 = g.AddNode(new Node(1, 10, 10));
    const nEdge2 = g.AddNode(new Node(2, 10, 10));
    addTestEdge(g, nEdge1, nEdge2);

    const nFixed = g.AddNode(new Node(3, 10, 10));
    nFixed.FixedTopLeft = new Point(100, 100);

    const nTree = g.AddNode(new Node(4, 10, 10));
    if (!g.NodeToTree) g.NodeToTree = new Map();
    g.NodeToTree.set(nTree, {});

    const nIsolated = g.AddNode(new Node(5, 10, 10));

    // Container hierarchy for usable / unusable nears
    const parentContainer = g.AddNode(new Node(10, 50, 50));
    const childContainer = g.AddNode(new Node(11, 50, 50));
    childContainer.Container = parentContainer;

    const otherContainer = g.AddNode(new Node(12, 50, 50));

    // Usable near: near is descendant of node.Container
    const nNearUsable = g.AddNode(new Node(6, 10, 10));
    nNearUsable.Container = parentContainer;
    const nearChild = g.AddNode(new Node(7, 10, 10));
    nearChild.Container = childContainer;
    nNearUsable.Nears.add(nearChild);

    // Unusable near: near is outside node.Container
    const nNearOutside = g.AddNode(new Node(8, 10, 10));
    nNearOutside.Container = parentContainer;
    const nearOutside = g.AddNode(new Node(9, 10, 10));
    nearOutside.Container = otherContainer;
    nNearOutside.Nears.add(nearOutside);

    const guard = new OptimizationWorkGuard(bg, 'canOpt', MAX_OPTIMIZATION_WORK_UNITS);
    const initialUsed = guard.used;

    // edge node -> true
    assert.strictEqual(canOptimizeNodeGuarded(nEdge1, g, guard), true);
    // fixed node -> false
    assert.strictEqual(canOptimizeNodeGuarded(nFixed, g, guard), false);
    // tree node -> false
    assert.strictEqual(canOptimizeNodeGuarded(nTree, g, guard), false);
    // isolated/no-near -> false
    assert.strictEqual(canOptimizeNodeGuarded(nIsolated, g, guard), false);
    // edge-less usable near -> true
    assert.strictEqual(canOptimizeNodeGuarded(nNearUsable, g, guard), true);
    // edge-less near outside raw node.Container ancestry -> false
    assert.strictEqual(canOptimizeNodeGuarded(nNearOutside, g, guard), false);

    // Guard work must have been charged during near descendant checks
    assert(guard.used > initialUsed, 'guard used must have advanced when scanning nears');
  });

  it('supports disabled edgeLengthCache (null) across store, snapshot, restore, and reset', () => {
    const g = new Graph();
    g.edgeLengthCache = null;

    // StoreEdgeLengthCost -> no-op
    assert.doesNotThrow(() => g.StoreEdgeLengthCost('dummyState', 42));
    assert.strictEqual(g.edgeLengthCache, null);
    assert.strictEqual(g.EdgeLengthCacheEntries(), 0);

    // SnapshotPlacementCosts
    const snap = g.SnapshotPlacementCosts();
    assert.strictEqual(snap.cacheRef, null);

    // Mutate costs/cache mode
    g.edgeLengthCache = new Map([['temp', 100]]);
    g.crossingCost = 15;
    g.turnCost = 25;
    g.nonCenterPortCost = 35;

    // Restore()
    snap.Restore();
    assert.strictEqual(g.edgeLengthCache, null);
    assert.strictEqual(g.crossingCost, 0);
    assert.strictEqual(g.turnCost, 0);
    assert.strictEqual(g.nonCenterPortCost, 0);

    // ResetPlacementCosts() -> still null
    g.ResetPlacementCosts();
    assert.strictEqual(g.edgeLengthCache, null);

    // Enabled cache identity test
    const enabledCache = new Map([['key1', 5]]);
    g.edgeLengthCache = enabledCache;
    const snapEnabled = g.SnapshotPlacementCosts();
    g.edgeLengthCache.set('key2', 10);
    snapEnabled.Restore();
    assert.strictEqual(g.edgeLengthCache, enabledCache);
    assert.strictEqual(g.edgeLengthCache.has('key2'), false);
    assert.strictEqual(g.edgeLengthCache.get('key1'), 5);
  });

  it('releases optimizer scratch on early occupancy copy failure and preserves Map identity on rollback', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n1.TopLeft = new Point(0, 0);
    n2.TopLeft = new Point(1, 1);
    addTestEdge(g, n1, n2);

    const opt = newSizelessOptimizer(bg, g, new GoRand(1n));
    const occupiedRef = opt.occupied;

    // Work limit of 2n allows the 2 nodes snapshot, but fails on 1st occupied entry step
    assert.throws(
      () => opt.optimizeWithLimit(bg, 1.0, 2n),
      (err) => {
        assert(err != null);
        return true;
      }
    );

    // Mutation scratch must have released its retained references
    assert.strictEqual(opt.mutationScratch.nodes.length, 0);
    assert.strictEqual(opt.mutationScratch.costSnapshot, null);
    assert.strictEqual(opt.mutationScratch.seenNodes.size, 0);
    // Graph positions must NOT have been altered
    assert.strictEqual(n1.TopLeft.X, 0);
    assert.strictEqual(n1.TopLeft.Y, 0);

    // Rollback preserves exact Map reference identity
    const canceledCtx = { Err: () => new Error('mid-cancel') };
    assert.throws(() => opt.optimize(canceledCtx, 1.0));
    assert.strictEqual(opt.occupied, occupiedRef);
  });

  it('preserves exact error message in moveNodeToBestGuarded late context check', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    n1.TopLeft = new Point(0, 0);
    const opt = newSizelessOptimizer(bg, g, new GoRand(1n));
    const guard = new OptimizationWorkGuard(bg, 'moveTest', MAX_OPTIMIZATION_WORK_UNITS);
    const points = [new Point(1, 1)];

    assert.throws(
      () => opt.moveNodeToBestGuarded({ Err: () => new Error('context canceled') }, n1, points, guard),
      (err) => {
        assert.strictEqual(err.message, 'EdgeLength: context canceled');
        return true;
      }
    );

    assert.throws(
      () => opt.moveNodeToBestGuarded({ Err: () => new Error('context deadline exceeded') }, n1, points, guard),
      (err) => {
        assert.strictEqual(err.message, 'EdgeLength: context deadline exceeded');
        return true;
      }
    );

    assert.throws(
      () => opt.moveNodeToBestGuarded({ Err: () => new Error('oracle custom edge error') }, n1, points, guard),
      (err) => {
        assert.strictEqual(err.message, 'EdgeLength: oracle custom edge error');
        return true;
      }
    );
  });

  it('preserves exact error message in bestSwapCandidateGuarded late context check', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n1.TopLeft = new Point(0, 0);
    n2.TopLeft = new Point(1, 0);
    addTestEdge(g, n1, n2);
    const opt = newSizelessOptimizer(bg, g, new GoRand(1n));
    const guard = new OptimizationWorkGuard(bg, 'swapCheck', MAX_OPTIMIZATION_WORK_UNITS);

    assert.throws(
      () => opt.bestSwapCandidateGuarded({ Err: () => new Error('context canceled') }, n1, guard),
      (err) => {
        assert.strictEqual(err.message, 'EdgeLength: context canceled');
        return true;
      }
    );

    assert.throws(
      () => opt.bestSwapCandidateGuarded({ Err: () => new Error('context deadline exceeded') }, n1, guard),
      (err) => {
        assert.strictEqual(err.message, 'EdgeLength: context deadline exceeded');
        return true;
      }
    );

    assert.throws(
      () => opt.bestSwapCandidateGuarded({ Err: () => new Error('oracle custom edge error') }, n1, guard),
      (err) => {
        assert.strictEqual(err.message, 'EdgeLength: oracle custom edge error');
        return true;
      }
    );
  });

  it('correctly reports hasArrowTo and isTargetedTo across all arrow combinations and self-loops', () => {
    const n1 = new Node(1, 10, 10);
    const n2 = new Node(2, 10, 10);
    const nOther = new Node(3, 10, 10);

    // 1. Source arrow only
    const eSourceOnly = new Edge(n1, n2);
    eSourceOnly.SourceArrowhead = 'arrow';
    eSourceOnly.TargetArrowhead = '';
    assert.strictEqual(eSourceOnly.hasArrowTo(n1), true);
    assert.strictEqual(eSourceOnly.hasArrowTo(n2), false);
    assert.strictEqual(eSourceOnly.hasArrowTo(nOther), false);
    assert.strictEqual(eSourceOnly.isTargetedTo(n1), true);
    assert.strictEqual(eSourceOnly.isTargetedTo(n2), false);

    // 2. Target arrow only
    const eTargetOnly = new Edge(n1, n2);
    eTargetOnly.SourceArrowhead = '';
    eTargetOnly.TargetArrowhead = 'arrow';
    assert.strictEqual(eTargetOnly.hasArrowTo(n1), false);
    assert.strictEqual(eTargetOnly.hasArrowTo(n2), true);
    assert.strictEqual(eTargetOnly.hasArrowTo(nOther), false);
    assert.strictEqual(eTargetOnly.isTargetedTo(n2), true);

    // 3. Both arrows (bidirectional)
    const eBoth = new Edge(n1, n2);
    eBoth.SourceArrowhead = 'arrow';
    eBoth.TargetArrowhead = 'arrow';
    assert.strictEqual(eBoth.hasArrowTo(n1), true);
    assert.strictEqual(eBoth.hasArrowTo(n2), true);
    assert.strictEqual(eBoth.hasArrowTo(nOther), false);

    // 4. No arrows (undirected)
    const eNone = new Edge(n1, n2);
    eNone.SourceArrowhead = '';
    eNone.TargetArrowhead = '';
    assert.strictEqual(eNone.hasArrowTo(n1), false);
    assert.strictEqual(eNone.hasArrowTo(n2), false);
    assert.strictEqual(eNone.hasArrowTo(nOther), false);

    // 5. Self-loop
    const eSelfArrow = new Edge(n1, n1);
    eSelfArrow.TargetArrowhead = 'arrow';
    assert.strictEqual(eSelfArrow.hasArrowTo(n1), true);

    const eSelfNone = new Edge(n1, n1);
    assert.strictEqual(eSelfNone.hasArrowTo(n1), false);
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
