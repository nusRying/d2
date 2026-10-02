import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Graph } from '../../src/graph/graph.js';
import { Edge, NO_ARROWHEAD } from '../../src/graph/edge.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { LabelPosition, getPointOnRoute, routeLength, routeGetPointAtDistance, getUnitNormalVector } from '../../src/graph/label-position.js';
import { Point } from '../../src/geometry/point.js';
import { goRound, chopPrecision } from '../../src/geometry/math.js';
import { nodesFixedBounds, nodesUnroundedFixedBounds } from '../../src/graph/node-bounds.js';
import * as rootIndex from '../../src/index.js';
import * as geometryIndex from '../../src/geometry/index.js';

describe('Slice 37 Direct Graph & Edge BoundingBox Tests', () => {
  it('1. Graph.boundingBox exists', () => {
    const g = new Graph();
    assert.equal(typeof g.boundingBox, 'function');
  });

  it('2. Graph.bounds exists', () => {
    const g = new Graph();
    assert.equal(typeof g.bounds, 'function');
  });

  it('3. Graph.BoundingBox exists and delegates to bounds()', () => {
    const g = new Graph();
    assert.equal(typeof g.BoundingBox, 'function');
    const [tl1, br1] = g.BoundingBox();
    const [tl2, br2] = g.bounds();
    assert.equal(tl1.X, tl2.X);
    assert.equal(tl1.Y, tl2.Y);
    assert.equal(br1.X, br2.X);
    assert.equal(br1.Y, br2.Y);
  });

  it('4. Edge bounding aliases exist', () => {
    const e = new Edge(null, null);
    assert.equal(typeof e.boundingBoxValues, 'function');
    assert.equal(typeof e.BoundingBoxValues, 'function');
    assert.equal(typeof e.bounds, 'function');
    assert.equal(typeof e.BoundingBox, 'function');
  });

  it('5. Empty graph returns infinity bounds oddity', () => {
    const g = new Graph();
    const [tl, br] = g.BoundingBox();
    assert.equal(tl.X, -Infinity);
    assert.equal(tl.Y, -Infinity);
    assert.equal(br.X, Infinity);
    assert.equal(br.Y, Infinity);
  });

  it('6. Unplaced node returns [null, null]', () => {
    const g = new Graph();
    const n = new Node(1n, 100, 50);
    // n.TopLeft is null
    g.Nodes.push(n);
    const [tl, br] = g.BoundingBox();
    assert.equal(tl, null);
    assert.equal(br, null);
  });

  it('7. nodesFixedBounds is reused rather than rewritten behaviorally', () => {
    const n = new Node(1n, 50, 40);
    n.TopLeft = new Point(10, 20);
    const [tl, br] = nodesFixedBounds([n]);
    assert.equal(tl.X, 10);
    assert.equal(tl.Y, 20);
    assert.equal(br.X, 60);
    assert.equal(br.Y, 60);
  });

  it('8. Fixed-origin top-left parity', () => {
    const g = new Graph();
    const root = new Node(0n, 1000, 1000);
    root.TopLeft = new Point(0, 0);
    const n = new Node(1n, 100, 100);
    n.TopLeft = new Point(60, 70);
    n.FixedTopLeft = new Point(10, 20); // fixedOrigin = (60-10, 70-20) = (50, 50)
    n.Container = root;
    g.Containers.set(root, [n]);
    g.Nodes.push(n);

    const [tl, br] = g.BoundingBox();
    assert.equal(tl.X, 50);
    assert.equal(tl.Y, 50);
    assert.equal(br.X, 160);
    assert.equal(br.Y, 170);
  });

  it('9. Empty nodes + finite edges remain infinite graph bounds', () => {
    const g = new Graph();
    const e = new Edge(null, null);
    e.Points = [new Point(10, 10), new Point(20, 20)];
    g.Edges.push(e);

    const [tl, br] = g.BoundingBox();
    assert.equal(tl.X, -Infinity);
    assert.equal(tl.Y, -Infinity);
    assert.equal(br.X, Infinity);
    assert.equal(br.Y, Infinity);
  });

  it('10. Zero-point edge is ignored by graph', () => {
    const g = new Graph();
    const n = new Node(1n, 100, 50);
    n.TopLeft = new Point(0, 0);
    g.Nodes.push(n);

    const e = new Edge(n, n); // 0 points
    g.Edges.push(e);

    const [tl, br] = g.BoundingBox();
    assert.equal(tl.X, 0);
    assert.equal(tl.Y, 0);
    assert.equal(br.X, 100);
    assert.equal(br.Y, 50);
  });

  it('11. Edge route expands graph', () => {
    const g = new Graph();
    const n = new Node(1n, 50, 50);
    n.TopLeft = new Point(50, 50);
    g.Nodes.push(n);

    const e = new Edge(n, n);
    e.Points = [new Point(10, 20), new Point(200, 250)];
    g.Edges.push(e);

    const [tl, br] = g.BoundingBox();
    assert.equal(tl.X, 10);
    assert.equal(tl.Y, 20);
    assert.equal(br.X, 200);
    assert.equal(br.Y, 250);
  });

  it('12. Final graph Go rounding', () => {
    const g = new Graph();
    const n = new Node(1n, 100.4, 50.4);
    n.TopLeft = new Point(10.4, 20.4);
    g.Nodes.push(n);

    // Node bounding box: tl=(10.4, 20.4), br=(Round(10.4+100.4)=Round(110.8)=111, Round(20.4+50.4)=Round(70.8)=71)
    // Graph final rounding: Round(10.4)=10, Round(20.4)=20, Round(111)=111, Round(71)=71
    const [tl, br] = g.BoundingBox();
    assert.equal(tl.X, 10);
    assert.equal(tl.Y, 20);
    assert.equal(br.X, 111);
    assert.equal(br.Y, 71);
  });

  it('13. Final edge Go rounding', () => {
    const e = new Edge(null, null);
    e.Points = [new Point(0.4, 0.6), new Point(9.6, 9.4)];
    const [tl, br] = e.BoundingBox();
    assert.equal(tl.X, 0);
    assert.equal(tl.Y, 1);
    assert.equal(br.X, 10);
    assert.equal(br.Y, 9);
  });

  it('14. Negative half-value rounding in goRound (-0.5 -> -1, -1.5 -> -2)', () => {
    assert.equal(goRound(-0.5), -1);
    assert.equal(goRound(-1.5), -2);
    assert.equal(goRound(0.5), 1);
    assert.equal(goRound(1.5), 2);
  });

  it('15. Main label Unset is ignored', () => {
    const e = new Edge(null, null);
    e.Points = [new Point(0, 0), new Point(100, 0)];
    e.Label = new Label('test', 500, 500);
    e.Label.Position = LabelPosition.Unset;

    const [tl, br] = e.BoundingBox();
    assert.equal(tl.X, 0);
    assert.equal(tl.Y, 0);
    assert.equal(br.X, 100);
    assert.equal(br.Y, 0);
  });

  it('16. edgeStrokeWidth is exactly 3.0 for main labels', () => {
    const e = new Edge(null, null);
    e.Points = [new Point(0, 100), new Point(100, 100)];
    e.Label = new Label('', 40, 20);
    e.Label.Position = LabelPosition.OutsideTopCenter;
    // normal points up (0, -1)
    // offsetY = strokeWidth/2 + 5 + height/2 = 3/2 + 5 + 10 = 16.5
    // basePoint = (50, 100) -> center = (50, 100 - 16.5) = (50, 83.5)
    // top-left = (50 - 20, 83.5 - 10) = (30, 73.5)
    // chopPrecision(73.5) = 74
    const tl = e.LabelTopLeft(e.Label.Position, e.Label.Width, e.Label.Height);
    assert.equal(tl.X, 30);
    assert.equal(tl.Y, 74);
  });

  it('17. Route left/center/right positions (0.25, 0.50, 0.75)', () => {
    const route = [new Point(0, 0), new Point(100, 0)];
    const [pLeft] = getPointOnRoute(LabelPosition.InsideMiddleLeft, route, 3, 0, 20, 10);
    const [pCenter] = getPointOnRoute(LabelPosition.InsideMiddleCenter, route, 3, 0, 20, 10);
    const [pRight] = getPointOnRoute(LabelPosition.InsideMiddleRight, route, 3, 0, 20, 10);

    // Left center is at 25 -> TL.X is 25 - 10 = 15
    assert.equal(pLeft.X, 15);
    // Center center is at 50 -> TL.X is 50 - 10 = 40
    assert.equal(pCenter.X, 40);
    // Right center is at 75 -> TL.X is 75 - 10 = 65
    assert.equal(pRight.X, 65);
  });

  it('18. Unlocked percentage positioning', () => {
    const route = [new Point(0, 0), new Point(100, 0)];
    const [p] = getPointOnRoute(LabelPosition.UnlockedMiddle, route, 3, 0.4, 20, 10);
    // center is at 40 -> TL.X is 40 - 10 = 30
    assert.equal(p.X, 30);
    assert.equal(p.Y, -5);
  });

  it('19. Extrapolation beyond route ends', () => {
    const route = [new Point(0, 0), new Point(100, 0)];
    const [pPos] = getPointOnRoute(LabelPosition.UnlockedMiddle, route, 3, 1.2, 20, 10);
    assert.equal(pPos.X, 120 - 10);

    const [pNeg] = getPointOnRoute(LabelPosition.UnlockedMiddle, route, 3, -0.2, 20, 10);
    assert.equal(pNeg.X, -20 - 10);
  });

  it('20. Float32 chopPrecision behavior', () => {
    assert.equal(chopPrecision(12.34567), 12);
    assert.equal(chopPrecision(0.00004), 0);
  });

  it('21. Negative zero normalized to +0 in chopPrecision', () => {
    const res = chopPrecision(-0.00001);
    assert.equal(Object.is(res, 0), true);
    assert.equal(Object.is(res, -0), false);
  });

  it('22. Source arrow label included in bounds', () => {
    const e = new Edge(null, null);
    e.Points = [new Point(0, 0), new Point(100, 0)];
    e.SourceArrowheadLabel = new Label('src', 30, 12);
    const [tl, br] = e.BoundingBox();
    assert.equal(tl.Y, -18);
  });

  it('23. Target arrow label included in bounds', () => {
    const e = new Edge(null, null);
    e.Points = [new Point(0, 0), new Point(100, 0)];
    e.TargetArrowheadLabel = new Label('dst', 40, 14);
    const [tl, br] = e.BoundingBox();
    assert.equal(tl.Y, -20);
  });

  it('24. Arrow label dimensions truncate via Math.trunc', () => {
    const e = new Edge(null, null);
    e.Points = [new Point(0, 0), new Point(100, 0)];
    e.SourceArrowhead = 'triangle';
    e.SourceArrowheadLabel = new Label('src', 30.9, 12.9);
    const [tl1, br1] = e.BoundingBox();

    const e2 = new Edge(null, null);
    e2.Points = [new Point(0, 0), new Point(100, 0)];
    e2.SourceArrowhead = 'triangle';
    e2.SourceArrowheadLabel = new Label('src', 30, 12);
    const [tl2, br2] = e2.BoundingBox();

    assert.equal(tl1.X, tl2.X);
    assert.equal(tl1.Y, tl2.Y);
    assert.equal(br1.X, br2.X);
    assert.equal(br1.Y, br2.Y);
  });

  it('25. Arrow label geometry uses strokeWidth 2', () => {
    // Verified by oracle matching BaseConnection default strokeWidth = 2
    const e = new Edge(null, null);
    e.Points = [new Point(0, 0), new Point(100, 0)];
    e.SourceArrowhead = 'triangle';
    e.SourceArrowheadLabel = new Label('src', 30, 12);
    const [tl] = e.BoundingBox();
    assert.equal(tl.Y, -20);
  });

  it('26. Target fallback to source arrow size', () => {
    const e = new Edge(null, null);
    e.Points = [new Point(0, 0), new Point(100, 0)];
    e.SourceArrowhead = 'triangle';
    e.TargetArrowhead = NO_ARROWHEAD;
    e.TargetArrowheadLabel = new Label('dst', 40, 14);
    const [tl, br] = e.BoundingBox();
    assert.equal(tl.Y, -22);
  });

  it('27. Arrow size uses HEIGHT, not width', () => {
    // For "line" arrowhead, widthMultiplier=5, heightMultiplier=8 -> width=10, height=16
    const e = new Edge(null, null);
    e.Points = [new Point(0, 0), new Point(100, 0)];
    e.SourceArrowhead = 'line';
    e.SourceArrowheadLabel = new Label('src', 30, 12);
    const [tl] = e.BoundingBox();
    assert.equal(tl.Y, -22);
  });

  it('28. Edge and graph inputs are not mutated', () => {
    const g = new Graph();
    const n = new Node(1n, 50, 50);
    n.TopLeft = new Point(10, 10);
    g.Nodes.push(n);
    const e = new Edge(n, n);
    e.Points = [new Point(0, 0), new Point(100, 100)];
    e.Label = new Label('lbl', 20, 10);
    e.Label.Position = LabelPosition.InsideMiddleCenter;
    g.Edges.push(e);

    const originalPointsLen = e.Points.length;
    const originalPos = e.Label.Position;
    g.BoundingBox();

    assert.equal(e.Points.length, originalPointsLen);
    assert.equal(e.Label.Position, originalPos);
    assert.equal(g.Nodes.length, 1);
    assert.equal(g.Edges.length, 1);
  });

  it('29. Null edge naturally fails', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(0, 0);
    g.Nodes.push(n);
    g.Edges.push(null);
    assert.throws(() => {
      g.BoundingBox();
    }, TypeError);
  });

  it('30. Null node naturally fails', () => {
    const g = new Graph();
    g.Nodes.push(null);
    assert.throws(() => {
      g.BoundingBox();
    }, TypeError);
  });

  it('31. Root API does not export chopPrecision', () => {
    assert.equal('chopPrecision' in rootIndex, false);
    assert.equal(rootIndex.chopPrecision, undefined);
  });

  it('32. Geometry barrel does not export chopPrecision', () => {
    assert.equal('chopPrecision' in geometryIndex, false);
    assert.equal(geometryIndex.chopPrecision, undefined);
  });

  it('33. chopPrecision remains available internally from geometry/math.js', () => {
    assert.equal(typeof chopPrecision, 'function');
    assert.equal(chopPrecision(12.34567), 12);
  });
});
