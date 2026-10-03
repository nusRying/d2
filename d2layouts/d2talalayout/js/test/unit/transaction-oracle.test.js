import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentsCross } from '../../src/placementcost/graph.js';
import { Point } from '../../src/geometry/point.js';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { isCandidateRejection } from '../../src/graph/transaction.js';

describe('Slice 44 — Transaction Go Oracle Replay', () => {
  const fixturePath = join(__dirname, '../fixtures/go-transaction-reference.json');
  let fixture;

  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch {
    fixture = null;
  }

  it('replays SegmentsCross reference values', () => {
    if (!fixture) return;

    for (const sc of fixture.segmentsCross) {
      if (sc.name === 'intersecting_diagonals') {
        const res = segmentsCross(
          new Point(0, 0),
          new Point(100, 100),
          new Point(0, 100),
          new Point(100, 0)
        );
        expect(res).toBe(sc.expected);
      } else if (sc.name === 'parallel_horizontal') {
        const res = segmentsCross(
          new Point(0, 0),
          new Point(100, 0),
          new Point(0, 50),
          new Point(100, 50)
        );
        expect(res).toBe(sc.expected);
      }
    }
  });

  it('replays exact overlap bad state detection', () => {
    if (!fixture) return;

    const g = new Graph();
    g.CellSize = 10;
    const n1 = new Node(1n, 20, 20);
    n1.TopLeft = new Point(0, 0);
    g.addNode(n1);

    const n2 = new Node(2n, 20, 20);
    n2.TopLeft = new Point(0, 0);
    g.addNode(n2);

    const [isBad] = g.isBadStateContext(n2, null, false);
    expect(isBad).toBe(fixture.overlapsExact);
  });

  it('replays transaction commit success and candidate rejection', () => {
    if (!fixture) return;

    const g = new Graph();
    g.CellSize = 10;
    const tn1 = new Node(1n, 20, 20);
    tn1.TopLeft = new Point(0, 0);
    g.addNode(tn1);

    const [txn] = g.newRequestTransaction({}, {});
    txn.addOp(() => {
      tn1.moveAbsWithChildren(50, 50);
    });
    const commitErr = txn.commit({});
    expect(commitErr).toBeNull();
    expect(tn1.TopLeft.X).toBe(fixture.commitSuccess.finalX);
    expect(tn1.TopLeft.Y).toBe(fixture.commitSuccess.finalY);

    const tn2 = new Node(2n, 20, 20);
    tn2.TopLeft = new Point(100, 100);
    g.addNode(tn2);

    const [txn2] = g.newRequestTransaction({}, {});
    txn2.addOp(() => {
      tn1.moveAbsWithChildren(100, 100);
    });
    const rejErr = txn2.commit({});
    expect(isCandidateRejection(rejErr)).toBe(fixture.commitOverlapRejected);
  });
});
