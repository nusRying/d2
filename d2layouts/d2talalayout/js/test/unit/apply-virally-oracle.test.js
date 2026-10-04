import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Node } from '../../src/graph/node.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { Orientation, orientationToString } from '../../src/geometry/orientation.js';
import { applyVirally } from '../../src/proximity/herding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(__dirname, '..', 'fixtures', 'go-apply-virally-reference.json');
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

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

describe('ApplyVirally Go Oracle Replay', () => {
  const scenarios = reference.scenarios;

  // A. empty herdOrder
  it('A_empty_herd_order', () => {
    const expected = scenarios.A_empty_herd_order;
    assert.equal(expected.success, true);
    assert.doesNotThrow(() => applyVirally({}, [], new Map()));
  });

  // B. nil herdOrder
  it('B_nil_herd_order', () => {
    const expected = scenarios.B_nil_herd_order;
    assert.equal(expected.success, true);
    assert.doesNotThrow(() => applyVirally({}, null, new Map()));
  });

  // C. pre-cancelled + empty herdOrder
  it('C_precanceled_empty_order', () => {
    const expected = scenarios.C_precanceled_empty_order;
    assert.equal(expected.success, false);
    const ctx = new CancelAfterChecks(0);
    assert.throws(
      () => applyVirally(ctx, [], new Map()),
      (err) => err.message === expected.error
    );
  });

  // D. nil context + empty herdOrder -> natural failure
  it('D_nil_context_empty_order', () => {
    const expected = scenarios.D_nil_context_empty_order;
    assert.equal(expected.success, false);
    assert.throws(() => applyVirally(null, [], new Map()), TypeError);
  });

  // E. nil herds map + one uncle
  it('E_nil_herds_map_one_uncle', () => {
    const expected = scenarios.E_nil_herds_map_one_uncle;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    assert.doesNotThrow(() => applyVirally({}, [uncle], null));
  });

  // F. missing uncle key
  it('F_missing_uncle_key', () => {
    const expected = scenarios.F_missing_uncle_key;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const herds = new Map();
    assert.doesNotThrow(() => applyVirally({}, [uncle], herds));
  });

  // G. nil uncle missing key
  it('G_nil_uncle_missing_key', () => {
    const expected = scenarios.G_nil_uncle_missing_key;
    assert.equal(expected.success, true);
    const herds = new Map();
    assert.doesNotThrow(() => applyVirally({}, [null], herds));
  });

  // H. all nodes nil HerdAssignment
  it('H_all_nodes_nil_assignment', () => {
    const expected = scenarios.H_all_nodes_nil_assignment;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // I. all nodes Orientation.NONE
  it('I_all_nodes_none_assignment', () => {
    const expected = scenarios.I_all_nodes_none_assignment;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.NONE;
    const b = new Node(3);
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.NONE;
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // J. mixed nil + NONE, no known source
  it('J_mixed_nil_and_none', () => {
    const expected = scenarios.J_mixed_nil_and_none;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    const b = new Node(3);
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.NONE;
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // K. simple propagation
  it('K_simple_propagation', () => {
    const expected = scenarios.K_simple_propagation;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // L. propagation copies Val
  it('L_propagation_copies_val', () => {
    const expected = scenarios.L_propagation_copies_val;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Top;
    a.HerdAssignment.Val = 123.456;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // M. propagation copies same-side pair set
  it('M_propagation_copies_same_side_pairs', () => {
    const expected = scenarios.M_propagation_copies_same_side_pairs;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const pairedNode = new Node(99);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Bottom;
    a.HerdAssignment.PairSameSide(pairedNode);
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // N. propagation copies opposite-side pair set
  it('N_propagation_copies_opposite_side_pairs', () => {
    const expected = scenarios.N_propagation_copies_opposite_side_pairs;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const oppNode = new Node(98);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Right;
    a.HerdAssignment.PairOppositeSide(oppNode);
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // O. two nil targets get independent copies
  it('O_two_nil_targets_get_independent_copies', () => {
    const expected = scenarios.O_two_nil_targets_get_independent_copies;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);
    const c = new Node(4);
    const herds = new Map([[uncle, [a, b, c]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b, c }, expected.nodeStates);
  });

  // P. existing same-orientation assignment unchanged
  it('P_existing_same_orientation_unchanged', () => {
    const expected = scenarios.P_existing_same_orientation_unchanged;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    a.HerdAssignment.Val = 100;
    const b = new Node(3);
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.Left;
    b.HerdAssignment.Val = 200;
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // Q. existing NONE assignment remains NONE
  it('Q_existing_none_remains_none', () => {
    const expected = scenarios.Q_existing_none_remains_none;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);
    b.HerdAssignment = new HerdAssignment();
    b.HerdAssignment.Orientation = Orientation.NONE;
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // R. default new HerdAssignment / TopLeft acts as source
  it('R_default_new_assignment_topleft_source', () => {
    const expected = scenarios.R_default_new_assignment_topleft_source;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment(); // defaults to TopLeft
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // S. diagonal known orientation propagates
  it('S_diagonal_known_orientation', () => {
    const expected = scenarios.S_diagonal_known_orientation;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.TopRight;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // T. unknown non-NONE orientation integer propagates
  it('T_unknown_orientation_int', () => {
    const expected = scenarios.T_unknown_orientation_int;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = 99;
    const b = new Node(3);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // U. direct conflicting orientations
  it('U_direct_conflicting_orientations', () => {
    const expected = scenarios.U_direct_conflicting_orientations;
    assert.equal(expected.success, false);
    const uncle = new Node(1);
    const left = new Node(2);
    left.HerdAssignment = new HerdAssignment();
    left.HerdAssignment.Orientation = Orientation.Left;
    const right = new Node(3);
    right.HerdAssignment = new HerdAssignment();
    right.HerdAssignment.Orientation = Orientation.Right;
    const herds = new Map([[uncle, [left, right]]]);

    assert.throws(
      () => applyVirally({}, [uncle], herds),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ left, right }, expected.nodeStates);
  });

  // V. conflict uses D2ID
  it('V_conflict_uses_d2id', () => {
    const expected = scenarios.V_conflict_uses_d2id;
    assert.equal(expected.success, false);
    const uncle = new Node(1);
    const left = new Node(2);
    left.HerdAssignment = new HerdAssignment();
    left.HerdAssignment.Orientation = Orientation.Left;
    const right = new Node(3);
    right.D2ID = 'conflict.node';
    right.HerdAssignment = new HerdAssignment();
    right.HerdAssignment.Orientation = Orientation.Right;
    const herds = new Map([[uncle, [left, right]]]);

    assert.throws(
      () => applyVirally({}, [uncle], herds),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ left, right }, expected.nodeStates);
  });

  // W. reversed conflicting node order
  it('W_reversed_conflicting_node_order', () => {
    const expected = scenarios.W_reversed_conflicting_node_order;
    assert.equal(expected.success, false);
    const uncle = new Node(1);
    const right = new Node(3);
    right.HerdAssignment = new HerdAssignment();
    right.HerdAssignment.Orientation = Orientation.Right;
    const left = new Node(2);
    left.HerdAssignment = new HerdAssignment();
    left.HerdAssignment.Orientation = Orientation.Left;
    const herds = new Map([[uncle, [right, left]]]);

    assert.throws(
      () => applyVirally({}, [uncle], herds),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ left, right }, expected.nodeStates);
  });

  // X. nil target BEFORE later conflict
  it('X_nil_target_before_later_conflict', () => {
    const expected = scenarios.X_nil_target_before_later_conflict;
    assert.equal(expected.success, false);
    const uncle = new Node(1);
    const nilTarget = new Node(10);
    const left = new Node(20);
    left.HerdAssignment = new HerdAssignment();
    left.HerdAssignment.Orientation = Orientation.Left;
    const right = new Node(30);
    right.HerdAssignment = new HerdAssignment();
    right.HerdAssignment.Orientation = Orientation.Right;
    const herds = new Map([[uncle, [nilTarget, left, right]]]);

    assert.throws(
      () => applyVirally({}, [uncle], herds),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ nilTarget, left, right }, expected.nodeStates);
  });

  // Y. two groups; first mutates, cancellation before second
  it('Y_partial_mutation_before_cancellation', () => {
    const expected = scenarios.Y_partial_mutation_before_cancellation;
    assert.equal(expected.success, false);
    const u1 = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);

    const u2 = new Node(4);
    const c = new Node(5);
    c.HerdAssignment = new HerdAssignment();
    c.HerdAssignment.Orientation = Orientation.Right;
    const d = new Node(6);

    const herds = new Map([
      [u1, [a, b]],
      [u2, [c, d]],
    ]);

    const ctx = new CancelAfterChecks(2);
    assert.throws(
      () => applyVirally(ctx, [u1, u2], herds),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ a, b, c, d }, expected.nodeStates);
  });

  // Z. cancellation after successful propagation before stability pass
  it('Z_cancellation_after_propagation_before_stability', () => {
    const expected = scenarios.Z_cancellation_after_propagation_before_stability;
    assert.equal(expected.success, false);
    const uncle = new Node(1);
    const a = new Node(2);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(3);

    const herds = new Map([[uncle, [a, b]]]);

    const ctx = new CancelAfterChecks(2);
    assert.throws(
      () => applyVirally(ctx, [uncle], herds),
      (err) => err.message === expected.error
    );
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // AA. chained virality requiring multiple passes (reverse order: [u2, u1])
  it('AA_chained_virality_multiple_passes', () => {
    const expected = scenarios.AA_chained_virality_multiple_passes;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);

    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(20);
    const c = new Node(30);

    const herds = new Map([
      [u1, [a, b]],
      [u2, [b, c]],
    ]);

    applyVirally({}, [u2, u1], herds);
    verifyNodeStates({ a, b, c }, expected.nodeStates);
  });

  // AB. same-pass chaining with order [u1, u2]
  it('AB_same_pass_chaining', () => {
    const expected = scenarios.AB_same_pass_chaining;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);

    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(20);
    const c = new Node(30);

    const herds = new Map([
      [u1, [a, b]],
      [u2, [b, c]],
    ]);

    applyVirally({}, [u1, u2], herds);
    verifyNodeStates({ a, b, c }, expected.nodeStates);
  });

  // AC. group with nil node member -> natural failure
  it('AC_group_with_nil_node', () => {
    const expected = scenarios.AC_group_with_nil_node;
    assert.equal(expected.success, false);
    const uncle = new Node(1);
    const herds = new Map([[uncle, [null]]]);
    assert.throws(() => applyVirally({}, [uncle], herds), TypeError);
  });

  // AD. null uncle key present in herds
  it('AD_null_uncle_key_present', () => {
    const expected = scenarios.AD_null_uncle_key_present;
    assert.equal(expected.success, true);
    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Top;
    const b = new Node(20);

    const herds = new Map([[null, [a, b]]]);
    applyVirally({}, [null], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // AE. duplicate uncle in herdOrder
  it('AE_duplicate_uncle_in_order', () => {
    const expected = scenarios.AE_duplicate_uncle_in_order;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Bottom;
    const b = new Node(20);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle, uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // AF. duplicate node in a herd group
  it('AF_duplicate_node_in_herd', () => {
    const expected = scenarios.AF_duplicate_node_in_herd;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Left;
    const b = new Node(20);
    const herds = new Map([[uncle, [a, b, b]]]);
    applyVirally({}, [uncle], herds);
    verifyNodeStates({ a, b }, expected.nodeStates);
  });

  // AG. empty node slice for uncle
  it('AG_empty_node_slice_for_uncle', () => {
    const expected = scenarios.AG_empty_node_slice_for_uncle;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const herds = new Map([[uncle, []]]);
    assert.doesNotThrow(() => applyVirally({}, [uncle], herds));
  });

  // AH. repeated invocation on already-stable result
  it('AH_repeated_invocation_stable', () => {
    const expected = scenarios.AH_repeated_invocation_stable;
    assert.equal(expected.success, true);
    const uncle = new Node(1);
    const a = new Node(10);
    a.HerdAssignment = new HerdAssignment();
    a.HerdAssignment.Orientation = Orientation.Right;
    const b = new Node(20);
    const herds = new Map([[uncle, [a, b]]]);
    applyVirally({}, [uncle], herds);
    const bAssign1 = b.HerdAssignment;
    applyVirally({}, [uncle], herds);
    const bAssign2 = b.HerdAssignment;
    assert.equal(bAssign1, bAssign2, 'Repeated call should not replace existing assignments');
    verifyNodeStates({ a, b }, expected.nodeStates);
  });
});
