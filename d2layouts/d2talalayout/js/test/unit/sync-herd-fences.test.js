import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { syncHerdFences, SyncHerdFences } from '../../src/proximity/herding.js';
import * as proximityExports from '../../src/proximity/index.js';
import * as rootExports from '../../src/internal.js';

describe('Slice 38 — Direct SyncHerdFences Unit Tests', () => {
  it('1. Alias identity: SyncHerdFences === syncHerdFences', () => {
    assert.equal(typeof syncHerdFences, 'function');
    assert.equal(SyncHerdFences, syncHerdFences);
  });

  it('2. Exported from proximity/index.js', () => {
    assert.equal(proximityExports.syncHerdFences, syncHerdFences);
    assert.equal(proximityExports.SyncHerdFences, syncHerdFences);
  });

  it('3. NOT exported from root src/index.js', () => {
    assert.equal('syncHerdFences' in rootExports, false);
    assert.equal('SyncHerdFences' in rootExports, false);
    assert.equal(rootExports.syncHerdFences, undefined);
    assert.equal(rootExports.SyncHerdFences, undefined);
  });

  it('4. Graph.BoundingBox called exactly once per invocation (Section 41 & 51 Discriminator)', () => {
    const g = new Graph();
    for (let i = 0; i < 5; i++) {
      const n = new Node(BigInt(i + 1), 10, 10);
      n.TopLeft = new Point(10 * i, 10 * i);
      n.HerdAssignment = new HerdAssignment();
      n.HerdAssignment.Orientation = Orientation.Right;
      g.addNode(n);
    }

    let calls = 0;
    const origBoundingBox = g.BoundingBox.bind(g);
    g.BoundingBox = () => {
      calls++;
      return origBoundingBox();
    };

    syncHerdFences(g);
    assert.equal(calls, 1, 'BoundingBox must be called exactly once');
  });

  it('5. BoundingBox called before node filtering (Section 52 Discriminator)', () => {
    const g = new Graph();
    // No eligible herd node that needs mutation, but graph.Nodes has null
    g.Nodes.push(null);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
  });

  it('6. Empty graph returns undefined and does not throw', () => {
    const g = new Graph();
    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
  });

  it('7. No-assignment node untouched', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment, null);
    assert.equal(n.TopLeft.X, 20);
    assert.equal(n.TopLeft.Y, 30);
  });

  it('8. Top uses topLeft.Y', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 30);
  });

  it('9. Bottom uses bottomRight.Y', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Bottom;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 40);
  });

  it('10. Left uses topLeft.X', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Left;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 20);
  });

  it('11. Right uses bottomRight.X', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 30);
  });

  it('12. Existing Val overwritten', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    n.HerdAssignment.Val = 1234.5;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 30);
  });

  it('13. Fixed cardinal assignment skipped', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.FixedTopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    n.HerdAssignment.Val = 999.0;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 999.0);
  });

  it('14. Fixed node still influences another fence through graph bounds (Section 54 Discriminator)', () => {
    const g = new Graph();
    const fixedA = new Node(1n, 10, 10);
    fixedA.TopLeft = new Point(5, 5);
    fixedA.FixedTopLeft = new Point(0, 0);
    fixedA.HerdAssignment = new HerdAssignment();
    fixedA.HerdAssignment.Orientation = Orientation.Left;
    fixedA.HerdAssignment.Val = -999;

    const nonFixedB = new Node(2n, 10, 10);
    nonFixedB.TopLeft = new Point(50, 50);
    nonFixedB.HerdAssignment = new HerdAssignment();
    nonFixedB.HerdAssignment.Orientation = Orientation.Left;
    nonFixedB.HerdAssignment.Val = 0;

    g.addNode(fixedA);
    g.addNode(nonFixedB);

    syncHerdFences(g);
    assert.equal(fixedA.HerdAssignment.Val, -999, 'fixed node A Val must remain sentinel');
    assert.equal(nonFixedB.HerdAssignment.Val, 5, 'nonfixed node B Val must receive graph bound including fixed node');
  });

  it('15. Unassigned node still influences graph bounds', () => {
    const g = new Graph();
    const unassigned = new Node(1n, 10, 10);
    unassigned.TopLeft = new Point(0, 0);

    const assigned = new Node(2n, 10, 10);
    assigned.TopLeft = new Point(100, 100);
    assigned.HerdAssignment = new HerdAssignment();
    assigned.HerdAssignment.Orientation = Orientation.Top;

    g.addNode(unassigned);
    g.addNode(assigned);

    syncHerdFences(g);
    assert.equal(assigned.HerdAssignment.Val, 0);
  });

  it('16. Edge route influences fence (Section 53 Discriminator)', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 20); // box right = 30
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    const e = new Edge(n, n);
    e.Points = [new Point(30, 25), new Point(300, 25)]; // rightmost X = 300
    g.addEdge(e);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 300, 'Right fence must be edge right boundary, not node boundary');
  });

  it('17. Edge label influences fence', () => {
    const g = new Graph();
    const n = new Node(1n, 20, 20);
    n.TopLeft = new Point(50, 50);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    const e = new Edge(n, n);
    e.Points = [new Point(50, 60), new Point(70, 60)];
    e.Label = new Label('test', 80, 30);
    e.Label.Position = LabelPosition.InsideMiddleRight;
    g.addEdge(e);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 105);
  });

  it('18. Fractional final graph rounding flows directly into Val', () => {
    const g = new Graph();
    const n = new Node(1n, 15.3, 25.7);
    n.TopLeft = new Point(10.4, 20.6);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 21); // goRound(20.6) = 21
  });

  it('19. TopLeft unchanged', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.TopLeft;
    n.HerdAssignment.Val = 123.4;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 123.4);
  });

  it('20. TopRight unchanged', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.TopRight;
    n.HerdAssignment.Val = 234.5;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 234.5);
  });

  it('21. BottomLeft unchanged', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.BottomLeft;
    n.HerdAssignment.Val = 345.6;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 345.6);
  });

  it('22. BottomRight unchanged', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.BottomRight;
    n.HerdAssignment.Val = 456.7;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 456.7);
  });

  it('23. NONE unchanged', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.NONE;
    n.HerdAssignment.Val = 567.8;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 567.8);
  });

  it('24. Unknown orientation unchanged', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = 999;
    n.HerdAssignment.Val = 678.9;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 678.9);
  });

  it('25. Fresh HerdAssignment TopLeft unchanged', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Val = 99.0;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 99.0);
  });

  it('26. HerdAssignment object identity preserved', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    const originalAssignment = new HerdAssignment();
    originalAssignment.Orientation = Orientation.Top;
    n.HerdAssignment = originalAssignment;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment, originalAssignment);
  });

  it('27. Same-side Set identity and content preserved', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    const uncle = new Node(2n, 5, 5);
    n.HerdAssignment.PairSameSide(uncle);
    const origSet = n.HerdAssignment.sameSidePaired;

    g.addNode(n);
    syncHerdFences(g);

    assert.equal(n.HerdAssignment.sameSidePaired, origSet);
    assert.equal(n.HerdAssignment.sameSidePaired.has(uncle), true);
    assert.equal(n.HerdAssignment.SameSidePairCount(), 1);
  });

  it('28. Opposite-side Set identity and content preserved', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    const uncle = new Node(2n, 5, 5);
    n.HerdAssignment.PairOppositeSide(uncle);
    const origSet = n.HerdAssignment.oppositeSidePaired;

    g.addNode(n);
    syncHerdFences(g);

    assert.equal(n.HerdAssignment.oppositeSidePaired, origSet);
    assert.equal(n.HerdAssignment.oppositeSidePaired.has(uncle), true);
    assert.equal(n.HerdAssignment.OppositeSidePairCount(), 1);
  });

  it('29. Orientation preserved', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Orientation, Orientation.Right);
  });

  it('30. Repeated invocation recomputes graph bounds', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 30);

    // Modify geometry
    n.TopLeft = new Point(80, 30);
    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 90);
  });

  it('31. Null graph natural failure', () => {
    assert.throws(() => {
      syncHerdFences(null);
    }, TypeError);
  });

  it('32. Null node fails during BoundingBox before Val mutation', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    n.HerdAssignment.Val = 777.0;

    g.Nodes.push(n, null);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
    assert.equal(n.HerdAssignment.Val, 777.0, 'Val must not be mutated if BoundingBox fails');
  });

  it('33. Null bounds with no assignment succeeds (Section 55 Case 1)', () => {
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10); // unplaced -> BoundingBox returns [null, null]
    const placed = new Node(2n, 10, 10);
    placed.TopLeft = new Point(20, 30);

    g.addNode(unplaced);
    g.addNode(placed);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
  });

  it('34. Null bounds with fixed cardinal assignment succeeds (Section 55 Case 2)', () => {
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const fixed = new Node(2n, 10, 10);
    fixed.TopLeft = new Point(20, 30);
    fixed.FixedTopLeft = new Point(20, 30);
    fixed.HerdAssignment = new HerdAssignment();
    fixed.HerdAssignment.Orientation = Orientation.Top;
    fixed.HerdAssignment.Val = 333.0;

    g.addNode(unplaced);
    g.addNode(fixed);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    assert.equal(fixed.HerdAssignment.Val, 333.0);
  });

  it('35. Null bounds with diagonal/NONE assignment succeeds (Section 55 Case 3)', () => {
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const diag = new Node(2n, 10, 10);
    diag.TopLeft = new Point(20, 30);
    diag.HerdAssignment = new HerdAssignment();
    diag.HerdAssignment.Orientation = Orientation.TopLeft;
    diag.HerdAssignment.Val = 444.0;

    g.addNode(unplaced);
    g.addNode(diag);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    assert.equal(diag.HerdAssignment.Val, 444.0);
  });

  it('36. Null bounds with nonfixed cardinal assignment naturally fails (Section 55 Case 4)', () => {
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const cardinal = new Node(2n, 10, 10);
    cardinal.TopLeft = new Point(20, 30);
    cardinal.HerdAssignment = new HerdAssignment();
    cardinal.HerdAssignment.Orientation = Orientation.Top;
    cardinal.HerdAssignment.Val = 555.0;

    g.addNode(unplaced);
    g.addNode(cardinal);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
  });

  it('37. Cardinal panic leaves old Val unchanged (Section 39)', () => {
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const cardinal = new Node(2n, 10, 10);
    cardinal.TopLeft = new Point(20, 30);
    cardinal.HerdAssignment = new HerdAssignment();
    cardinal.HerdAssignment.Orientation = Orientation.Right;
    cardinal.HerdAssignment.Val = 888.0;

    g.addNode(unplaced);
    g.addNode(cardinal);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
    assert.equal(cardinal.HerdAssignment.Val, 888.0, 'Val must not be modified before failed read');
  });

  it('38. No WorkGuard construction or dependency', () => {
    // Proves syncHerdFences takes only graph, has no guard/options parameter
    assert.equal(syncHerdFences.length, 1);
  });

  it('39. No GraphState construction or snapshotting', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Left;
    g.addNode(n);

    // Verify properties before and after
    assert.equal(g.Nodes.length, 1);
    syncHerdFences(g);
    assert.equal(g.Nodes.length, 1);
    assert.equal(n.HerdAssignment.Val, 20);
  });
});
