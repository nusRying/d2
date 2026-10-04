// Shared helpers for the Slice 47 labeling Go-oracle replay and unit tests.
// They rebuild the Go-exported scenario specs and run labeling entry points
// with Go-compatible outcome classification; expected values come from the
// fixture.
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Cluster } from '../../src/graph/cluster.js';
import { Sequence } from '../../src/graph/sequence.js';
import { Point } from '../../src/geometry/point.js';
import { normalizeLabelPosition } from '../../src/graph/label-position.js';
import { placeNewEdges } from '../../src/labeling/placement.js';
import { num, enc } from './slice46-fixtures.js';

/** Marker for a Go `panic(...)` raised by the test context. */
export class S47Panic extends Error {}

/** Go s47lContext: counts Err calls; cancels or panics at a call index. */
export function s47Context(cancelAt = 0, panicAt = 0) {
  const canceled = new Error('context canceled');
  return {
    calls: 0,
    canceled,
    Err() {
      this.calls++;
      if (panicAt > 0 && this.calls >= panicAt) {
        throw new S47Panic('label placement test panic');
      }
      return cancelAt > 0 && this.calls >= cancelAt ? canceled : null;
    },
  };
}

export function points(route) {
  return (route ?? []).map((p) => new Point(num(p[0]), num(p[1])));
}

function labelOf(spec) {
  if (spec == null) return null;
  const value = new Label(spec.text, num(spec.w), num(spec.h));
  value.Position = spec.pos;
  if (spec.fixed) value.FixPosition();
  return value;
}

/** Rebuilds a Go s47lSpec. */
export function buildS47(spec) {
  const g = new Graph();
  const byID = new Map();
  const b = { g, byID, edges: [], selected: [], nodeLabels: [], nodeIcons: [], edgeLabels: [] };
  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), num(ns.w), num(ns.h));
    if (ns.shape) n.setShape(ns.shape);
    if (!ns.unplaced) n.TopLeft = new Point(num(ns.x), num(ns.y));
    n.Label = labelOf(ns.label);
    if (ns.icon != null) {
      n.Icon = new Icon(ns.icon.pos);
      if (ns.icon.fixed) n.Icon.FixPosition();
    }
    n.Is3D = Boolean(ns.is3d);
    n.IsMultiple = Boolean(ns.multiple);
    if (ns.loops != null && ns.loops.length > 0) {
      n.LoopOffsets = new Map();
      for (const loop of ns.loops) n.LoopOffsets.set(loop.o, num(loop.v));
    }
    const container = ns.container ? byID.get(ns.container) : null;
    g.addNewNodeToContainer(container, n);
    byID.set(ns.id, n);
    b.nodeLabels.push(n.Label);
    b.nodeIcons.push(n.Icon);
  }
  for (const cs of spec.clusters ?? []) {
    const cluster = new Cluster({ Vessel: new Node(BigInt(cs.vessel), 10, 10), Nodes: [] });
    for (const member of cs.members) {
      cluster.Nodes.push(byID.get(member));
      byID.get(member).Cluster = cluster;
    }
  }
  for (const es of spec.edges ?? []) {
    const e = g.connect(byID.get(es.from), byID.get(es.to));
    e.ID = BigInt(es.id);
    e.Points = points(es.points);
    e.Label = labelOf(es.label);
    e.LabelPercentage = es.pct == null ? 0 : num(es.pct);
    e.SourceArrowhead = es.src ?? '';
    e.TargetArrowhead = es.dst ?? '';
    e.SourceArrowheadLabel = labelOf(es.srcLabel);
    e.TargetArrowheadLabel = labelOf(es.dstLabel);
    b.edges.push(e);
    b.edgeLabels.push(e.Label);
  }
  for (const index of spec.selected ?? []) {
    b.selected.push(index < 0 ? null : b.edges[index]);
  }
  return b;
}

