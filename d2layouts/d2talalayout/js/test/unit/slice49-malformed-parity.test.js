import { describe, it, expect } from 'bun:test';
import { Box } from '../../src/geometry/box.js';
import { Point } from '../../src/geometry/point.js';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { LabelBoxFits, PadLabelCandidate } from '../../src/labeling/labeling-access.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { newEvaluationWorkGuard } from '../../src/quality/evaluation-guard.js';
import { boxOverlapArea } from '../../src/quality/labels.js';

describe('Slice 49 malformed-input parity corrections', () => {
  it('preserves WorkGuard validation and cancellation ordering', () => {
    const cancelled = {
      doneAvailable: true,
      Err: () => new Error('context canceled'),
    };

    expect(() => newEvaluationWorkGuard(null, -1))
      .toThrow('TALA Evaluate requires a context');
    expect(() => newEvaluationWorkGuard(backgroundWorkContext(), -1))
      .toThrow('TALA Evaluate work limit must not be negative');
    expect(() => newEvaluationWorkGuard(cancelled, 10))
      .toThrow('TALA Evaluate context canceled');
    expect(() => newEvaluationWorkGuard(cancelled, -1))
      .toThrow('TALA Evaluate work limit must not be negative');
  });

  it('LabelBoxFits fails fast for malformed geometry instead of normalizing false', () => {
    const valid = new Box(new Point(0, 0), 10, 10);
    expect(() => LabelBoxFits(null, valid)).toThrow();
    expect(() => LabelBoxFits(valid, null)).toThrow();

    const malformed = new Box(null, 1, 1);
    expect(() => LabelBoxFits(valid, malformed)).toThrow();
  });

  it('PadLabelCandidate preserves TopLeft identity and fails fast when unplaced', () => {
    const node = new Node(1n, 10, 20);
    const topLeft = new Point(5, 7);
    node.TopLeft = topLeft;

    PadLabelCandidate(node, 3);
    expect(node.TopLeft).toBe(topLeft);
    expect([node.TopLeft.X, node.TopLeft.Y, node.Width, node.Height]).toEqual([2, 4, 16, 26]);

    PadLabelCandidate(node, -3);
    expect(node.TopLeft).toBe(topLeft);
    expect([node.TopLeft.X, node.TopLeft.Y, node.Width, node.Height]).toEqual([5, 7, 10, 20]);

    const unplaced = new Node(2n, 10, 10);
    expect(() => PadLabelCandidate(unplaced, 1)).toThrow();
  });

  it('Graph.Area only special-cases an actually empty graph', () => {
    const empty = new Graph();
    expect(empty.Area()).toBe(0);

    const graph = new Graph();
    const node = new Node(1n, 12.5, 3.25);
    node.TopLeft = new Point(4.25, 9.5);
    graph.addNewNodeToContainer(null, node);
    expect(graph.Area()).toBe(40.625);

    const malformed = new Graph();
    malformed.addNewNodeToContainer(null, new Node(2n, 10, 10));
    expect(() => malformed.Area()).toThrow();
  });

  it('boxOverlapArea follows Go float ordering for NaN and preserves zero ties', () => {
    const nanWidth = new Box(new Point(0, 0), Number.NaN, 2);
    const finite = new Box(new Point(1, 0), 1, 2);
    expect(boxOverlapArea(nanWidth, finite)).toBe(2);

    const negativeZero = new Box(new Point(-0, 0), 1, 1);
    const positiveZero = new Box(new Point(+0, 0), 1, 1);
    expect(boxOverlapArea(negativeZero, positiveZero)).toBe(1);
  });
});
