// Slice 46 — ports of key assertions from internal/packing/*_test.go
// (cancellation_test.go, atomicity_test.go, combine_test.go, guard_test.go,
// route_blocker_cancellation_test.go, routed_container_test.go).
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { FixedBoundingBox } from '../../src/graph/node-bounds.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { MAX_ENGINE_WORK_UNITS } from '../../src/limits/constants.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { pack, Pack, combineSubgraphs, CombineSubgraphs } from '../../src/packing/index.js';
import * as packingIndex from '../../src/packing/index.js';
import { packWithWorkLimit, blocksRoutesWithDeltasGuarded } from '../../src/packing/binpack.js';
import { binPackScoreGuarded, binPackSmallestDeltas, newWorkGuard } from '../../src/packing/guard.js';
import { bg, chainHas } from './packing-fixtures.js';

function placed(id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  return n;
}

function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
}

function canceledContext() {
  const canceled = new Error('context canceled');
  return { canceled, Err: () => canceled };
}

function requireCanceledAt(err, ctx, location) {
  expect(err).not.toBe(null);
  expect(chainHas(err, ctx.canceled)).toBe(true);
  expect(err.message).toContain(location);
}

function routeSnapshot(edge) {
  return { array: edge.Points, points: edge.Points.slice(), values: edge.Points.map((p) => [p.X, p.Y]) };
}

function routeChanged(edge, snapshot) {
  return edge.Points !== snapshot.array || edge.Points.length !== snapshot.points.length ||
    edge.Points.some((p, i) => p !== snapshot.points[i] || p.X !== snapshot.values[i][0] || p.Y !== snapshot.values[i][1]);
}

function expectRouteRestored(edge, snapshot) {
  expect(routeChanged(edge, snapshot)).toBe(false);
}

// binPackAtomicityGraph (atomicity_test.go)
function atomicityGraph() {
  const g = new Graph();
  const from = placed(1, 10, 10, 0, 0);
  const to = placed(2, 10, 10, 500, 500);
  const isolate = placed(3, 10, 10, 1000, 1000);
  g.addNewNodeToContainer(null, from);
  g.addNewNodeToContainer(null, to);
  g.addNewNodeToContainer(null, isolate);
  const edge = g.connect(from, to);
  edge.Points = [new Point(10, 5), new Point(250, 5), new Point(250, 505), new Point(500, 505)];
  return { g, isolate, edge };
}

// packingMutationProbe (atomicity_test.go)
function mutationProbe(node, route, edge, panicMode = false) {
  const position = [node.TopLeft.X, node.TopLeft.Y];
  const topLeft = node.TopLeft;
  const canceled = new Error('context canceled');
  const panicValue = new Error('packing mutation probe');
  return {
    canceled,
    panicValue,
    observed: false,
    Err() {
      const changed = node.TopLeft == null || node.TopLeft !== topLeft || node.TopLeft.X !== position[0] ||
        node.TopLeft.Y !== position[1] || routeChanged(edge, route);
      if (changed) {
        this.observed = true;
        if (panicMode) throw panicValue;
        return canceled;
      }
      return null;
    },
  };
}

describe('packing API boundary', () => {
  it('exports exactly pack/combineSubgraphs with PascalCase aliases', () => {
    expect(Object.keys(packingIndex).sort()).toEqual(['CombineSubgraphs', 'Pack', 'combineSubgraphs', 'pack']);
    expect(Pack).toBe(pack);
    expect(CombineSubgraphs).toBe(combineSubgraphs);
  });
});

