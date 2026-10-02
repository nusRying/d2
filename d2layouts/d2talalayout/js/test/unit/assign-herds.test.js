import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Node } from '../../src/graph/node.js';
import { Graph } from '../../src/graph/graph.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { Point } from '../../src/geometry/point.js';
import { assignHerds, canUseBothSides } from '../../src/proximity/herding.js';
import { WorkCanceledError } from '../../src/limits/work-guard.js';

function makeAbduction(from, to, currentTo) {
  return new EdgeAbduction({ OriginallyFrom: from, OriginallyTo: to, CurrentTo: currentTo });
}

function setContainerFlag(g) {
  if (!g.Containers) return;
  for (const [c] of g.Containers.entries()) {
    if (c != null) {
      c.isContainer = true;
    }
  }
}

describe('AssignHerds Unit Tests (Go herding_test.go parity)', () => {
  // TestAssignHerdVirality
  it('TestAssignHerdVirality: virally propagates orientation across connected groups', () => {
    const g = new Graph();
    const container = new Node(0, 1000, 1000);
    const x = new Node(1, 5, 5);
    const y = new Node(2, 5, 5);
    const a = new Node(3, 5, 5);
    const b = new Node(4, 5, 5);
    const c = new Node(5, 5, 5);

    for (const node of [x, y, a, b, c]) {
      node.Container = container;
    }

    const placedCousin = new Node(6, 5, 5);
    placedCousin.TopLeft = new Point(8, 8);
    const placedUncle = new Node(7, 10, 10);
    placedCousin.Container = placedUncle;
    placedCousin.HerdAssignment = new HerdAssignment();
    placedCousin.HerdAssignment.Orientation = Orientation.Right;

    const cousin = new Node(8, 5, 5);
    const uncle = new Node(9, 10, 10);
    cousin.Container = uncle;

    g.Containers.set(container, [x, y, a, b, c]);
    g.Containers.set(placedUncle, [placedCousin]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    const edgeAbductions = [
      makeAbduction(x, placedCousin, placedUncle),
      makeAbduction(y, placedCousin, placedUncle),
      makeAbduction(x, cousin, uncle),
      makeAbduction(y, cousin, uncle),
      makeAbduction(a, cousin, uncle),
      makeAbduction(b, cousin, uncle),
      makeAbduction(c, cousin, uncle),
    ];

    assignHerds({}, g, container, edgeAbductions);

    for (const node of [x, y, a, b, c]) {
      assert.ok(node.HerdAssignment != null, `Node ${node.ID} should have HerdAssignment`);
      assert.equal(node.HerdAssignment.Orientation, x.HerdAssignment.Orientation);
    }
  });

  // TestUseBothSides
  it('TestUseBothSides: chooses same side when opposite count exceeds same count on tall container', () => {
    const g = new Graph();
    const container = new Node(0, 1000, 1000);
    const x = new Node(1, 5, 5);
    const y = new Node(2, 5, 5);
    x.Container = container;
    y.Container = container;

    const placedCousin = new Node(6, 5, 5);
    placedCousin.TopLeft = new Point(8, 8);
    // Tall (Height >= 2*Width), so both sides usable
    const placedUncle = new Node(7, 10, 30);
    placedCousin.Container = placedUncle;

    assert.equal(canUseBothSides(placedUncle, Orientation.Right), true);

    placedCousin.HerdAssignment = new HerdAssignment();
    placedCousin.HerdAssignment.Orientation = Orientation.Right;
    placedCousin.HerdAssignment.PairOppositeSide(new Node(99, 1, 1));

    const edgeAbductions = [
      makeAbduction(x, placedCousin, placedUncle),
      makeAbduction(y, placedCousin, placedUncle),
    ];

    g.Containers.set(container, [x, y]);
    g.Containers.set(placedUncle, [placedCousin]);
    setContainerFlag(g);

    assignHerds({}, g, container, edgeAbductions);

    assert.ok(x.HerdAssignment != null);
    assert.ok(y.HerdAssignment != null);
    // Since opposite count (1) > same count (0), preferred side is Right (same side)
    assert.equal(x.HerdAssignment.Orientation, Orientation.Right);
    assert.equal(y.HerdAssignment.Orientation, Orientation.Right);
  });

  // TestRandomHerdVirality
  it('TestRandomHerdVirality: unplaced herds all agree through common cousin bridge', () => {
    const g = new Graph();
    const container = new Node(0, 1000, 1000);
    const a1 = new Node(1, 5, 5);
    const a2 = new Node(2, 5, 5);
    const b1 = new Node(3, 5, 5);
    const b2 = new Node(4, 5, 5);
    const c1 = new Node(5, 5, 5);
    const c2 = new Node(6, 5, 5);

    for (const node of [a1, a2, b1, b2, c1, c2]) {
      node.Container = container;
    }

    const aCousin = new Node(10, 5, 5);
    const aUncle = new Node(11, 10, 10);
    aCousin.Container = aUncle;

    const bCousin = new Node(20, 5, 5);
    const bUncle = new Node(21, 10, 10);
    bCousin.Container = bUncle;

    const cCousin = new Node(30, 5, 5);
    const cUncle = new Node(31, 10, 10);
    cCousin.Container = cUncle;

    const commonCousin = new Node(40, 5, 5);
    const commonUncle = new Node(41, 10, 10);
    commonCousin.Container = commonUncle;

    g.Containers.set(container, [a1, a2, b1, b2, c1, c2]);
    g.Containers.set(aUncle, [aCousin]);
    g.Containers.set(bUncle, [bCousin]);
    g.Containers.set(cUncle, [cCousin]);
    g.Containers.set(commonUncle, [commonCousin]);
    setContainerFlag(g);

    const edgeAbductions = [
      makeAbduction(a1, aCousin, aUncle),
      makeAbduction(a2, aCousin, aUncle),
      makeAbduction(b1, bCousin, bUncle),
      makeAbduction(b2, bCousin, bUncle),
      makeAbduction(c1, cCousin, cUncle),
      makeAbduction(c2, cCousin, cUncle),
      makeAbduction(a1, commonCousin, commonUncle),
      makeAbduction(a2, commonCousin, commonUncle),
      makeAbduction(b1, commonCousin, commonUncle),
      makeAbduction(b2, commonCousin, commonUncle),
      makeAbduction(c1, commonCousin, commonUncle),
      makeAbduction(c2, commonCousin, commonUncle),
    ];

    assignHerds({}, g, container, edgeAbductions);

    const firstOrientation = a1.HerdAssignment?.Orientation;
    assert.ok(firstOrientation != null);
    for (const node of [a1, a2, b1, b2, c1, c2]) {
      assert.equal(node.HerdAssignment.Orientation, firstOrientation);
    }
  });

  // TestAssignHerdsRejectsUnindexedUncleChildren
  it('TestAssignHerdsRejectsUnindexedUncleChildren: throws layout invariant if uncle has no children', () => {
    const g = new Graph();
    const root = new Node(1, 100, 100);
    const a = new Node(2, 10, 10);
    const b = new Node(3, 10, 10);
    const uncle = new Node(4, 100, 100);
    uncle.isContainer = true;
    const cousinA = new Node(5, 10, 10);
    const cousinB = new Node(6, 10, 10);
    cousinA.Container = uncle;
    cousinB.Container = uncle;

    g.Containers.set(root, [a, b]);
    a.Container = root;
    b.Container = root;

    assert.throws(
      () =>
        assignHerds({}, g, root, [
          makeAbduction(a, cousinA, uncle),
          makeAbduction(b, cousinB, uncle),
        ]),
      (err) =>
        err.message === 'layout invariant violated: herding uncle 4 has no children'
    );
  });

  // TestAssignHerdsReconcilesOverlappingGroups table test
  const tableTests = [
    {
      name: 'opposing preferences with a shared side',
      firstWide: true,
      lastWide: true,
      lastOrientation: Orientation.Bottom,
      want: Orientation.Top,
    },
    {
      name: 'later constraint selects the shared side',
      firstWide: true,
      lastOrientation: Orientation.Bottom,
      want: Orientation.Top,
    },
    {
      name: 'later constraint overrides the first preference',
      firstWide: true,
      lastOrientation: Orientation.Top,
      want: Orientation.Bottom,
    },
    {
      name: 'incompatible sides leave the connected herd free',
      lastOrientation: Orientation.Bottom,
      want: Orientation.NONE,
    },
  ];

  for (const tc of tableTests) {
    it(`TestAssignHerdsReconcilesOverlappingGroups: ${tc.name}`, () => {
      const g = new Graph();
      const root = new Node(0, 100, 100);
      const a = new Node(1, 10, 10);
      const b = new Node(2, 10, 10);
      const c = new Node(3, 10, 10);
      root.isContainer = true;
      g.Containers.set(root, [a, b, c]);
      for (const node of [a, b, c]) {
        node.Container = root;
      }

      const first = new Node(4, 100, 100);
      const last = new Node(5, 100, 100);
      if (tc.firstWide) first.Width = 300;
      if (tc.lastWide) last.Width = 300;
      first.isContainer = true;
      last.isContainer = true;

      const firstCousin = new Node(6, 10, 10);
      const lastCousin = new Node(7, 10, 10);
      firstCousin.Container = first;
      lastCousin.Container = last;

      g.Containers.set(first, [firstCousin]);
      g.Containers.set(last, [lastCousin]);

      for (const cousin of [firstCousin, lastCousin]) {
        cousin.TopLeft = new Point(0, 0);
        cousin.HerdAssignment = new HerdAssignment();
        cousin.HerdAssignment.PairOppositeSide(new Node(8, 10, 10));
      }
      firstCousin.HerdAssignment.Orientation = Orientation.Top;
      lastCousin.HerdAssignment.Orientation = tc.lastOrientation;

      assignHerds({}, g, root, [
        makeAbduction(a, firstCousin, first),
        makeAbduction(b, firstCousin, first),
        makeAbduction(b, lastCousin, last),
        makeAbduction(c, lastCousin, last),
      ]);

      for (const node of [a, b, c]) {
        if (tc.want === Orientation.NONE) {
          assert.equal(node.HerdAssignment, null);
        } else {
          assert.ok(node.HerdAssignment != null);
          assert.equal(node.HerdAssignment.Orientation, tc.want);
        }
      }

      let wantFirstSame = 0;
      let wantLastSame = 0;
      if (tc.want === Orientation.Top) wantFirstSame = 1;
      if (tc.want === tc.lastOrientation) wantLastSame = 1;

      assert.equal(firstCousin.HerdAssignment.SameSidePairCount(), wantFirstSame);
      assert.equal(lastCousin.HerdAssignment.SameSidePairCount(), wantLastSame);
    });
  }

  // Cluster arrangement tests
  it('flips cluster Column to Row when assigned Top or Bottom', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const vessel = new Node(1, 5, 5);
    const sheep2 = new Node(2, 5, 5);
    vessel.Container = root;
    sheep2.Container = root;

    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;

    g.Containers.set(root, [vessel, sheep2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    const cluster = new Cluster({ Vessel: vessel, Arrangement: ClusterArrangement.Column });
    g.Clusters.set(vessel, cluster);
    vessel.setClusterVessel(true);

    assignHerds({}, g, root, [
      makeAbduction(vessel, cousin, uncle),
      makeAbduction(sheep2, cousin, uncle),
    ]);

    // Unbiased side 0 is Top -> flips Column to Row
    assert.equal(cluster.Arrangement, ClusterArrangement.Row);
  });

  it('flips cluster Row to Column when assigned Left or Right', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const vessel = new Node(1, 5, 5);
    const sheep2 = new Node(2, 5, 5);
    vessel.Container = root;
    sheep2.Container = root;

    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(0, 0);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right; // non-tall uncle -> preferred=Left

    g.Containers.set(root, [vessel, sheep2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    const cluster = new Cluster({ Vessel: vessel, Arrangement: ClusterArrangement.Row });
    g.Clusters.set(vessel, cluster);
    vessel.setClusterVessel(true);

    assignHerds({}, g, root, [
      makeAbduction(vessel, cousin, uncle),
      makeAbduction(sheep2, cousin, uncle),
    ]);

    assert.equal(cluster.Arrangement, ClusterArrangement.Column);
  });

  // Pre-cancellation test
  it('throws WorkCanceledError when pre-cancelled', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    g.Containers.set(root, []);
    root.isContainer = true;

    assert.throws(
      () => assignHerds({ isCancelled: () => true }, g, root, []),
      (err) => err instanceof WorkCanceledError && err.message === 'AssignHerds: context canceled'
    );
  });
});
