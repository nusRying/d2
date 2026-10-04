import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Cluster } from '../../src/graph/cluster.js';
import { Point } from '../../src/geometry/point.js';
import { num } from './slice46-fixtures.js';

export function buildLabel(spec) {
  if (spec == null) return null;
  const l = new Label(spec.text ?? '', num(spec.w), num(spec.h));
  l.Position = spec.pos;
  if (spec.fixed) {
    l.FixPosition();
  }
  return l;
}

export function buildSlice49Graph(spec) {
  const g = new Graph();
  const byID = new Map();

  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), num(ns.w), num(ns.h));
    if (ns.shape) {
      n.setShape(ns.shape);
    }
    n.TopLeft = new Point(num(ns.x), num(ns.y));
    n.Label = buildLabel(ns.label);
    if (ns.icon) {
      n.Icon = new Icon();
      n.Icon.Position = ns.icon.pos;
      if (ns.icon.fixed) {
        n.Icon.FixPosition();
      }
    }
    n.Is3D = Boolean(ns.is3d);
    n.IsMultiple = Boolean(ns.multiple);
    const container = ns.container ? byID.get(ns.container) : null;
    g.addNewNodeToContainer(container, n);
    byID.set(ns.id, n);
  }

  for (const cs of spec.clusters ?? []) {
    const cluster = new Cluster();
    cluster.Vessel = new Node(BigInt(cs.vessel), 10, 10);
    cluster.Nodes = [];
    for (const member of cs.members ?? []) {
      const mn = byID.get(member);
      cluster.Nodes.push(mn);
      mn.Cluster = cluster;
    }
  }

  for (const es of spec.edges ?? []) {
    const fromNode = byID.get(es.from);
    const toNode = byID.get(es.to);
    const e = g.connect(fromNode, toNode);
    e.ID = BigInt(es.id);
    e.Points = (es.points ?? []).map((p) => new Point(num(p[0]), num(p[1])));
    e.Label = buildLabel(es.label);
    e.LabelPercentage = es.pct != null ? num(es.pct) : 0;
    e.SourceArrowhead = es.src ?? '';
    e.TargetArrowhead = es.dst ?? '';
    e.SourceArrowheadLabel = buildLabel(es.srcLabel);
    e.TargetArrowheadLabel = buildLabel(es.dstLabel);
  }

  return { g, byID };
}

export function captureState(g) {
  const nodes = g.Nodes.map((n) => ({
    id: Number(n.ID),
    labelPos: n.Label != null ? n.Label.Position : -1,
    iconPos: n.Icon != null ? n.Icon.Position : -1,
  }));
  const edges = g.Edges.length === 0
    ? null
    : g.Edges.map((e) => ({
        id: Number(e.ID),
        labelPos: e.Label != null ? e.Label.Position : -1,
        pct: e.LabelPercentage,
      }));
  return { nodes, edges };
}
