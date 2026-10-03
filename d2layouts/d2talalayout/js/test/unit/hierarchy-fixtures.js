// Slice 46 — shared builders for the hierarchy oracle replay and unit tests.
// buildSpec and stateOf mirror s46Spec.build and s46Built.state in
// internal/hierarchy/go_slice46_hierarchy_oracle_test.go.
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { newHierarchy } from '../../src/graph/hierarchy.js';
import { hierarchyLevel, setHierarchyRankWeight } from '../../src/graph/structural-access.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { GoRand } from '../../src/random/go-math-rand.js';

export const bg = backgroundWorkContext();

export function buildSpec(spec) {
  const g = new Graph();
  g.IsRootHierarchy = Boolean(spec.rootHierarchy);
  const nodes = [];
  const byID = new Map();
  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), ns.w, ns.h);
    n.TopLeft = new Point(ns.x, ns.y);
    if (ns.shape) n.setShape(ns.shape);
    if (ns.columns) n.setNumColumns(ns.columns);
    if (ns.fixed) n.FixedTopLeft = new Point(ns.x, ns.y);
    n.ForceHierarchy = Boolean(ns.force);
    const container = ns.container ? byID.get(ns.container) : null;
    g.addNewNodeToContainer(container, n);
    nodes.push(n);
    byID.set(ns.id, n);
  }
  const edges = [];
  for (const es of spec.edges ?? []) {
    const e = g.connect(byID.get(es.from), byID.get(es.to));
    e.ID = BigInt(es.id);
    if (es.src) e.SourceArrowhead = es.src;
    if (es.dst) e.TargetArrowhead = es.dst;
    if (es.fromCol != null) e.FromTableColumnIndex = es.fromCol;
    if (es.toCol != null) e.ToTableColumnIndex = es.toCol;
    if (es.labelW || es.labelH) e.Label = new Label('', es.labelW ?? 0, es.labelH ?? 0);
    if (es.weight != null) setHierarchyRankWeight(e, es.weight);
    edges.push(e);
  }
  for (const d of spec.directions ?? []) {
    g.Directions.set(d.container ? byID.get(d.container) : null, Orientation[d.direction]);
  }
  for (const [a, b] of spec.nears ?? []) {
    byID.get(a).addNear(byID.get(b));
  }
  for (const hs of spec.hierarchies ?? []) {
    const h = newHierarchy();
    h.LevelCount = hs.levelCount;
    for (const [id, level] of hs.members) {
      const n = byID.get(id);
      h.Levels().set(n, level);
      n.Hierarchy = h;
    }
  }
  return { g, nodes, byID, edges };
}

export function stateOf(built) {
  const st = { boxes: [], hier: [], levels: [], levelCounts: [], hierSizes: [], edges: [], adj: [], nears: [], owned: [] };
  const index = new Map();
  for (const n of built.nodes) {
    st.boxes.push(n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height);
    if (n.Hierarchy == null) {
      st.hier.push(-1);
      st.levels.push(0);
    } else {
      let i = index.get(n.Hierarchy);
      if (i === undefined) {
        i = st.levelCounts.length;
        index.set(n.Hierarchy, i);
        st.levelCounts.push(n.Hierarchy.LevelCount);
        st.hierSizes.push(n.Hierarchy.Levels().size);
      }
      st.hier.push(i);
      st.levels.push(hierarchyLevel(n));
    }
    st.adj.push(n.Edges.map((e) => Number(e.ID)));
    st.nears.push([...n.Nears].map((m) => Number(m.ID)).sort((a, b) => a - b));
    st.owned.push(n.Graph === built.g);
  }
  for (const e of built.edges) {
    st.edges.push(Number(e.From.ID), Number(e.To.ID));
  }
  return st;
}

/** Go's json.Marshal omits empty slices with omitempty; normalize nil vs []. */
export function fixtureState(st) {
  return {
    boxes: st.boxes ?? [],
    hier: st.hier ?? [],
    levels: st.levels ?? [],
    levelCounts: st.levelCounts ?? [],
    hierSizes: st.hierSizes ?? [],
    edges: st.edges ?? [],
    adj: st.adj ?? [],
    nears: st.nears ?? [],
    owned: st.owned ?? [],
  };
}

export function sameState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function seededRand(seed) {
  return seed < 0 ? null : new GoRand(seed);
}

export function countingContext(cancelAt = 0, panicAt = 0, canceled = new Error('context canceled')) {
  return {
    calls: 0,
    cancelAt,
    panicAt,
    canceled,
    Err() {
      this.calls++;
      if (this.panicAt > 0 && this.calls === this.panicAt) {
        throw new Error('s46 injected panic');
      }
      return this.cancelAt > 0 && this.calls >= this.cancelAt ? this.canceled : null;
    },
  };
}

export function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
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
