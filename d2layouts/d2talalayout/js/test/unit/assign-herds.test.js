import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Node } from '../../src/graph/node.js';
import { Graph } from '../../src/graph/graph.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { Point } from '../../src/geometry/point.js';
import { assignHerds, AssignHerds, canUseBothSides } from '../../src/proximity/herding.js';
import * as proximityExports from '../../src/proximity/index.js';
import * as rootExports from '../../src/index.js';
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

describe('AssignHerds Review-Gate Direct Tests', () => {
  it('AssignHerds === assignHerds', () => {
    assert.equal(AssignHerds, assignHerds);
  });

  it('proximity export present', () => {
    assert.equal(typeof proximityExports.assignHerds, 'function');
    assert.equal(typeof proximityExports.AssignHerds, 'function');
    assert.equal(proximityExports.AssignHerds, proximityExports.assignHerds);
    assert.equal(proximityExports.assignHerds, assignHerds);
  });

  it('root export absent', () => {
    assert.equal(rootExports.assignHerds, undefined);
    assert.equal(rootExports.AssignHerds, undefined);
  });

  it('entry cancellation before graph access', () => {
    const graphProxy = new Proxy({}, {
      get() {
        throw new Error('graph should not be accessed when pre-cancelled');
      },
    });
    assert.throws(
      () => assignHerds({ isCancelled: () => true }, graphProxy, null, []),
      (err) => err instanceof WorkCanceledError && err.message === 'AssignHerds: context canceled'
    );
  });

  it('empty case exact 2 context polls', () => {
    let polls = 0;
    const ctx = {
      isCancelled() {
        polls++;
        return false;
      },
    };
    const g = new Graph();
    const root = new Node(0, 100, 100);
    g.Containers.set(root, []);
    root.isContainer = true;
    assignHerds(ctx, g, root, []);
    // Poll 1: entry check in assignHerds
    // Poll 2: top-level loop check in applyVirally
    assert.equal(polls, 2);
  });

  it('singleton filtering: single sheep group deleted and receives no assignment', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const sheep = new Node(1, 5, 5);
    sheep.Container = root;
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    g.Containers.set(root, [sheep]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [makeAbduction(sheep, cousin, uncle)]);
    assert.equal(sheep.HerdAssignment, null);
  });

  it('signed uncle-ID sorting: negative and positive IDs ordered algebraically', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const sheep = [];
    for (let i = 1; i <= 8; i++) {
      const s = new Node(i, 5, 5);
      s.Container = root;
      sheep.push(s);
    }
    const un3 = new Node(-3, 10, 10);
    const un2 = new Node(-2, 10, 10);
    const un1 = new Node(-1, 10, 10);
    const u1 = new Node(1, 10, 10);
    const cn3a = new Node(91, 5, 5);
    const cn3b = new Node(92, 5, 5);
    const cn2a = new Node(93, 5, 5);
    const cn2b = new Node(94, 5, 5);
    const cn1a = new Node(95, 5, 5);
    const cn1b = new Node(96, 5, 5);
    const c1a = new Node(97, 5, 5);
    const c1b = new Node(98, 5, 5);
    for (const [c, u] of [
      [cn3a, un3], [cn3b, un3], [cn2a, un2], [cn2b, un2],
      [cn1a, un1], [cn1b, un1], [c1a, u1], [c1b, u1],
    ]) {
      c.Container = u;
    }
    g.Containers.set(root, sheep);
    g.Containers.set(un3, [cn3a, cn3b]);
    g.Containers.set(un2, [cn2a, cn2b]);
    g.Containers.set(un1, [cn1a, cn1b]);
    g.Containers.set(u1, [c1a, c1b]);
    setContainerFlag(g);

    // Provide abductions in reverse ID order
    const abductions = [
      makeAbduction(sheep[6], c1a, u1),
      makeAbduction(sheep[7], c1b, u1),
      makeAbduction(sheep[4], cn1a, un1),
      makeAbduction(sheep[5], cn1b, un1),
      makeAbduction(sheep[2], cn2a, un2),
      makeAbduction(sheep[3], cn2b, un2),
      makeAbduction(sheep[0], cn3a, un3),
      makeAbduction(sheep[1], cn3b, un3),
    ];
    assignHerds({}, g, root, abductions);

    // Unbiased cycling: -3 gets Top, -2 gets Right, -1 gets Bottom, 1 gets Left
    assert.equal(sheep[0].HerdAssignment.Orientation, Orientation.Top);
    assert.equal(sheep[1].HerdAssignment.Orientation, Orientation.Top);
    assert.equal(sheep[2].HerdAssignment.Orientation, Orientation.Right);
    assert.equal(sheep[3].HerdAssignment.Orientation, Orientation.Right);
    assert.equal(sheep[4].HerdAssignment.Orientation, Orientation.Bottom);
    assert.equal(sheep[5].HerdAssignment.Orientation, Orientation.Bottom);
    assert.equal(sheep[6].HerdAssignment.Orientation, Orientation.Left);
    assert.equal(sheep[7].HerdAssignment.Orientation, Orientation.Left);
  });

  it('Top/Right/Bottom/Left unbiased order', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const sheep = [];
    for (let i = 0; i < 8; i++) {
      const s = new Node(i + 1, 5, 5);
      s.Container = root;
      sheep.push(s);
    }
    const uncles = [];
    const cousins = [];
    g.Containers.set(root, sheep);
    const abductions = [];
    for (let i = 0; i < 4; i++) {
      const u = new Node(i + 10, 10, 10);
      const c = new Node(i + 20, 5, 5);
      c.Container = u;
      uncles.push(u);
      cousins.push(c);
      g.Containers.set(u, [c]);
      abductions.push(
        makeAbduction(sheep[2 * i], c, u),
        makeAbduction(sheep[2 * i + 1], c, u)
      );
    }
    setContainerFlag(g);
    assignHerds({}, g, root, abductions);

    assert.equal(sheep[0].HerdAssignment.Orientation, Orientation.Top);
    assert.equal(sheep[2].HerdAssignment.Orientation, Orientation.Right);
    assert.equal(sheep[4].HerdAssignment.Orientation, Orientation.Bottom);
    assert.equal(sheep[6].HerdAssignment.Orientation, Orientation.Left);
  });

  it('global unbiased cycling: 5th unconstrained component cycles back to Top', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const sheep = [];
    for (let i = 0; i < 10; i++) {
      const s = new Node(i + 1, 5, 5);
      s.Container = root;
      sheep.push(s);
    }
    const uncles = [];
    const cousins = [];
    g.Containers.set(root, sheep);
    const abductions = [];
    for (let i = 0; i < 5; i++) {
      const u = new Node(i + 10, 10, 10);
      const c = new Node(i + 20, 5, 5);
      c.Container = u;
      uncles.push(u);
      cousins.push(c);
      g.Containers.set(u, [c]);
      abductions.push(
        makeAbduction(sheep[2 * i], c, u),
        makeAbduction(sheep[2 * i + 1], c, u)
      );
    }
    setContainerFlag(g);
    assignHerds({}, g, root, abductions);

    assert.equal(sheep[0].HerdAssignment.Orientation, Orientation.Top);
    assert.equal(sheep[2].HerdAssignment.Orientation, Orientation.Right);
    assert.equal(sheep[4].HerdAssignment.Orientation, Orientation.Bottom);
    assert.equal(sheep[6].HerdAssignment.Orientation, Orientation.Left);
    assert.equal(sheep[8].HerdAssignment.Orientation, Orientation.Top);
  });

  it('incompatible component does not advance unbiasedSide', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const s3 = new Node(3, 5, 5);
    const s4 = new Node(4, 5, 5);
    const s5 = new Node(5, 5, 5);
    const s6 = new Node(6, 5, 5);
    for (const s of [s1, s2, s3, s4, s5, s6]) s.Container = root;

    const u10 = new Node(10, 10, 10);
    const c10a = new Node(101, 5, 5);
    const c10b = new Node(102, 5, 5);
    c10a.Container = u10;
    c10b.Container = u10;

    const u20 = new Node(20, 10, 10);
    const c20a = new Node(201, 5, 5);
    const c20b = new Node(202, 5, 5);
    c20a.Container = u20;
    c20b.Container = u20;
    c20a.TopLeft = new Point(0, 0);
    c20b.TopLeft = new Point(0, 0);
    c20a.HerdAssignment = new HerdAssignment();
    c20a.HerdAssignment.Orientation = Orientation.Left;
    c20b.HerdAssignment = new HerdAssignment();
    c20b.HerdAssignment.Orientation = Orientation.Right;

    const u30 = new Node(30, 10, 10);
    const c30a = new Node(301, 5, 5);
    const c30b = new Node(302, 5, 5);
    c30a.Container = u30;
    c30b.Container = u30;

    g.Containers.set(root, [s1, s2, s3, s4, s5, s6]);
    g.Containers.set(u10, [c10a, c10b]);
    g.Containers.set(u20, [c20a, c20b]);
    g.Containers.set(u30, [c30a, c30b]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, c10a, u10),
      makeAbduction(s2, c10b, u10),
      makeAbduction(s3, c20a, u20),
      makeAbduction(s4, c20b, u20),
      makeAbduction(s5, c30a, u30),
      makeAbduction(s6, c30b, u30),
    ]);

    // Comp 1: Top (unbiased index 0 -> 1)
    assert.equal(s1.HerdAssignment.Orientation, Orientation.Top);
    // Comp 2: incompatible -> null, unbiased index remains 1
    assert.equal(s3.HerdAssignment, null);
    assert.equal(s4.HerdAssignment, null);
    // Comp 3: Right (unbiased index 1 -> 2)
    assert.equal(s5.HerdAssignment.Orientation, Orientation.Right);
  });

  it('first-child-only placed semantics: uncle unplaced if child[0].TopLeft is null', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const child0 = new Node(11, 5, 5); // child0.TopLeft is null
    const child1 = new Node(12, 5, 5);
    child0.Container = uncle;
    child1.Container = uncle;
    child1.TopLeft = new Point(8, 8);
    child1.HerdAssignment = new HerdAssignment();
    child1.HerdAssignment.Orientation = Orientation.Right;

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [child0, child1]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, child1, uncle),
      makeAbduction(s2, child1, uncle),
    ]);

    // Unplaced uncle is skipped -> sheep get unbiased Top instead of constrained Left
    assert.equal(s1.HerdAssignment.Orientation, Orientation.Top);
  });

  it('invalid cousin orientation throws layout invariant', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.TopLeft; // diagonal

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assert.throws(
      () =>
        assignHerds({}, g, root, [
          makeAbduction(s1, cousin, uncle),
          makeAbduction(s2, cousin, uncle),
        ]),
      (err) => err.message === 'layout invariant violated: cousin 11 has an invalid herd orientation'
    );
  });

  it('unplaced uncle skipping invalid cousin', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    // cousin.TopLeft is null
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.TopLeft; // invalid diagonal

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assert.doesNotThrow(() =>
      assignHerds({}, g, root, [
        makeAbduction(s1, cousin, uncle),
        makeAbduction(s2, cousin, uncle),
      ])
    );
    // Uncle unplaced -> skipped without checking orientation -> sheep get Top
    assert.equal(s1.HerdAssignment.Orientation, Orientation.Top);
  });

  it('strict SameSide < OppositeSide: equal counts leave preferred opposite', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 30); // tall, bothSides=true
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;
    // Equal pair counts: 0 same, 0 opposite -> strict 0 < 0 is false -> preferred remains Left
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    assert.equal(s1.HerdAssignment.Orientation, Orientation.Left);
  });

  it('preferred chosen only once: later cousin does not overwrite earlier preferred', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const a = new Node(1, 10, 10);
    const b = new Node(2, 10, 10);
    const c = new Node(3, 10, 10);
    root.isContainer = true;
    a.Container = root;
    b.Container = root;
    c.Container = root;
    g.Containers.set(root, [a, b, c]);

    // Uncle 4 (tall, cousin Right, 0 < 1 opposite -> preferred = Right)
    const first = new Node(4, 10, 30);
    first.isContainer = true;
    const firstCousin = new Node(6, 10, 10);
    firstCousin.Container = first;
    firstCousin.TopLeft = new Point(0, 0);
    firstCousin.HerdAssignment = new HerdAssignment();
    firstCousin.HerdAssignment.Orientation = Orientation.Right;
    firstCousin.HerdAssignment.PairOppositeSide(new Node(99, 1, 1));
    g.Containers.set(first, [firstCousin]);

    // Uncle 5 (tall, cousin Left, 0 < 1 opposite -> would prefer Left, but preferred already Right)
    const second = new Node(5, 10, 30);
    second.isContainer = true;
    const secondCousin = new Node(7, 10, 10);
    secondCousin.Container = second;
    secondCousin.TopLeft = new Point(0, 0);
    secondCousin.HerdAssignment = new HerdAssignment();
    secondCousin.HerdAssignment.Orientation = Orientation.Left;
    secondCousin.HerdAssignment.PairOppositeSide(new Node(98, 1, 1));
    g.Containers.set(second, [secondCousin]);

    assignHerds({}, g, root, [
      makeAbduction(a, firstCousin, first),
      makeAbduction(b, firstCousin, first),
      makeAbduction(b, secondCousin, second),
      makeAbduction(c, secondCousin, second),
    ]);

    // Right survives as preferred because it is in sides ([Right, Left])
    assert.equal(a.HerdAssignment.Orientation, Orientation.Right);
    assert.equal(b.HerdAssignment.Orientation, Orientation.Right);
    assert.equal(c.HerdAssignment.Orientation, Orientation.Right);
  });

  it('preferred fallback to sides[0] when preferred not in sides', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const a = new Node(1, 10, 10);
    const b = new Node(2, 10, 10);
    const c = new Node(3, 10, 10);
    root.isContainer = true;
    a.Container = root;
    b.Container = root;
    c.Container = root;
    g.Containers.set(root, [a, b, c]);

    // First uncle: tall, Right, equal counts -> preferred = Left, allowed = [Right, Left]
    const first = new Node(4, 10, 30);
    first.isContainer = true;
    const firstCousin = new Node(6, 10, 10);
    firstCousin.Container = first;
    firstCousin.TopLeft = new Point(0, 0);
    firstCousin.HerdAssignment = new HerdAssignment();
    firstCousin.HerdAssignment.Orientation = Orientation.Right;
    g.Containers.set(first, [firstCousin]);

    // Second uncle: non-tall, Left -> allowed = [Right]
    const second = new Node(5, 10, 10);
    second.isContainer = true;
    const secondCousin = new Node(7, 10, 10);
    secondCousin.Container = second;
    secondCousin.TopLeft = new Point(0, 0);
    secondCousin.HerdAssignment = new HerdAssignment();
    secondCousin.HerdAssignment.Orientation = Orientation.Left;
    g.Containers.set(second, [secondCousin]);

    assignHerds({}, g, root, [
      makeAbduction(a, firstCousin, first),
      makeAbduction(b, firstCousin, first),
      makeAbduction(b, secondCousin, second),
      makeAbduction(c, secondCousin, second),
    ]);

    // Preferred was Left, which is not in sides ([Right]), so fall back to sides[0] = Right
    assert.equal(a.HerdAssignment.Orientation, Orientation.Right);
  });

  it('successful assignment replaces old object/state', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    s1.Container = root;
    s2.Container = root;

    const oldAssignment = new HerdAssignment();
    oldAssignment.Orientation = Orientation.Right;
    oldAssignment.Val = 42;
    oldAssignment.PairSameSide(new Node(99, 1, 1));
    s1.HerdAssignment = oldAssignment;

    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    assert.notEqual(s1.HerdAssignment, oldAssignment);
    assert.equal(s1.HerdAssignment.Val, 0);
    assert.equal(s1.HerdAssignment.Orientation, Orientation.Top);
  });

  it('incompatible component clears old assignment', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const a = new Node(1, 10, 10);
    const b = new Node(2, 10, 10);
    const c = new Node(3, 10, 10);
    root.isContainer = true;
    a.Container = root;
    b.Container = root;
    c.Container = root;
    g.Containers.set(root, [a, b, c]);

    const first = new Node(4, 100, 100);
    const last = new Node(5, 100, 100);
    first.isContainer = true;
    last.isContainer = true;

    const firstCousin = new Node(6, 10, 10);
    const lastCousin = new Node(7, 10, 10);
    firstCousin.Container = first;
    lastCousin.Container = last;
    g.Containers.set(first, [firstCousin]);
    g.Containers.set(last, [lastCousin]);

    firstCousin.TopLeft = new Point(0, 0);
    lastCousin.TopLeft = new Point(0, 0);
    firstCousin.HerdAssignment = new HerdAssignment();
    firstCousin.HerdAssignment.Orientation = Orientation.Top;
    lastCousin.HerdAssignment = new HerdAssignment();
    lastCousin.HerdAssignment.Orientation = Orientation.Bottom;

    // Pre-assign sheep with existing assignments
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Right;
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.Right;
    c.HerdAssignment = new HerdAssignment();
    c.HerdAssignment.Orientation = Orientation.Right;

    assignHerds({}, g, root, [
      makeAbduction(a, firstCousin, first),
      makeAbduction(b, firstCousin, first),
      makeAbduction(b, lastCousin, last),
      makeAbduction(c, lastCousin, last),
    ]);

    assert.equal(a.HerdAssignment, null);
    assert.equal(b.HerdAssignment, null);
    assert.equal(c.HerdAssignment, null);
  });

  it('same-side pair on sheep + cousin', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 30); // tall
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(0, 0);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;
    cousin.HerdAssignment.PairOppositeSide(new Node(99, 1, 1)); // 0 < 1 -> preferred = Right

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    assert.equal(s1.HerdAssignment.Orientation, Orientation.Right);
    assert.equal(s1.HerdAssignment.SameSidePairCount(), 1);
    assert.equal(cousin.HerdAssignment.SameSidePairCount(), 1);
  });

  it('opposite-side pair on sheep + cousin', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10); // non-tall
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(0, 0);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    assert.equal(s1.HerdAssignment.Orientation, Orientation.Left);
    assert.equal(s1.HerdAssignment.OppositeSidePairCount(), 1);
    assert.equal(cousin.HerdAssignment.OppositeSidePairCount(), 1);
  });

  it('unplaced uncle records no pair', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    // cousin.TopLeft is null
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    assert.equal(s1.HerdAssignment.SameSidePairCount(), 0);
    assert.equal(s1.HerdAssignment.OppositeSidePairCount(), 0);
    assert.equal(cousin.HerdAssignment.SameSidePairCount(), 0);
    assert.equal(cousin.HerdAssignment.OppositeSidePairCount(), 0);
  });

  it('duplicate pair Set uniqueness: multiple edges to same uncle produce 1 pair entry', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(0, 0);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    assert.equal(s1.HerdAssignment.OppositeSidePairCount(), 1);
    assert.equal(cousin.HerdAssignment.OppositeSidePairCount(), 1);
  });

  it('cousin HerdAssignment identity preserved', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(0, 0);
    const cousinAssignment = new HerdAssignment();
    cousinAssignment.Orientation = Orientation.Right;
    cousin.HerdAssignment = cousinAssignment;

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds({}, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    assert.equal(cousin.HerdAssignment, cousinAssignment);
  });

  it('no context polling in pair pass', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(0, 0);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;

    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    let polls = 0;
    const ctx = {
      isCancelled() {
        polls++;
        return false;
      },
    };

    assignHerds(ctx, g, root, [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ]);

    // Poll breakdown:
    // 1: assignHerds entry
    // 2-7: groupSheep (children and abductions)
    // 8: connectedHerds (expanding uncle 10)
    // 9: component uncle 10 check (line 392)
    // 10: applyVirally entry
    // 11: applyVirally uncle loop
    // (exact zero polls in pair pass and cluster pass)
    assert.equal(polls, 11);
  });

  it('ApplyVirally still runs with empty uncleOrder', () => {
    let virallyChecked = false;
    let entryChecked = false;
    const ctx = {
      isCancelled() {
        if (!entryChecked) {
          entryChecked = true;
          return false;
        }
        virallyChecked = true;
        return false;
      },
    };
    const g = new Graph();
    const root = new Node(0, 100, 100);
    // 1 sheep -> singleton -> uncleOrder becomes empty
    const sheep = new Node(1, 5, 5);
    sheep.Container = root;
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    g.Containers.set(root, [sheep]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);

    assignHerds(ctx, g, root, [makeAbduction(sheep, cousin, uncle)]);
    assert.equal(virallyChecked, true);
  });

  it('partial mutation survives later invariant', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    // Comp 1 (uncle 10): unconstrained
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const u10 = new Node(10, 10, 10);
    const c10a = new Node(101, 5, 5);
    const c10b = new Node(102, 5, 5);
    c10a.Container = u10;
    c10b.Container = u10;
    s1.Container = root;
    s2.Container = root;

    // Comp 2 (uncle 20): invalid cousin orientation
    const s3 = new Node(3, 5, 5);
    const s4 = new Node(4, 5, 5);
    const u20 = new Node(20, 10, 10);
    const c20 = new Node(201, 5, 5);
    c20.Container = u20;
    c20.TopLeft = new Point(0, 0);
    c20.HerdAssignment = new HerdAssignment();
    c20.HerdAssignment.Orientation = Orientation.TopLeft; // invalid
    s3.Container = root;
    s4.Container = root;

    g.Containers.set(root, [s1, s2, s3, s4]);
    g.Containers.set(u10, [c10a, c10b]);
    g.Containers.set(u20, [c20]);
    setContainerFlag(g);

    assert.throws(() =>
      assignHerds({}, g, root, [
        makeAbduction(s1, c10a, u10),
        makeAbduction(s2, c10b, u10),
        makeAbduction(s3, c20, u20),
        makeAbduction(s4, c20, u20),
      ])
    );

    // Comp 1 mutation survived!
    assert.ok(s1.HerdAssignment != null);
    assert.equal(s1.HerdAssignment.Orientation, Orientation.Top);
    assert.ok(s2.HerdAssignment != null);
    assert.equal(s2.HerdAssignment.Orientation, Orientation.Top);
    // Comp 2 not assigned
    assert.equal(s3.HerdAssignment, null);
    assert.equal(s4.HerdAssignment, null);
  });

  it('partial mutation survives cancellation', () => {
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const s3 = new Node(3, 5, 5);
    const s4 = new Node(4, 5, 5);
    const u10 = new Node(10, 10, 10);
    const u20 = new Node(20, 10, 10);
    const c10a = new Node(101, 5, 5);
    const c10b = new Node(102, 5, 5);
    const c20a = new Node(201, 5, 5);
    const c20b = new Node(202, 5, 5);
    for (const c of [c10a, c10b]) c.Container = u10;
    for (const c of [c20a, c20b]) c.Container = u20;
    s1.Container = root;
    s2.Container = root;
    s3.Container = root;
    s4.Container = root;
    g.Containers.set(root, [s1, s2, s3, s4]);
    g.Containers.set(u10, [c10a, c10b]);
    g.Containers.set(u20, [c20a, c20b]);
    setContainerFlag(g);

    // Track when Comp 1 finishes assignment: cancel at Comp 2's uncle check
    let comp1Done = false;
    const ctx = {
      isCancelled() {
        if (s1.HerdAssignment != null && s2.HerdAssignment != null) {
          comp1Done = true;
          return true; // Cancel after comp1 is assigned
        }
        return false;
      },
    };

    assert.throws(
      () =>
        assignHerds(ctx, g, root, [
          makeAbduction(s1, c10a, u10),
          makeAbduction(s2, c10b, u10),
          makeAbduction(s3, c20a, u20),
          makeAbduction(s4, c20b, u20),
        ]),
      (err) => err instanceof WorkCanceledError
    );

    assert.equal(comp1Done, true);
    assert.ok(s1.HerdAssignment != null);
    assert.equal(s3.HerdAssignment, null);
  });

  it('graph.Clusters is authoritative', () => {
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

    assert.equal(g.Clusters.get(vessel).Arrangement, ClusterArrangement.Row);
  });

  it('missing graph.Clusters entry naturally fails with TypeError', () => {
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

    vessel.setClusterVessel(true);
    // vessel is NOT in g.Clusters

    assert.throws(
      () =>
        assignHerds({}, g, root, [
          makeAbduction(vessel, cousin, uncle),
          makeAbduction(sheep2, cousin, uncle),
        ]),
      TypeError
    );
  });

  it('Column -> Row flip on Top or Bottom assignment', () => {
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

    assert.equal(cluster.Arrangement, ClusterArrangement.Row);
  });

  it('Row -> Column flip on Left or Right assignment', () => {
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
    cousin.HerdAssignment.Orientation = Orientation.Right; // non-tall -> preferred = Left

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

  it('no context polling in final cluster pass', () => {
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

    let pollsDuringClusterPass = 0;
    let inClusterPass = false;

    // Track when viral propagation finishes by instrumenting clusterArrangement
    const clusterProxy = new Proxy(cluster, {
      get(target, prop, receiver) {
        inClusterPass = true;
        return Reflect.get(target, prop, receiver);
      },
    });
    g.Clusters.set(vessel, clusterProxy);

    const ctx = {
      isCancelled() {
        if (inClusterPass) {
          pollsDuringClusterPass++;
        }
        return false;
      },
    };

    assignHerds(ctx, g, root, [
      makeAbduction(vessel, cousin, uncle),
      makeAbduction(sheep2, cousin, uncle),
    ]);

    assert.equal(pollsDuringClusterPass, 0);
    assert.equal(cluster.Arrangement, ClusterArrangement.Row);
  });
});
