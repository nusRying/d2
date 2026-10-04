// Slice 47 — focused OVG substrate tests ported from the pinned Go tests:
// internal/routing/{ovg_test,ovg_node_test,ovg_edge_test,ovg_edge_set_test,
// ovg_edge_set_index_test,ovg_resource_test,tunnel_test,ovg_aligned_owners_test,
// ovg_port_direction_filter_test,ovg_index_resource_test,
// ovg_construction_scaling_test,ovg_cancellation_test,tree_routing_test}.go
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Hierarchy } from '../../src/graph/hierarchy.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { WorkContext, backgroundWorkContext } from '../../src/limits/work-context.js';
import { preprocess as preprocessTrees, place as placeTrees } from '../../src/trees/index.js';
import {
  contextWithRouteAggregateWork,
  errRouteSearchWorkLimit,
  errRouteStageWorkLimit,
  errorIs,
  newRouteSearchWorkGuard,
  newRouteWorkGuard,
} from '../../src/routing/route-guards.js';
import { intersects } from '../../src/routing/geometry.js';
import { NewOVGNode, OVGNode, portDirectionSetAny, portDirectionSetHas, newPortDirectionSet } from '../../src/routing/ovg-node.js';
import { NewOVGEdge, OVGEdge } from '../../src/routing/ovg-edge.js';
import { newOvgEdgeSet } from '../../src/routing/ovg-edge-set.js';
import {
  OVGAlignedOwners,
  OVGBuildLimits,
  checkedOVGEdgeCapacity,
  defaultOVGBuildLimits,
  errOVGResourceLimit,
  newOVGBuildGuard,
  newOVGPointProximityIndex,
  newOVGPortIndex,
} from '../../src/routing/ovg-resource.js';
import { NewOVG, buildOVGFromGraphWithGuard, buildOVGFromGraphWithLimits, newBuildOVG } from '../../src/routing/ovg.js';
import { newOVGForHierarchy, mirrorPortDirection, transposePortDirection } from '../../src/routing/ovg-hierarchy.js';
import { buildTunnels, tunnelRangesBetween } from '../../src/routing/tunnel.js';
import { treeEdgePath } from '../../src/routing/tree-routes.js';
import { GoFloatMap, GoPointMap, goFormatFloatV, goJSONFloat, MAX_UINT64 } from '../../src/routing/ovg-go-support.js';
import { SEGMENT_SPACING_BUFFER } from '../../src/routing/tuning.js';
import { nodeContainsPointOnBox } from '../../src/routing/layoutgraph-routing-support.js';

const bg = backgroundWorkContext();
const CANCELED = new Error('context canceled');

const P = (x, y) => new Point(x, y);
const guardFor = (ctx = bg, limits = defaultOVGBuildLimits()) => newOVGBuildGuard(ctx, limits);
const canceledContext = () => new WorkContext({ isCancelled: () => true, doneAvailable: true });
const cancelWhen = (shouldCancel) => ({ Err: () => (shouldCancel() ? CANCELED : null) });
const cancelAfterErrChecks = (remaining) => ({
  Err() {
    if (remaining === 0) return CANCELED;
    remaining--;
    return null;
  },
});

function node(id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  if (x !== undefined) n.TopLeft = P(x, y);
  return n;
}

function hierarchyWithLevels(entries) {
  const h = new Hierarchy();
  h.ReplaceLevels(new Map(entries));
  return h;
}

function thrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

function requireResourceError(err, resource) {
  expect(errorIs(err, errOVGResourceLimit)).toBe(true);
  expect(err.message).toContain(resource);
}

function requireCanceled(err) {
  expect(errorIs(err, CANCELED) || err.cause?.message === 'context canceled').toBe(true);
  expect(err.message).toContain('EdgeRouting');
}

function cancellationGraph(targetX, targetY) {
  const g = new Graph();
  const source = node(1, 40, 40, 0, 0);
  const target = node(2, 40, 40, targetX, targetY);
  g.AddNode(source);
  g.AddNode(target);
  g.Connect(source, target);
  return g;
}

/** ovg_assertions_test.go Equals (coordinate sets, undirected edges). */
function ovgEquals(a, b) {
  if (a.Nodes.length !== b.Nodes.length || a.Edges.length !== b.Edges.length) return false;
  const key = (n) => `${n.X},${n.Y}`;
  const points = new Set(a.Nodes.map(key));
  for (const n of b.Nodes) points.delete(key(n));
  if (points.size > 0) return false;
  const edges = new Set(a.Edges.map((e) => `${key(e.From)}:${key(e.To)}`));
  for (const e of b.Edges) {
    edges.delete(`${key(e.From)}:${key(e.To)}`);
    edges.delete(`${key(e.To)}:${key(e.From)}`);
  }
  return edges.size === 0;
}

const edgeEquals = (e, other) =>
  (e.From.Point.equals(other.From.Point) && e.To.Point.equals(other.To.Point)) ||
  (e.From.Point.equals(other.To.Point) && e.To.Point.equals(other.From.Point));

/** Test-only ovg.ports(n, o) helper from ovg_test.go. */
function portsOf(ovg, n, o) {
  const seen = new Set();
  const out = [];
  for (const port of ovg.Ports.get(n) ?? []) {
    if (seen.has(port)) continue;
    seen.add(port);
    if (port.hasPortDirection(n, o)) out.push(port);
  }
  return out;
}

// ── go support ───────────────────────────────────────────────────────────────

describe('Go semantics helpers', () => {
  it('formats floats like fmt %v and encoding/json', () => {
    const cases = [
      [1000000, '1e+06', '1000000'], [123456789, '1.23456789e+08', '123456789'],
      [1e20, '1e+20', '100000000000000000000'], [1e21, '1e+21', '1e+21'],
      [0.0001, '0.0001', '0.0001'], [0.00001, '1e-05', '0.00001'], [1.5e-7, '1.5e-07', '1.5e-7'],
      [-0, '-0', '-0'], [0.1, '0.1', '0.1'], [2.5, '2.5', '2.5'], [1e100, '1e+100', '1e+100'],
      [123456789012345678, '1.2345678901234568e+17', '123456789012345680'],
    ];
    for (const [v, fmtV, json] of cases) {
      expect(goFormatFloatV(v)).toBe(fmtV);
      expect(goJSONFloat(v)).toBe(json);
    }
    expect(() => goJSONFloat(NaN)).toThrow('json: unsupported value: NaN');
    expect(() => goJSONFloat(-Infinity)).toThrow('json: unsupported value: -Inf');
  });

  it('emulates Go float and point map keys', () => {
    const m = new GoFloatMap();
    m.set(0, 'a');
    m.set(-0, 'b');
    expect(m.size).toBe(1);
    expect(Object.is([...m.keys()][0], -0)).toBe(true);
    expect(m.get(0)).toBe('b');
    m.set(NaN, 'x');
    m.set(NaN, 'y');
    expect(m.size).toBe(3);
    expect(m.has(NaN)).toBe(false);
    expect(m.get(NaN)).toBeUndefined();

    const pm = new GoPointMap();
    pm.set(P(0, 1), 'a');
    expect(pm.get(P(-0, 1))).toBe('a');
    pm.set(P(NaN, 1), 'n');
    expect(pm.get(P(NaN, 1))).toBeUndefined();
    expect(pm.size).toBe(2);
  });
});

