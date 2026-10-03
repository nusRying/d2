// Slice 46 — focused ports of the pinned Go unit tests for the placement
// stages: dejitter_test.go, dejitter_atomicity_test.go,
// symmetry_resource_test.go, extracted_kernels_test.go (direction kernels and
// mirrorAxes atomicity), cancellation_test.go
// (TestOptimizationHelpersCanceledBeforeWork), and atomicity_test.go
// (TestEquidistanceMidReachabilityCancellationIsAtomic).
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Tree } from '../../src/graph/tree.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { MAX_ENGINE_WORK_UNITS } from '../../src/limits/constants.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { dejitter } from '../../src/placement/dejitter.js';
import { balanceSymmetry, isSimple } from '../../src/placement/symmetry.js';
import {
  DirectionCounts,
  compareDirectionCounts,
  direct,
  edgeDirectionCounts,
  mirrorAxes,
} from '../../src/placement/direct.js';
import { tryMove } from '../../src/placement/alignment.js';
import { equidistance } from '../../src/placement/equidistance.js';
import { chainHas } from './sized-optimizer-fixtures.js';

const bg = backgroundWorkContext();
const CANCELED = new Error('context canceled');

function placed(id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  return n;
}

function route(edge, ...coords) {
  edge.Points = [];
  for (let i = 0; i < coords.length; i += 2) edge.Points.push(new Point(coords[i], coords[i + 1]));
}

function flat(points) {
  return points.flatMap((p) => [p.X, p.Y]);
}

function canceledContext() {
  return { Err: () => CANCELED };
}

function predicateContext(predicate) {
  return {
    observed: false,
    Err() {
      if (predicate()) {
        this.observed = true;
        return CANCELED;
      }
      return null;
    },
  };
}

function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
}

// Go cancelWhenStackContains(..., "reachableNodesGuarded"): cancel only
// while Node.reachableNodesGuarded is on the stack.
function withReachabilityCancellation(fn) {
  const original = Node.prototype.reachableNodesGuarded;
  let depth = 0;
  Node.prototype.reachableNodesGuarded = function patched(...args) {
    depth++;
    try {
      return original.apply(this, args);
    } finally {
      depth--;
    }
  };
  try {
    return fn({ Err: () => (depth > 0 ? CANCELED : null) });
  } finally {
    Node.prototype.reachableNodesGuarded = original;
  }
}

describe('Dejitter (dejitter_test.go)', () => {
  it('TestBasicDejitter', () => {
    const graph = new Graph();
    const a = placed(1, 8, 8, 4, 4);
    const b = placed(2, 8, 8, 20, 3);
    graph.addNode(a);
    graph.addNode(b);
    const edge = graph.connect(a, b);
    route(edge, 12, 4, 16, 4, 16, 3, 20, 3);
    expect(dejitter(bg, graph)).toBe(true);
    expect(flat(edge.Points)).toEqual([12, 3, 20, 3]);
  });

  it('TestDejitterProhibitOne', () => {
    const graph = new Graph();
    const d = placed(1, 8, 8, 4, 4);
    const a = placed(2, 8, 8, 20, 4);
    const b = placed(3, 8, 8, 40, 3);
    graph.addNode(a);
    graph.addNode(b);
    graph.addNode(d);
    const ab = graph.connect(a, b);
    route(ab, 28, 4, 34, 4, 34, 3, 40, 3);
    const da = graph.connect(d, a);
    route(da, 12, 4, 20, 4);
    dejitter(bg, graph);
    expect(flat(ab.Points)).toEqual([28, 4, 40, 4]);
  });

  it('TestNoDejitter1', () => {
    const graph = new Graph();
    const d = placed(1, 8, 8, 4, 4);
    const a = placed(2, 8, 8, 20, 4);
    const b = placed(3, 8, 8, 40, 3);
    const c = placed(4, 8, 8, 60, 3);
    for (const n of [a, b, c, d]) graph.addNode(n);
    const ab = graph.connect(a, b);
    route(ab, 28, 4, 34, 4, 34, 3, 40, 3);
    route(graph.connect(d, a), 12, 4, 20, 4);
    route(graph.connect(b, c), 48, 3, 60, 3);
    expect(dejitter(bg, graph)).toBe(false);
    expect(flat(ab.Points)).toEqual([28, 4, 34, 4, 34, 3, 40, 3]);
  });

  it('TestDejitterWithTangentConnections', () => {
    const graph = new Graph();
    const d = placed(1, 8, 8, 4, 40);
    const a = placed(2, 8, 8, 4, 20);
    const b = placed(3, 8, 8, 20, 18);
    const c = placed(4, 8, 8, 20, 4);
    for (const n of [a, b, c, d]) graph.addNode(n);
    const ab = graph.connect(a, b);
    route(ab, 12, 24, 16, 24, 16, 22, 20, 22);
    route(graph.connect(a, d), 8, 28, 8, 40);
    route(graph.connect(b, c), 24, 18, 24, 12);
    dejitter(bg, graph);
    expect(flat(ab.Points)).toEqual([12, 22, 20, 22]);
  });
});