/** Mirrors s47lApplyMutation → [graph, selected, nilCtx]. */
export function applyMutation(b, mutation) {
  const g = b.g;
  let selected = b.selected;
  switch (mutation ?? '') {
    case '':
      break;
    case 'nil-graph':
      return [null, selected, false];
    case 'nil-ctx':
      return [g, selected, true];
    case 'node-no-position':
      g.Nodes[0].TopLeft = null;
      break;
    case 'requested-nil':
      selected = [...selected, null];
      break;
    case 'requested-repeat':
      selected = [...selected, selected[0]];
      break;
    case 'graph-repeat':
      g.Edges.push(g.Edges[0]);
      break;
    case 'requested-missing-endpoint': {
      const extra = new Edge(null, g.Nodes[0]);
      extra.ID = 900n;
      selected = [...selected, extra];
      break;
    }
    case 'requested-short-route': {
      const extra = new Edge(g.Nodes[0], g.Nodes[1]);
      extra.ID = 901n;
      extra.Points = [new Point(1, 1)];
      extra.Label = new Label('short', 10, 10);
      selected = [...selected, extra];
      break;
    }
    case 'requested-nil-point': {
      const extra = new Edge(g.Nodes[0], g.Nodes[1]);
      extra.ID = 902n;
      extra.Points = [new Point(1, 1), null, new Point(5, 5)];
      selected = [...selected, extra];
      break;
    }
    case 'requested-arrow-label-short': {
      const extra = new Edge(g.Nodes[0], g.Nodes[1]);
      extra.ID = 903n;
      extra.TargetArrowheadLabel = new Label('t', 4, 4);
      selected = [...selected, extra];
      break;
    }
    case 'graph-short-route':
      g.Edges[0].Points = g.Edges[0].Points.slice(0, 1);
      break;
    case 'graph-nil-point':
      g.Edges[0].Points[1] = null;
      break;
    case 'cluster-no-vessel':
      g.Nodes[0].Cluster = new Cluster({ Nodes: [g.Nodes[0]] });
      break;
    case 'sequence-no-vessel':
      g.Nodes[0].Sequence = new Sequence({ Nodes: [g.Nodes[0]] });
      break;
    case 'unselected-unset-label':
      g.Edges[0].Label = new Label('unset', 30, 10);
      g.Edges[0].Label.Position = 0;
      b.edgeLabels[0] = g.Edges[0].Label;
      selected = selected.slice(1);
      break;
    default:
      throw new Error(`unknown mutation ${mutation}`);
  }
  return [g, selected, false];
}

/** s47lStateOf */
export function stateOf(b, withTL) {
  const state = { edges: [], nodeLabels: [], icons: [] };
  for (const e of b.edges) {
    const edgeState = { pos: -1, pct: enc(e.LabelPercentage) };
    if (e.Label != null) {
      edgeState.pos = normalizeLabelPosition(e.Label.Position);
      if (withTL) {
        try {
          const tl = e.labelTopLeft(e.Label.Position, e.Label.Width, e.Label.Height);
          if (tl != null) edgeState.tl = [enc(tl.X), enc(tl.Y)];
        } catch {
          // Go: the d2 helper panics on malformed routes; the box is omitted.
        }
      }
    }
    state.edges.push(edgeState);
  }
  for (const n of b.g.Nodes) {
    state.nodeLabels.push(n.Label != null ? normalizeLabelPosition(n.Label.Position) : -1);
    state.icons.push(n.Icon != null ? normalizeLabelPosition(n.Icon.Position) : -1);
  }
  return state;
}

function identityKept(b) {
  for (let i = 0; i < b.edges.length; i++) {
    if (b.edges[i].Label !== b.edgeLabels[i]) return false;
  }
  for (let i = 0; i < b.g.Nodes.length; i++) {
    const n = b.g.Nodes[i];
    if (i < b.nodeLabels.length && (n.Label !== b.nodeLabels[i] || n.Icon !== b.nodeIcons[i])) return false;
  }
  return true;
}

function rawState(b) {
  return {
    labels: b.edges.map((e) => [e.Label?.Position, e.LabelPercentage]),
    nodes: b.g.Nodes.map((n) => [n.Label?.Position, n.Icon?.Position]),
  };
}

export function errorChainIncludes(err, target) {
  for (let current = err; current != null; current = current.cause) {
    if (current === target) return true;
  }
  return false;
}

/**
 * Go-shaped outcome of one placeNewEdges call. Exact rollback is checked on
 * the raw JS values (null stays null), not only on the normalized dump.
 */
export function execS47(spec, mutation, cancelAt, panicAt, limit, withState) {
  const b = buildS47(spec);
  const [graph, selected, nilCtx] = applyMutation(b, mutation);
  const initial = stateOf(b, false);
  const initialRaw = rawState(b);
  const ctx = s47Context(cancelAt, panicAt);
  const run = {};
  try {
    placeNewEdges(nilCtx ? null : ctx, graph, selected, limit);
  } catch (err) {
    if (err instanceof S47Panic) {
      run.panic = err.message;
    } else if (err instanceof TypeError || err instanceof RangeError) {
      run.panic = 'runtime error';
    } else {
      run.err = err.message;
      if (errorChainIncludes(err, ctx.canceled)) run.canceled = true;
    }
  }
  const after = stateOf(b, false);
  run.restored = Bun.deepEquals(after, initial) && identityKept(b);
  if (run.restored && !Bun.deepEquals(rawState(b), initialRaw, true)) {
    run.restored = false;
  }
  run.calls = ctx.calls;
  if (withState) run.state = stateOf(b, true);
  return run;
}
