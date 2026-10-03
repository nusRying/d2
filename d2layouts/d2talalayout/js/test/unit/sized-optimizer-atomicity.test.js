// Slice 45 — sized optimizer rollback and identity. Ports the atomicity cases of
// internal/placement/sized_optimizer_test.go and optimizer_simplex_hardening_test.go.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { OptimizationWorkGuard, isOptimizationResourceLimitError } from '../../src/limits/optimization.js';
import { MAX_OPTIMIZATION_WORK_UNITS } from '../../src/limits/constants.js';
import { WorkContext } from '../../src/limits/work-context.js';
import { edgeLength } from '../../src/placementcost/graph.js';
import { nodeEdgeLength } from '../../src/placementcost/edge-length.js';
import { newSizedOptimizer, withHubSpokesSuppressed } from '../../src/placement/sized-optimizer.js';
import { bg, buildSpec, capture, chainHas, fixtureState, newOptimizer, stateOf } from './sized-optimizer-fixtures.js';

// simpleOptimizationGraph(true) from optimizer_simplex_hardening_test.go
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

function captureExact(g) {
  return g.Nodes.map((n) => ({ node: n, pointer: n.TopLeft, x: n.TopLeft.X, y: n.TopLeft.Y, w: n.Width, h: n.Height }));
}

function expectExact(positions) {
  for (const p of positions) {
    expect(p.node.TopLeft).toBe(p.pointer);
    expect([p.node.TopLeft.X, p.node.TopLeft.Y, p.node.Width, p.node.Height]).toEqual([p.x, p.y, p.w, p.h]);
  }
}

function mutationObserver(positions, onMutation) {
  return {
    observed: false,
    Err() {
      for (const p of positions) {
        if (p.node.TopLeft !== p.pointer || p.node.TopLeft.X !== p.x || p.node.TopLeft.Y !== p.y ||
            p.node.Width !== p.w || p.node.Height !== p.h) {
          this.observed = true;
          return onMutation();
        }
      }
      return null;
    },
  };
}

describe('Slice 45 — sized optimizer whole-run rollback', () => {
  it('restores exact state on a low work limit (TestSizedOptimizerLowLimitRestoresExactState)', () => {
    const g = simpleOptimizationGraph();
    const positions = captureExact(g);
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const result = capture(() => optim.optimizeWithLimit(bg, 0, 2));
    expect(isOptimizationResourceLimitError(result.err)).toBe(true);
    expectExact(positions);
  });

  it('restores positions, routing costs, and cache before rethrowing a mid-mutation throw (TestSizedOptimizerMidMutationPanicRestoresExactState)', () => {
    const g = simpleOptimizationGraph();
    const positions = captureExact(g);
    edgeLength(bg, g, { EdgeAbductions: null, IncludeNodeSizes: true, EnforceMinimumGap: false, PenalizeDirection: true });
    const wantState = 0x7f00a11n;
    g.storeEdgeLengthCost(wantState, 73.5);
    const wantCosts = g.routingCosts();
    const wantEntries = g.edgeLengthCacheEntries();
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const sentinel = { name: 'optimizer mutation observer' };
    const ctx = mutationObserver(positions, () => {
      throw sentinel;
    });
    const result = capture(() => optim.optimize(ctx, 0));
    expect(result.err).toBe(sentinel);
    expect(ctx.observed).toBe(true);
    expectExact(positions);
    expect(g.routingCosts()).toEqual(wantCosts);
    expect(g.edgeLengthCacheEntries()).toBe(wantEntries);
    expect(g.lookupEdgeLengthCost(wantState)).toEqual([73.5, true]);
  });

  it('restores state and reports EdgeLength cancellation after a trial mutation', () => {
    const g = simpleOptimizationGraph();
    const positions = captureExact(g);
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const canceled = new Error('context canceled');
    const ctx = mutationObserver(positions, () => canceled);
    const result = capture(() => optim.optimize(ctx, 0));
    expect(ctx.observed).toBe(true);
    expect(chainHas(result.err, canceled)).toBe(true);
    expectExact(positions);
  });

  it('restores herd fence values and cluster policy when the run fails late', () => {
    const run = buildSpec({ cluster: true });
    run.nodes.get(1).HerdAssignment = { Orientation: 4, Val: 123 };
    const initial = fixtureState(stateOf(run));
    const cluster = run.g.Clusters.get(run.nodes.get(5));
    const policy = [cluster.Arrangement, cluster.DesiredArrangement, cluster.Padding];
    const { optim } = newOptimizer(run, 2);
    // A tiny limit fails inside the run after setup and snapshot capture.
    const result = capture(() => optim.optimizeWithLimit(bg, 1, 200));
    expect(isOptimizationResourceLimitError(result.err)).toBe(true);
    expect(fixtureState(stateOf(run))).toEqual(initial);
    expect([cluster.Arrangement, cluster.DesiredArrangement, cluster.Padding]).toEqual(policy);
    expect(run.nodes.get(1).HerdAssignment.Val).toBe(123);
  });
});

