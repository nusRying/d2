import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Point } from '../../src/geometry/point.js';
import { LabelPosition as P } from '../../src/graph/label-position.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { Place, place } from '../../src/labeling/placement.js';

describe('labeling Place unit tests (slice 49)', () => {
  it('places a simple movable inside node label', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    const node = new Node(1n, 120, 80);
    node.TopLeft = new Point(50, 50);
    node.Label = new Label('A', 30, 16);
    node.Label.Position = P.Unset;
    g.addNewNodeToContainer(null, node);

    Place(ctx, g);

    // InsideMiddleCenter is 17
    expect(node.Label.Position).toBe(P.InsideMiddleCenter);
  });

  it('rejects inside placement when label does not fit inside node', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    const node = new Node(1n, 40, 40);
    node.TopLeft = new Point(50, 50);
    // Label 50x30 exceeds 40x40 node inside box
    node.Label = new Label('TooBigForInside', 50, 30);
    node.Label.Position = P.Unset;
    g.addNewNodeToContainer(null, node);

    Place(ctx, g);

    // Must be placed at an outside position
    expect(node.Label.Position).not.toBe(P.InsideMiddleCenter);
    expect(node.Label.Position).not.toBe(P.Unset);
  });

  it('preserves fixed node label position', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    const node = new Node(1n, 100, 60);
    node.TopLeft = new Point(50, 50);
    node.Label = new Label('Fixed', 30, 16);
    node.Label.Position = P.OutsideTopCenter;
    node.Label.FixPosition();
    g.addNewNodeToContainer(null, node);

    Place(ctx, g);

    expect(node.Label.Position).toBe(P.OutsideTopCenter);
  });

  it('preserves fixed icon and positions label around it', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    const node = new Node(1n, 120, 80);
    node.TopLeft = new Point(50, 50);
    node.Icon = new Icon();
    node.Icon.Position = P.InsideMiddleCenter;
    node.Icon.FixPosition();

    node.Label = new Label('LabelWithIcon', 30, 16);
    node.Label.Position = P.Unset;
    g.addNewNodeToContainer(null, node);

    Place(ctx, g);

    expect(node.Icon.Position).toBe(P.InsideMiddleCenter);
    // Label cannot use InsideMiddleCenter because it is taken by the icon
    expect(node.Label.Position).not.toBe(P.InsideMiddleCenter);
    expect(node.Label.Position).not.toBe(P.Unset);
  });

  it('does not place icon for image shape node', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    const node = new Node(1n, 80, 80);
    node.TopLeft = new Point(50, 50);
    node.setShape('Image');
    node.Icon = new Icon();
    node.Icon.Position = P.Unset;
    g.addNewNodeToContainer(null, node);

    Place(ctx, g);

    // Image shape nodes do not place icon
    expect(node.Icon.Position).toBe(P.Unset);
  });

  it('preserves fixed edge labels and loop edge labels', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    const a = new Node(1n, 50, 50);
    a.TopLeft = new Point(20, 20);
    const b = new Node(2n, 50, 50);
    b.TopLeft = new Point(150, 20);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);

    // Fixed edge
    const eFixed = g.connect(a, b);
    eFixed.Points = [new Point(70, 45), new Point(150, 45)];
    eFixed.Label = new Label('Fixed', 30, 14);
    eFixed.Label.Position = P.InsideMiddleCenter;
    eFixed.Label.FixPosition();
    eFixed.LabelPercentage = 0.5;

    // Loop edge
    const eLoop = g.connect(a, a);
    eLoop.Points = [new Point(45, 20), new Point(45, 0), new Point(65, 0), new Point(65, 20)];
    eLoop.Label = new Label('Loop', 24, 12);
    eLoop.Label.Position = P.InsideMiddleCenter;
    eLoop.LabelPercentage = 0.5;

    Place(ctx, g);

    expect(eFixed.Label.Position).toBe(P.InsideMiddleCenter);
    expect(eLoop.Label.Position).toBe(P.InsideMiddleCenter);
  });

  it('arrowhead labels reserve space before edge label placement', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    const a = new Node(1n, 40, 40);
    a.TopLeft = new Point(20, 50);
    const b = new Node(2n, 40, 40);
    b.TopLeft = new Point(200, 50);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);

    const edge = g.connect(a, b);
    edge.Points = [new Point(60, 70), new Point(200, 70)];
    edge.SourceArrowhead = 'arrow';
    edge.TargetArrowhead = 'arrow';
    edge.SourceArrowheadLabel = new Label('src', 16, 12);
    edge.TargetArrowheadLabel = new Label('dst', 16, 12);
    edge.Label = new Label('EdgeLabel', 36, 14);
    edge.Label.Position = P.Unset;

    Place(ctx, g);

    expect(edge.Label.Position).not.toBe(P.Unset);
    expect(edge.LabelPercentage).toBeGreaterThanOrEqual(0);
    expect(edge.LabelPercentage).toBeLessThanOrEqual(1);
  });
});