// ── nodes and edges ──────────────────────────────────────────────────────────

describe('OVGNode / OVGEdge', () => {
  it('distanceToBoundary', () => {
    const a = NewOVGNode(P(0, 0));
    const b = node(1, 1, 1, 6, 0);
    expect(a.distanceToBoundary(b)).toBe(6);
    a.Point = P(10, 10);
    b.TopLeft = P(5, 6);
    expect(a.distanceToBoundary(b)).toBe(5);
  });

  it('addEdge / adjacent', () => {
    const n1 = NewOVGNode(P(0, 0));
    const n2 = NewOVGNode(P(1, 1));
    const e = NewOVGEdge(n1, n2);
    n1.addEdge(e);
    expect(n1.Edges.length).toBe(1);
    expect(n2.Edges.length).toBe(0);
    expect(n1.adjacent(e)).toBe(n2);
    expect(n2.Adjacent(e)).toBe(n1);
  });

  it('port directions without an owner are unrestricted', () => {
    const n = NewOVGNode(P(0, 0));
    const owner = node(1, 10, 10);
    const directions = n.portDirectionsForObstacle(owner);
    expect(directions).toBe(0);
    expect(portDirectionSetAny(directions, (d) => d === Orientation.NONE)).toBe(true);
    expect(newPortDirectionSet(-1)).toBe(0);
    expect(newPortDirectionSet(9)).toBe(0);
    expect(portDirectionSetHas(newPortDirectionSet(Orientation.Left), Orientation.Left)).toBe(true);
  });

  it('per-owner port metadata merges and is read by value', () => {
    const n = NewOVGNode(P(0, 0));
    const a = node(1, 10, 10);
    const b = node(2, 10, 10);
    n.addPortOwner(a, Orientation.Top, false);
    n.addPortOwner(a, Orientation.Left, false);
    n.addPortOwner(b, Orientation.Right, false);
    n.setCenterPort(a);
    expect(n.hasPortDirection(a, Orientation.Top) && n.hasPortDirection(a, Orientation.Left)).toBe(true);
    expect(n.isCenterPortOf(a)).toBe(true);
    expect(n.isCenterPortOf(b)).toBe(false);
    const [metadata] = n.portMetadataFor(a);
    metadata.directions = 0;
    expect(n.hasPortDirection(a, Orientation.Top)).toBe(true);
    const other = NewOVGNode(P(1, 1));
    other.addPortOwner(b, Orientation.Bottom, false);
    expect(n.sharesPortOwner(other)).toBe(true);
    expect(NewOVGNode(P(2, 2)).portOwners().size).toBe(0);
  });

  it('X/Y write through the shared point', () => {
    const p = P(1, 2);
    const n = NewOVGNode(p);
    n.X = 7;
    expect(p.X).toBe(7);
  });

  it('isVertical / isHorizontal', () => {
    expect(NewOVGEdge(NewOVGNode(P(5, 5)), NewOVGNode(P(5, 15))).isVertical()).toBe(true);
    expect(NewOVGEdge(NewOVGNode(P(5, 15)), NewOVGNode(P(35, 15))).isVertical()).toBe(false);
    expect(NewOVGEdge(NewOVGNode(P(5, 15)), NewOVGNode(P(35, 55))).isVertical()).toBe(false);
    expect(NewOVGEdge(NewOVGNode(P(5, 15)), NewOVGNode(P(35, 15))).isHorizontal()).toBe(true);
  });
});

// ── edge set ─────────────────────────────────────────────────────────────────