describe('Dejitter atomicity (dejitter_atomicity_test.go)', () => {
  const CACHE_KEY = 0xdecafbadn;

  function atomicityGraph(finalCandidate) {
    const graph = new Graph();
    const a = placed(1, 8, 8, 4, 4);
    const b = placed(2, 8, 8, 20, 3);
    if (finalCandidate) {
      b.FixedTopLeft = new Point(20, 3);
      graph.addNode(b);
      graph.addNode(a);
    } else {
      graph.addNode(a);
      graph.addNode(b);
    }
    const edge = graph.connect(a, b);
    route(edge, 12, 4, 16, 4, 16, 3, 20, 3);
    graph.restoreRoutingCosts({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
    graph.storeEdgeLengthCost(CACHE_KEY, 11);
    return { graph, node: a, edge };
  }

  function snapshot({ graph, node, edge }) {
    return {
      topLeft: node.TopLeft,
      topLeftValue: [node.TopLeft.X, node.TopLeft.Y],
      route: edge.Points,
      pointers: [...edge.Points],
      values: edge.Points.map((p) => [p.X, p.Y]),
      costs: graph.routingCosts(),
      assert() {
        expect(node.TopLeft).toBe(this.topLeft);
        expect([node.TopLeft.X, node.TopLeft.Y]).toEqual(this.topLeftValue);
        expect(edge.Points).toBe(this.route);
        expect(edge.Points.length).toBe(this.pointers.length);
        edge.Points.forEach((p, i) => expect(p).toBe(this.pointers[i]));
        expect(edge.Points.map((p) => [p.X, p.Y])).toEqual(this.values);
        expect(graph.routingCosts()).toEqual(this.costs);
        expect(graph.lookupEdgeLengthCost(CACHE_KEY)).toEqual([11, true]);
        expect(graph.edgeLengthCacheEntries()).toBe(1);
      },
    };
  }

  // dejitterMutationContext: cancel once the route has been shortened.
  const mutationContext = (edge) => predicateContext(() => edge.Points.length === 2);

  it('TestDejitterCancellationRestoresAcceptedMutation', () => {
    const fixture = atomicityGraph(false);
    const snap = snapshot(fixture);
    const ctx = mutationContext(fixture.edge);
    const { value, err } = capture(() => dejitter(ctx, fixture.graph));
    expect(value).toBeUndefined();
    expect(chainHas(err, CANCELED)).toBe(true);
    expect(err.message).toContain('EdgeLength');
    expect(ctx.observed).toBe(true);
    snap.assert();
  });

  it('TestDejitterPanicRestoresAcceptedMutation', () => {
    const fixture = atomicityGraph(false);
    const snap = snapshot(fixture);
    const sentinel = { name: 'dejitter panic' };
    let observed = false;
    const ctx = {
      Err() {
        if (fixture.edge.Points.length === 2) {
          observed = true;
          throw sentinel;
        }
        return null;
      },
    };
    const { err } = capture(() => dejitter(ctx, fixture.graph));
    expect(err).toBe(sentinel);
    expect(observed).toBe(true);
    snap.assert();
  });

  it('TestDejitterFinalCancellationRestoresAcceptedMutation', () => {
    const fixture = atomicityGraph(true);
    const snap = snapshot(fixture);
    const ctx = mutationContext(fixture.edge);
    const { err } = capture(() => dejitter(ctx, fixture.graph));
    expect(chainHas(err, CANCELED)).toBe(true);
    expect(err.message).toContain('DejitterTransactions');
    expect(ctx.observed).toBe(true);
    snap.assert();
  });

  it('TestDejitterSuccessCommitsAcceptedMutation', () => {
    const { graph, node, edge } = atomicityGraph(false);
    const topLeft = node.TopLeft;
    const routeArray = edge.Points;
    expect(dejitter(bg, graph)).toBe(true);
    expect(node.TopLeft).toBe(topLeft);
    expect([node.TopLeft.X, node.TopLeft.Y]).toEqual([4, 3]);
    // Go appends into the same backing array.
    expect(edge.Points).toBe(routeArray);
    expect(flat(edge.Points)).toEqual([12, 3, 20, 3]);
    expect(graph.routingCosts()).toEqual({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
    expect(graph.lookupEdgeLengthCost(CACHE_KEY)).toEqual([11, true]);
    expect(graph.edgeLengthCacheEntries()).toBe(1);
  });

  it('reports forceReroute=false and leaves an empty graph untouched', () => {
    expect(dejitter(bg, new Graph())).toBe(false);
  });
});

describe('BalanceSymmetry (symmetry_resource_test.go)', () => {
  function starsGraph(secondQualifies) {
    const graph = new Graph();
    const addStar = (id, x, suppress) => {
      const center = placed(id, 10, 10, x, 40);
      const top = placed(id + 1, 10, 10, x + 100, 0);
      const bottom = placed(id + 2, 10, 10, x + 100, 100);
      graph.addNodeUnchecked(center);
      graph.addNodeUnchecked(top);
      graph.addNodeUnchecked(bottom);
      const first = graph.connect(center, top);
      const second = graph.connect(center, bottom);
      if (suppress) {
        first.FromTableColumnIndex = 0;
        second.FromTableColumnIndex = 0;
      }
    };
    addStar(1, 0, false);
    addStar(4, 2000, !secondQualifies);
    return graph;
  }

  function positions(graph) {
    return graph.Nodes.map((n) => ({ n, p: n.TopLeft, v: [n.TopLeft.X, n.TopLeft.Y] }));
  }

  function expectPositions(saved) {
    for (const { n, p, v } of saved) {
      expect(n.TopLeft).toBe(p);
      expect([n.TopLeft.X, n.TopLeft.Y]).toEqual(v);
    }
  }

  it('TestBalanceSymmetryEmptyGraphPreservesContextPreflight', () => {
    expect(() => balanceSymmetry(bg, new Graph())).not.toThrow();
    const { err } = capture(() => balanceSymmetry(canceledContext(), new Graph()));
    expect(chainHas(err, CANCELED)).toBe(true);
  });

  it('TestBalanceSymmetryDirectCallSharesAggregateTransactionGuard', () => {
    const baselineGuard = new WorkGuard(bg, 'BalanceSymmetryAggregateTest', MAX_ENGINE_WORK_UNITS);
    baselineGuard.SetLimit(1000000);
    const baselineGraph = starsGraph(false);
    balanceSymmetry(contextWithTransactionWorkGuard(bg, baselineGuard), baselineGraph);
    const used = baselineGuard.Used();
    expect(used > 0n).toBe(true);
    expect(baselineGraph.Nodes[0].TopLeft.Y).toBe(50);

    const limitedGuard = new WorkGuard(bg, 'BalanceSymmetryAggregateTest', MAX_ENGINE_WORK_UNITS);
    limitedGuard.SetLimit(used);
    const limitedGraph = starsGraph(true);
    const saved = positions(limitedGraph);
    const { err } = capture(() => balanceSymmetry(contextWithTransactionWorkGuard(bg, limitedGuard), limitedGraph));
    expect(err.message).toContain(`work exceeds limit ${used}`);
    expect(limitedGuard.Used()).toBe(used + 1n);
    expectPositions(saved);
  });

  // interruptBalanceSymmetryAfterFirstCommit: once the first node moved,
  // cancel inside the next transaction construction.
  function interruptAfterFirstCommit(graph, payload) {
    const node = graph.Nodes[0];
    const original = [node.TopLeft.X, node.TopLeft.Y];
    let inConstructor = false;
    const ownCtor = graph.NewRequestTransactionWithWorkGuard;
    graph.NewRequestTransactionWithWorkGuard = function patched(...args) {
      inConstructor = true;
      try {
        return ownCtor.apply(this, args);
      } finally {
        inConstructor = false;
      }
    };
    return {
      observed: false,
      Err() {
        const moved = node.TopLeft != null && (node.TopLeft.X !== original[0] || node.TopLeft.Y !== original[1]);
        if (moved && inConstructor) {
          this.observed = true;
          if (payload != null) throw payload;
          return CANCELED;
        }
        return null;
      },
    };
  }

  it('TestBalanceSymmetryCancellationAfterCommitRestoresStage', () => {
    const graph = starsGraph(true);
    const saved = positions(graph);
    const ctx = interruptAfterFirstCommit(graph, null);
    const { err } = capture(() => balanceSymmetry(ctx, graph));
    expect(ctx.observed).toBe(true);
    expect(chainHas(err, CANCELED)).toBe(true);
    expectPositions(saved);
  });

  it('TestBalanceSymmetryPanicAfterCommitRestoresStage', () => {
    const graph = starsGraph(true);
    const saved = positions(graph);
    const payload = { sentinel: true };
    const ctx = interruptAfterFirstCommit(graph, payload);
    const { err } = capture(() => balanceSymmetry(ctx, graph));
    expect(ctx.observed).toBe(true);
    expect(err).toBe(payload);
    expectPositions(saved);
  });

  it('TestBalanceSymmetrySuccessCommitsStage', () => {
    const graph = starsGraph(true);
    const pointers = graph.Nodes.map((n) => n.TopLeft);
    balanceSymmetry(bg, graph);
    graph.Nodes.forEach((n, i) => expect(n.TopLeft).toBe(pointers[i]));
    expect(graph.Nodes[0].TopLeft.Y).toBe(50);
    expect(graph.Nodes[3].TopLeft.Y).toBe(50);
  });

  it('isSimple rejects containers and cluster members', () => {
    const graph = new Graph();
    const container = placed(1, 100, 100, 0, 0);
    const child = placed(2, 10, 10, 20, 20);
    graph.addNewNodeToContainer(null, container);
    graph.addNewNodeToContainer(container, child);
    expect(isSimple(graph, container)).toBe(false);
    expect(isSimple(graph, child)).toBe(true);
    child.Cluster = {};
    expect(isSimple(graph, child)).toBe(false);
  });
});

describe('Direction kernels (extracted_kernels_test.go)', () => {
  it('TestEdgeDirectionCountsUseSemanticArrowEndpoints', () => {
    const left = placed(1, 10, 10, 0, 0);
    const right = placed(2, 10, 10, 100, 0);
    const targetRight = new Edge(left, right);
    targetRight.TargetArrowhead = 'triangle';
    const sourceLeft = new Edge(left, right);
    sourceLeft.SourceArrowhead = 'triangle';
    const equivalentTargetLeft = new Edge(right, left);
    equivalentTargetLeft.TargetArrowhead = 'triangle';
    expect({ ...edgeDirectionCounts(targetRight) }).toEqual({ left: 0, right: 1, top: 0, bottom: 0 });
    expect({ ...edgeDirectionCounts(sourceLeft) }).toEqual({ left: 1, right: 0, top: 0, bottom: 0 });
    expect({ ...edgeDirectionCounts(equivalentTargetLeft) }).toEqual({ ...edgeDirectionCounts(sourceLeft) });
  });

  it('TestCompareDirectionCountsIsReflexiveAndPreservesTies', () => {
    const values = [
      { direction: Orientation.Left, count: 2 },
      { direction: Orientation.Top, count: 2 },
      { direction: Orientation.Right, count: 2 },
      { direction: Orientation.Bottom, count: 2 },
    ];
    for (const v of values) expect(compareDirectionCounts(v, v, Orientation.Right)).toBe(0);
    values.sort((a, b) => compareDirectionCounts(a, b, Orientation.Right));
    expect(values.map((v) => v.direction)).toEqual([
      Orientation.Right, Orientation.Left, Orientation.Top, Orientation.Bottom,
    ]);
  });

  it('TestDirectionTransforms', () => {
    const c = ({ left = 0, right = 0, top = 0, bottom = 0 } = {}) => new DirectionCounts(left, right, top, bottom);
    const tests = [
      [c(), Orientation.Right, false, false],
      [c({ right: 1 }), Orientation.Right, false, false],
      [c({ right: 1 }), Orientation.Left, true, false],
      [c({ bottom: 1 }), Orientation.Top, false, true],
      [c({ top: 1 }), Orientation.Bottom, false, true],
      [c({ left: 2, top: 1 }), Orientation.Right, true, true],
      [c({ left: 1, top: 1, right: 1 }), Orientation.Right, false, true],
      [c({ left: 1, bottom: 1 }), Orientation.Bottom, true, false],
      [c({ left: 1, bottom: 1 }), Orientation.NONE, true, false],
    ];
    for (const [counts, direction, mirrorX, mirrorY] of tests) {
      expect(counts.transformsTo(direction)).toEqual({ mirrorX, mirrorY });
    }
  });

  it('TestMirrorAxesMidReachabilityCancellationReturnsBeforeMutation', () => {
    const graph = new Graph();
    let previous = null;
    const saved = [];
    for (let i = 0; i < 130; i++) {
      const node = placed(i + 1, 10, 10, i * 20, 0);
      graph.addNodeUnchecked(node);
      saved.push([node, node.TopLeft.X, node.TopLeft.Y]);
      if (previous != null) graph.connect(previous, node);
      previous = node;
    }
    const { err } = withReachabilityCancellation((ctx) => capture(() => mirrorAxes(ctx, graph, true, true)));
    expect(chainHas(err, CANCELED)).toBe(true);
    for (const [node, x, y] of saved) expect([node.TopLeft.X, node.TopLeft.Y]).toEqual([x, y]);
  });

  for (const waitForTree of [false, true]) {
    it(`TestMirrorAxesMutationCancellationRestoresExactState/${waitForTree ? 'tree' : 'node'}`, () => {
      const graph = new Graph();
      const node = placed(1, 10, 10, 25, 40);
      graph.addNodeUnchecked(node);
      const tree = new Tree(node);
      tree.Orientation = Orientation.Right;
      graph.NodeToTree = new Map([[node, tree]]);
      const pointer = node.TopLeft;
      const ctx = predicateContext(() => (waitForTree
        ? tree.Orientation !== Orientation.Right
        : node.TopLeft == null || node.TopLeft.X !== 25 || node.TopLeft.Y !== 40));
      const { err } = capture(() => mirrorAxes(ctx, graph, true, false));
      expect(chainHas(err, CANCELED)).toBe(true);
      expect(ctx.observed).toBe(true);
      expect(node.TopLeft).toBe(pointer);
      expect([node.TopLeft.X, node.TopLeft.Y]).toEqual([25, 40]);
      expect(tree.Orientation).toBe(Orientation.Right);
    });
  }

  it('direct accepts the Go zero-value options object', () => {
    const graph = new Graph();
    const a = placed(1, 40, 40, 300, 0);
    const b = placed(2, 40, 40, 0, 0);
    graph.addNewNodeToContainer(null, a);
    graph.addNewNodeToContainer(null, b);
    graph.connect(a, b).TargetArrowhead = 'triangle';
    direct(bg, graph, graph.Nodes, null, {});
    // Mirrored on X so the edge points right.
    expect(a.TopLeft.X < b.TopLeft.X).toBe(true);
  });
});

describe('Cancellation before work (cancellation_test.go, atomicity_test.go)', () => {
  it('TestOptimizationHelpersCanceledBeforeWork', () => {
    const ctx = canceledContext();
    const graph = new Graph();
    let { err } = capture(() => direct(ctx, graph, null, null, { checkEdgeLength: true }));
    expect(chainHas(err, CANCELED)).toBe(true);
    const [txn, txnErr] = graph.NewRequestTransaction(bg, {});
    expect(txnErr).toBeNull();
    ({ err } = capture(() => tryMove(ctx, txn, graph, null, null, null, 1, 1)));
    expect(chainHas(err, CANCELED)).toBe(true);
  });

  it('TestEquidistanceMidReachabilityCancellationIsAtomic', () => {
    const g = new Graph();
    const node = placed(1, 10, 10, 0, 0);
    const back = placed(2, 10, 10, -30, 0);
    const front = placed(3, 10, 10, 30, 0);
    const other = placed(4, 10, 10, 0, -30);
    for (const n of [node, back, front, other]) g.addNodeUnchecked(n);
    g.connect(node, back);
    g.connect(node, front);
    g.connect(node, other);
    let previous = other;
    for (let i = 0; i < 130; i++) {
      const connected = placed(10 + i, 10, 10, 0, -50 - i * 20);
      g.addNodeUnchecked(connected);
      g.connect(previous, connected);
      previous = connected;
    }
    const saved = g.Nodes.map((n) => [n, n.TopLeft, n.TopLeft.X, n.TopLeft.Y]);
    const { err } = withReachabilityCancellation((ctx) => capture(() => equidistance(ctx, g)));
    expect(chainHas(err, CANCELED)).toBe(true);
    for (const [n, p, x, y] of saved) {
      expect(n.TopLeft).toBe(p);
      expect([n.TopLeft.X, n.TopLeft.Y]).toEqual([x, y]);
    }
  });
});