describe('cancellation_test.go', () => {
  it('TestBinPackCanceled', () => {
    const ctx = canceledContext();
    const { err } = capture(() => pack(ctx, new Graph(), null));
    requireCanceledAt(err, ctx, 'BinPack');
  });

  it('TestBinPackCancellationRestoresState', () => {
    const g = new Graph();
    const first = placed(1, 10, 10, 0, 0);
    const second = placed(2, 10, 10, 100, 100);
    g.addNewNodeToContainer(null, first);
    g.addNewNodeToContainer(null, second);
    g.computeCellSize();
    const firstPointer = first.TopLeft;
    const secondPointer = second.TopLeft;
    const canceled = new Error('context canceled');
    const ctx = {
      canceled,
      Err: () => (second.TopLeft.X >= 100000 || second.TopLeft.Y >= 100000 ? canceled : null),
    };
    const { err } = capture(() => pack(ctx, g, null));
    requireCanceledAt(err, ctx, 'BinPack');
    expect([first.TopLeft.X, first.TopLeft.Y, second.TopLeft.X, second.TopLeft.Y]).toEqual([0, 0, 100, 100]);
    expect(first.TopLeft).toBe(firstPointer);
    expect(second.TopLeft).toBe(secondPointer);
  });
});

describe('atomicity_test.go', () => {
  it('TestBinPackCancellationRestoresExactGeometryAndRoute', () => {
    const { g, isolate, edge } = atomicityGraph();
    const pointer = isolate.TopLeft;
    const route = routeSnapshot(edge);
    const ctx = mutationProbe(isolate, route, edge);
    const { err } = capture(() => pack(ctx, g, null));
    expect(chainHas(err, ctx.canceled)).toBe(true);
    expect(ctx.observed).toBe(true);
    expect(isolate.TopLeft).toBe(pointer);
    expect([isolate.TopLeft.X, isolate.TopLeft.Y]).toEqual([1000, 1000]);
    expectRouteRestored(edge, route);
  });

  it('TestBinPackPanicRestoresExactGeometryAndRoute', () => {
    const { g, isolate, edge } = atomicityGraph();
    const pointer = isolate.TopLeft;
    const route = routeSnapshot(edge);
    const ctx = mutationProbe(isolate, route, edge, true);
    const { err } = capture(() => pack(ctx, g, null));
    expect(err).toBe(ctx.panicValue);
    expect(isolate.TopLeft).toBe(pointer);
    expect([isolate.TopLeft.X, isolate.TopLeft.Y]).toEqual([1000, 1000]);
    expectRouteRestored(edge, route);
  });

  it('TestBinPackCandidateRejectionRestoresRouteBackingBeforeNextCandidate', () => {
    const { g, edge } = atomicityGraph();
    const original = routeSnapshot(edge);
    const guard = newWorkGuard(bg, 1_000_000);
    const txnCtx = contextWithTransactionWorkGuard(bg, guard);
    const [txn, txnErr] = g.newRequestTransaction(txnCtx, { IgnoreContainerEscape: true, AffectEdgeRoutes: true });
    expect(txnErr).toBe(null);
    txn.AddOp(() => {
      edge.Points[0].X = 999;
      edge.Points[0] = new Point(777, 888);
      edge.Points.push(new Point(500, 500));
      return new Error('reject first candidate');
    });
    expect(txn.Commit(bg)).not.toBe(null);
    expectRouteRestored(edge, original);
    txn.Clear();
    let leaked = null;
    txn.AddOp(() => {
      leaked = routeChanged(edge, original);
      return null;
    });
    expect(txn.Commit(bg)).toBe(null);
    expect(leaked).toBe(false);
    expectRouteRestored(edge, original);
  });

  it('TestBinPackWorkLimitAfterMutationRestoresExactState', () => {
    const { g, isolate, edge } = atomicityGraph();
    const pointer = isolate.TopLeft;
    const route = routeSnapshot(edge);
    const { err } = capture(() => packWithWorkLimit(bg, g, null, 75));
    expect(err).not.toBe(null);
    expect(err.message).toBe('TALA BinPack work exceeds limit 75');
    expect(isolate.TopLeft).toBe(pointer);
    expect([isolate.TopLeft.X, isolate.TopLeft.Y]).toEqual([1000, 1000]);
    expectRouteRestored(edge, route);
  });
});