describe('Slice 45 — sized optimizer component rollback', () => {
  it('restores both swap positions on symmetry cancellation (TestSizedSwapRestoresPositionsOnSymmetryCancellation)', () => {
    const g = new Graph();
    const first = new Node(1n, 10, 10);
    first.TopLeft = new Point(0, 0);
    const second = new Node(2n, 10, 10);
    second.TopLeft = new Point(80, 0);
    g.addNewNodeToContainer(null, first);
    g.addNewNodeToContainer(null, second);
    g.computeCellSize();
    g.CellSize = 100;
    const optim = newSizedOptimizer(bg, g, null, null, new GoRand(1), null);
    const firstPoint = first.TopLeft;
    const secondPoint = second.TopLeft;
    const canceled = new Error('context canceled');
    let remaining = 3; // edgeLength and the non-table column check succeed.
    const ctx = {
      Err() {
        if (first.TopLeft != null && first.TopLeft.X === 80 && first.TopLeft.Y === 0) {
          if (remaining === 0) return canceled;
          remaining--;
        }
        return null;
      },
    };
    const guard = new OptimizationWorkGuard(ctx, 'LocalOptimize', MAX_OPTIMIZATION_WORK_UNITS);
    optim.rebuildSpatialIndex(guard);
    const result = capture(() => optim.bestSwapCandidateGuarded(ctx, first, guard));
    expect(result.value).toBeUndefined();
    expect(chainHas(result.err, canceled)).toBe(true);
    expect(result.err.message).toContain('EdgeLength');
    expect(first.TopLeft).toBe(firstPoint);
    expect([first.TopLeft.X, first.TopLeft.Y]).toEqual([0, 0]);
    expect(second.TopLeft).toBe(secondPoint);
    expect([second.TopLeft.X, second.TopLeft.Y]).toEqual([80, 0]);
  });

  it('restores the exact hub edge array on cancellation (TestHubSpokeSuppressionRestoresExactEdgeSliceOnCancellation)', () => {
    const g = new Graph();
    const add = (id, x) => {
      const n = new Node(BigInt(id), 10, 10);
      n.TopLeft = new Point(x, 0);
      g.addNewNodeToContainer(null, n);
      return n;
    };
    const hub = add(1, 0);
    const spoke = add(2, 20);
    add(3, 40);
    g.connect(hub, spoke);
    g.connect(hub, g.Nodes[2]);
    g.computeCellSize();
    const originalEdges = hub.Edges;
    const contents = [...hub.Edges];
    const guard = new OptimizationWorkGuard(bg, 'LocalOptimize', MAX_OPTIMIZATION_WORK_UNITS);
    const ctx = new WorkContext({ isCancelled: () => true });
    const result = capture(() => withHubSpokesSuppressed(hub, [spoke], guard, () => {
      expect(hub.Edges.length).toBe(contents.length - 1);
      return nodeEdgeLength(ctx, hub, { EdgeAbductions: null, IncludeNodeSizes: false, EnforceMinimumGap: false, PenalizeDirection: true });
    }));
    expect(chainHas(result.err, ctx.Err())).toBe(true);
    expect(result.err.message).toContain('EdgeLength');
    expect(hub.Edges).toBe(originalEdges);
    expect([...hub.Edges]).toEqual(contents);
  });

  it('restores the moving node and its descendants when scoring throws mid-search', () => {
    const run = buildSpec({ cluster: true });
    const vessel = run.nodes.get(5);
    const tracked = run.tracked.map((n) => [n, n.TopLeft, n.TopLeft.X, n.TopLeft.Y]);
    const { optim } = newOptimizer(run, 1);
    const sentinel = { name: 'scoring throw' };
    const ctx = {
      Err() {
        if (vessel.TopLeft.X !== 1000 || vessel.TopLeft.Y !== 1220) throw sentinel;
        return null;
      },
    };
    const guard = new OptimizationWorkGuard(bg, 'LocalOptimize', MAX_OPTIMIZATION_WORK_UNITS);
    optim.rebuildSpatialIndex(guard);
    const result = capture(() => optim.moveNodeToBestGuarded(ctx, vessel, [new Point(1300, 1220), new Point(700, 1220)], false, guard));
    expect(result.err).toBe(sentinel);
    for (const [n, pointer, x, y] of tracked) {
      expect(n.TopLeft).toBe(pointer);
      expect([n.TopLeft.X, n.TopLeft.Y]).toEqual([x, y]);
    }
  });

  it('restores state and reports the pinned error when no placement is valid', () => {
    const run = buildSpec({ compute: true, nodes: [
      { id: 1, w: 50, h: 50, placed: true, x: 100, y: 0 }, { id: 2, w: 50, h: 50, placed: true, x: 0, y: 100 },
      { id: 3, w: 50, h: 50, placed: true, x: 200, y: 100 }, { id: 4, w: 50, h: 50, placed: true, x: 100, y: 200 },
      { id: 5, w: 50, h: 50, placed: true, x: 0, y: 0 },
    ], edges: [{ from: 1, to: 5 }, { from: 2, to: 5 }, { from: 3, to: 5 }, { from: 4, to: 5 }] });
    const n5 = run.nodes.get(5);
    const pointer = n5.TopLeft;
    const { optim } = newOptimizer(run, 1);
    const guard = new OptimizationWorkGuard(bg, 'LocalOptimize', MAX_OPTIMIZATION_WORK_UNITS);
    optim.rebuildSpatialIndex(guard);
    const result = capture(() => optim.moveNodeToBestGuarded(bg, n5, [new Point(100, 100), new Point(200, 100)], false, guard));
    expect(result.err.message).toBe('sizedOptimizer: could not find any placement');
    expect(n5.TopLeft).toBe(pointer);
    expect([n5.TopLeft.X, n5.TopLeft.Y]).toEqual([0, 0]);
  });
});
