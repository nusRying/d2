// Slice 47 — exact rollback identity of the atomic route stage, plus key
// assertions ported from internal/routing post_route_atomicity_test.go,
// stage_context_atomicity_test.go, edge_routing_stage_resource_test.go,
// reorder_duplicates_test.go, cost_test.go and route_test.go.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Point } from '../../src/geometry/point.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import {
  errorIs, errRouteStageWorkLimit, MAX_ROUTE_STAGE_WORK_UNITS, newRouteWorkGuard,
} from '../../src/routing/route-guards.js';
import {
  captureRouteMutations, routeStageGraphBoundingBox, runAtomicRouteStage, runAtomicRouteStageAfterPreflight,
} from '../../src/routing/route-stage.js';
import {
  edgeHasOverlappingEndGuarded, reorderDuplicatesInEdgesGuarded, traceToShapeBorderGuarded,
} from '../../src/routing/standalone-route-guard.js';
import { estimateRouteCostGuarded } from '../../src/routing/cluster-route-guard.js';
import { estimateRouteCost } from '../../src/routing/cost.js';
import { Route } from '../../src/routing/route.js';
import { MaxRoutePoints, MaxTopologyReferences } from '../../src/routing/layoutgraph-route-support.js';

const ctx = () => backgroundWorkContext();

function simplificationGraph() {
  const g = new Graph();
  const from = new Node(1n, 10, 10);
  const to = new Node(2n, 10, 10);
  from.TopLeft = new Point(1000, 1000);
  to.TopLeft = new Point(2000, 2000);
  g.addNewNodeToContainer(null, from);
  g.addNewNodeToContainer(null, to);
  const edge = g.connect(from, to);
  edge.Points = [new Point(0, 0), new Point(10, 0), new Point(10, 10), new Point(20, 10), new Point(20, 0)];
  edge.Label = new Label('l', 30, 12);
  edge.Label.Position = LabelPosition.UnlockedMiddle;
  edge.Style = { Stroke: { Value: 'red' } };
  return { g, from, to, edge };
}

function captureIdentity({ g, from, to, edge }) {
  return {
    points: edge.Points,
    members: [...edge.Points],
    values: edge.Points.map((p) => [p.X, p.Y]),
    label: edge.Label,
    labelValues: { ...edge.Label },
    style: edge.Style,
    stroke: edge.Style.Stroke,
    fromTopLeft: from.TopLeft,
    fromValue: [from.TopLeft.X, from.TopLeft.Y],
    toTopLeft: to.TopLeft,
    graph: g,
    cellSize: g.CellSize,
    costs: g.RoutingCosts(),
  };
}

function expectRestored(state, snap) {
  const { g, from, to, edge } = state;
  expect(edge.Points === snap.points).toBe(true);
  expect(edge.Points.length).toBe(snap.members.length);
  snap.members.forEach((p, i) => {
    expect(edge.Points[i] === p).toBe(true);
    expect([p.X, p.Y]).toEqual(snap.values[i]);
  });
  expect(edge.Label === snap.label).toBe(true);
  expect({ ...edge.Label }).toEqual(snap.labelValues);
  expect(edge.Style === snap.style).toBe(true);
  expect(edge.Style.Stroke === snap.stroke).toBe(true);
  expect(Boolean(edge.IsCurve)).toBe(false);
  expect(from.TopLeft === snap.fromTopLeft).toBe(true);
  expect([from.TopLeft.X, from.TopLeft.Y]).toEqual(snap.fromValue);
  expect(to.TopLeft === snap.toTopLeft).toBe(true);
  expect(from.Graph === snap.graph).toBe(true);
  expect(g.CellSize).toBe(snap.cellSize);
  expect(g.RoutingCosts()).toEqual(snap.costs);
}

