import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Icon } from '../../src/graph/icon.js';
import { Point } from '../../src/geometry/point.js';
import { LabelPosition as P } from '../../src/graph/label-position.js';
import { place } from '../../src/labeling/placement.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';

describe('labeling Place atomicity tests (slice 49)', () => {
  it('rolls back exact label and icon state on work limit', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();

    const nodeA = new Node(1n, 80, 80);
    nodeA.TopLeft = new Point(20, 20);
    const labelA = new Label('A', 30, 14);
    labelA.Position = P.Unset;
    nodeA.Label = labelA;

    const iconA = new Icon();
    iconA.Position = P.Unset;
    nodeA.Icon = iconA;

    const nodeB = new Node(2n, 80, 80);
    nodeB.TopLeft = new Point(150, 20);
    const labelB = new Label('B', 30, 14);
    labelB.Position = P.Unset;
    nodeB.Label = labelB;

    g.addNewNodeToContainer(null, nodeA);
    g.addNewNodeToContainer(null, nodeB);

    const edge = g.connect(nodeA, nodeB);
    const p1 = new Point(60, 60);
    const p2 = new Point(150, 60);
    edge.Points = [p1, p2];
    const edgeLabel = new Label('E', 24, 12);
    edgeLabel.Position = P.Unset;
    edge.Label = edgeLabel;
    edge.LabelPercentage = 0.5;

    // Run with limit=5 so it exceeds after doing a small amount of work
    expect(() => {
      place(ctx, g, 5);
    }).toThrow('TALA PlaceLabels work exceeds limit 5');

    // Object identities preserved
    expect(nodeA.Label).toBe(labelA);
    expect(nodeA.Icon).toBe(iconA);
    expect(nodeB.Label).toBe(labelB);
    expect(edge.Label).toBe(edgeLabel);
    expect(edge.Points[0]).toBe(p1);
    expect(edge.Points[1]).toBe(p2);

    // Initial state restored
    expect(nodeA.Label.Position).toBe(P.Unset);
    expect(nodeA.Icon.Position).toBe(P.Unset);
    expect(nodeB.Label.Position).toBe(P.Unset);
    expect(edge.Label.Position).toBe(P.Unset);
    expect(edge.LabelPercentage).toBe(0.5);
  });

  it('rolls back and rethrows identical thrown sentinel object after mutation', () => {
    const sentinel = { customSentinelError: true, id: 42 };
    const ctx = backgroundWorkContext();

    const g = new Graph();
    const node1 = new Node(1n, 100, 60);
    node1.TopLeft = new Point(50, 50);
    const label1 = new Label('First', 30, 14);
    label1.Position = P.Unset;
    node1.Label = label1;

    const icon1 = new Icon();
    icon1.Position = P.Unset;
    node1.Icon = icon1;

    const node2 = new Node(2n, 100, 60);
    node2.TopLeft = new Point(200, 50);
    const label2 = new Label('Second', 30, 14);
    label2.Position = P.Unset;
    node2.Label = label2;

    g.addNewNodeToContainer(null, node1);
    g.addNewNodeToContainer(null, node2);

    // After node1 is placed, node2.innerBox throws the sentinel
    node2.innerBox = () => {
      // At this point, node1 was already placed and mutated!
      expect(node1.Icon.Position).not.toBe(P.Unset);
      expect(node1.Label.Position).not.toBe(P.Unset);
      throw sentinel;
    };

    let thrown = null;
    try {
      place(ctx, g, 10000);
    } catch (e) {
      thrown = e;
    }

    // Must rethrow the exact same object by reference
    expect(thrown).toBe(sentinel);

    // Label and icon positions must be restored to Unset
    expect(node1.Label).toBe(label1);
    expect(node1.Icon).toBe(icon1);
    expect(node1.Label.Position).toBe(P.Unset);
    expect(node1.Icon.Position).toBe(P.Unset);
    expect(node2.Label).toBe(label2);
    expect(node2.Label.Position).toBe(P.Unset);
  });

  it('rolls back on context cancellation occurring after mutation', () => {
    let cancelled = false;
    const cancellableCtx = {
      isCancelled: () => cancelled,
      Err: () => (cancelled ? new Error('context canceled') : null),
      doneAvailable: true,
    };

    const g = new Graph();
    const nodeA = new Node(1n, 80, 80);
    nodeA.TopLeft = new Point(20, 20);
    nodeA.Icon = new Icon();
    nodeA.Icon.Position = P.Unset;
    nodeA.Label = new Label('A', 30, 14);
    nodeA.Label.Position = P.Unset;
    g.addNewNodeToContainer(null, nodeA);

    const nodeB = new Node(2n, 80, 80);
    nodeB.TopLeft = new Point(120, 20);
    nodeB.Label = new Label('B', 30, 14);
    nodeB.Label.Position = P.Unset;
    g.addNewNodeToContainer(null, nodeB);

    // Cancel context when nodeB is reached, after nodeA has already been placed
    nodeB.innerBox = () => {
      expect(nodeA.Icon.Position).not.toBe(P.Unset);
      expect(nodeA.Label.Position).not.toBe(P.Unset);
      cancelled = true;
      // Normal inner box so execution proceeds to next check
      return nodeB.Box;
    };

    expect(() => {
      place(cancellableCtx, g, 100000);
    }).toThrow('context canceled');

    // Rollback restored positions
    expect(nodeA.Icon.Position).toBe(P.Unset);
    expect(nodeA.Label.Position).toBe(P.Unset);
    expect(nodeB.Label.Position).toBe(P.Unset);
  });
});