describe('OVGEdgeSet', () => {
  const E = (x1, y1, x2, y2) => NewOVGEdge(NewOVGNode(P(x1, y1)), NewOVGNode(P(x2, y2)));
  const fixture = () => {
    const set = newOvgEdgeSet();
    const edges = {
      v1: E(5, 5, 5, 15), v2: E(5, 25, 5, 39), v3: E(7, 5, 7, 15),
      h1: E(5, 5, 7, 5), h2: E(20, 25, 30, 25), h3: E(0, 40, 50, 40),
    };
    for (const e of Object.values(edges)) set.add(e);
    return [set, edges];
  };

  it('add buckets edges by axis and ignores diagonals', () => {
    const set = newOvgEdgeSet();
    const vertical = E(5, 5, 5, 15);
    set.add(vertical);
    expect(set.verticalEdges.size).toBe(1);
    expect(set.horizontalEdges.size).toBe(0);
    expect(set.verticalEdges.get(5)[0].From).toBe(vertical.From);
    set.add(E(5, 5, 15, 5));
    expect(set.horizontalEdges.size).toBe(1);
    set.add(E(5, 10, 15, 5));
    expect(set.horizontalEdges.size).toBe(1);
    expect(set.verticalEdges.size).toBe(1);
    set.add(vertical);
    expect(set.edges.size).toBe(2 + 1);
  });

  it('intersectsWith', () => {
    const [set, { v1, h1, h3 }] = fixture();
    const query = (e) => set.intersectsWithChecked(e, null);
    expect(query(v1)).toBe(false);
    expect(query(h3)).toBe(false);
    expect(query(h1)).toBe(false);
    expect(query(E(50, 40, 0, 40))).toBe(false);
    expect(query(E(6, 4, 6, 10))).toBe(true);
    expect(query(E(5, 19, 5, 50))).toBe(true);
    expect(query(E(1, 9, 19, 9))).toBe(true);
    expect(query(E(6, 0, 6, 4))).toBe(false);
    expect(query(E(6, 39, 30, 39))).toBe(false);
    expect(query(E(0, 0, 50, 50))).toBe(false);
  });

  it('overlappingEdges', () => {
    const [set, { v1, v2, h1 }] = fixture();
    const overlaps = (e) => set.overlappingEdgesChecked(e, null);
    let got = overlaps(h1);
    expect(got.length).toBe(1);
    expect(edgeEquals(h1, got[0])).toBe(true);
    got = overlaps(v1);
    expect(got.length).toBe(1);
    got = overlaps(E(5, 14, 5, 25)).sort((a, b) => a.From.Y - b.From.Y);
    expect(got.length).toBe(2);
    expect(edgeEquals(v1, got[0]) && edgeEquals(v2, got[1])).toBe(true);
    expect(overlaps(E(6, 0, 6, 80)).length).toBe(0);
    expect(overlaps(E(0, 0, 50, 50)).length).toBe(0);
  });

  it('indexed crossings match a brute-force scan', () => {
    let seed = 143;
    const rand = (n) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const set = newOvgEdgeSet();
    for (let i = 0; i < 200; i++) {
      const x = rand(100) - 50.25;
      const y = rand(100) - 50.25;
      const length = rand(15) + 1;
      set.add(rand(2) === 0 ? E(x, y, x + length, y) : E(x, y, x, y + length));
    }
    for (let i = 0; i < 2000; i++) {
      const x = rand(140) - 70.25;
      const y = rand(140) - 70.25;
      let length = rand(31) - 15;
      if (length === 0) length = 0.5;
      const q = rand(2) === 0 ? E(x, y, x, y + length) : E(x, y, x + length, y);
      let want = false;
      for (const edge of set.edges) {
        if (q.sharePoints(edge)) continue;
        if (q.isHorizontal() && edge.isHorizontal()) {
          want = q.From.Y === edge.From.Y &&
            Math.max(Math.min(q.From.X, q.To.X), Math.min(edge.From.X, edge.To.X)) <
            Math.min(Math.max(q.From.X, q.To.X), Math.max(edge.From.X, edge.To.X));
        } else if (q.isVertical() && edge.isVertical()) {
          want = q.From.X === edge.From.X &&
            Math.max(Math.min(q.From.Y, q.To.Y), Math.min(edge.From.Y, edge.To.Y)) <
            Math.min(Math.max(q.From.Y, q.To.Y), Math.max(edge.From.Y, edge.To.Y));
        } else {
          want = intersects(q.From.Point, q.To.Point, edge.From.Point, edge.To.Point);
        }
        if (want) break;
      }
      expect(set.intersectsWithChecked(q, null)).toBe(want);
    }
  });

  const sparseCrossingFixture = (axisCount) => {
    const set = newOvgEdgeSet();
    for (let i = 0; i < axisCount; i++) set.add(E(i, 10, i, 20));
    const x = axisCount - 2.75;
    return [set, E(x, 15, x + 1, 15)];
  };
  const cancellable = () => new WorkContext({ isCancelled: () => false, doneAvailable: true });

  it('indexed crossing work is charged exactly', () => {
    let [set, query] = sparseCrossingFixture(512);
    for (const transpose of [false, true]) {
      if (transpose) {
        const transposed = newOvgEdgeSet();
        for (const edge of set.edges) transposed.add(E(edge.From.Y, edge.From.X, edge.To.Y, edge.To.X));
        set = transposed;
        query = E(query.From.Y, query.From.X, query.To.Y, query.To.X);
      }
      let guard = newRouteSearchWorkGuard(cancellable(), 'ShortestToLongest', 1000);
      expect(set.intersectsWithGuarded(query, guard)).toBe(true);
      expect(guard.used).toBe(512);
      guard = newRouteSearchWorkGuard(cancellable(), 'ShortestToLongest', 100);
      const err = thrown(() => set.intersectsWithGuarded(query, guard));
      expect(errorIs(err, errRouteSearchWorkLimit)).toBe(true);
      expect(guard.used).toBe(100);
    }
  });

  it('indexed crossing aggregate work and synthetic cancellation', () => {
    const [set, query] = sparseCrossingFixture(512);
    const ctx = cancellable();
    const aggregate = newRouteWorkGuard(ctx, 'EdgeRouting', 100);
    const guard = newRouteSearchWorkGuard(contextWithRouteAggregateWork(ctx, aggregate), 'ShortestToLongest', 1000);
    const err = thrown(() => set.intersectsWithGuarded(query, guard));
    expect(errorIs(err, errRouteStageWorkLimit)).toBe(true);
    expect(guard.used).toBe(101);
    expect(aggregate.used).toBe(100);

    const synthetic = newRouteSearchWorkGuard(cancelAfterErrChecks(10), 'ShortestToLongest', 1000);
    const cancelErr = thrown(() => set.intersectsWithGuarded(query, synthetic));
    expect(cancelErr.cause).toBe(CANCELED);
    expect(synthetic.used).toBe(9);
  });

  it('addGuarded charges shifts and keeps value copies', () => {
    const set = newOvgEdgeSet();
    const guard = newRouteWorkGuard(bg, 'EdgeRouting', 1000);
    const e = E(0, 0, 0, 10);
    set.addGuarded(e, guard);
    expect(guard.used).toBe(3);
    set.addGuarded(e, guard);
    expect(guard.used).toBe(4);
    e.Distance = 99;
    expect(set.verticalEdges.get(0)[0].Distance).toBe(0);
  });
});

// ── OVG core ─────────────────────────────────────────────────────────────────