describe('combine_test.go', () => {
  it('TestCombineSubgraphsValidatesNodeOwnedTopologyAcrossSharedNilMaps', () => {
    const nilMaps = (g) => {
      for (const key of ['Containers', 'Clusters', 'Trees', 'NodeToTree', 'Hubs', 'Sequences', 'Directions', 'CommonUncleSiblings']) {
        g[key] = null;
      }
      return g;
    };
    const master = nilMaps(new Graph());
    const first = nilMaps(new Graph());
    const second = nilMaps(new Graph());
    const firstNode = new Node(1n, 1, 1);
    firstNode.Graph = first;
    first.Nodes = [firstNode];
    const secondNode = new Node(2n, 1, 1);
    secondNode.Graph = second;
    secondNode.Nears.add(null);
    second.Nodes = [secondNode];
    const { value, err } = capture(() => combineSubgraphs(bg, master, [first, second], null));
    expect(value).toBe(undefined);
    expect(err.message).toContain('nil near node');
  });

  it('TestCombineSubgraphsMidLoopCancellationRestoresExactGeometry', () => {
    const first = new Graph();
    const firstNode = placed(1, 1000, 1000, 100, 100);
    first.addNodeUnchecked(firstNode);
    const firstEdge = first.connect(firstNode, firstNode);
    firstEdge.Points = [new Point(100, 100), new Point(150, 175)];
    const second = new Graph();
    for (let i = 0; i < 80; i++) second.addNodeUnchecked(placed(i + 2, 1, 1, 0, 0));
    const originalTopLeft = firstNode.TopLeft;
    const originalGraph = firstNode.Graph;
    const route = routeSnapshot(firstEdge);
    const ctx = mutationProbe(firstNode, route, firstEdge);
    const { value, err } = capture(() => combineSubgraphs(ctx, new Graph(), [first, second], null));
    expect(value).toBe(undefined);
    requireCanceledAt(err, ctx, 'CombineSubgraphs');
    expect(ctx.observed).toBe(true);
    expect(firstNode.TopLeft).toBe(originalTopLeft);
    expect([firstNode.TopLeft.X, firstNode.TopLeft.Y]).toEqual([100, 100]);
    expect(firstNode.Graph).toBe(originalGraph);
    expectRouteRestored(firstEdge, route);
    for (const node of second.Nodes) expect(node.Graph).toBe(second);
  });
});

describe('guard_test.go', () => {
  it('TestBinPackScoreGuardedMatchesLegacyPolicy', () => {
    const n1 = placed(1, 80, 20, 0, 0);
    const n2 = placed(2, 20, 30, 90, 40);
    const nodes = [n1, n2];
    const legacy = (root) => {
      const [tl, br] = FixedBoundingBox(nodes);
      const width = br.X - tl.X;
      const height = br.Y - tl.Y;
      let penalty = 0;
      if (root != null) {
        if (root.DesiredWidth != null && root.DesiredHeight == null && width < root.DesiredWidth) penalty = root.DesiredWidth - width;
        else if (root.DesiredWidth == null && root.DesiredHeight != null && height < root.DesiredHeight) penalty = root.DesiredHeight - height;
      }
      return width * height + (width - height) ** 2 * 0.5 + penalty ** 2 * 0.5;
    };
    const desiredWidth = new Node(10n, 1, 1);
    desiredWidth.DesiredWidth = 300;
    const desiredHeight = new Node(11n, 1, 1);
    desiredHeight.DesiredHeight = 250;
    for (const root of [null, desiredWidth, desiredHeight]) {
      const guard = newWorkGuard(bg, 1_000_000_000);
      expect(binPackScoreGuarded(nodes, root, guard)).toBe(legacy(root));
    }
  });
});

