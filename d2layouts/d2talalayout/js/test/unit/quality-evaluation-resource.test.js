import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Label } from '../../src/graph/label.js';
import { Point } from '../../src/geometry/point.js';
import { LabelPosition as P } from '../../src/graph/label-position.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import {
  evaluateWithAreaLimit,
  EvaluateWithArea,
} from '../../src/quality/scoring.js';
import {
  chargeEvaluationAreaWork,
  newEvaluationWorkGuard,
  maxEvaluationWorkUnits,
} from '../../src/quality/evaluation-guard.js';

describe('quality evaluation resource tests (slice 49)', () => {
  it('charges edges with 0 or 1 route point without throwing incomplete route error', () => {
    const ctx = backgroundWorkContext();

    for (const routePoints of [0, 1]) {
      const g = new Graph();
      const from = new Node(1n, 10, 10);
      const to = new Node(2n, 10, 10);
      from.TopLeft = new Point(0, 0);
      to.TopLeft = new Point(20, 0);
      g.addNewNodeToContainer(null, from);
      g.addNewNodeToContainer(null, to);

      for (let i = 0; i < 1000; i++) {
        const edge = g.connect(from, to);
        if (routePoints === 1) {
          edge.Points = [new Point(10, 5)];
        }
      }

      const limit = 1500;
      expect(() => {
        evaluateWithAreaLimit(ctx, g, limit);
      }).toThrow('TALA Evaluate work exceeds limit 1500');
    }
  });

  it('charges conservative evaluation area work correctly', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();

    const n1 = new Node(1n, 40, 40);
    n1.TopLeft = new Point(0, 0);
    n1.Label = new Label('Outside', 30, 14);
    n1.Label.Position = P.OutsideTopCenter;

    const n2 = new Node(2n, 40, 40);
    n2.TopLeft = new Point(100, 0);

    g.addNewNodeToContainer(null, n1);
    g.addNewNodeToContainer(null, n2);

    const edge = g.connect(n1, n2);
    edge.Points = [new Point(40, 20), new Point(100, 20)];
    edge.Label = new Label('E', 20, 10);
    edge.Label.Position = P.InsideMiddleCenter;
    edge.SourceArrowheadLabel = new Label('S', 10, 10);

    const guard = newEvaluationWorkGuard(ctx, 10000);
    chargeEvaluationAreaWork(g, guard);

    // Charge includes:
    // nodes: 2
    // outside label on n1: 4 * 2 = 8
    // edge: points=2, multiplier=1 (base) + 1 (label) + 1 (source arrowhead) = 3 -> 3 * 2 = 6
    // total = 2 + 8 + 6 = 16
    expect(Number(guard.Used())).toBe(16);
  });

  it('preflight rejects graph with too many nodes', () => {
    const ctx = backgroundWorkContext();
    const g = new Graph();
    g.Nodes = new Array(10001);
    for (let i = 0; i < 10001; i++) {
      g.Nodes[i] = new Node(BigInt(i + 1), 1, 1);
      g.Nodes[i].TopLeft = new Point(i, 0);
    }

    expect(() => {
      EvaluateWithArea(ctx, g);
    }).toThrow('TALA engine unique node count exceeds limit 10000');
  });

  it('rejects nil graph with exact error', () => {
    const ctx = backgroundWorkContext();
    expect(() => {
      EvaluateWithArea(ctx, null);
    }).toThrow('cannot evaluate a nil graph');
  });

  it('checks cancellation before work', () => {
    const cancelledCtx = {
      isCancelled: () => true,
      Err: () => new Error('context canceled'),
      doneAvailable: true,
    };
    const g = new Graph();
    expect(() => {
      EvaluateWithArea(cancelledCtx, g);
    }).toThrow('context canceled');
  });
});