describe('OVG', () => {
  it('AddNodeUnchecked / AddNode', () => {
    let ovg = NewOVG(null);
    ovg.AddNodeUnchecked(NewOVGNode(P(1, 1)));
    ovg.AddNodeUnchecked(NewOVGNode(P(1, 1)));
    expect(ovg.Nodes.length).toBe(2);

    ovg = NewOVG(null);
    const p = P(42, 23);
    const node1 = NewOVGNode(p);
    expect(ovg.AddNode(node1)).toBe(node1);
    expect(ovg.AddNode(NewOVGNode(p))).toBe(node1);
    expect(ovg.Nodes).toEqual([node1]);
  });

  it('Connect', () => {
    const ovg = NewOVG(null);
    let n1 = ovg.AddNode(NewOVGNode(P(1, 2)));
    let n2 = ovg.AddNode(NewOVGNode(P(5, 10)));
    let e = ovg.Connect(n1, n2);
    expect(ovg.Edges.length).toBe(1);
    expect(n1.Edges[0]).toBe(e);
    expect(n2.Edges[0]).toBe(e);
    expect(e.From).toBe(n1);
    expect(ovg.VerticalEdges.size).toBe(0);
    expect(ovg.HorizontalEdges.size).toBe(0);
    n1 = ovg.AddNode(NewOVGNode(P(1, 2)));
    n2 = ovg.AddNode(NewOVGNode(P(1, 10)));
    e = ovg.Connect(n1, n2);
    expect(ovg.VerticalEdges.get(1)[0]).toBe(e);
    expect(e.Distance).toBe(8);
    n2 = ovg.AddNode(NewOVGNode(P(10, 2)));
    e = ovg.Connect(n1, n2);
    expect(ovg.HorizontalEdges.get(2)[0]).toBe(e);
    const center = NewOVGNode(P(50, 50));
    center.IsNodeCenter = true;
    expect(ovg.Connect(center, n2)).toBeNull();
  });

  it('removeIsolatedNodes', () => {
    const ovg = NewOVG(null);
    const n1 = ovg.AddNode(NewOVGNode(P(1, 2)));
    const n2 = ovg.AddNode(NewOVGNode(P(5, 10)));
    ovg.AddNode(NewOVGNode(P(7, 11)));
    ovg.Connect(n1, n2);
    ovg.removeIsolatedNodes(guardFor());
    expect(ovg.Nodes).toEqual([n1, n2]);
  });

  it('ovgBoundingBox', () => {
    const ovg = NewOVG(null);
    const guard = guardFor();
    let [tl, br] = guard.ovgBoundingBox(ovg);
    expect([tl.X, tl.Y, br.X, br.Y]).toEqual([-Infinity, -Infinity, Infinity, Infinity]);
    for (const [x, y] of [[1, 45], [42, 23], [45, 0], [33, 8], [12, 7]]) ovg.AddNode(NewOVGNode(P(x, y)));
    [tl, br] = guard.ovgBoundingBox(ovg);
    expect([tl.X, tl.Y, br.X, br.Y]).toEqual([1, 0, 45, 45]);
  });

  it('JSON round trip (Equals, fractional coordinates, Go encoding)', () => {
    const ovg1 = NewOVG(null);
    const n = [[10, 10], [10, 15], [10, 20], [15, 10], [20, 10], [20, 20]].map(([x, y]) => ovg1.AddNode(NewOVGNode(P(x, y))));
    for (const [a, b] of [[0, 1], [0, 3], [1, 2], [3, 4], [4, 5], [2, 5]]) ovg1.Connect(n[a], n[b]);
    const serialized = ovg1.MarshalJSON();
    expect(serialized.startsWith('{"nodes":[{"x":10,"y":10},{"x":10,"y":15}')).toBe(true);
    const ovg2 = NewOVG(null);
    ovg2.UnmarshalJSON(serialized);
    expect(ovgEquals(ovg1, ovg2)).toBe(true);

    const frac = NewOVG(null);
    frac.Connect(frac.AddNode(NewOVGNode(P(0.1, 0))), frac.AddNode(NewOVGNode(P(0.9, 0))));
    const decoded = NewOVG(null);
    decoded.UnmarshalJSON(JSON.stringify(frac));
    expect(decoded.Nodes.length).toBe(2);
    expect(decoded.OccupiedPoints.get(P(0.1, 0))).toBeDefined();
    expect(decoded.Edges[0].From).not.toBe(decoded.Edges[0].To);

    expect(NewOVG(null).MarshalJSON()).toBe('{"nodes":null,"edges":null}');
    expect(() => NewOVG(null).UnmarshalJSON('{"nodes":[],"edges":[{"from":{"x":1,"y":2},"to":{"x":1e6,"y":0.5}}]}'))
      .toThrow('OVG edge references a missing endpoint: {1 2} -> {1e+06 0.5}');
    const caseInsensitive = NewOVG(null);
    caseInsensitive.UnmarshalJSON('{"Nodes":[{"X":1,"Y":2}]}');
    expect(caseInsensitive.Nodes[0].X).toBe(1);
  });

  it('canonicalizes coincident ports of touching nodes', () => {
    const g = new Graph();
    const left = node(1, 100, 100, 0, 0);
    const right = node(2, 100, 100, 100, 0);
    g.AddNodeUnchecked(left);
    g.AddNodeUnchecked(right);
    g.Connect(left, right);
    const ovg = buildOVGFromGraphWithLimits(bg, g, null, defaultOVGBuildLimits());
    const nodes = new Set(ovg.Nodes);
    for (const [owner, ports] of ovg.Ports) {
      for (const port of ports) {
        expect(nodes.has(port)).toBe(true);
        expect(port.isPortOf(owner)).toBe(true);
      }
    }
    let shared = 0;
    for (const lp of ovg.Ports.get(left)) {
      for (const rp of ovg.Ports.get(right)) {
        if (!lp.Point.equals(rp.Point)) continue;
        shared++;
        expect(lp).toBe(rp);
        expect(lp.hasPortDirection(left, Orientation.Right) && lp.hasPortDirection(right, Orientation.Left)).toBe(true);
      }
    }
    expect(shared).toBeGreaterThan(0);
    ovg.Nodes.forEach((n, i) => expect(n.Index).toBe(i));
  });

  it('a 1x1 node keeps every port role', () => {
    const g = new Graph();
    const tiny = g.AddNode(node(1, 1, 1, 100, 100));
    const target = g.AddNode(node(2, 20, 20, 90, 0));
    g.Connect(tiny, target);
    const ovg = NewOVG(g.Nodes);
    ovg.addPorts(g, guardFor());
    for (const d of [Orientation.Top, Orientation.Right, Orientation.Bottom, Orientation.Left]) {
      expect(portsOf(ovg, tiny, d).length).toBeGreaterThan(0);
    }
  });

  it('hierarchy mirroring transforms shared ports once and restores nodes', () => {
    for (const direction of [Orientation.Top, Orientation.Left]) {
      const g = new Graph();
      const left = g.AddNode(node(1, 100, 100, 0, 0));
      const right = g.AddNode(node(2, 100, 100, 100, 0));
      g.Directions.set(null, direction);
      const h = hierarchyWithLevels([[left, 0], [right, 0]]);
      left.Hierarchy = h;
      right.Hierarchy = h;
      const ovg = newOVGForHierarchy(g, h, guardFor());
      let shared = 0;
      for (const lp of ovg.Ports.get(left)) {
        expect(nodeContainsPointOnBox(left, lp.Point)).toBe(true);
        for (const rp of ovg.Ports.get(right)) {
          if (!lp.Point.equals(rp.Point)) continue;
          shared++;
          expect(lp).toBe(rp);
          expect(nodeContainsPointOnBox(right, rp.Point)).toBe(true);
          expect(lp.hasPortDirection(left, Orientation.Right) && lp.hasPortDirection(right, Orientation.Left)).toBe(true);
        }
      }
      expect(shared).toBeGreaterThan(0);
      for (const n of ovg.Nodes) expect(ovg.OccupiedPoints.get(n.Point)).toBe(n);
      expect([left.TopLeft.X, left.TopLeft.Y, right.TopLeft.X, right.TopLeft.Y]).toEqual([0, 0, 100, 0]);
    }
    expect(transposePortDirection(Orientation.TopRight)).toBe(Orientation.BottomLeft);
    expect(mirrorPortDirection(Orientation.TopLeft, true, true)).toBe(Orientation.BottomRight);
  });

  it('hierarchy cancellation restores mirrored nodes', () => {
    const g = new Graph();
    const left = g.AddNode(node(1, 100, 100, 0, 0));
    const right = g.AddNode(node(2, 100, 100, 100, 0));
    g.Directions.set(null, Orientation.Left);
    const h = hierarchyWithLevels([[left, 0], [right, 0]]);
    left.Hierarchy = h;
    right.Hierarchy = h;
    const moved = () => left.TopLeft.X !== 0 || right.TopLeft.X !== 100;
    const err = thrown(() => newOVGForHierarchy(g, h, guardFor(cancelWhen(moved))));
    requireCanceled(err);
    expect(moved()).toBe(false);
  });

  it('mergePorts canonicalizes base and hierarchy ports', () => {
    const g = new Graph();
    const base = g.AddNode(node(1, 100, 100, 0, 0));
    const hierarchical = g.AddNode(node(2, 100, 100, 100, 0));
    hierarchical.Hierarchy = hierarchyWithLevels([[hierarchical, 0]]);
    const ovg = buildOVGFromGraphWithLimits(bg, g, null, defaultOVGBuildLimits());
    const shared = P(100, 50);
    const canonical = ovg.OccupiedPoints.get(shared);
    expect(canonical.hasPortDirection(base, Orientation.Right) && canonical.hasPortDirection(hierarchical, Orientation.Left)).toBe(true);
    for (const owner of [base, hierarchical]) {
      const found = ovg.Ports.get(owner).filter((p) => p.Point.equals(shared));
      expect(found.length).toBeGreaterThan(0);
      for (const p of found) expect(p).toBe(canonical);
    }
    for (const e of ovg.Edges) {
      if (e.From.Point.equals(shared)) expect(e.From).toBe(canonical);
      if (e.To.Point.equals(shared)) expect(e.To).toBe(canonical);
    }
  });

  it('tunnels keep existing port directions', () => {
    const g = new Graph();
    const left = g.AddNode(node(1, 100, 100, 0, 0));
    const right = g.AddNode(node(2, 100, 100, 300, 0));
    g.Connect(left, right);
    const ovg = NewOVG(g.Nodes);
    ovg.addPorts(g, guardFor());
    ovg.addTunnels(g, guardFor());
    for (const [owner, point, direction] of [[left, P(100, 50), Orientation.Right], [right, P(300, 50), Orientation.Left]]) {
      const port = ovg.OccupiedPoints.get(point);
      expect(port.IsTunnel).toBe(true);
      const [directions, ok] = port.portDirectionsFor(owner);
      expect(ok && portDirectionSetHas(directions, direction)).toBe(true);
      expect(portDirectionSetHas(directions, Orientation.TopLeft)).toBe(false);
    }
  });

  it('addTreeNodes shares an occupied aligned port', () => {
    for (const childIsSource of [false, true]) {
      const g = new Graph();
      const parent = node(1, 101, 100, 0, 0);
      const child = node(2, 100, 100, 0, 200);
      const other = node(3, 20, 20, 41, 200);
      g.AddNodeUnchecked(parent);
      g.AddNodeUnchecked(child);
      g.AddNodeUnchecked(other);
      const edge = childIsSource ? g.Connect(child, parent) : g.Connect(parent, child);
      const tree = { Node: child, SentinelEdge: edge, Orientation: Orientation.Bottom, SentinelNode: () => (edge.From === child ? edge.To : edge.From) };
      g.NodeToTree = new Map([[child, tree]]);
      const ovg = buildOVGFromGraphWithLimits(bg, g, null, defaultOVGBuildLimits());
      const canonical = ovg.OccupiedPoints.get(P(51, 200));
      expect(canonical.isPortOf(other) && canonical.isPortOf(child)).toBe(true);
      expect(canonical.hasPortDirection(child, Orientation.Top)).toBe(true);
      expect(ovg.Ports.get(child).includes(canonical)).toBe(true);
      const path = treeEdgePath(tree, ovg.Ports, null);
      expect(childIsSource ? path.SourcePortNode : path.TargetPortNode).toBe(canonical);
    }
  });

  it('fixed-overlap cache is keyed by graph and node subset', () => {
    const g = new Graph();
    const fixed = g.AddNode(node(1, 10, 10, 0, 0));
    fixed.FixedTopLeft = fixed.TopLeft.copy();
    const overlapping = g.AddNode(node(2, 10, 10, 0, 0));
    const ovg = NewOVG([fixed, overlapping]);
    const guard = guardFor();
    expect(ovg.fixedOverlapsForBuild(g, [fixed], guard).size).toBe(0);
    const full = ovg.fixedOverlapsForBuild(g, [fixed, overlapping], guard);
    expect(full.size).toBe(1);
    expect(full.has(fixed)).toBe(true);
    expect(ovg.fixedOverlapsForBuild(g, [fixed], guard).size).toBe(0);
  });

  it('tree path alignment (trees.Preprocess/Place)', () => {
    const g = new Graph();
    const n0 = g.AddNode(node(3607948159, 191, 111, 1000, 1000));
    const n1 = g.AddNode(node(873436672, 158, 126, 919, 1211));
    const n2 = g.AddNode(node(2541194078, 130, 126, 1127, 1211));
    n2.SetShape('StoredData');
    const n3 = g.AddNode(node(4207512678, 158, 126, 919, 1437));
    const n4 = g.AddNode(node(974102386, 100, 100, 1142, 1450));
    for (const [a, b] of [[n0, n1], [n0, n2], [n1, n3], [n2, n4]]) g.Connect(a, b).TargetArrowhead = 'triangle';
    for (const n of g.Nodes) g.AddNodeToContainer(null, n);
    preprocessTrees(bg, g);
    placeTrees(bg, g, null);
    const ovg = buildOVGFromGraphWithLimits(bg, g, null, defaultOVGBuildLimits());
    expect(ovg.Ports.get(n4).length).toBe(13);
  });

  it('construction scaling graphs build', () => {
    for (const count of [32, 128]) {
      const g = new Graph();
      const columns = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const column = i % columns;
        const row = Math.floor(i / columns);
        const n = g.AddNode(node(i + 1, 60 + (i % 3) * 20, 40 + (i % 4) * 10, column * 230 + (row % 3) * 23, row * 180 + (column % 4) * 17));
        if (i > 0) g.Connect(g.Nodes[i - 1], n);
        if (i >= columns) g.Connect(g.Nodes[i - columns], n);
      }
      g.ComputeCellSize();
      const ovg = buildOVGFromGraphWithLimits(bg, g, null, defaultOVGBuildLimits());
      expect(ovg.Nodes.length).toBeGreaterThan(count);
      expect(JSON.parse(ovg.MarshalJSON()).nodes.length).toBe(ovg.Nodes.length);
    }
  });
});