describe('route_blocker_cancellation_test.go', () => {
  it('TestBlocksRoutesMidLoopCancellation', () => {
    const g = new Graph();
    const packing = [];
    for (let index = 0; index < 130; index++) {
      const node = placed(index + 1, 10, 10, index * 20, 0);
      g.addNodeUnchecked(node);
      packing.push(node);
    }
    const packedNode = placed(1000, 10, 10, 0, 100);
    const canceled = new Error('context canceled');
    const ctx = {
      remaining: 1,
      canceled,
      Err() {
        if (this.remaining === 0) return canceled;
        this.remaining--;
        return null;
      },
    };
    const { err } = capture(() => {
      const guard = new WorkGuard(ctx, 'BinPackRoutes', MAX_ENGINE_WORK_UNITS);
      const [xd, yd] = binPackSmallestDeltas([[packedNode]], guard);
      return blocksRoutesWithDeltasGuarded(g, packing, [[packedNode]], [], xd, yd, guard);
    });
    requireCanceledAt(err, ctx, 'BinPackRoutes');
  });
});

describe('routed_container_test.go (Pack level)', () => {
  function routedGraph({ externalX = 80, edgeX = 50, desired = true, shape = 'Square', firstX = 80, firstY = 90 } = {}) {
    const g = new Graph();
    const container = placed(1, 700, 600, 20, 30);
    container.setShape(shape);
    if (desired) container.DesiredWidth = 700;
    const first = placed(2, 20, 20, firstX, firstY);
    const moving = placed(3, 20, 20, 40, 130);
    const external = placed(4, 20, 20, externalX, -100);
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(container, first);
    g.addNewNodeToContainer(container, moving);
    g.addNewNodeToContainer(null, external);
    const edge = g.connect(container, external);
    edge.Points = [new Point(edgeX, 30), new Point(edgeX, -80)];
    return { g, container, first, moving, external, edge };
  }

  it('TestPackCompactsRoutedRectangularContainerWhenEndpointStaysOnOriginalSide', () => {
    const { g, container, first, external, edge } = routedGraph();
    const descendantExit = g.connect(first, external);
    descendantExit.Points = [new Point(90, 90), new Point(90, -80)];
    const routeA = routeSnapshot(edge);
    const routeB = routeSnapshot(descendantExit);
    pack(bg, g, container);
    expect([container.TopLeft.X, container.TopLeft.Y, container.Width]).toEqual([20, 30, 700]);
    expect(container.Height).toBeLessThan(600);
    expect(edge.Points[0].Y).toBe(container.TopLeft.Y);
    // Existing routes are preserved exactly, never cleared.
    expectRouteRestored(edge, routeA);
    expectRouteRestored(descendantExit, routeB);
  });

  it('TestPackPreservesRoutedRectangularContainerWhenShrinkChangesAttachedSide', () => {
    const { g, container } = routedGraph({ externalX: 190, edgeX: 200, desired: false, firstX: 40, firstY: 50 });
    pack(bg, g, container);
    expect([container.TopLeft.X, container.TopLeft.Y, container.Width, container.Height]).toEqual([20, 30, 700, 600]);
  });

  it('TestPackRejectsRoutedContainerWhenRootIncidenceIsMissing', () => {
    const { g, container, edge } = routedGraph({ externalX: 690, edgeX: 700, desired: false, firstX: 40, firstY: 50 });
    container.Edges = [];
    const topLeft = container.TopLeft;
    const route = routeSnapshot(edge);
    const { err } = capture(() => pack(bg, g, container));
    expect(err.message).toContain('edge inventory');
    expect(container.TopLeft).toBe(topLeft);
    expect([container.TopLeft.X, container.TopLeft.Y, container.Width, container.Height]).toEqual([20, 30, 700, 600]);
    expectRouteRestored(edge, route);
  });

  for (const [name, configure] of [
    ['route omitted from graph inventory', (g) => { g.Edges = []; }],
    ['route omitted from descendant inventory', (_g, moving) => { moving.Edges = []; }],
  ]) {
    it(`TestPackRejectsDescendantEdgeInventoryMismatch/${name}`, () => {
      const g = new Graph();
      const container = placed(1, 700, 600, 20, 30);
      container.setShape('Square');
      container.DesiredWidth = 700;
      const first = placed(2, 20, 20, 40, 50);
      const moving = placed(3, 20, 20, 40, 130);
      g.addNewNodeToContainer(null, container);
      g.addNewNodeToContainer(container, first);
      g.addNewNodeToContainer(container, moving);
      const loop = g.connect(moving, moving);
      loop.Points = [new Point(45, 150), new Point(45, 550), new Point(55, 550), new Point(55, 150)];
      configure(g, moving);
      const route = routeSnapshot(loop);
      const { err } = capture(() => pack(bg, g, container));
      expect(err.message).toContain('edge inventory');
      expect([moving.TopLeft.X, moving.TopLeft.Y, container.Width, container.Height]).toEqual([40, 130, 700, 600]);
      expectRouteRestored(loop, route);
    });
  }

  it('TestPackRejectsPartiallyRoutedGraph', () => {
    const g = new Graph();
    const container = placed(1, 700, 600, 20, 30);
    container.setShape('Square');
    const fixed = placed(2, 20, 20, 80, 80);
    fixed.FixedTopLeft = new Point(80, 80);
    const moving = placed(3, 20, 20, 80, 160);
    const external = placed(4, 20, 20, 900, 40);
    const other = placed(5, 20, 20, 900, 140);
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(container, fixed);
    g.addNewNodeToContainer(container, moving);
    g.addNewNodeToContainer(null, external);
    g.addNewNodeToContainer(null, other);
    const routed = g.connect(container, external);
    routed.Points = [new Point(720, 50), new Point(900, 50)];
    g.connect(external, other);
    const route = routeSnapshot(routed);
    const { err } = capture(() => pack(bg, g, container));
    expect(err.message).toContain('partially routed');
    expectRouteRestored(routed, route);
  });

  for (const [name, points, want] of [
    ['one point', [new Point(10, 5)], 'incomplete route'],
    ['nil point', [new Point(10, 5), null], 'nil route point'],
  ]) {
    it(`TestPackRejectsMalformedRoute/${name}`, () => {
      const g = new Graph();
      const from = placed(1, 10, 10, 0, 0);
      const to = placed(2, 10, 10, 100, 0);
      g.addNewNodeToContainer(null, from);
      g.addNewNodeToContainer(null, to);
      g.connect(from, to).Points = points;
      const topLeft = from.TopLeft;
      const { err } = capture(() => pack(bg, g, null));
      expect(err.message).toContain(want);
      expect(from.TopLeft).toBe(topLeft);
    });
  }

  it('TestPackRejectsNilEdge', () => {
    const g = new Graph();
    const node = placed(1, 10, 10, 0, 0);
    g.addNewNodeToContainer(null, node);
    g.Edges.push(null);
    const { err } = capture(() => pack(bg, g, null));
    expect(err.message).toContain('nil edge');
    expect([node.TopLeft.X, node.TopLeft.Y]).toEqual([0, 0]);
  });

  it('TestPackDoesNotMoveRoutedChildAttachedToContainer', () => {
    const g = new Graph();
    const container = placed(1, 300, 300, 0, 0);
    container.setShape('Square');
    const connected = placed(2, 20, 20, 220, 140);
    const disconnected = placed(3, 20, 20, 70, 70);
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(container, connected);
    g.addNewNodeToContainer(container, disconnected);
    const edge = g.connect(container, connected);
    edge.Points = [new Point(300, 150), new Point(240, 150)];
    const route = routeSnapshot(edge);
    pack(bg, g, container);
    expect([connected.TopLeft.X, connected.TopLeft.Y]).toEqual([220, 140]);
    expectRouteRestored(edge, route);
  });
});
