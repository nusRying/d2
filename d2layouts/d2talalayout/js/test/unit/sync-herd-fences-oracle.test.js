import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Graph } from '../../src/graph/graph.js';
import { Label } from '../../src/graph/label.js';
import { LabelPosition } from '../../src/graph/label-position.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { syncHerdFences } from '../../src/proximity/herding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(__dirname, '..', 'fixtures', 'go-sync-herd-fences-reference.json');
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

function verifyNodeState(node, expNodeState, nodeName) {
  if (expNodeState == null) return;
  if (!expNodeState.hasAssignment) {
    assert.equal(node.HerdAssignment, null, `${nodeName}: expected no HerdAssignment`);
    return;
  }
  assert.ok(node.HerdAssignment != null, `${nodeName}: expected HerdAssignment`);
  assert.equal(node.HerdAssignment.Orientation, expNodeState.orientationInt, `${nodeName}: orientation mismatch`);
  assert.equal(node.HerdAssignment.Val, expNodeState.val, `${nodeName}: val mismatch`);
  if (expNodeState.sameSidePairCount != null) {
    assert.equal(node.HerdAssignment.sameSidePairCount(), expNodeState.sameSidePairCount, `${nodeName}: sameSidePairCount mismatch`);
  }
  if (expNodeState.oppositeSidePairCount != null) {
    assert.equal(node.HerdAssignment.oppositeSidePairCount(), expNodeState.oppositeSidePairCount, `${nodeName}: oppositeSidePairCount mismatch`);
  }
}

