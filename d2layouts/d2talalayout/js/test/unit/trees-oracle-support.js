// Slice 46 — shared builders for the trees oracle replay. Mirrors the spec
// builder and observable-state dump in
// internal/trees/go_slice46_trees_oracle_test.go.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Sequence } from '../../src/graph/sequence.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { Descendants } from '../../src/trees/index.js';
import { Preprocess, Place, preprocessTreesWithWorkLimit, placeTreesWithWorkLimit, constructToOrientation, buildPlacementTrees, positionTreeEdgeLabels } from '../../src/trees/layout.js';
import { treeDescendants } from '../../src/trees/preprocess-helpers.js';
import { newWorkGuard } from '../../src/trees/types.js';

export const bg = backgroundWorkContext();

export function loadFixture() {
  return JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'fixtures', 'go-slice46-trees-reference.json'), 'utf8'),
  );
}

export function build(spec) {
  const g = new Graph();
  const nodes = [];
  const byID = new Map();
  const edges = [];
  for (const ns of spec.nodes) {
    const n = new Node(BigInt(ns.id), ns.w, ns.h);
    if (ns.placed) n.TopLeft = new Point(ns.x ?? 0, ns.y ?? 0);
    if (ns.fixed) n.FixedTopLeft = new Point(ns.fx ?? 0, ns.fy ?? 0);
    if (ns.shape) n.SetShape(ns.shape);
    byID.set(ns.id, n);
    nodes.push(n);
    if (ns.detached) continue;
    const container = ns.container ? byID.get(ns.container) : null;
    g.AddNewNodeToContainer(container, n);
  }
  for (const es of spec.edges ?? []) {
    const e = g.Connect(byID.get(es.from), byID.get(es.to));
    e.SourceArrowhead = es.src ?? '';
    e.TargetArrowhead = es.dst ?? '';
    e.MinWidth = es.minW ?? 0;
    e.MinHeight = es.minH ?? 0;
    if (es.label) {
      e.Label = new Label('label', es.minW ?? 0, es.minH ?? 0);
      e.Label.Position = 0;
    }
    const pts = es.points ?? [];
    for (let i = 0; i + 1 < pts.length; i += 2) e.Points.push(new Point(pts[i], pts[i + 1]));
    edges.push(e);
  }
  for (const [a, b] of spec.nears ?? []) byID.get(a).Nears.add(byID.get(b));
  for (const s of spec.sequences ?? []) {
    const vessel = byID.get(s.vessel);
    const seq = new Sequence({ Vessel: vessel, Graph: g, Nodes: [] });
    for (const id of s.members) {
      const member = byID.get(id);
      member.Graph = g;
      member.Sequence = seq;
      seq.Nodes.push(member);
    }
    g.Sequences.set(vessel, seq);
  }
  for (const d of spec.directions ?? []) {
    g.Directions.set(d.container ? byID.get(d.container) : null, d.dir);
  }
  return { g, nodes, byID, edges };
}

const id = (n) => (n == null ? 0 : Number(n.ID));

export function stateOf(b) {
  const { g } = b;
  const st = {
    nodes: [], nodeEdges: [], nodeContainer: [], nodeInGraph: [], graphNodes: [], graphEdges: [],
    containers: [], trees: [], nodeToTree: [], descendants: [],
  };
  const edgeIndex = new Map(b.edges.map((e, i) => [e, i]));
  const idx = (e) => (e == null ? -1 : (edgeIndex.has(e) ? edgeIndex.get(e) : -2));
  for (const n of b.nodes) {
    st.nodes.push(n.TopLeft == null ? [n.Width, n.Height] : [n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height]);
    st.nodeEdges.push(n.Edges.map(idx));
    st.nodeContainer.push(id(n.Container));
    st.nodeInGraph.push(n.Graph === g);
  }
  for (const n of g.Nodes) st.graphNodes.push(id(n));
  for (const e of g.Edges) st.graphEdges.push(idx(e));
  const byId = (a, c) => id(a) - id(c);
  for (const k of [...g.Containers.keys()].sort(byId)) {
    st.containers.push([id(k), ...(g.Containers.get(k) ?? []).map(id)]);
  }
  const inTrees = new Set();
  const dump = (t) => {
    inTrees.add(t);
    const d = { n: id(t.Node), p: t.Parent != null ? id(t.Parent.Node) : 0, e: idx(t.SentinelEdge), o: t.Orientation };
    if (t.Children != null && t.Children.length > 0) d.c = t.Children.map(dump);
    return d;
  };
  for (const k of [...g.Trees.keys()].sort(byId)) {
    const entry = { s: id(k), roots: [] };
    for (const root of g.Trees.get(k)) {
      entry.roots.push(dump(root));
      st.descendants.push([id(root.Node), ...Descendants(root).map((d) => id(d.Node))]);
    }
    st.trees.push(entry);
  }
  for (const k of [...g.NodeToTree.keys()].sort(byId)) {
    const t = g.NodeToTree.get(k);
    st.nodeToTree.push([id(k), id(t.Node), t.Parent != null ? id(t.Parent.Node) : 0, inTrees.has(t) ? 1 : 0]);
  }
  const labels = [];
  b.edges.forEach((e, i) => {
    if (e.Label != null) labels.push([i, e.Label.Position ?? 0, e.LabelPercentage]);
  });
  if (labels.length > 0) st.labels = labels;
  return st;
}

