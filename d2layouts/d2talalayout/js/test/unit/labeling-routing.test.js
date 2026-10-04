// Slice 47 — focused ports of internal/labeling/*_test.go and
// internal/labelgeom/arrowhead_test.go assertions within the routing scope
// (arrowhead labels, PlaceNewEdges and its guard closure).
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Cluster } from '../../src/graph/cluster.js';
import { LabelPosition as P, routeLength } from '../../src/graph/label-position.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { ArrowheadTopLeft, PositionArrowheadLabel, PositionedArrowheadLabel } from '../../src/labeling/arrowhead.js';
import {
  LabelPlacementWorkGuard,
  isLabelPlacementDescendantOf,
  maxLabelPlacementAncestryDepth,
  maxLabelPlacementWorkUnits,
  newLabelPlacementWorkGuard,
} from '../../src/labeling/guard.js';
import {
  PlaceNewEdges,
  findSharedSegmentsChecked,
  isClusterPathSharedChecked,
  labelPercentageSearchRange,
  placeNewEdges,
} from '../../src/labeling/placement.js';
import { ValidatePositionedGraphSelection } from '../../src/labeling/positioned-validation.js';
import { errorChainIncludes } from './slice47-labeling-fixtures.js';

const pt = (x, y) => new Point(x, y);

describe('arrowhead labels', () => {
  it('PositionArrowheadLabel owns the rendered record', () => {
    const edge = new Edge(null, null);
    edge.Points = [pt(0, 0), pt(100, 0)];
    edge.SourceArrowhead = 'triangle';
    edge.TargetArrowhead = 'triangle';
    edge.SourceArrowheadLabel = new Label('source', 30, 12);
    edge.TargetArrowheadLabel = new Label('target', 40, 14);
    for (const test of [
      { isTarget: false, text: 'source', width: 30, height: 12, want: [5, -20] },
      { isTarget: true, text: 'target', width: 40, height: 14, want: [55, -22] },
    ]) {
      const positioned = PositionArrowheadLabel(edge, test.isTarget, edge.Points);
      expect(positioned).toBeInstanceOf(PositionedArrowheadLabel);
      expect(positioned.Edge).toBe(edge);
      expect(positioned.IsTarget).toBe(test.isTarget);
      expect(positioned.Text).toBe(test.text);
      expect([positioned.Width, positioned.Height]).toEqual([test.width, test.height]);
      expect([positioned.TopLeft.X, positioned.TopLeft.Y]).toEqual(test.want);
      expect(positioned.Box.TopLeft).toBe(positioned.TopLeft);
    }
    expect(PositionArrowheadLabel(new Edge(null, null), false, edge.Points)).toBeNull();
    expect(PositionArrowheadLabel(null, false, null)).toBeNull();
  });

  it('ArrowheadTopLeft preserves historical truncation', () => {
    const got = ArrowheadTopLeft([pt(0, 0), pt(100, 0)], false, 'triangle', 'none', 30.9, 12.9);
    expect([got.X, got.Y]).toEqual([5, -20]);
  });

  it('ArrowheadTopLeft panics like Go on a one-point route', () => {
    expect(() => ArrowheadTopLeft([pt(0, 0)], false, '', '', 1, 1)).toThrow('runtime error: index out of range [1] with length 1');
    expect(() => ArrowheadTopLeft([pt(0, 0)], true, '', '', 1, 1)).toThrow('runtime error: index out of range [-1]');
  });
});