// ── resources ────────────────────────────────────────────────────────────────

const smallLimits = (overrides = {}) => new OVGBuildLimits({ intersectionCandidates: 100, nodes: 100, edges: 100, work: 10_000, ...overrides });
const floatSet = (...values) => {
  const m = new GoFloatMap();
  for (const v of values) m.set(v, true);
  return m;
};

describe('OVG build resources', () => {
  it('default limits and exact work budget', () => {
    const limits = defaultOVGBuildLimits();
    expect([limits.intersectionCandidates, limits.nodes, limits.edges, limits.work]).toEqual([1_000_000, 200_000, 500_000, 250_000_000]);
    const guard = guardFor(bg, limits);
    guard.reserveWork(limits.work);
    requireResourceError(thrown(() => guard.step()), 'work units');
    const huge = guardFor(bg, new OVGBuildLimits({ work: MAX_UINT64 }));
    huge.reserveWork(5);
    requireResourceError(thrown(() => huge.reserveWork(MAX_UINT64)), 'work units arithmetic overflow');
  });

  it('intersection and work limits reject before the Cartesian product', () => {
    let guard = guardFor(bg, smallLimits({ intersectionCandidates: 3 }));
    let ovg = newBuildOVG(null, guard);
    requireResourceError(thrown(() => ovg.addIntersections(new Graph(), floatSet(0, 1), floatSet(0, 1), guard)), 'intersection candidate count');
    expect(ovg.Nodes.length).toBe(0);
    expect(guard.work).toBe(0);

    guard = guardFor(bg, smallLimits({ work: 3 }));
    ovg = newBuildOVG(null, guard);
    requireResourceError(thrown(() => ovg.addIntersections(new Graph(), floatSet(0, 1), floatSet(0, 1), guard)), 'work units');
    expect(ovg.Nodes.length).toBe(0);
  });

  it('cancellation precedes resource checks', () => {
    let cancelled = false;
    const ctx = new WorkContext({ isCancelled: () => cancelled, doneAvailable: true });
    const guard = guardFor(ctx, smallLimits({ intersectionCandidates: 0 }));
    cancelled = true;
    const ovg = newBuildOVG(null, guard);
    requireCanceled(thrown(() => ovg.addIntersections(new Graph(), floatSet(0), floatSet(0), guard)));
    expect([guard.candidates, guard.work, ovg.Nodes.length]).toEqual([0, 0, 0]);
  });

  it('node and edge limits bound actual construction', () => {
    let guard = guardFor(bg, smallLimits({ nodes: 1 }));
    let ovg = newBuildOVG(null, guard);
    requireResourceError(thrown(() => ovg.addIntersections(new Graph(), floatSet(0, 1), floatSet(0), guard)), 'node count');
    expect(ovg.Nodes.length).toBe(1);

    guard = guardFor(bg, smallLimits({ edges: 1 }));
    ovg = newBuildOVG(null, guard);
    for (const x of [0, 10, 20]) guard.addNode(ovg, NewOVGNode(P(x, 0)));
    requireResourceError(thrown(() => ovg.connectNodes(new Graph(), guard)), 'edge count');
    expect(ovg.Edges.length).toBe(1);
  });

  it('hierarchy, tunnel and full-builder work limits stop mid-construction', () => {
    const hierarchyGraph = () => {
      const g = new Graph();
      const top = g.AddNode(node(1, 80, 60, 0, 0));
      const bottom = g.AddNode(node(2, 80, 60, 0, 160));
      g.Connect(top, bottom);
      g.Directions.set(null, Orientation.Bottom);
      const h = hierarchyWithLevels([[top, 0], [bottom, 1]]);
      top.Hierarchy = h;
      bottom.Hierarchy = h;
      return [g, h];
    };
    let [g, h] = hierarchyGraph();
    const baseline = guardFor();
    newOVGForHierarchy(g, h, baseline);
    expect(baseline.nodes).toBeGreaterThan(0);
    [g, h] = hierarchyGraph();
    let limited = guardFor(bg, new OVGBuildLimits({ ...defaultOVGBuildLimits(), work: Math.floor(baseline.work / 2) }));
    requireResourceError(thrown(() => newOVGForHierarchy(g, h, limited)), 'work units');
    expect(limited.nodes).toBeGreaterThan(0);

    const tunnelGraph = () => {
      const tg = cancellationGraph(300, 0);
      tg.Connect(tg.Nodes[0], tg.Nodes[1]);
      tg.Connect(tg.Nodes[0], tg.Nodes[1]);
      return tg;
    };
    const tunnelBaseline = guardFor();
    expect(buildTunnels(tunnelGraph(), tunnelBaseline).length).toBeGreaterThan(0);
    limited = guardFor(bg, new OVGBuildLimits({ ...defaultOVGBuildLimits(), work: tunnelBaseline.work - 1 }));
    requireResourceError(thrown(() => buildTunnels(tunnelGraph(), limited)), 'work units');
    expect(limited.nodes).toBeGreaterThan(0);

    const fullBaseline = guardFor();
    buildOVGFromGraphWithGuard(cancellationGraph(200, 100), null, fullBaseline);
    limited = guardFor(bg, new OVGBuildLimits({ ...defaultOVGBuildLimits(), work: Math.floor(fullBaseline.work / 3) }));
    requireResourceError(thrown(() => buildOVGFromGraphWithGuard(cancellationGraph(200, 100), null, limited)), 'work units');
    expect(limited.nodes > 0 && limited.candidates > 0).toBe(true);
  });

  it('full builder cancels after derived node allocation', () => {
    let guard = null;
    guard = guardFor(cancelWhen(() => guard != null && guard.nodes >= 5));
    requireCanceled(thrown(() => buildOVGFromGraphWithGuard(cancellationGraph(200, 100), null, guard)));
    expect(guard.nodes).toBeGreaterThanOrEqual(5);
  });

  it('checkedOVGEdgeCapacity', () => {
    expect(checkedOVGEdgeCapacity(0, 6, 2, 3, 100, 2147483647)).toBe(7);
    requireResourceError(thrown(() => checkedOVGEdgeCapacity(0, 2_000_000_000, 1, 1, MAX_UINT64, 2147483647)), 'allocation capacity');
    requireResourceError(thrown(() => checkedOVGEdgeCapacity(0, MAX_UINT64, 1, 1, MAX_UINT64, MAX_UINT64)), 'edge capacity');
  });

  it('aligned owners match an ordered scan', () => {
    let seed = 53;
    const rand = (n) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const ports = new Map();
    for (let i = 0; i < 64; i++) {
      const owner = node(i + 1, 40, 40);
      ports.set(owner, Array.from({ length: 9 }, () => NewOVGNode(P(rand(11) - 5, rand(11) - 5))));
    }
    const guard = guardFor();
    const index = newOVGPortIndex(ports, null, null, guard);
    for (let x = -6; x <= 6; x++) {
      for (let y = -6; y <= 6; y++) {
        const want = [];
        index.owners.forEach((owner, i) => {
          if (ports.get(owner).some((p) => p.X === x || p.Y === y)) want.push(i);
        });
        const got = [];
        const aligned = index.alignedOwners(x, y);
        for (;;) {
          const [owner, ok] = aligned.next(guard);
          if (!ok) break;
          got.push(owner);
        }
        expect(got).toEqual(want);
      }
    }
  });

  it('aligned owner work is bounded', () => {
    const zeros = () => new OVGAlignedOwners(new Array(1000).fill(0), new Array(1000).fill(0));
    let guard = guardFor(bg, new OVGBuildLimits({ ...defaultOVGBuildLimits(), work: 6 }));
    requireResourceError(thrown(() => zeros().next(guard)), 'work units');
    guard = guardFor(contextWithRouteAggregateWork(bg, newRouteWorkGuard(bg, 'EdgeRouting', 6)));
    expect(errorIs(thrown(() => zeros().next(guard)), errRouteStageWorkLimit)).toBe(true);
    guard = null;
    guard = guardFor(cancelWhen(() => guard != null && guard.work >= 6));
    requireCanceled(thrown(() => zeros().next(guard)));
  });

  it('port direction filter matches the linear reference', () => {
    const owner = node(1, 40, 60, 0, 0);
    const ports = [P(0, 30), P(40, 30), P(20, 0), P(20, 60)].map(NewOVGNode);
    const points = [P(-50, 30), P(90, 30), P(20, -50), P(20, 90), P(20, 30), ...ports.map((p) => p.Point)];
    const linear = (guard, from, to, direction, selected) => {
      for (const port of selected ?? []) {
        guard.step();
        if (!port.Point.equals(from) && !port.Point.equals(to)) continue;
        if (direction === Orientation.Top && from.X === to.X && from.Y > to.Y) return false;
        if (direction === Orientation.Bottom && from.X === to.X && from.Y < to.Y) return false;
        if (direction === Orientation.Left && from.Y === to.Y && from.X > to.X) return false;
        if (direction === Orientation.Right && from.Y === to.Y && from.X < to.X) return false;
      }
      const result = owner.PassesThrough(from, to);
      guard.check();
      return result;
    };
    for (let direction = Orientation.TopLeft; direction <= Orientation.NONE; direction++) {
      for (const from of points) {
        for (const to of points) {
          for (const selected of [null, ports.slice(0, 1), ports, ports.concat(ports)]) {
            const guard = guardFor();
            expect(guard.passesThroughAllowingPorts(owner, from, to, direction, selected)).toBe(linear(guard, from, to, direction, selected));
          }
        }
      }
    }
    for (const direction of [Orientation.NONE, Orientation.Right]) {
      const guard = guardFor();
      guard.ctx = canceledContext();
      guard.done = () => true;
      requireCanceled(thrown(() => guard.passesThroughAllowingPorts(owner, P(-50, 20), P(90, 20), direction, [NewOVGNode(P(0, 20))])));
    }
  });

  it('indexes do not charge eliminated comparisons and consume budgets', () => {
    const sparse = () => {
      const g = cancellationGraph(200, 0);
      for (let i = 0; i < 1000; i++) g.AddNode(node(i + 3, 40, 40, 10000, i * 100));
      return g;
    };
    const g = sparse();
    const guard = guardFor(bg, new OVGBuildLimits({ ...defaultOVGBuildLimits(), work: 10_000 }));
    const index = newOVGPointProximityIndex(g, [20], guard);
    const linear = guardFor();
    for (let i = 0; i < 1000; i++) {
      expect(index.pointNear(20, i - 100, guard)).toBe(linear.pointNearGraphNode(g, P(20, i - 100)));
    }

    for (const blocked of [false, true]) {
      const graph = sparse();
      if (blocked) graph.AddNode(node(1003, 20, 40, 80, 0));
      const ovg = NewOVG(graph.Nodes);
      ovg.Ports.set(graph.Nodes[0], [NewOVGNode(P(40, 20))]);
      ovg.Ports.set(graph.Nodes[1], [NewOVGNode(P(200, 20))]);
      const portGuard = guardFor(bg, new OVGBuildLimits({ ...defaultOVGBuildLimits(), work: 20_000 }));
      const portIndex = newOVGPortIndex(ovg.Ports, graph, null, portGuard);
      const candidate = NewOVGNode(P(120, 20));
      for (let i = 0; i < 1000; i++) expect(candidate.hasUnobstructedLineToPorts(ovg, portIndex, 2, portGuard)).toBe(!blocked);
    }

    const ports = new Map([[g.Nodes[0], [NewOVGNode(P(20, 20))]]]);
    for (const buildIndex of [(gd) => newOVGPointProximityIndex(g, [20], gd), (gd) => newOVGPortIndex(ports, g, null, gd)]) {
      requireResourceError(thrown(() => buildIndex(guardFor(bg, new OVGBuildLimits({ ...defaultOVGBuildLimits(), work: 10 })))), 'work units');
      const aggregate = guardFor(contextWithRouteAggregateWork(bg, newRouteWorkGuard(bg, 'EdgeRouting', 10)));
      expect(errorIs(thrown(() => buildIndex(aggregate)), errRouteStageWorkLimit)).toBe(true);
      let cancelGuard = null;
      cancelGuard = guardFor(cancelWhen(() => cancelGuard != null && cancelGuard.work >= 10));
      requireCanceled(thrown(() => buildIndex(cancelGuard)));
    }
  });
});