/** Captures object identities that a whole-call rollback must restore. */
export function captureRefs(b) {
  const { g } = b;
  const trees = [];
  const visit = (t) => {
    trees.push({ t, children: t.Children, parent: t.Parent, edge: t.SentinelEdge, node: t.Node, o: t.Orientation });
    for (const c of t.Children) visit(c);
  };
  for (const roots of g.Trees.values()) for (const r of roots) visit(r);
  return {
    nodes: g.Nodes,
    edges: g.Edges,
    containers: g.Containers,
    containerArrays: new Map([...g.Containers].map(([k, v]) => [k, v])),
    treesMap: g.Trees,
    treeArrays: new Map([...g.Trees].map(([k, v]) => [k, v])),
    nodeToTree: g.NodeToTree,
    nodeToTreeEntries: new Map(g.NodeToTree),
    trees,
    nodeEdges: b.nodes.map((n) => n.Edges),
    topLefts: b.nodes.map((n) => n.TopLeft),
  };
}

/** Returns a description of the first identity mismatch, or null. */
export function refsMismatch(b, refs) {
  const { g } = b;
  if (g.Nodes !== refs.nodes) return 'g.Nodes';
  if (g.Edges !== refs.edges) return 'g.Edges';
  if (g.Containers !== refs.containers) return 'g.Containers';
  if (g.Containers.size !== refs.containerArrays.size) return 'g.Containers size';
  for (const [k, v] of refs.containerArrays) if (g.Containers.get(k) !== v) return `container ${id(k)}`;
  if (g.Trees !== refs.treesMap) return 'g.Trees';
  if (g.Trees.size !== refs.treeArrays.size) return 'g.Trees size';
  for (const [k, v] of refs.treeArrays) if (g.Trees.get(k) !== v) return `trees ${id(k)}`;
  if (g.NodeToTree !== refs.nodeToTree) return 'g.NodeToTree';
  if (g.NodeToTree.size !== refs.nodeToTreeEntries.size) return 'g.NodeToTree size';
  for (const [k, v] of refs.nodeToTreeEntries) if (g.NodeToTree.get(k) !== v) return `nodeToTree ${id(k)}`;
  for (const r of refs.trees) {
    if (r.t.Children !== r.children || r.t.Parent !== r.parent || r.t.SentinelEdge !== r.edge ||
      r.t.Node !== r.node || r.t.Orientation !== r.o) return `tree ${id(r.node)}`;
  }
  for (let i = 0; i < b.nodes.length; i++) {
    if (b.nodes[i].Edges !== refs.nodeEdges[i]) return `node edges ${id(b.nodes[i])}`;
    if (b.nodes[i].TopLeft !== refs.topLefts[i]) return `node topLeft ${id(b.nodes[i])}`;
  }
  return null;
}

export function countingContext(cancelAt = 0, panicAt = 0) {
  const canceled = new Error('context canceled');
  return {
    calls: 0,
    Err() {
      this.calls++;
      if (panicAt > 0 && this.calls === panicAt) throw new Error('slice46 tree probe panic');
      return cancelAt > 0 && this.calls >= cancelAt ? canceled : null;
    },
    canceled,
  };
}

export function prepare(c) {
  const b = build(c.spec);
  if (c.op !== 'preprocess') Preprocess(bg, b.g);
  return b;
}

function construct(ctx, b, orientation) {
  const guard = newWorkGuard(ctx, 'Slice46Construct');
  const placementTrees = buildPlacementTrees(b.g, guard);
  if (placementTrees.length === 0) return;
  const tree = placementTrees[0];
  for (const d of treeDescendants(tree, guard)) d.Node.TopLeft = new Point(0, 0);
  constructToOrientation(tree, orientation, guard);
  positionTreeEdgeLabels(tree, false, guard);
}

export function run(c, ctx = bg, limit = 0) {
  const b = prepare(c);
  const initial = stateOf(b);
  const refs = captureRefs(b);
  const container = c.container ? b.byID.get(c.container) : null;
  let err = null;
  try {
    switch (c.op) {
      case 'preprocess':
        if (limit === 0) Preprocess(ctx, b.g);
        else preprocessTreesWithWorkLimit(ctx, b.g, BigInt(limit));
        break;
      case 'place':
        if (limit === 0) Place(ctx, b.g, container);
        else placeTreesWithWorkLimit(ctx, b.g, container, BigInt(limit));
        break;
      case 'construct':
        construct(ctx, b, c.orientation ?? 0);
        break;
      default:
        throw new Error(`unknown op ${c.op}`);
    }
  } catch (e) {
    err = e;
  }
  return { b, initial, refs, err };
}

export function errorString(err) {
  return err == null ? '' : err.message;
}

export function chainHas(err, target) {
  for (let current = err; current != null; current = current.cause) {
    if (current === target) return true;
  }
  return false;
}
