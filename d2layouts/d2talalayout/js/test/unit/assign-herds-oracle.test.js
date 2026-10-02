import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Node } from '../../src/graph/node.js';
import { Graph } from '../../src/graph/graph.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { Orientation, orientationToString } from '../../src/geometry/orientation.js';
import { Point } from '../../src/geometry/point.js';
import { assignHerds } from '../../src/proximity/herding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(__dirname, '..', 'fixtures', 'go-assign-herds-reference.json');
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

function makeAbduction(from, to, currentTo) {
  return new EdgeAbduction({ OriginallyFrom: from, OriginallyTo: to, CurrentTo: currentTo });
}

class CancelAfterChecks {
  constructor(remaining) {
    this.remaining = remaining;
  }
  isCancelled() {
    if (this.remaining <= 0) {
      return true;
    }
    this.remaining--;
    return false;
  }
}

function verifyNodeStates(nodes, expectedStates) {
  if (!expectedStates) return;
  for (const [name, expected] of Object.entries(expectedStates)) {
    const node = nodes[name];
    assert.ok(node, `Node ${name} should exist`);
    assert.equal(node.ID, expected.id, `Node ${name} ID mismatch`);
    if (expected.hasAssignment) {
      assert.ok(node.HerdAssignment != null, `Node ${name} should have HerdAssignment`);
      if (expected.orientation !== undefined) {
        assert.equal(
          orientationToString(node.HerdAssignment.Orientation),
          expected.orientation,
          `Node ${name} orientation string mismatch`
        );
      }
      if (expected.orientationInt !== undefined) {
        assert.equal(
          node.HerdAssignment.Orientation,
          expected.orientationInt,
          `Node ${name} orientation int mismatch`
        );
      }
      if (expected.val !== undefined) {
        assert.equal(node.HerdAssignment.Val, expected.val, `Node ${name} Val mismatch`);
      }
      if (expected.sameSidePairCount !== undefined) {
        assert.equal(
          node.HerdAssignment.SameSidePairCount(),
          expected.sameSidePairCount,
          `Node ${name} SameSidePairCount mismatch`
        );
      }
      if (expected.oppositeSidePairCount !== undefined) {
        assert.equal(
          node.HerdAssignment.OppositeSidePairCount(),
          expected.oppositeSidePairCount,
          `Node ${name} OppositeSidePairCount mismatch`
        );
      }
    } else {
      assert.equal(node.HerdAssignment, null, `Node ${name} should NOT have HerdAssignment`);
    }
  }
}

function verifyClusterStates(clusters, expectedStates) {
  if (!expectedStates) return;
  for (const [name, expected] of Object.entries(expectedStates)) {
    const cluster = clusters[name];
    assert.ok(cluster, `Cluster ${name} should exist`);
    assert.equal(cluster.Arrangement, expected.arrangement, `Cluster ${name} arrangement mismatch`);
  }
}

function setContainerFlag(g) {
  if (!g.Containers) return;
  for (const [c] of g.Containers.entries()) {
    if (c != null) {
      c.isContainer = true;
    }
  }
}