// ── cancellation sweeps ──────────────────────────────────────────────────────

describe('OVG cancellation', () => {
  it('constructor cancelled before work', () => {
    requireCanceled(thrown(() => buildOVGFromGraphWithLimits(canceledContext(), cancellationGraph(200, 100), null, defaultOVGBuildLimits())));
  });

  it('intersections, boundary, tunnel, connect, mapping and near-port sweeps cancel after progress', () => {
    let g = cancellationGraph(200, 100);
    let ovg = NewOVG(g.Nodes);
    ovg.addPorts(g, guardFor());
    let initial = ovg.Nodes.length;
    requireCanceled(thrown(() => ovg.addNodesIntersections(g, guardFor(cancelWhen(() => ovg.Nodes.length > initial)))));
    expect(ovg.Nodes.length).toBeGreaterThan(initial);

    ovg = NewOVG(null);
    ovg.AddNode(NewOVGNode(P(0, 0)));
    ovg.AddNode(NewOVGNode(P(100, 100)));
    initial = ovg.Nodes.length;
    requireCanceled(thrown(() => ovg.addNewBoundaryLayers(new Graph(), P(0, 0), P(100, 100), guardFor(cancelWhen(() => ovg.Nodes.length > initial)))));

    g = cancellationGraph(300, 0);
    ovg = NewOVG(g.Nodes);
    ovg.addPorts(g, guardFor());
    requireCanceled(thrown(() => ovg.addTunnels(g, guardFor(cancelWhen(() => ovg.Edges.length > 0)))));
    expect(ovg.Edges.length).toBeGreaterThan(0);

    ovg = NewOVG(null);
    for (const x of [0, 10, 20]) ovg.AddNode(NewOVGNode(P(x, 0)));
    requireCanceled(thrown(() => ovg.connectNodes(new Graph(), guardFor(cancelWhen(() => ovg.Edges.length > 0)))));

    const graph = new Graph();
    const container = node(1, 200, 200, 0, 0);
    const child = node(2, 20, 20, 10, 10);
    graph.AddNewNodeToContainer(null, container);
    graph.AddNewNodeToContainer(container, child);
    ovg = NewOVG(null);
    const first = ovg.AddNode(NewOVGNode(P(50, 50)));
    ovg.AddNode(NewOVGNode(P(100, 100)));
    requireCanceled(thrown(() => ovg.mapNodesToContainer(graph, guardFor(cancelWhen(() => first.Container != null)))));
    expect(first.Container).toBe(container);

    const owner = node(1, 20, 20, 0, 0);
    ovg = NewOVG(null);
    const port = ovg.AddNode(NewOVGNode(P(20, 10)));
    port.addPortOwner(owner, Orientation.Right, true);
    const adjacent = ovg.AddNode(NewOVGNode(P(25, 10)));
    ovg.Ports.set(owner, [port]);
    ovg.Connect(port, adjacent);
    requireCanceled(thrown(() => ovg.flagNodesNearPorts(guardFor(cancelWhen(() => adjacent.IsNearPort?.has(owner) ?? false)))));
    expect(adjacent.IsNearPort.has(owner)).toBe(true);
  });

  it('tunnel ranges cancel during the node sweep', () => {
    const g = cancellationGraph(300, 0);
    for (let i = 0; i < 3; i++) g.AddNode(node(3 + i, 20, 20, 100 + i * 30, 200));
    requireCanceled(thrown(() => tunnelRangesBetween(g, g.Nodes[0], g.Nodes[1], true, guardFor(cancelAfterErrChecks(4)))));
  });
});

