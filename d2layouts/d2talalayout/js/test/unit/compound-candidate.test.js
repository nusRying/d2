// Slice 50 — compound candidate / route preservation edge behavior.
import { describe, it as bunIt, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { WorkContext, backgroundWorkContext } from '../../src/limits/work-context.js';
import { Layout, LayoutOptions } from '../../src/engine/pipeline.js';
import { CompoundCandidate, compoundCrossAxisDetours } from '../../src/engine/compound-candidate.js';
import { PreserveCompoundRoutes, compoundEnclosedRoute } from '../../src/engine/compound-routes.js';
import { Point } from '../../src/geometry/point.js';

const it = (name, fn) => bunIt(name, fn, 300_000);
const bg = backgroundWorkContext();

function compoundGraph() {
  const g = new Graph();
  const add = (id, w, h, container = null) => {
    const n = new Node(BigInt(id), w, h);
    g.AddNewNodeToContainer(container, n);
    return n;
  };
  const g1 = add(1, 0, 0);
  const a = add(11, 80, 40, g1);
  const b = add(12, 80, 40, g1);
  const c = add(13, 80, 40, g1);
  const g2 = add(2, 0, 0);
  const d = add(21, 80, 40, g2);
  const e = add(22, 80, 40, g2);
  const x = add(3, 100, 50);
  const y = add(4, 100, 50);
  let id = 500;
  for (const [from, to] of [[a, b], [b, c], [d, e], [c, d], [x, a], [e, y]]) {
    const edge = g.Connect(from, to);
    edge.ID = BigInt(++id);
    edge.SourceArrowhead = 'none';
    edge.TargetArrowhead = 'triangle';
  }
  return g;
}

function geometry(g) {
  return JSON.stringify([
    g.Nodes.map((n) => [String(n.ID), n.TopLeft?.X, n.TopLeft?.Y, n.Width, n.Height]),
    g.Edges.map((e) => e.Points.map((p) => [p.X, p.Y])),
  ]);
}

describe('Slice 50 — CompoundCandidate', () => {
  it('requires a context and graph', () => {
    expect(() => CompoundCandidate(null, new Graph())).toThrow('TALA compound candidate requires a context and graph');
  });

  it('pre-canceled context fails without touching the input', () => {
    const ordinary = Layout(bg, compoundGraph(), new LayoutOptions({ Seed: 1n }));
    const before = geometry(ordinary);
    const ctx = new WorkContext({ isCancelled: () => true, doneAvailable: true });
    expect(() => CompoundCandidate(ctx, ordinary)).toThrow('context canceled');
    expect(geometry(ordinary)).toBe(before);
  });

  it('mid-flight cancellation preserves the input', () => {
    const ordinary = Layout(bg, compoundGraph(), new LayoutOptions({ Seed: 1n }));
    const before = geometry(ordinary);
    for (const at of [3, 20, 200, 2000]) {
      let calls = 0;
      const ctx = new WorkContext({ isCancelled: () => ++calls >= at, doneAvailable: true });
      try {
        CompoundCandidate(ctx, ordinary);
      } catch (err) {
        expect(err.message).toContain('context canceled');
      }
      expect(geometry(ordinary)).toBe(before);
    }
  });

  it('cross-axis detours treat touching projections as overlapping', () => {
    const g = new Graph();
    const a = new Node(1n, 10, 10);
    const b = new Node(2n, 10, 10);
    g.AddNewNodeToContainer(null, a);
    g.AddNewNodeToContainer(null, b);
    g.Connect(a, b);
    a.TopLeft = new Point(0, 0);
    b.TopLeft = new Point(10, 0);
    expect(compoundCrossAxisDetours(g)).toBe(0);
    b.TopLeft = new Point(11, 0);
    expect(compoundCrossAxisDetours(g)).toBe(1);
  });
});

describe('Slice 50 — PreserveCompoundRoutes', () => {
  it('copies fixed node labels/icons and fixed edge labels including fixed bookkeeping', () => {
    const before = Layout(bg, compoundGraph(), new LayoutOptions({ Seed: 1n }));
    const fixedLabel = new Label('fixed', 20, 10);
    fixedLabel.Position = LabelPosition.InsideTopLeft;
    fixedLabel.FixPosition();
    before.Nodes[1].Label = fixedLabel;
    const icon = new Icon(LabelPosition.InsideTopRight);
    icon.FixPosition();
    before.Nodes[1].Icon = icon;
    const edgeLabel = new Label('e', 10, 10);
    edgeLabel.Position = LabelPosition.InsideMiddleCenter;
    edgeLabel.FixPosition();
    before.Edges[0].Label = edgeLabel;
    before.Edges[0].LabelPercentage = 0.25;

    const after = PreserveCompoundRoutes(bg, before, before);
    const node = after.Nodes[1];
    expect(node.Label).not.toBe(fixedLabel);
    expect(node.Label.PositionFixed()).toBe(true);
    expect(node.Label.Position).toBe(LabelPosition.InsideTopLeft);
    expect(node.Icon.PositionFixed()).toBe(true);
    expect(after.Edges[0].Label.PositionFixed()).toBe(true);
    expect(after.Edges[0].LabelPercentage).toBe(0.25);
  });

  it('only routes enclosed in one top-level container are preserved', () => {
    const laidOut = Layout(bg, compoundGraph(), new LayoutOptions({ Seed: 1n }));
    const guard = { Step() {}, Add() {} };
    const enclosed = laidOut.Edges.map((e) => compoundEnclosedRoute(e, guard));
    // a->b, b->c inside group 1 and d->e inside group 2 are enclosed; the rest cross roots.
    expect(enclosed).toEqual([true, true, true, false, false, false]);
  });
});