describe('placement helpers', () => {
  it('labelPercentageSearchRange is mirror invariant', () => {
    const from = new Node(1n, 10, 10);
    from.Cluster = new Cluster();
    const to = new Node(2n, 10, 10);
    for (const tt of [
      { p: [pt(0, 0), pt(100, 0), pt(100, 100)], want: 0.45 },
      { p: [pt(0, 0), pt(-100, 0), pt(-100, 100)], want: 0.45 },
      { p: [pt(0, 0), pt(0, 100), pt(100, 100)], want: 0.475 },
      { p: [pt(0, 0), pt(0, -100), pt(100, -100)], want: 0.475 },
    ]) {
      const e = new Edge(from, to);
      e.Label = new Label('', 20, 10);
      e.Points = tt.p;
      const r = labelPercentageSearchRange(e, routeLength(e.Points));
      expect(Math.abs(r.start)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(r.end - tt.want)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('isClusterPathShared requires overlapping intervals', () => {
    for (const tt of [
      { first: [pt(-10, 0), pt(0, 0), pt(0, 10)], second: [pt(10, 30), pt(0, 30), pt(0, 20)], want: false },
      { first: [pt(-10, 0), pt(0, 0), pt(0, 10)], second: [pt(10, 20), pt(0, 20), pt(0, 10)], want: true },
      { first: [pt(0, -10), pt(0, 0), pt(10, 0)], second: [pt(30, 10), pt(30, 0), pt(20, 0)], want: false },
      { first: [pt(0, -10), pt(0, 0), pt(10, 0)], second: [pt(20, 10), pt(20, 0), pt(10, 0)], want: true },
    ]) {
      const adjacent = new Node(1n, 10, 10);
      const firstNode = new Node(2n, 10, 10);
      const secondNode = new Node(3n, 10, 10);
      const cluster = new Cluster({ Nodes: [firstNode, secondNode] });
      firstNode.Cluster = cluster;
      secondNode.Cluster = cluster;
      const firstEdge = new Edge(firstNode, adjacent);
      firstEdge.Points = tt.first;
      const secondEdge = new Edge(secondNode, adjacent);
      secondEdge.Points = tt.second;
      firstNode.Edges = [firstEdge];
      secondNode.Edges = [secondEdge];
      expect(isClusterPathSharedChecked(firstEdge, null)).toBe(tt.want);
    }
  });

  it('findSharedSegments keeps exclusive corridors on a trunk', () => {
    const mk = (...coords) => {
      const e = new Edge(null, null);
      for (let i = 0; i < coords.length; i += 2) e.Points.push(pt(coords[i], coords[i + 1]));
      return e;
    };
    const segments = findSharedSegmentsChecked([
      mk(300, 300, 200, 300, 200, 200, 100, 200),
      mk(300, 350, 200, 350, 200, 100, 300, 100),
      mk(300, 100, 50, 100, 50, 150),
      mk(300, 100, 200, 100, 200, 180, 100, 180),
    ], null);
    expect(segments.map((s) => [s.Start.X, s.Start.Y, s.End.X, s.End.Y])).toEqual([
      [200, 100, 200, 180],
      [200, 200, 200, 300],
      [200, 100, 300, 100],
    ]);
  });

  it('shared segments preserve exclusive gaps', () => {
    for (const vertical of [false, true]) {
      for (const reverse of [false, true]) {
        const edges = [[0, 100], [10, 20], [30, 40], [50, 50]].map(([a0, b0]) => {
          let a = pt(a0, 0);
          let b = pt(b0, 0);
          if (vertical) {
            a = pt(a.Y, a.X);
            b = pt(b.Y, b.X);
          }
          if (reverse) [a, b] = [b, a];
          const edge = new Edge(null, null);
          edge.Points = [a, b];
          return edge;
        });
        const segments = findSharedSegmentsChecked(edges, null);
        const coordinate = (p) => (vertical ? p.Y : p.X);
        expect(segments.map((s) => [coordinate(s.Start), coordinate(s.End)])).toEqual([[10, 20], [30, 40]]);
      }
    }
  });
});

function fixedLabelGraph(position) {
  const g = new Graph();
  const a = new Node(1n, 40, 40);
  a.TopLeft = pt(0, 0);
  g.addNode(a);
  const b = new Node(2n, 40, 40);
  b.TopLeft = pt(300, 0);
  g.addNode(b);
  const fixed = g.connect(a, b);
  fixed.Points = [pt(40, 20), pt(300, 20)];
  fixed.Label = new Label('fixed', 80, 20);
  fixed.Label.Position = position;
  fixed.Label.FixPosition();
  fixed.LabelPercentage = 0.25;
  const movable = g.connect(a, b);
  movable.Points = [...fixed.Points];
  movable.Label = new Label('automatic', 80, 20);
  movable.Label.Position = P.Unset;
  return { g, fixed, movable };
}

describe('PlaceNewEdges', () => {
  it('preserves fixed edge labels and reserves their space', () => {
    for (const position of [P.InsideMiddleCenter, P.OutsideTopCenter]) {
      const { g, fixed, movable } = fixedLabelGraph(position);
      const original = fixed.Label;
      PlaceNewEdges(backgroundWorkContext(), g, g.Edges);
      expect(fixed.Label).toBe(original);
      expect(fixed.Label.Position).toBe(position);
      expect(fixed.LabelPercentage).toBe(0.25);
      const box = (e) => [e.labelTopLeft(e.Label.Position, e.Label.Width, e.Label.Height), e.Label.Width, e.Label.Height];
      const [atl, aw, ah] = box(fixed);
      const [btl, bw, bh] = box(movable);
      const overlap = atl.X < btl.X + bw && btl.X < atl.X + aw && atl.Y < btl.Y + bh && btl.Y < atl.Y + ah;
      expect(overlap).toBe(false);
    }
  });
});

// internal/labeling/atomicity_test.go
function atomicityGraph() {
  const g = new Graph();
  const nodes = [];
  for (let index = 0; index < 32; index++) {
    const node = new Node(BigInt(index + 1), 40, 40);
    node.TopLeft = pt((index % 8) * 300, Math.floor(index / 8) * 300);
    g.addNewNodeToContainer(null, node);
    nodes.push(node);
  }
  nodes[0].Icon = new Icon(P.Unset);
  nodes[0].Label = new Label('node label', 50, 20);
  nodes[0].Label.Position = P.Unset;
  const first = g.connect(nodes[0], nodes[1]);
  first.ID = 1n;
  first.Points = [pt(40, 20), pt(300, 20)];
  first.Label = new Label('first', 40, 20);
  first.Label.Position = P.Unset;
  const second = g.connect(nodes[8], nodes[9]);
  second.ID = 2n;
  second.Points = [pt(40, 320), pt(300, 320)];
  second.Label = new Label('second', 40, 20);
  second.Label.Position = P.Unset;
  return { g, edges: [first, second] };
}

function captureState(g, edges) {
  return {
    icon: g.Nodes[0].Icon,
    iconPosition: g.Nodes[0].Icon.Position,
    nodeLabel: g.Nodes[0].Label,
    nodeLabelPosition: g.Nodes[0].Label.Position,
    edgeLabels: edges.map((e) => e.Label),
    edgeLabelPositions: edges.map((e) => e.Label.Position),
    edgePercentages: edges.map((e) => e.LabelPercentage),
  };
}

function changed(state, g, edges) {
  if (g.Nodes[0].Icon !== state.icon || state.icon.Position !== state.iconPosition) return true;
  if (g.Nodes[0].Label !== state.nodeLabel || state.nodeLabel.Position !== state.nodeLabelPosition) return true;
  return edges.some((edge, index) => edge.Label !== state.edgeLabels[index] ||
    edge.Label.Position !== state.edgeLabelPositions[index] ||
    edge.LabelPercentage !== state.edgePercentages[index]);
}

function mutationContext(onChange, result = null, panicNow = false) {
  const ctx = {
    observed: false,
    Err() {
      if (onChange()) {
        ctx.observed = true;
        if (panicNow) throw new Error('label placement test panic');
        return result;
      }
      return null;
    },
  };
  return ctx;
}

describe('label placement atomicity', () => {
  it('cancellation during overlap restores exact label state', () => {
    const { g, edges } = atomicityGraph();
    const want = captureState(g, edges);
    const canceled = new Error('context canceled');
    const ctx = mutationContext(() => changed(want, g, edges), canceled);
    let err = null;
    try {
      PlaceNewEdges(ctx, g, edges);
    } catch (e) {
      err = e;
    }
    expect(errorChainIncludes(err, canceled)).toBe(true);
    expect(err.message).toContain('PlaceNewEdgeLabels');
    expect(ctx.observed).toBe(true);
    expect(changed(want, g, edges)).toBe(false);
  });

  it('work limit during overlap restores exact label state', () => {
    const { g, edges } = atomicityGraph();
    const want = captureState(g, edges);
    const ctx = mutationContext(() => changed(want, g, edges));
    expect(() => placeNewEdges(ctx, g, edges, 320)).toThrow('PlaceNewEdgeLabels work exceeds limit 320');
    expect(ctx.observed).toBe(true);
    expect(changed(want, g, edges)).toBe(false);
  });

  it('panic restores exact label state', () => {
    const { g, edges } = atomicityGraph();
    const want = captureState(g, edges);
    const ctx = mutationContext(() => changed(want, g, edges), null, true);
    expect(() => PlaceNewEdges(ctx, g, edges)).toThrow('label placement test panic');
    expect(ctx.observed).toBe(true);
    expect(changed(want, g, edges)).toBe(false);
  });

  it('work guard rejects overflow, negative estimates and negative limits', () => {
    const guard = newLabelPlacementWorkGuard(backgroundWorkContext(), 'overflow test', Number.MAX_SAFE_INTEGER);
    guard.used = Number.MAX_SAFE_INTEGER - 1;
    expect(() => guard.add(2)).toThrow('work exceeds limit');
    expect(() => guard.add(-1)).toThrow('TALA overflow test received a negative work estimate');
    expect(() => newLabelPlacementWorkGuard(backgroundWorkContext(), 'neg', -1)).toThrow('TALA neg work limit must not be negative');
    expect(() => newLabelPlacementWorkGuard(null, 'nil', 1)).toThrow('TALA nil requires a context');
    expect(new LabelPlacementWorkGuard(backgroundWorkContext(), 'x', 5).limit).toBe(5);
    expect(maxLabelPlacementWorkUnits).toBe(50_000_000);
  });

  it('rejects a nil context', () => {
    const { g, edges } = atomicityGraph();
    expect(() => PlaceNewEdges(null, g, edges)).toThrow('requires a context');
  });

  it('rejects a canceled context before work', () => {
    const canceled = new Error('context canceled');
    const ctx = { Err: () => canceled };
    let err = null;
    try {
      PlaceNewEdges(ctx, new Graph(), null);
    } catch (e) {
      err = e;
    }
    expect(errorChainIncludes(err, canceled)).toBe(true);
    expect(err.message).toContain('PlaceNewEdgeLabels');
  });

  it('rejects repeated edge aliases within each input list', () => {
    const { g, edges } = atomicityGraph();
    const first = edges[0];
    expect(() => PlaceNewEdges(backgroundWorkContext(), g, [first, first])).toThrow('repeats edge');
    // The same edge once in the graph and once in the requested subset is the
    // normal route-only call shape and must remain accepted.
    expect(() => ValidatePositionedGraphSelection(backgroundWorkContext(), 'test', g, [first])).not.toThrow();
  });

  it('descendant check allows the exact maximum depth', () => {
    const nodes = [];
    for (let i = 0; i < maxLabelPlacementAncestryDepth; i++) {
      nodes.push(new Node(BigInt(i + 1), 1, 1));
      if (i > 0) nodes[i - 1].Container = nodes[i];
    }
    const guard = newLabelPlacementWorkGuard(backgroundWorkContext(), 'test', maxLabelPlacementWorkUnits);
    expect(isLabelPlacementDescendantOf(nodes[0], new Node(10_000n, 1, 1), guard)).toBe(false);
  });
});
