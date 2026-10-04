// Shared Slice 46 packing scenario builders. Mirrors s46Spec.build, the exact
// state snapshot, and the counting context in
// internal/packing/go_slice46_packing_oracle_test.go. Not a test file.
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Point } from '../../src/geometry/point.js';
import { Box } from '../../src/geometry/box.js';
import { copyEntitiesFrom } from '../../src/graph/structural-access.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';

export const bg = backgroundWorkContext();

export const PANIC_PROBE = new Error('s46 panic probe');

/** Mirrors s46Spec.build. */
export function buildSpec(spec) {
  const g = new Graph();
  const b = { g, nodes: [], byID: new Map(), edges: [], root: null, subs: [], obst: [], graphs: [g] };
  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), ns.w, ns.h);
    if (ns.shape) n.setShape(ns.shape);
    n.TopLeft = new Point(ns.x ?? 0, ns.y ?? 0);
    if (ns.fixed) n.FixedTopLeft = new Point(ns.fx ?? 0, ns.fy ?? 0);
    if (ns.desiredW != null) n.DesiredWidth = ns.desiredW;
    if (ns.desiredH != null) n.DesiredHeight = ns.desiredH;
    if (ns.label) {
      const lbl = new Label('', ns.label.w, ns.label.h);
      lbl.Position = ns.label.pos;
      n.Label = lbl;
    }
    n.Is3D = Boolean(ns.is3d);
    n.IsMultiple = Boolean(ns.multiple);
    if (ns.nilNear) n.Nears.add(null);
    const container = ns.container ? b.byID.get(ns.container) : null;
    if (!ns.subOnly) g.addNewNodeToContainer(container, n);
    b.nodes.push(n);
    b.byID.set(ns.id, n);
  }
  (spec.edges ?? []).forEach((es, i) => {
    const from = b.byID.get(es.from);
    const to = b.byID.get(es.to);
    const e = es.subOnly ? new Edge(from, to) : g.connect(from, to);
    e.ID = BigInt(i + 1);
    if (es.points && es.points.length > 0) {
      e.Points = [];
      for (let j = 0; j + 1 < es.points.length; j += 2) e.Points.push(new Point(es.points[j], es.points[j + 1]));
    }
    if (es.radius != null) e.Style = { BorderRadius: { Value: es.radius } };
    e.IsCurve = Boolean(es.curve);
    b.edges.push(e);
  });
  for (const [owner, near] of spec.nears ?? []) b.byID.get(owner).Nears.add(b.byID.get(near));
  if (spec.root) b.root = b.byID.get(spec.root);
  for (const ss of spec.subs ?? []) {
    if (ss.nil) {
      b.subs.push(null);
      continue;
    }
    const sub = new Graph();
    if (!ss.fresh) copyEntitiesFrom(sub, g);
    for (const id of ss.nodes ?? []) sub.addNodeUnchecked(b.byID.get(id));
    for (const index of ss.edges ?? []) sub.AddEdge(b.edges[index]);
    b.subs.push(sub);
    b.graphs.push(sub);
  }
  for (const o of spec.obstacles ?? []) b.obst.push(new Box(new Point(o.x, o.y), o.w, o.h));
  return b;
}

/** Mirrors s46Built.snap (pointer identity included). */
export function snap(b) {
  return {
    nodes: b.nodes.map((n) => ({
      topLeft: n.TopLeft, x: n.TopLeft.X, y: n.TopLeft.Y, w: n.Width, h: n.Height, graph: n.Graph, container: n.Container,
    })),
    edges: b.edges.map((e) => ({ array: e.Points, points: e.Points.slice(), values: e.Points.map((p) => [p.X, p.Y]) })),
    graphs: b.graphs.map((g) => ({ nodes: g.Nodes.slice(), edges: g.Edges.slice() })),
    children: new Map([...b.g.Containers].map(([k, v]) => [k, v.slice()])),
  };
}

/** Mirrors s46Built.restoredTo; `strictArrays` also checks route-array identity. */
export function restoredTo(b, s, strictArrays = false) {
  for (let i = 0; i < b.nodes.length; i++) {
    const n = b.nodes[i];
    const w = s.nodes[i];
    if (n.TopLeft !== w.topLeft || n.TopLeft.X !== w.x || n.TopLeft.Y !== w.y || n.Width !== w.w ||
      n.Height !== w.h || n.Graph !== w.graph || n.Container !== w.container) return false;
  }
  for (let i = 0; i < b.edges.length; i++) {
    const e = b.edges[i];
    const w = s.edges[i];
    if (strictArrays && e.Points !== w.array) return false;
    if (e.Points.length !== w.points.length) return false;
    for (let j = 0; j < e.Points.length; j++) {
      const p = e.Points[j];
      if (p !== w.points[j] || p.X !== w.values[j][0] || p.Y !== w.values[j][1]) return false;
    }
  }
  for (let i = 0; i < b.graphs.length; i++) {
    const g = b.graphs[i];
    const w = s.graphs[i];
    if (g.Nodes.length !== w.nodes.length || g.Edges.length !== w.edges.length) return false;
    if (g.Nodes.some((n, j) => n !== w.nodes[j]) || g.Edges.some((e, j) => e !== w.edges[j])) return false;
  }
  if (b.g.Containers.size !== s.children.size) return false;
  for (const [k, v] of b.g.Containers) {
    const want = s.children.get(k);
    if (want === undefined || want.length !== v.length || v.some((n, j) => n !== want[j])) return false;
  }
  return true;
}

export function geomOf(b) {
  return b.nodes.flatMap((n) => [n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height]);
}

export function routesOf(b) {
  return b.edges.map((e) => e.Points.flatMap((p) => [p.X, p.Y]));
}

export function ownersOf(b, combined) {
  return b.nodes.map((n) => {
    if (n.Graph === b.g) return 0;
    if (combined != null && n.Graph === combined) return -1;
    let owner = -2;
    b.subs.forEach((sub, i) => {
      if (sub != null && n.Graph === sub) owner = i + 1;
    });
    return owner;
  });
}

/** Mirrors s46CountingContext. */
export function countingContext({ cancelAt = 0, panicAt = 0 } = {}) {
  const canceled = new Error('context canceled');
  return {
    calls: 0,
    canceled,
    Err() {
      this.calls++;
      if (panicAt > 0 && this.calls >= panicAt) throw PANIC_PROBE;
      if (cancelAt > 0 && this.calls >= cancelAt) return canceled;
      return null;
    },
  };
}

export function chainHas(err, target) {
  for (let current = err; current != null; current = current.cause) {
    if (current === target) return true;
  }
  return false;
}

export function errorString(err) {
  return err == null ? '' : err.message;
}