// ── tunnels ──────────────────────────────────────────────────────────────────

describe('tunnels', () => {
  const tunnels = (g) => buildTunnels(g, guardFor());

  it('simple', () => {
    const g = new Graph();
    const a = node(0, 100, 100, 0, 0);
    const b = node(1, 100, 100, 300, 0);
    g.AddNodeUnchecked(a);
    g.AddNodeUnchecked(b);
    g.Connect(a, b);
    const built = tunnels(g);
    expect(built.length).toBe(1);
    for (const entry of [built[0].EntryA, built[0].EntryB]) {
      const [metadata, ok] = entry.OVGNode.portMetadataFor(entry.Node);
      expect(ok).toBe(true);
      expect(metadata.directions).toBe(0);
      expect(metadata.isCenterPort).toBe(false);
    }
    b.TopLeft.Y = 300;
    expect(tunnels(g).length).toBe(0);
  });

  it('obscured', () => {
    const g = new Graph();
    const a = node(0, 100, 100, 0, 0);
    const b = node(1, 100, 100, 500, 0);
    g.AddNodeUnchecked(a);
    g.AddNodeUnchecked(b);
    g.Connect(a, b);
    const c = node(2, 100, 100, 300, 0);
    g.AddNodeUnchecked(c);
    expect(tunnels(g).length).toBe(0);
    c.TopLeft = P(300, 1);
    expect(tunnels(g).length).toBe(0);
    c.TopLeft = P(300, SEGMENT_SPACING_BUFFER + 1);
    expect(tunnels(g).length).toBe(1);
    c.TopLeft = P(300, -90);
    expect(tunnels(g).length).toBe(1);
  });

  it('multiple', () => {
    const g = new Graph();
    const a = node(0, 1000, 1000, 0, 0);
    const b = node(1, 1000, 1000, 5000, 0);
    g.AddNodeUnchecked(a);
    g.AddNodeUnchecked(b);
    for (let i = 0; i < 3; i++) g.Connect(a, b);
    expect(tunnels(g).length).toBe(3);
    b.TopLeft.Y = b.Height - 2 * SEGMENT_SPACING_BUFFER;
    expect(tunnels(g).length).toBe(2);
    b.TopLeft.Y = 0;
    g.AddNodeUnchecked(node(2, 1000, b.Height - SEGMENT_SPACING_BUFFER * 2, 3000, SEGMENT_SPACING_BUFFER));
    expect(tunnels(g).length).toBe(2);
    g.AddNodeUnchecked(node(3, 1000, SEGMENT_SPACING_BUFFER, 3000, 0));
    expect(tunnels(g).length).toBe(1);
  });

  it('panics with Go runtime messages on malformed hierarchies', () => {
    const g = new Graph();
    const a = g.AddNode(node(1, 40, 40, 0, 0));
    const b = g.AddNode(node(2, 40, 40, 200, 0));
    g.Connect(a, b);
    b.Hierarchy = new Hierarchy();
    const err = thrown(() => buildOVGFromGraphWithGuard(g, null, guardFor()));
    expect(err.goPanic).toBe(true);
    expect(err.message).toBe('runtime error: index out of range [0] with length 0');
  });

  it('OVGEdge is a plain value', () => {
    expect(new OVGEdge().Distance).toBe(0);
    expect(new OVGNode().Edges).toEqual([]);
  });
});