function mutate({ g, from, to, edge }, guard) {
  edge.Points[1].X = 999;
  edge.Points[2] = new Point(-5, -5);
  edge.Points.reverse();
  edge.Points.push(new Point(7, 7));
  edge.Points = [new Point(1, 1), new Point(2, 2)];
  edge.Label.Width = 1;
  edge.Label.Position = LabelPosition.UnlockedTop;
  edge.Style.Stroke = { Value: 'blue' };
  edge.Style = null;
  edge.IsCurve = true;
  edge.scratch = 'added';
  from.TopLeft.X += 10;
  from.TopLeft = new Point(-1, -1);
  to.Graph = null;
  g.CellSize = 99;
  g.RestoreRoutingCosts({ Crossing: 101, Turn: 102, NonCenterPort: 103 });
  guard.step();
}

describe('runAtomicRouteStage rollback identity', () => {
  it('restores exact arrays, points, labels, nodes and caches on a returned error', () => {
    const state = simplificationGraph();
    state.g.CellSize = 17;
    const snap = captureIdentity(state);
    const failure = new Error('stage failure');
    let caught = null;
    try {
      runAtomicRouteStage(ctx(), 'rollback', state.g, null, MAX_ROUTE_STAGE_WORK_UNITS, (guard) => {
        mutate(state, guard);
        throw failure;
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(failure);
    expectRestored(state, snap);
    expect('scratch' in state.edge).toBe(false);
    expect(state.to.Graph === state.g).toBe(true);
  });

  it('restores first and then rethrows the original thrown value', () => {
    const state = simplificationGraph();
    const snap = captureIdentity(state);
    const panicValue = { name: 'route graph mutation probe' };
    let caught = null;
    let restoredAtCatch = null;
    try {
      runAtomicRouteStageAfterPreflight(ctx(), 'panic', state.g, null, MAX_ROUTE_STAGE_WORK_UNITS, (guard) => {
        mutate(state, guard);
        throw panicValue; // eslint-disable-line no-throw-literal
      });
    } catch (err) {
      caught = err;
      restoredAtCatch = state.edge.Points === snap.points;
    }
    expect(caught).toBe(panicValue);
    expect(restoredAtCatch).toBe(true);
    expectRestored(state, snap);
  });

  it('restores on a work limit raised after mutation', () => {
    const state = simplificationGraph();
    const snap = captureIdentity(state);
    let caught = null;
    try {
      runAtomicRouteStage(ctx(), 'limit', state.g, null, 100, (guard) => {
        mutate(state, guard);
        guard.add(1000);
      });
    } catch (err) {
      caught = err;
    }
    expect(errorIs(caught, errRouteStageWorkLimit)).toBe(true);
    expect(caught.message).toBe('TALA route-stage work limit exceeded: TALA limit work exceeds limit 100');
    expectRestored(state, snap);
  });

  it('restores on cancellation observed at the final poll', () => {
    const state = simplificationGraph();
    const snap = captureIdentity(state);
    const canceled = new Error('context canceled');
    let mutated = false;
    const probe = {
      Err() {
        return mutated ? canceled : null;
      },
    };
    let caught = null;
    try {
      runAtomicRouteStageAfterPreflight(probe, 'TraceEdgesToShapeBorder', state.g, null, MAX_ROUTE_STAGE_WORK_UNITS, (guard) => {
        mutate(state, guard);
        mutated = true;
      });
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toBe('TraceEdgesToShapeBorder: context canceled');
    expect(errorIs(caught, canceled)).toBe(true);
    expectRestored(state, snap);
  });

  it('commits mutations on success', () => {
    const state = simplificationGraph();
    runAtomicRouteStage(ctx(), 'commit', state.g, null, MAX_ROUTE_STAGE_WORK_UNITS, (guard) => {
      state.edge.Points = [new Point(1, 1), new Point(2, 2)];
      guard.step();
    });
    expect(state.edge.Points.map((p) => [p.X, p.Y])).toEqual([[1, 1], [2, 2]]);
  });

  it('restores points shared between routes and extra edges', () => {
    const state = simplificationGraph();
    const shared = state.edge.Points[0];
    const extra = new Edge(state.from, state.to);
    extra.Points = [shared, new Point(5, 5)];
    const extraPoints = extra.Points;
    const guard = newRouteWorkGuard(ctx(), 'shared', MAX_ROUTE_STAGE_WORK_UNITS);
    const snapshot = captureRouteMutations(state.g, [extra, extra, null], guard);
    expect(snapshot.edges.size).toBe(2);
    shared.X = 123;
    extra.Points = [];
    snapshot.restore();
    expect(extra.Points === extraPoints).toBe(true);
    expect(extra.Points[0] === shared).toBe(true);
    expect(shared.X).toBe(0);
  });

  it('restores graph caches and node positions after a panic (post_route_atomicity_test)', () => {
    const { g, from } = simplificationGraph();
    const originalPosition = from.TopLeft;
    g.CellSize = 17;
    expect(() => runAtomicRouteStage(ctx(), 'cache rollback', g, null, MAX_ROUTE_STAGE_WORK_UNITS, (guard) => {
      g.CellSize = 99;
      g.RestoreRoutingCosts({ Crossing: 101, Turn: 102, NonCenterPort: 103 });
      from.TopLeft = new Point(123, 456);
      guard.step();
      throw 'route graph mutation probe'; // eslint-disable-line no-throw-literal
    })).toThrow('route graph mutation probe');
    expect(g.CellSize).toBe(17);
    expect(g.RoutingCosts()).toEqual({ Crossing: 0, Turn: 0, NonCenterPort: 0 });
    expect(from.TopLeft === originalPosition).toBe(true);
    expect([from.TopLeft.X, from.TopLeft.Y]).toEqual([1000, 1000]);
  });

  it('caps extra edges before taking the snapshot', () => {
    const g = new Graph();
    const from = new Node(1n, 10, 10);
    const to = new Node(2n, 10, 10);
    from.TopLeft = new Point(0, 0);
    to.TopLeft = new Point(100, 0);
    const edge = new Edge(from, to);
    edge.Points = new Array(MaxRoutePoints + 1).fill(null);
    let reached = false;
    const fn = () => { reached = true; };
    expect(() => runAtomicRouteStage(ctx(), 'extra references', g, new Array(MaxTopologyReferences + 1).fill(null), MAX_ROUTE_STAGE_WORK_UNITS, fn))
      .toThrow('extra edge references exceed limit');
    expect(() => runAtomicRouteStage(ctx(), 'extra capacity', g, [edge], MAX_ROUTE_STAGE_WORK_UNITS, fn))
      .toThrow('route point capacity exceeds limit');
    edge.Points = [new Point(0, 0), new Point(100, 0)];
    let caught = null;
    try {
      runAtomicRouteStage(ctx(), 'extra duplicates', g, new Array(20).fill(edge), 10, fn);
    } catch (err) {
      caught = err;
    }
    expect(errorIs(caught, errRouteStageWorkLimit)).toBe(true);
    expect(reached).toBe(false);
  });
});

describe('guarded helpers', () => {
  it('traceToShapeBorderGuarded restores endpoint positions when tracing throws', () => {
    const g = new Graph();
    const from = new Node(1n, 100, 100);
    const to = new Node(2n, 100, 100);
    from.TopLeft = new Point(0, 0);
    to.TopLeft = new Point(300, 0);
    from.Is3D = true;
    from.setShape('Circle');
    g.addNewNodeToContainer(null, from);
    g.addNewNodeToContainer(null, to);
    const edge = g.connect(from, to);
    edge.Points = [new Point(100, 50), new Point(300, 50)];
    const fromTopLeft = from.TopLeft;
    const guard = newRouteWorkGuard(ctx(), 'trace', MAX_ROUTE_STAGE_WORK_UNITS);
    const sentinel = new Error('tracing sentinel');
    to.ModifierElementAdjustments = () => { throw sentinel; };
    let caught;
    try { traceToShapeBorderGuarded(edge, guard); } catch (error) { caught = error; }
    expect(caught).toBe(sentinel);
    expect(from.TopLeft === fromTopLeft).toBe(true);
    expect([from.TopLeft.X, from.TopLeft.Y]).toEqual([0, 0]);
  });

  it('edgeHasOverlappingEndGuarded panics on an empty incident route like Go', () => {
    const g = new Graph();
    const a = new Node(1n, 10, 10);
    const b = new Node(2n, 10, 10);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = g.connect(a, b);
    edge.Points = [new Point(0, 0), new Point(0, 10)];
    g.connect(a, b).Points = [];
    const guard = newRouteWorkGuard(ctx(), 'end', MAX_ROUTE_STAGE_WORK_UNITS);
    expect(() => edgeHasOverlappingEndGuarded(edge, guard)).toThrow('index out of range [0] with length 0');
  });

  it('reorderDuplicates commits a successful swap (reorder_duplicates_test)', () => {
    for (const reverseUnlabeled of [false, true]) {
      const g = new Graph();
      const from = new Node(1n, 40, 40);
      const to = new Node(2n, 40, 40);
      from.TopLeft = new Point(0, 0);
      to.TopLeft = new Point(0, 200);
      g.addNewNodeToContainer(null, from);
      g.addNewNodeToContainer(null, to);
      const first = g.connect(from, to);
      first.Points = [new Point(10, 40), new Point(10, 200)];
      const last = reverseUnlabeled ? g.connect(to, from) : g.connect(from, to);
      last.Points = reverseUnlabeled ? [new Point(30, 200), new Point(30, 40)] : [new Point(30, 40), new Point(30, 200)];
      const labeled = g.connect(from, to);
      labeled.Points = [new Point(20, 40), new Point(20, 200)];
      labeled.Label = new Label('labeled');
      const edges = [first, last, labeled];
      const want = edges.map((e) => [...e.Points]);
      runAtomicRouteStage(ctx(), 'ReorderDuplicates', g, null, MAX_ROUTE_STAGE_WORK_UNITS, (guard) => {
        reorderDuplicatesInEdgesGuarded(g.Edges, guard);
      });
      if (reverseUnlabeled) {
        want[1].reverse();
        want[2].reverse();
      }
      [want[1], want[2]] = [want[2], want[1]];
      edges.forEach((e, i) => {
        expect(e.Points.length).toBe(want[i].length);
        want[i].forEach((p, j) => expect(e.Points[j] === p).toBe(true));
      });
    }
  });

  it('reorderDuplicates rolls back when a poll throws after the swap', () => {
    const g = new Graph();
    const from = new Node(1n, 40, 40);
    const to = new Node(2n, 40, 40);
    from.TopLeft = new Point(0, 0);
    to.TopLeft = new Point(0, 200);
    g.addNewNodeToContainer(null, from);
    g.addNewNodeToContainer(null, to);
    const edges = [0, 1, 2].map((i) => {
      const e = g.connect(from, to);
      const x = 10 * (i + 1);
      e.Points = [new Point(x, 40), new Point(x, 200)];
      return e;
    });
    edges[1].Label = new Label('labeled');
    const arrays = edges.map((e) => e.Points);
    const members = edges.map((e) => [...e.Points]);
    const probeValue = { name: 'reorder duplicates mutation probe' };
    let observed = false;
    const probe = {
      Err() {
        if (edges.some((e, i) => e.Points !== arrays[i])) {
          observed = true;
          throw probeValue;
        }
        return null;
      },
    };
    let caught = null;
    try {
      runAtomicRouteStage(backgroundWorkContext(), 'ReorderDuplicates', g, null, MAX_ROUTE_STAGE_WORK_UNITS, (guard) => {
        guard.ctx = probe;
        reorderDuplicatesInEdgesGuarded(g.Edges, guard);
      });
    } catch (err) {
      caught = err;
    }
    expect(observed).toBe(true);
    expect(caught).toBe(probeValue);
    edges.forEach((e, i) => {
      expect(e.Points === arrays[i]).toBe(true);
      members[i].forEach((p, j) => expect(e.Points[j] === p).toBe(true));
    });
  });
});

describe('route cost and route helpers', () => {
  it('estimateRouteCostGuarded matches and charges every scan (cost_test)', () => {
    const first = new Edge(null, null);
    first.Points = [new Point(0, 0), new Point(10, 10)];
    const second = new Edge(null, null);
    second.Points = [new Point(0, 10), new Point(10, 0)];
    const edges = [first, second];
    const guard = newRouteWorkGuard(ctx(), 'route cost', 4);
    expect(estimateRouteCostGuarded(edges, first, guard)).toBe(estimateRouteCost(edges, first));
    expect(guard.used).toBe(4);
    const limited = newRouteWorkGuard(ctx(), 'route cost', 3);
    let caught = null;
    try {
      estimateRouteCostGuarded(edges, first, limited);
    } catch (err) {
      caught = err;
    }
    expect(errorIs(caught, errRouteStageWorkLimit)).toBe(true);

    const empty = Array.from({ length: 1000 }, () => new Edge(null, null));
    const tight = newRouteWorkGuard(ctx(), 'route cost', 10);
    expect(() => estimateRouteCostGuarded(empty, new Edge(null, null), tight)).toThrow('work exceeds limit 10');
  });

  it('isOpposingColinear (route_test)', () => {
    const gEdge = new Edge(null, null);
    gEdge.TargetArrowhead = 'triangle';
    const node = (x, y) => ({ Point: new Point(x, y) });
    const route = new Route({ GEdge: gEdge, OVGNodes: [node(0, 0), node(100, 0), node(100, 100), node(200, 100)] });
    const check = (a, b, forward, backward) => {
      expect(route.isOpposingColinear(node(...a), node(...b))).toBe(forward);
      expect(route.isOpposingColinear(node(...b), node(...a))).toBe(backward);
    };
    check([0, 0], [100, 0], false, true);
    check([100, 0], [100, 100], false, true);
    check([190, 0], [100, 0], false, false);
    check([90, 0], [120, 0], false, true);
    check([101, 0], [200, 0], false, false);
    check([0, 0], [100, 100], false, false);
    check([120, 100], [300, 100], false, false);
  });

  it('routeStageGraphBoundingBox charges label route scans (edge_routing_stage_resource_test)', () => {
    const g = new Graph();
    const from = new Node(1n, 10, 10);
    const to = new Node(2n, 10, 10);
    from.TopLeft = new Point(0, 0);
    to.TopLeft = new Point(100, 0);
    g.addNewNodeToContainer(null, from);
    g.addNewNodeToContainer(null, to);
    const edge = g.connect(from, to);
    edge.Points = [new Point(10, 5), new Point(25, -20), new Point(50, -20), new Point(75, 5), new Point(100, 5)];
    const used = () => {
      const guard = newRouteWorkGuard(ctx(), 'EdgeRouting', Number.MAX_SAFE_INTEGER);
      routeStageGraphBoundingBox(g, guard);
      return guard.used;
    };
    const baseline = used();
    const count = edge.Points.length;
    edge.Label = new Label('', 30, 12);
    edge.Label.Position = LabelPosition.UnlockedMiddle;
    expect(used() - baseline).toBe(2 * count);
    edge.Label = null;
    edge.SourceArrowheadLabel = new Label('', 20, 10);
    expect(used() - baseline).toBe(3 * count);
    edge.SourceArrowheadLabel = null;
    edge.TargetArrowheadLabel = new Label('', 20, 10);
    expect(used() - baseline).toBe(3 * count);
  });
});
