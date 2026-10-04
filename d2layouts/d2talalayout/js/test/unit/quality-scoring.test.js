import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Point } from '../../src/geometry/point.js';
import { LabelPosition as P } from '../../src/graph/label-position.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { EvaluateWithArea } from '../../src/quality/scoring.js';
import { Evaluate, Score, compareNumber, finite } from '../../src/quality/score.js';

describe('quality scoring unit tests (slice 49)', () => {
  it('keeps area as separate tie breaker and does not encode into penalty', () => {
    const ctx = backgroundWorkContext();

    const makeGraph = (width) => {
      const g = new Graph();
      const node = new Node(1n, width, 1);
      node.TopLeft = new Point(0, 0);
      g.addNewNodeToContainer(null, node);
      return g;
    };

    const res99 = EvaluateWithArea(ctx, makeGraph(99));
    const res100 = EvaluateWithArea(ctx, makeGraph(100));

    // Penalties must be exactly identical
    expect(res99.penalty).toBe(res100.penalty);
    expect(res99.area).toBe(99);
    expect(res100.area).toBe(100);

    const score99 = new Score(res99.penalty, res99.area);
    const score100 = new Score(res100.penalty, res100.area);

    // score99 beats score100 strictly on area tie-breaker
    expect(score99.Compare(score100)).toBe(-1);
    expect(score100.Compare(score99)).toBe(1);
  });

  it('preserves fractional and large unrounded areas without integer truncation', () => {
    const ctx = backgroundWorkContext();

    // Fractional
    const gFrac = new Graph();
    const nFrac = new Node(1n, 12.5, 3.25);
    nFrac.TopLeft = new Point(0.25, 0.5);
    gFrac.addNewNodeToContainer(null, nFrac);
    const resFrac = EvaluateWithArea(ctx, gFrac);
    expect(resFrac.area).toBe(40.625);

    // Large
    const gLarge = new Graph();
    const nLarge = new Node(1n, 1_000_000_000, 1_000_000_000);
    nLarge.TopLeft = new Point(0, 0);
    gLarge.addNewNodeToContainer(null, nLarge);
    const resLarge = EvaluateWithArea(ctx, gLarge);
    expect(resLarge.area).toBe(1e18);
    expect(resLarge.area).toBeGreaterThan(2147483647);
  });

  it('strictly satisfies read-only contract: does not mutate graph geometry or labels', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();

    const n1 = new Node(1n, 60, 40);
    const tl1 = new Point(10, 20);
    n1.TopLeft = tl1;
    const l1 = new Label('A', 20, 12);
    l1.Position = P.InsideMiddleCenter;
    n1.Label = l1;

    const n2 = new Node(2n, 60, 40);
    const tl2 = new Point(120, 20);
    n2.TopLeft = tl2;
    const l2 = new Label('B', 20, 12);
    l2.Position = P.InsideMiddleCenter;
    n2.Label = l2;

    g.addNewNodeToContainer(null, n1);
    g.addNewNodeToContainer(null, n2);

    const edge = g.connect(n1, n2);
    const p1 = new Point(70, 40);
    const p2 = new Point(120, 40);
    edge.Points = [p1, p2];
    const edgeLabel = new Label('edge', 24, 10);
    edgeLabel.Position = P.InsideMiddleCenter;
    edge.Label = edgeLabel;
    edge.LabelPercentage = 0.5;

    // Run Evaluate and EvaluateWithArea
    Evaluate(ctx, g);
    EvaluateWithArea(ctx, g);

    // References and coordinates must be identical
    expect(n1.TopLeft).toBe(tl1);
    expect(n1.TopLeft.X).toBe(10);
    expect(n1.TopLeft.Y).toBe(20);
    expect(n1.Label).toBe(l1);
    expect(n1.Label.Position).toBe(P.InsideMiddleCenter);

    expect(n2.TopLeft).toBe(tl2);
    expect(n2.TopLeft.X).toBe(120);
    expect(n2.TopLeft.Y).toBe(20);
    expect(n2.Label).toBe(l2);
    expect(n2.Label.Position).toBe(P.InsideMiddleCenter);

    expect(edge.Points[0]).toBe(p1);
    expect(edge.Points[1]).toBe(p2);
    expect(edge.Label).toBe(edgeLabel);
    expect(edge.LabelPercentage).toBe(0.5);
  });

  it('Score.Compare orders non-finite values and areas exactly without epsilons', () => {
    // finite check
    expect(finite(1)).toBe(true);
    expect(finite(0)).toBe(true);
    expect(finite(-5)).toBe(true);
    expect(finite(NaN)).toBe(false);
    expect(finite(Infinity)).toBe(false);
    expect(finite(-Infinity)).toBe(false);

    // compareNumber penalty (nonnegative = false)
    expect(compareNumber(1, 2, false)).toBe(-1);
    expect(compareNumber(2, 1, false)).toBe(1);
    expect(compareNumber(1.5, 1.5, false)).toBe(0);
    expect(compareNumber(1, NaN, false)).toBe(-1);
    expect(compareNumber(NaN, 1, false)).toBe(1);
    expect(compareNumber(NaN, NaN, false)).toBe(0);
    expect(compareNumber(Infinity, 1, false)).toBe(1);
    expect(compareNumber(-Infinity, 1, false)).toBe(1);

    // compareNumber area (nonnegative = true)
    expect(compareNumber(50, 100, true)).toBe(-1);
    expect(compareNumber(100, 50, true)).toBe(1);
    expect(compareNumber(0, 50, true)).toBe(-1);
    expect(compareNumber(50, -1, true)).toBe(-1);
    expect(compareNumber(-1, 50, true)).toBe(1);
    expect(compareNumber(-5, -10, true)).toBe(0);
    expect(compareNumber(50, NaN, true)).toBe(-1);
    expect(compareNumber(50, Infinity, true)).toBe(-1);

    // Score.Compare
    const s1 = new Score(1.0, 50);
    const s2 = new Score(2.0, 10);
    expect(s1.Compare(s2)).toBe(-1); // lower penalty wins
    expect(s2.Compare(s1)).toBe(1);

    const s3 = new Score(1.0, 100);
    expect(s1.Compare(s3)).toBe(-1); // equal penalty, lower area wins
    expect(s3.Compare(s1)).toBe(1);

    const s4 = new Score(1.0, 50);
    expect(s1.Compare(s4)).toBe(0); // exact equality
  });
});