describe('SyncHerdFences Go Oracle Replay (40 Scenarios)', () => {
  it('A_empty_graph', () => {
    const sc = reference.scenarios.A_empty_graph;
    const g = new Graph();
    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    assert.equal(sc.success, true);
  });

  it('B_nil_graph', () => {
    const sc = reference.scenarios.B_nil_graph;
    assert.equal(sc.success, false);
    assert.throws(() => {
      syncHerdFences(null);
    }, TypeError);
  });

  it('C_one_placed_node_no_assignment', () => {
    const sc = reference.scenarios.C_one_placed_node_no_assignment;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    g.addNode(n);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('D_one_top_assignment', () => {
    const sc = reference.scenarios.D_one_top_assignment;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    g.addNode(n);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('E_one_bottom_assignment', () => {
    const sc = reference.scenarios.E_one_bottom_assignment;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Bottom;
    g.addNode(n);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('F_one_left_assignment', () => {
    const sc = reference.scenarios.F_one_left_assignment;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Left;
    g.addNode(n);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('G_one_right_assignment', () => {
    const sc = reference.scenarios.G_one_right_assignment;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('H_mixed_cardinal_nodes', () => {
    const sc = reference.scenarios.H_mixed_cardinal_nodes;
    const g = new Graph();
    const topNode = new Node(1n, 10, 10);
    topNode.TopLeft = new Point(50, 20);
    topNode.HerdAssignment = new HerdAssignment();
    topNode.HerdAssignment.Orientation = Orientation.Top;

    const bottomNode = new Node(2n, 10, 10);
    bottomNode.TopLeft = new Point(50, 100);
    bottomNode.HerdAssignment = new HerdAssignment();
    bottomNode.HerdAssignment.Orientation = Orientation.Bottom;

    const leftNode = new Node(3n, 10, 10);
    leftNode.TopLeft = new Point(10, 50);
    leftNode.HerdAssignment = new HerdAssignment();
    leftNode.HerdAssignment.Orientation = Orientation.Left;

    const rightNode = new Node(4n, 10, 10);
    rightNode.TopLeft = new Point(120, 50);
    rightNode.HerdAssignment = new HerdAssignment();
    rightNode.HerdAssignment.Orientation = Orientation.Right;

    g.addNode(topNode);
    g.addNode(bottomNode);
    g.addNode(leftNode);
    g.addNode(rightNode);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(topNode, sc.nodeStates.top, 'top');
    verifyNodeState(bottomNode, sc.nodeStates.bottom, 'bottom');
    verifyNodeState(leftNode, sc.nodeStates.left, 'left');
    verifyNodeState(rightNode, sc.nodeStates.right, 'right');
  });

  it('I_multiple_right_assigned_nodes', () => {
    const sc = reference.scenarios.I_multiple_right_assigned_nodes;
    const g = new Graph();
    const r1 = new Node(1n, 10, 10);
    r1.TopLeft = new Point(20, 30);
    r1.HerdAssignment = new HerdAssignment();
    r1.HerdAssignment.Orientation = Orientation.Right;

    const r2 = new Node(2n, 20, 20);
    r2.TopLeft = new Point(50, 40);
    r2.HerdAssignment = new HerdAssignment();
    r2.HerdAssignment.Orientation = Orientation.Right;

    g.addNode(r1);
    g.addNode(r2);

    syncHerdFences(g);
    verifyNodeState(r1, sc.nodeStates.r1, 'r1');
    verifyNodeState(r2, sc.nodeStates.r2, 'r2');
  });

  it('J_existing_nonzero_val_overwritten', () => {
    const sc = reference.scenarios.J_existing_nonzero_val_overwritten;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    n.HerdAssignment.Val = 9999.9;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('K_assigned_fixed_top_node_skipped', () => {
    const sc = reference.scenarios.K_assigned_fixed_top_node_skipped;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.FixedTopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    n.HerdAssignment.Val = 777.0;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('L_assigned_fixed_right_node_skipped', () => {
    const sc = reference.scenarios.L_assigned_fixed_right_node_skipped;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.FixedTopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    n.HerdAssignment.Val = -888.0;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('M_fixed_node_influences_other_fence', () => {
    const sc = reference.scenarios.M_fixed_node_influences_other_fence;
    const g = new Graph();
    const fixedNode = new Node(1n, 10, 10);
    fixedNode.TopLeft = new Point(10, 10);
    fixedNode.FixedTopLeft = new Point(10, 10);
    fixedNode.HerdAssignment = new HerdAssignment();
    fixedNode.HerdAssignment.Orientation = Orientation.Top;
    fixedNode.HerdAssignment.Val = 111.0;

    const nonFixedNode = new Node(2n, 10, 10);
    nonFixedNode.TopLeft = new Point(50, 50);
    nonFixedNode.HerdAssignment = new HerdAssignment();
    nonFixedNode.HerdAssignment.Orientation = Orientation.Top;
    nonFixedNode.HerdAssignment.Val = 222.0;

    g.addNode(fixedNode);
    g.addNode(nonFixedNode);

    syncHerdFences(g);
    verifyNodeState(fixedNode, sc.nodeStates.fixed, 'fixed');
    verifyNodeState(nonFixedNode, sc.nodeStates.nonFixed, 'nonFixed');
  });

  it('N_unassigned_faraway_node_affects_bounds', () => {
    const sc = reference.scenarios.N_unassigned_faraway_node_affects_bounds;
    const g = new Graph();
    const unassigned = new Node(1n, 10, 10);
    unassigned.TopLeft = new Point(0, 0);

    const assigned = new Node(2n, 10, 10);
    assigned.TopLeft = new Point(100, 100);
    assigned.HerdAssignment = new HerdAssignment();
    assigned.HerdAssignment.Orientation = Orientation.Left;

    g.addNode(unassigned);
    g.addNode(assigned);

    syncHerdFences(g);
    verifyNodeState(unassigned, sc.nodeStates.unassigned, 'unassigned');
    verifyNodeState(assigned, sc.nodeStates.assigned, 'assigned');
  });

  it('O_routed_edge_extends_left', () => {
    const sc = reference.scenarios.O_routed_edge_extends_left;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(50, 50);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Left;
    g.addNode(n);

    const e = new Edge(n, n);
    e.Points = [new Point(10, 55), new Point(50, 55)];
    g.addEdge(e);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('P_routed_edge_extends_right', () => {
    const sc = reference.scenarios.P_routed_edge_extends_right;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(50, 50);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    const e = new Edge(n, n);
    e.Points = [new Point(60, 55), new Point(200, 55)];
    g.addEdge(e);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('Q_routed_edge_extends_top_bottom', () => {
    const sc = reference.scenarios.Q_routed_edge_extends_top_bottom;
    const g = new Graph();
    const topNode = new Node(1n, 10, 10);
    topNode.TopLeft = new Point(50, 50);
    topNode.HerdAssignment = new HerdAssignment();
    topNode.HerdAssignment.Orientation = Orientation.Top;

    const bottomNode = new Node(2n, 10, 10);
    bottomNode.TopLeft = new Point(50, 60);
    bottomNode.HerdAssignment = new HerdAssignment();
    bottomNode.HerdAssignment.Orientation = Orientation.Bottom;

    g.addNode(topNode);
    g.addNode(bottomNode);

    const e = new Edge(topNode, bottomNode);
    e.Points = [new Point(55, 10), new Point(55, 150)];
    g.addEdge(e);

    syncHerdFences(g);
    verifyNodeState(topNode, sc.nodeStates.top, 'top');
    verifyNodeState(bottomNode, sc.nodeStates.bottom, 'bottom');
  });

  it('R_edge_label_expands_bound', () => {
    const sc = reference.scenarios.R_edge_label_expands_bound;
    const g = new Graph();
    const n = new Node(1n, 20, 20);
    n.TopLeft = new Point(50, 50);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    const e = new Edge(n, n);
    e.Points = [new Point(50, 60), new Point(70, 60)];
    e.Label = new Label('long-label', 80, 30);
    e.Label.Position = LabelPosition.InsideMiddleRight;
    g.addEdge(e);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('S_fractional_geometry_rounded', () => {
    const sc = reference.scenarios.S_fractional_geometry_rounded;
    const g = new Graph();
    const n = new Node(1n, 15.3, 25.7);
    n.TopLeft = new Point(10.4, 20.6);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;

    const r = new Node(2n, 10, 10);
    r.TopLeft = new Point(50.3, 50);
    r.HerdAssignment = new HerdAssignment();
    r.HerdAssignment.Orientation = Orientation.Right;

    g.addNode(n);
    g.addNode(r);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
    verifyNodeState(r, sc.nodeStates.r, 'r');
  });

  it('T_top_left_orientation_unchanged', () => {
    const sc = reference.scenarios.T_top_left_orientation_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.TopLeft;
    n.HerdAssignment.Val = 123.4;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('U_top_right_orientation_unchanged', () => {
    const sc = reference.scenarios.U_top_right_orientation_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.TopRight;
    n.HerdAssignment.Val = 234.5;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('V_bottom_left_orientation_unchanged', () => {
    const sc = reference.scenarios.V_bottom_left_orientation_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.BottomLeft;
    n.HerdAssignment.Val = 345.6;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('W_bottom_right_orientation_unchanged', () => {
    const sc = reference.scenarios.W_bottom_right_orientation_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.BottomRight;
    n.HerdAssignment.Val = 456.7;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('X_none_orientation_unchanged', () => {
    const sc = reference.scenarios.X_none_orientation_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.NONE;
    n.HerdAssignment.Val = 567.8;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('Y_unknown_orientation_unchanged', () => {
    const sc = reference.scenarios.Y_unknown_orientation_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = 999;
    n.HerdAssignment.Val = 678.9;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('Z_fresh_herd_assignment_top_left_unchanged', () => {
    const sc = reference.scenarios.Z_fresh_herd_assignment_top_left_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Val = 99.0;
    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('AA_assignment_pair_counts_unchanged', () => {
    const sc = reference.scenarios.AA_assignment_pair_counts_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;

    const uncle1 = new Node(10n, 5, 5);
    const uncle2 = new Node(20n, 5, 5);
    n.HerdAssignment.PairSameSide(uncle1);
    n.HerdAssignment.PairSameSide(uncle2);
    n.HerdAssignment.PairOppositeSide(uncle1);

    g.addNode(n);

    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('AB_repeated_invocation_after_geometry_change', () => {
    const sc = reference.scenarios.AB_repeated_invocation_after_geometry_change;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    // First sync
    syncHerdFences(g);
    assert.equal(n.HerdAssignment.Val, 30);

    // Move node
    n.TopLeft = new Point(100, 30);

    // Second sync
    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('AC_unplaced_node_all_unassigned', () => {
    const sc = reference.scenarios.AC_unplaced_node_all_unassigned;
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);
    const placed = new Node(2n, 10, 10);
    placed.TopLeft = new Point(20, 30);
    g.addNode(unplaced);
    g.addNode(placed);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(unplaced, sc.nodeStates.unplaced, 'unplaced');
    verifyNodeState(placed, sc.nodeStates.placed, 'placed');
  });

  it('AD_unplaced_node_fixed_cardinal', () => {
    const sc = reference.scenarios.AD_unplaced_node_fixed_cardinal;
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
    verifyNodeState(unplaced, sc.nodeStates.unplaced, 'unplaced');
    verifyNodeState(fixed, sc.nodeStates.fixed, 'fixed');
  });

  it('AE_unplaced_node_diagonal_assignment', () => {
    const sc = reference.scenarios.AE_unplaced_node_diagonal_assignment;
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
    verifyNodeState(unplaced, sc.nodeStates.unplaced, 'unplaced');
    verifyNodeState(diag, sc.nodeStates.diag, 'diag');
  });

  it('AF_unplaced_node_none_assignment', () => {
    const sc = reference.scenarios.AF_unplaced_node_none_assignment;
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const noneNode = new Node(2n, 10, 10);
    noneNode.TopLeft = new Point(20, 30);
    noneNode.HerdAssignment = new HerdAssignment();
    noneNode.HerdAssignment.Orientation = Orientation.NONE;
    noneNode.HerdAssignment.Val = 777.0;

    g.addNode(unplaced);
    g.addNode(noneNode);

    const ret = syncHerdFences(g);
    assert.equal(ret, undefined);
    verifyNodeState(unplaced, sc.nodeStates.unplaced, 'unplaced');
    verifyNodeState(noneNode, sc.nodeStates.noneNode, 'noneNode');
  });

  it('AG_unplaced_graph_eligible_top_panic', () => {
    const sc = reference.scenarios.AG_unplaced_graph_eligible_top_panic;
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const top = new Node(2n, 10, 10);
    top.TopLeft = new Point(20, 30);
    top.HerdAssignment = new HerdAssignment();
    top.HerdAssignment.Orientation = Orientation.Top;
    top.HerdAssignment.Val = 555.0;

    g.addNode(unplaced);
    g.addNode(top);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
    verifyNodeState(top, sc.nodeStates.top, 'top');
  });

  it('AH_unplaced_graph_eligible_bottom_panic', () => {
    const sc = reference.scenarios.AH_unplaced_graph_eligible_bottom_panic;
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const bottom = new Node(2n, 10, 10);
    bottom.TopLeft = new Point(20, 30);
    bottom.HerdAssignment = new HerdAssignment();
    bottom.HerdAssignment.Orientation = Orientation.Bottom;
    bottom.HerdAssignment.Val = 666.0;

    g.addNode(unplaced);
    g.addNode(bottom);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
    verifyNodeState(bottom, sc.nodeStates.bottom, 'bottom');
  });

  it('AI_unplaced_graph_eligible_left_panic', () => {
    const sc = reference.scenarios.AI_unplaced_graph_eligible_left_panic;
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const left = new Node(2n, 10, 10);
    left.TopLeft = new Point(20, 30);
    left.HerdAssignment = new HerdAssignment();
    left.HerdAssignment.Orientation = Orientation.Left;
    left.HerdAssignment.Val = 777.0;

    g.addNode(unplaced);
    g.addNode(left);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
    verifyNodeState(left, sc.nodeStates.left, 'left');
  });

  it('AJ_unplaced_graph_eligible_right_panic', () => {
    const sc = reference.scenarios.AJ_unplaced_graph_eligible_right_panic;
    const g = new Graph();
    const unplaced = new Node(1n, 10, 10);

    const right = new Node(2n, 10, 10);
    right.TopLeft = new Point(20, 30);
    right.HerdAssignment = new HerdAssignment();
    right.HerdAssignment.Orientation = Orientation.Right;
    right.HerdAssignment.Val = 888.0;

    g.addNode(unplaced);
    g.addNode(right);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
    verifyNodeState(right, sc.nodeStates.right, 'right');
  });

  it('AK_graph_nodes_contains_nil', () => {
    const sc = reference.scenarios.AK_graph_nodes_contains_nil;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Top;
    n.HerdAssignment.Val = 999.0;

    g.Nodes.push(n, null);

    assert.throws(() => {
      syncHerdFences(g);
    }, TypeError);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });

  it('AL_multiple_assigned_nodes_identity_and_pairs', () => {
    const sc = reference.scenarios.AL_multiple_assigned_nodes_identity_and_pairs;
    const g = new Graph();
    const n1 = new Node(1n, 10, 10);
    n1.TopLeft = new Point(20, 30);
    n1.HerdAssignment = new HerdAssignment();
    n1.HerdAssignment.Orientation = Orientation.Top;

    const n2 = new Node(2n, 10, 10);
    n2.TopLeft = new Point(50, 60);
    n2.HerdAssignment = new HerdAssignment();
    n2.HerdAssignment.Orientation = Orientation.Bottom;

    const u = new Node(3n, 5, 5);
    n1.HerdAssignment.PairSameSide(u);
    n2.HerdAssignment.PairOppositeSide(u);

    g.addNode(n1);
    g.addNode(n2);

    syncHerdFences(g);
    verifyNodeState(n1, sc.nodeStates.n1, 'n1');
    verifyNodeState(n2, sc.nodeStates.n2, 'n2');
  });

  it('AM_edge_label_graph_bound_plus_opposite_orientation', () => {
    const sc = reference.scenarios.AM_edge_label_graph_bound_plus_opposite_orientation;
    const g = new Graph();
    const leftNode = new Node(1n, 20, 20);
    leftNode.TopLeft = new Point(20, 50);
    leftNode.HerdAssignment = new HerdAssignment();
    leftNode.HerdAssignment.Orientation = Orientation.Left;

    const rightNode = new Node(2n, 20, 20);
    rightNode.TopLeft = new Point(80, 50);
    rightNode.HerdAssignment = new HerdAssignment();
    rightNode.HerdAssignment.Orientation = Orientation.Right;

    g.addNode(leftNode);
    g.addNode(rightNode);

    const e = new Edge(leftNode, rightNode);
    e.Points = [new Point(40, 60), new Point(80, 60)];
    e.Label = new Label('huge-label', 100, 40);
    e.Label.Position = LabelPosition.InsideMiddleRight;
    g.addEdge(e);

    syncHerdFences(g);
    verifyNodeState(leftNode, sc.nodeStates.left, 'left');
    verifyNodeState(rightNode, sc.nodeStates.right, 'right');
  });

  it('AN_repeated_call_stable_when_geometry_unchanged', () => {
    const sc = reference.scenarios.AN_repeated_call_stable_when_geometry_unchanged;
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    n.TopLeft = new Point(20, 30);
    n.HerdAssignment = new HerdAssignment();
    n.HerdAssignment.Orientation = Orientation.Right;
    g.addNode(n);

    // First sync
    syncHerdFences(g);
    // Second sync immediately without geometry change
    syncHerdFences(g);
    verifyNodeState(n, sc.nodeStates.n, 'n');
  });
});