describe('AssignHerds Go Oracle Replay', () => {
  const scenarios = reference.scenarios;

  // A. empty graph / no root children / no abductions
  it('A_empty_graph', () => {
    const expected = scenarios.A_empty_graph;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    g.Containers.set(root, []);
    root.isContainer = true;
    assert.doesNotThrow(() => assignHerds({}, g, root, []));
  });

  // B. pre-cancelled empty graph
  it('B_precancelled_empty_graph', () => {
    const expected = scenarios.B_precancelled_empty_graph;
    assert.equal(expected.success, false);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    g.Containers.set(root, []);
    root.isContainer = true;
    const ctx = new CancelAfterChecks(0);
    assert.throws(
      () => assignHerds(ctx, g, root, []),
      (err) => err.message === expected.error
    );
  });

  // C. nil context
  it('C_nil_context', () => {
    const expected = scenarios.C_nil_context;
    assert.equal(expected.success, false);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    g.Containers.set(root, []);
    root.isContainer = true;
    assert.throws(() => assignHerds(null, g, root, []), TypeError);
  });

  // D. nil graph
  it('D_nil_graph', () => {
    const expected = scenarios.D_nil_graph;
    assert.equal(expected.success, false);
    assert.throws(() => assignHerds({}, null, null, null), TypeError);
  });

  // E. nil Containers map
  it('E_nil_containers_map', () => {
    const expected = scenarios.E_nil_containers_map;
    assert.equal(expected.success, true);
    const g = new Graph();
    g.Containers = null;
    const root = new Node(0, 100, 100);
    assert.doesNotThrow(() => assignHerds({}, g, root, []));
  });

  // F. nil abduction with no root children
  it('F_nil_abduction_no_children', () => {
    const expected = scenarios.F_nil_abduction_no_children;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    g.Containers.set(root, []);
    root.isContainer = true;
    assert.doesNotThrow(() => assignHerds({}, g, root, [null]));
  });

  // G. nil abduction with root child
  it('G_nil_abduction_with_child', () => {
    const expected = scenarios.G_nil_abduction_with_child;
    assert.equal(expected.success, false);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const child = new Node(1, 5, 5);
    child.Container = root;
    g.Containers.set(root, [child]);
    root.isContainer = true;
    assert.throws(
      () => assignHerds({}, g, root, [null]),
      (err) => err.message === expected.error
    );
  });

  // H. singleton group removed
  it('H_singleton_group_removed', () => {
    const expected = scenarios.H_singleton_group_removed;
    assert.equal(expected.success, true);
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
    const abductions = [makeAbduction(sheep, cousin, uncle)];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ sheep }, expected.nodeStates);
  });

  // I. singleton + retained group
  it('I_singleton_plus_retained', () => {
    const expected = scenarios.I_singleton_plus_retained;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const sheep1 = new Node(1, 5, 5);
    const sheep2 = new Node(2, 5, 5);
    const sheep3 = new Node(3, 5, 5);
    sheep1.Container = root;
    sheep2.Container = root;
    sheep3.Container = root;
    const uncleA = new Node(10, 10, 10);
    const uncleB = new Node(20, 10, 10);
    const cousinA = new Node(11, 5, 5);
    const cousinB = new Node(21, 5, 5);
    cousinA.Container = uncleA;
    cousinB.Container = uncleB;
    g.Containers.set(root, [sheep1, sheep2, sheep3]);
    g.Containers.set(uncleA, [cousinA]);
    g.Containers.set(uncleB, [cousinB]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(sheep1, cousinA, uncleA),
      makeAbduction(sheep2, cousinB, uncleB),
      makeAbduction(sheep3, cousinB, uncleB),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ sheep1, sheep2, sheep3 }, expected.nodeStates);
  });

  // J. sorted uncle IDs
  it('J_sorted_uncle_ids', () => {
    const expected = scenarios.J_sorted_uncle_ids;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const sheep = [];
    for (let i = 1; i <= 8; i++) {
      const s = new Node(i, 5, 5);
      s.Container = root;
      sheep.push(s);
    }
    const u30 = new Node(30, 10, 10);
    const u10 = new Node(10, 10, 10);
    const u20 = new Node(20, 10, 10);
    const u40 = new Node(40, 10, 10);
    const c30a = new Node(31, 5, 5);
    const c30b = new Node(32, 5, 5);
    const c10a = new Node(11, 5, 5);
    const c10b = new Node(12, 5, 5);
    const c20a = new Node(21, 5, 5);
    const c20b = new Node(22, 5, 5);
    const c40a = new Node(41, 5, 5);
    const c40b = new Node(42, 5, 5);
    for (const [c, u] of [
      [c30a, u30], [c30b, u30], [c10a, u10], [c10b, u10],
      [c20a, u20], [c20b, u20], [c40a, u40], [c40b, u40],
    ]) {
      c.Container = u;
    }
    g.Containers.set(root, sheep);
    g.Containers.set(u30, [c30a, c30b]);
    g.Containers.set(u10, [c10a, c10b]);
    g.Containers.set(u20, [c20a, c20b]);
    g.Containers.set(u40, [c40a, c40b]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(sheep[0], c30a, u30),
      makeAbduction(sheep[1], c30b, u30),
      makeAbduction(sheep[2], c10a, u10),
      makeAbduction(sheep[3], c10b, u10),
      makeAbduction(sheep[4], c20a, u20),
      makeAbduction(sheep[5], c20b, u20),
      makeAbduction(sheep[6], c40a, u40),
      makeAbduction(sheep[7], c40b, u40),
    ];
    assignHerds({}, g, root, abductions);
    const nodeMap = {};
    for (let i = 0; i < 8; i++) {
      nodeMap[`s${i + 1}`] = sheep[i];
    }
    verifyNodeStates(nodeMap, expected.nodeStates);
  });

  // K. negative uncle IDs
  it('K_negative_uncle_ids', () => {
    const expected = scenarios.K_negative_uncle_ids;
    assert.equal(expected.success, true);
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
    const abductions = [
      makeAbduction(sheep[0], cn3a, un3),
      makeAbduction(sheep[1], cn3b, un3),
      makeAbduction(sheep[2], cn2a, un2),
      makeAbduction(sheep[3], cn2b, un2),
      makeAbduction(sheep[4], cn1a, un1),
      makeAbduction(sheep[5], cn1b, un1),
      makeAbduction(sheep[6], c1a, u1),
      makeAbduction(sheep[7], c1b, u1),
    ];
    assignHerds({}, g, root, abductions);
    const nodeMap = {};
    for (let i = 0; i < 8; i++) {
      nodeMap[`s${i + 1}`] = sheep[i];
    }
    verifyNodeStates(nodeMap, expected.nodeStates);
  });

  // L. five unconstrained cycling
  it('L_five_unconstrained_cycling', () => {
    const expected = scenarios.L_five_unconstrained_cycling;
    assert.equal(expected.success, true);
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
    g.Containers.set(root, []);
    const abductions = [];
    for (let i = 0; i < 5; i++) {
      const u = new Node(i + 10, 10, 10);
      const c = new Node(i + 20, 5, 5);
      c.Container = u;
      uncles.push(u);
      cousins.push(c);
      g.Containers.set(u, [c]);
      g.Containers.get(root).push(sheep[2 * i], sheep[2 * i + 1]);
      abductions.push(
        makeAbduction(sheep[2 * i], c, u),
        makeAbduction(sheep[2 * i + 1], c, u)
      );
    }
    setContainerFlag(g);
    assignHerds({}, g, root, abductions);
    const ns = {};
    for (let i = 0; i < 10; i++) {
      ns[`sheep${i}`] = sheep[i];
    }
    verifyNodeStates(ns, expected.nodeStates);
  });

  // M. placed right non-tall uncle
  it('M_placed_right_non_tall_uncle', () => {
    const expected = scenarios.M_placed_right_non_tall_uncle;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // N. tall right opposite > same
  it('N_tall_right_opposite_gt_same', () => {
    const expected = scenarios.N_tall_right_opposite_gt_same;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 30);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;
    cousin.HerdAssignment.PairOppositeSide(new Node(99, 1, 1));
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // O. tall right equal counts
  it('O_tall_right_equal_counts', () => {
    const expected = scenarios.O_tall_right_equal_counts;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 30);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // P. wide top cousin bias
  it('P_wide_top_cousin_bias', () => {
    const expected = scenarios.P_wide_top_cousin_bias;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 30, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Top;
    cousin.HerdAssignment.PairOppositeSide(new Node(99, 1, 1));
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // Q. invalid diagonal cousin
  it('Q_invalid_diagonal_cousin', () => {
    const expected = scenarios.Q_invalid_diagonal_cousin;
    assert.equal(expected.success, false);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.TopLeft;
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assert.throws(
      () => assignHerds({}, g, root, abductions),
      (err) => err.message === expected.error
    );
  });

  // R. none cousin orientation
  it('R_none_cousin_orientation', () => {
    const expected = scenarios.R_none_cousin_orientation;
    assert.equal(expected.success, false);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(8, 8);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.NONE;
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assert.throws(
      () => assignHerds({}, g, root, abductions),
      (err) => err.message === expected.error
    );
  });

  // S. unplaced uncle skips invalid cousin
  it('S_unplaced_uncle_skips_invalid_cousin', () => {
    const expected = scenarios.S_unplaced_uncle_skips_invalid_cousin;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.TopLeft;
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // T. first child nil topleft
  it('T_first_child_nil_topleft', () => {
    const expected = scenarios.T_first_child_nil_topleft;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const child0 = new Node(11, 5, 5);
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
    const abductions = [
      makeAbduction(s1, child1, uncle),
      makeAbduction(s2, child1, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, child0, child1 }, expected.nodeStates);
  });

  // U. unindexed uncle
  it('U_unindexed_uncle', () => {
    const expected = scenarios.U_unindexed_uncle;
    assert.equal(expected.success, false);
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
    const abductions = [
      makeAbduction(a, cousinA, uncle),
      makeAbduction(b, cousinB, uncle),
    ];
    assert.throws(
      () => assignHerds({}, g, root, abductions),
      (err) => err.message === expected.error
    );
  });

  // V. overlapping compatible
  it('V_overlapping_compatible', () => {
    const expected = scenarios.V_overlapping_compatible;
    assert.equal(expected.success, true);
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
    const first = new Node(4, 300, 100);
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
    firstCousin.HerdAssignment.PairOppositeSide(new Node(8, 10, 10));
    lastCousin.HerdAssignment = new HerdAssignment();
    lastCousin.HerdAssignment.Orientation = Orientation.Bottom;
    lastCousin.HerdAssignment.PairOppositeSide(new Node(9, 10, 10));
    const abductions = [
      makeAbduction(a, firstCousin, first),
      makeAbduction(b, firstCousin, first),
      makeAbduction(b, lastCousin, last),
      makeAbduction(c, lastCousin, last),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ a, b, c, firstCousin, lastCousin }, expected.nodeStates);
  });

  // W. preferred removed sides remain
  it('W_preferred_removed_sides_remain', () => {
    const expected = scenarios.W_preferred_removed_sides_remain;
    assert.equal(expected.success, true);
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
    const first = new Node(4, 10, 30);
    first.isContainer = true;
    const firstCousin = new Node(6, 10, 10);
    firstCousin.Container = first;
    g.Containers.set(first, [firstCousin]);
    firstCousin.TopLeft = new Point(0, 0);
    firstCousin.HerdAssignment = new HerdAssignment();
    firstCousin.HerdAssignment.Orientation = Orientation.Right;
    const last = new Node(5, 10, 10);
    last.isContainer = true;
    const lastCousin = new Node(7, 10, 10);
    lastCousin.Container = last;
    g.Containers.set(last, [lastCousin]);
    lastCousin.TopLeft = new Point(0, 0);
    lastCousin.HerdAssignment = new HerdAssignment();
    lastCousin.HerdAssignment.Orientation = Orientation.Left;
    const abductions = [
      makeAbduction(a, firstCousin, first),
      makeAbduction(b, firstCousin, first),
      makeAbduction(b, lastCousin, last),
      makeAbduction(c, lastCousin, last),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ a, b, c, firstCousin, lastCousin }, expected.nodeStates);
  });

  // X. incompatible clears assignments
  it('X_incompatible_clears_assignments', () => {
    const expected = scenarios.X_incompatible_clears_assignments;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const a = new Node(1, 10, 10);
    const b = new Node(2, 10, 10);
    root.isContainer = true;
    a.Container = root;
    b.Container = root;
    g.Containers.set(root, [a, b]);
    const uncle1 = new Node(10, 10, 10);
    const uncle2 = new Node(11, 10, 10);
    const cousin1 = new Node(20, 5, 5);
    const cousin2 = new Node(21, 5, 5);
    cousin1.Container = uncle1;
    cousin2.Container = uncle2;
    cousin1.TopLeft = new Point(0, 0);
    cousin2.TopLeft = new Point(0, 0);
    cousin1.HerdAssignment = new HerdAssignment();
    cousin1.HerdAssignment.Orientation = Orientation.Left;
    cousin2.HerdAssignment = new HerdAssignment();
    cousin2.HerdAssignment.Orientation = Orientation.Right;
    g.Containers.set(uncle1, [cousin1]);
    g.Containers.set(uncle2, [cousin2]);
    setContainerFlag(g);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Top;
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.Bottom;
    const abductions = [
      makeAbduction(a, cousin1, uncle1),
      makeAbduction(b, cousin2, uncle2),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // Y. incompatible no unbiased advance
  it('Y_incompatible_no_unbiased_advance', () => {
    const expected = scenarios.Y_incompatible_no_unbiased_advance;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const s3 = new Node(3, 5, 5);
    const s4 = new Node(4, 5, 5);
    const s5 = new Node(5, 5, 5);
    const s6 = new Node(6, 5, 5);
    for (const s of [s1, s2, s3, s4, s5, s6]) {
      s.Container = root;
    }
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
    const abductions = [
      makeAbduction(s1, c10a, u10),
      makeAbduction(s2, c10b, u10),
      makeAbduction(s3, c20a, u20),
      makeAbduction(s4, c20b, u20),
      makeAbduction(s5, c30a, u30),
      makeAbduction(s6, c30b, u30),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, s3, s4, s5, s6 }, expected.nodeStates);
  });

  // Z. fresh sheep assignment
  it('Z_fresh_sheep_assignment', () => {
    const expected = scenarios.Z_fresh_sheep_assignment;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    s1.Container = root;
    s2.Container = root;
    s1.HerdAssignment = new HerdAssignment();
    s1.HerdAssignment.Orientation = Orientation.Right;
    s1.HerdAssignment.Val = 99;
    s1.HerdAssignment.PairSameSide(new Node(999, 1, 1));
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2 }, expected.nodeStates);
  });

  // AA. cousin identity preserved
  it('AA_cousin_identity_preserved', () => {
    const expected = scenarios.AA_cousin_identity_preserved;
    assert.equal(expected.success, true);
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
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // AB. same side pair
  it('AB_same_side_pair', () => {
    const expected = scenarios.AB_same_side_pair;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 30);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    cousin.TopLeft = new Point(0, 0);
    cousin.HerdAssignment = new HerdAssignment();
    cousin.HerdAssignment.Orientation = Orientation.Right;
    cousin.HerdAssignment.PairOppositeSide(new Node(99, 1, 1));
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // AC. opposite side pair
  it('AC_opposite_side_pair', () => {
    const expected = scenarios.AC_opposite_side_pair;
    assert.equal(expected.success, true);
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
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // AD. duplicate cousin pair set uniqueness
  it('AD_duplicate_cousin_pair_set_uniqueness', () => {
    const expected = scenarios.AD_duplicate_cousin_pair_set_uniqueness;
    assert.equal(expected.success, true);
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
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2, cousin }, expected.nodeStates);
  });

  // AE. assign herd virality
  it('AE_assign_herd_virality', () => {
    const expected = scenarios.AE_assign_herd_virality;
    assert.equal(expected.success, true);
    const g = new Graph();
    const container = new Node(0, 1000, 1000);
    const x = new Node(1, 5, 5);
    const y = new Node(2, 5, 5);
    const a = new Node(3, 5, 5);
    const b = new Node(4, 5, 5);
    const c = new Node(5, 5, 5);
    for (const s of [x, y, a, b, c]) {
      s.Container = container;
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
    const abductions = [
      makeAbduction(x, placedCousin, placedUncle),
      makeAbduction(y, placedCousin, placedUncle),
      makeAbduction(x, cousin, uncle),
      makeAbduction(y, cousin, uncle),
      makeAbduction(a, cousin, uncle),
      makeAbduction(b, cousin, uncle),
      makeAbduction(c, cousin, uncle),
    ];
    assignHerds({}, g, container, abductions);
    verifyNodeStates({ x, y, a, b, c, placedCousin }, expected.nodeStates);
  });

  // AF. random herd virality
  it('AF_random_herd_virality', () => {
    const expected = scenarios.AF_random_herd_virality;
    assert.equal(expected.success, true);
    const g = new Graph();
    const container = new Node(0, 1000, 1000);
    const a1 = new Node(1, 5, 5);
    const a2 = new Node(2, 5, 5);
    const b1 = new Node(3, 5, 5);
    const b2 = new Node(4, 5, 5);
    const c1 = new Node(5, 5, 5);
    const c2 = new Node(6, 5, 5);
    for (const s of [a1, a2, b1, b2, c1, c2]) {
      s.Container = container;
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
    const abductions = [
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
    assignHerds({}, g, container, abductions);
    verifyNodeStates({ a1, a2, b1, b2, c1, c2 }, expected.nodeStates);
  });

  // AG. partial mutation before error
  it('AG_partial_mutation_before_error', () => {
    const expected = scenarios.AG_partial_mutation_before_error;
    assert.equal(expected.success, false);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const u10 = new Node(10, 10, 10);
    const c10a = new Node(101, 5, 5);
    const c10b = new Node(102, 5, 5);
    c10a.Container = u10;
    c10b.Container = u10;
    s1.Container = root;
    s2.Container = root;
    const s3 = new Node(3, 5, 5);
    const s4 = new Node(4, 5, 5);
    const u20 = new Node(20, 10, 10);
    const c20 = new Node(201, 5, 5);
    c20.Container = u20;
    c20.TopLeft = new Point(0, 0);
    c20.HerdAssignment = new HerdAssignment();
    c20.HerdAssignment.Orientation = Orientation.TopLeft;
    s3.Container = root;
    s4.Container = root;
    g.Containers.set(root, [s1, s2, s3, s4]);
    g.Containers.set(u10, [c10a, c10b]);
    g.Containers.set(u20, [c20]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, c10a, u10),
      makeAbduction(s2, c10b, u10),
      makeAbduction(s3, c20, u20),
      makeAbduction(s4, c20, u20),
    ];
    assert.throws(
      () => assignHerds({}, g, root, abductions),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ s1, s2, s3, s4 }, expected.nodeStates);
  });

  // AH. partial mutation before cancellation
  it('AH_partial_mutation_before_cancellation', () => {
    const expected = scenarios.AH_partial_mutation_before_cancellation;
    assert.equal(expected.success, false);
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
    const ctx = new CancelAfterChecks(4);
    const abductions = [
      makeAbduction(s1, c10a, u10),
      makeAbduction(s2, c10b, u10),
      makeAbduction(s3, c20a, u20),
      makeAbduction(s4, c20b, u20),
    ];
    assert.throws(
      () => assignHerds(ctx, g, root, abductions),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ s1, s2, s3, s4 }, expected.nodeStates);
  });

  // AI. apply virally cancellation
  it('AI_apply_virally_cancellation', () => {
    const expected = scenarios.AI_apply_virally_cancellation;
    assert.equal(expected.success, false);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const ctx = new CancelAfterChecks(3);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assert.throws(
      () => assignHerds(ctx, g, root, abductions),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ s1, s2 }, expected.nodeStates);
  });

  // AJ. cluster column to row on top
  it('AJ_cluster_column_to_row_on_top', () => {
    const expected = scenarios.AJ_cluster_column_to_row_on_top;
    assert.equal(expected.success, true);
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
    const abductions = [
      makeAbduction(vessel, cousin, uncle),
      makeAbduction(sheep2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ vessel, sheep2 }, expected.nodeStates);
    verifyClusterStates({ cluster }, expected.clusterStates);
  });

  // AK. cluster row to column on left
  it('AK_cluster_row_to_column_on_left', () => {
    const expected = scenarios.AK_cluster_row_to_column_on_left;
    assert.equal(expected.success, true);
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
    cousin.HerdAssignment.Orientation = Orientation.Right;
    g.Containers.set(root, [vessel, sheep2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const cluster = new Cluster({ Vessel: vessel, Arrangement: ClusterArrangement.Row });
    g.Clusters.set(vessel, cluster);
    vessel.setClusterVessel(true);
    const abductions = [
      makeAbduction(vessel, cousin, uncle),
      makeAbduction(sheep2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ vessel, sheep2 }, expected.nodeStates);
    verifyClusterStates({ cluster }, expected.clusterStates);
  });

  // AL. cluster noop
  it('AL_cluster_noop', () => {
    const expected = scenarios.AL_cluster_noop;
    assert.equal(expected.success, true);
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
    const cluster = new Cluster({ Vessel: vessel, Arrangement: ClusterArrangement.Row });
    g.Clusters.set(vessel, cluster);
    vessel.setClusterVessel(true);
    const abductions = [
      makeAbduction(vessel, cousin, uncle),
      makeAbduction(sheep2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ vessel, sheep2 }, expected.nodeStates);
    verifyClusterStates({ cluster }, expected.clusterStates);
  });

  // AM. malformed cluster vessel
  it('AM_malformed_cluster_vessel', () => {
    const expected = scenarios.AM_malformed_cluster_vessel;
    assert.equal(expected.success, false);
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
    const abductions = [
      makeAbduction(vessel, cousin, uncle),
      makeAbduction(sheep2, cousin, uncle),
    ];
    assert.throws(
      () => assignHerds({}, g, root, abductions),
      TypeError
    );
  });

  // AN. repeated invocation
  it('AN_repeated_invocation', () => {
    const expected = scenarios.AN_repeated_invocation;
    assert.equal(expected.success, true);
    const g = new Graph();
    const root = new Node(0, 100, 100);
    const s1 = new Node(1, 5, 5);
    const s2 = new Node(2, 5, 5);
    const uncle = new Node(10, 10, 10);
    const cousin = new Node(11, 5, 5);
    cousin.Container = uncle;
    s1.Container = root;
    s2.Container = root;
    g.Containers.set(root, [s1, s2]);
    g.Containers.set(uncle, [cousin]);
    setContainerFlag(g);
    const abductions = [
      makeAbduction(s1, cousin, uncle),
      makeAbduction(s2, cousin, uncle),
    ];
    assignHerds({}, g, root, abductions);
    s1.HerdAssignment = null;
    s2.HerdAssignment = null;
    assignHerds({}, g, root, abductions);
    verifyNodeStates({ s1, s2 }, expected.nodeStates);
  });
});
