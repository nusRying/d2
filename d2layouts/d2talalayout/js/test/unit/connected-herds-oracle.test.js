import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Node } from '../../src/graph/node.js';
import { connectedHerds } from '../../src/proximity/herding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(__dirname, '..', 'fixtures', 'go-connected-herds-reference.json');
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

function verifyComponents(actual, expected, labels) {
  if (expected === null) {
    assert.equal(actual, null, 'Components should be null');
    return;
  }

  assert.ok(Array.isArray(actual), 'Components should be an array');
  assert.equal(actual.length, expected.length, 'Component count mismatch');

  for (let c = 0; c < expected.length; c++) {
    const actComp = actual[c];
    const expComp = expected[c];

    // Uncles
    if (expComp.uncles === null) {
      assert.equal(actComp.uncles, null, `Component ${c} uncles should be null`);
    } else {
      assert.ok(Array.isArray(actComp.uncles), `Component ${c} uncles should be array`);
      assert.equal(actComp.uncles.length, expComp.uncles.length, `Component ${c} uncle count mismatch`);
      for (let u = 0; u < expComp.uncles.length; u++) {
        const expUncleLabel = expComp.uncles[u];
        const actUncle = actComp.uncles[u];
        if (expUncleLabel === null) {
          assert.equal(actUncle, null, `Component ${c} uncle ${u} should be null`);
        } else {
          const actLabel = labels.get(actUncle);
          assert.equal(actLabel, expUncleLabel, `Component ${c} uncle ${u} mismatch: got ${actLabel}, expected ${expUncleLabel}`);
        }
      }
    }

    // Nodes
    if (expComp.nodes === null) {
      assert.equal(actComp.nodes, null, `Component ${c} nodes should be null`);
    } else {
      assert.ok(Array.isArray(actComp.nodes), `Component ${c} nodes should be array`);
      assert.equal(actComp.nodes.length, expComp.nodes.length, `Component ${c} node count mismatch`);
      for (let n = 0; n < expComp.nodes.length; n++) {
        const expNodeLabel = expComp.nodes[n];
        const actNode = actComp.nodes[n];
        if (expNodeLabel === null) {
          assert.equal(actNode, null, `Component ${c} node ${n} should be null`);
        } else {
          const actLabel = labels.get(actNode);
          assert.equal(actLabel, expNodeLabel, `Component ${c} node ${n} mismatch: got ${actLabel}, expected ${expNodeLabel}`);
        }
      }
    }
  }
}

describe('ConnectedHerds Go Oracle Replay', () => {
  const scenarios = reference.scenarios;

  // A. nil herdOrder
  it('A_nil_herd_order', () => {
    const expected = scenarios.A_nil_herd_order;
    assert.equal(expected.success, true);
    const actual = connectedHerds({}, null, new Map());
    verifyComponents(actual, expected.components, new Map());
  });

  // B. empty herdOrder
  it('B_empty_herd_order', () => {
    const expected = scenarios.B_empty_herd_order;
    assert.equal(expected.success, true);
    const actual = connectedHerds({}, [], new Map());
    verifyComponents(actual, expected.components, new Map());
  });

  // C. pre-cancelled + empty order
  it('C_precanceled_empty_order', () => {
    const expected = scenarios.C_precanceled_empty_order;
    assert.equal(expected.success, true);
    const ctx = new CancelAfterChecks(0);
    const actual = connectedHerds(ctx, [], new Map());
    verifyComponents(actual, expected.components, new Map());
  });

  // D. nil context + empty order
  it('D_nil_context_empty_order', () => {
    const expected = scenarios.D_nil_context_empty_order;
    assert.equal(expected.success, true);
    const actual = connectedHerds(null, [], new Map());
    verifyComponents(actual, expected.components, new Map());
  });

  // E. nil context + one uncle -> natural failure
  it('E_nil_context_one_uncle', () => {
    const expected = scenarios.E_nil_context_one_uncle;
    assert.equal(expected.success, false);
    const u1 = new Node(1);
    assert.throws(() => connectedHerds(null, [u1], new Map()), TypeError);
  });

  // F. pre-cancelled + one uncle -> error
  it('F_precanceled_one_uncle', () => {
    const expected = scenarios.F_precanceled_one_uncle;
    assert.equal(expected.success, false);
    const ctx = new CancelAfterChecks(0);
    const u1 = new Node(1);
    assert.throws(
      () => connectedHerds(ctx, [u1], new Map()),
      (err) => err.message === expected.error
    );
  });

  // G. one uncle / one node
  it('G_one_uncle_one_node', () => {
    const expected = scenarios.G_one_uncle_one_node;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const a = new Node(10);
    const labels = new Map([[u1, 'u1'], [a, 'a']]);
    const herds = new Map([[u1, [a]]]);
    const actual = connectedHerds({}, [u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // H. one uncle / zero nodes
  it('H_one_uncle_zero_nodes', () => {
    const expected = scenarios.H_one_uncle_zero_nodes;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const labels = new Map([[u1, 'u1']]);
    const herds = new Map([[u1, []]]);
    const actual = connectedHerds({}, [u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // I. nil herds map / one uncle
  it('I_nil_herds_map_one_uncle', () => {
    const expected = scenarios.I_nil_herds_map_one_uncle;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const labels = new Map([[u1, 'u1']]);
    const actual = connectedHerds({}, [u1], null);
    verifyComponents(actual, expected.components, labels);
  });

  // J. missing map key
  it('J_missing_map_key', () => {
    const expected = scenarios.J_missing_map_key;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const labels = new Map([[u1, 'u1']]);
    const herds = new Map();
    const actual = connectedHerds({}, [u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // K. two disconnected uncles
  it('K_two_disconnected_uncles', () => {
    const expected = scenarios.K_two_disconnected_uncles;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const b = new Node(20);
    const labels = new Map([[u1, 'u1'], [u2, 'u2'], [a, 'a'], [b, 'b']]);
    const herds = new Map([
      [u1, [a]],
      [u2, [b]],
    ]);
    const actual = connectedHerds({}, [u1, u2], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // L. two connected uncles via shared node
  it('L_two_connected_uncles_shared_node', () => {
    const expected = scenarios.L_two_connected_uncles_shared_node;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const shared = new Node(99);
    const b = new Node(20);
    const labels = new Map([
      [u1, 'u1'], [u2, 'u2'],
      [a, 'a'], [shared, 'shared'], [b, 'b'],
    ]);
    const herds = new Map([
      [u1, [a, shared]],
      [u2, [shared, b]],
    ]);
    const actual = connectedHerds({}, [u1, u2], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // M. transitive three-uncle connection
  it('M_transitive_three_uncle_connection', () => {
    const expected = scenarios.M_transitive_three_uncle_connection;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const a = new Node(10);
    const x = new Node(91);
    const y = new Node(92);
    const z = new Node(30);
    const labels = new Map([
      [u1, 'u1'], [u2, 'u2'], [u3, 'u3'],
      [a, 'a'], [x, 'x'], [y, 'y'], [z, 'z'],
    ]);
    const herds = new Map([
      [u1, [a, x]],
      [u2, [x, y]],
      [u3, [y, z]],
    ]);
    const actual = connectedHerds({}, [u1, u2, u3], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // N. source order versus ID order
  it('N_source_order_vs_id_order', () => {
    const expected = scenarios.N_source_order_vs_id_order;
    assert.equal(expected.success, true);
    const u30 = new Node(30);
    const u10 = new Node(10);
    const u20 = new Node(20);
    const labels = new Map([[u30, 'u30'], [u10, 'u10'], [u20, 'u20']]);
    const herds = new Map([
      [u30, []],
      [u10, []],
      [u20, []],
    ]);
    const actual = connectedHerds({}, [u30, u10, u20], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // O. node source order preserved
  it('O_node_source_order_preserved', () => {
    const expected = scenarios.O_node_source_order_preserved;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const c = new Node(30);
    const a = new Node(10);
    const b = new Node(20);
    const labels = new Map([[u1, 'u1'], [c, 'c'], [a, 'a'], [b, 'b']]);
    const herds = new Map([[u1, [c, a, b]]]);
    const actual = connectedHerds({}, [u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // P. duplicate uncle in herdOrder
  it('P_duplicate_uncle_in_herd_order', () => {
    const expected = scenarios.P_duplicate_uncle_in_herd_order;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const a = new Node(10);
    const labels = new Map([[u1, 'u1'], [a, 'a']]);
    const herds = new Map([[u1, [a]]]);
    const actual = connectedHerds({}, [u1, u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // Q. duplicate node in one herd
  it('Q_duplicate_node_in_one_herd', () => {
    const expected = scenarios.Q_duplicate_node_in_one_herd;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const a = new Node(10);
    const b = new Node(20);
    const labels = new Map([[u1, 'u1'], [a, 'a'], [b, 'b']]);
    const herds = new Map([[u1, [a, a, b]]]);
    const actual = connectedHerds({}, [u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // R. duplicate node across connected herds
  it('R_duplicate_node_across_connected_herds', () => {
    const expected = scenarios.R_duplicate_node_across_connected_herds;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const b = new Node(20);
    const labels = new Map([[u1, 'u1'], [u2, 'u2'], [a, 'a'], [b, 'b']]);
    const herds = new Map([
      [u1, [a, b]],
      [u2, [b, b]],
    ]);
    const actual = connectedHerds({}, [u1, u2], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // S. null uncle missing key
  it('S_null_uncle_missing_key', () => {
    const expected = scenarios.S_null_uncle_missing_key;
    assert.equal(expected.success, true);
    const herds = new Map();
    const actual = connectedHerds({}, [null], herds);
    verifyComponents(actual, expected.components, new Map());
  });

  // T. null uncle with nodes
  it('T_null_uncle_with_nodes', () => {
    const expected = scenarios.T_null_uncle_with_nodes;
    assert.equal(expected.success, true);
    const a = new Node(10);
    const b = new Node(20);
    const labels = new Map([[a, 'a'], [b, 'b']]);
    const herds = new Map([[null, [a, b]]]);
    const actual = connectedHerds({}, [null], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // U. nil node member
  it('U_nil_node_member', () => {
    const expected = scenarios.U_nil_node_member;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const labels = new Map([[u1, 'u1']]);
    const herds = new Map([[u1, [null]]]);
    const actual = connectedHerds({}, [u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // V. nil node shared by two uncles
  it('V_nil_node_shared_by_two_uncles', () => {
    const expected = scenarios.V_nil_node_shared_by_two_uncles;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const labels = new Map([[u1, 'u1'], [u2, 'u2']]);
    const herds = new Map([
      [u1, [null]],
      [u2, [null]],
    ]);
    const actual = connectedHerds({}, [u1, u2], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // W. duplicate nil node within herd
  it('W_duplicate_nil_node_within_herd', () => {
    const expected = scenarios.W_duplicate_nil_node_within_herd;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const labels = new Map([[u1, 'u1']]);
    const herds = new Map([[u1, [null, null]]]);
    const actual = connectedHerds({}, [u1], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // X. multiple disconnected components with empty trailing component
  it('X_multiple_disconnected_with_empty_trailing', () => {
    const expected = scenarios.X_multiple_disconnected_with_empty_trailing;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const labels = new Map([[u1, 'u1'], [u2, 'u2'], [a, 'a']]);
    const herds = new Map([
      [u1, [a]],
      [u2, []],
    ]);
    const actual = connectedHerds({}, [u1, u2], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // Y. first shared node discovers multiple related uncles
  it('Y_first_shared_node_discovers_multiple_uncles', () => {
    const expected = scenarios.Y_first_shared_node_discovers_multiple_uncles;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const shared = new Node(99);
    const labels = new Map([[u1, 'u1'], [u2, 'u2'], [u3, 'u3'], [shared, 'shared']]);
    const herds = new Map([
      [u1, [shared]],
      [u2, [shared]],
      [u3, [shared]],
    ]);
    const actual = connectedHerds({}, [u1, u2, u3], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // Z. related uncle already seen
  it('Z_related_uncle_already_seen', () => {
    const expected = scenarios.Z_related_uncle_already_seen;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const a = new Node(10);
    const b = new Node(20);
    const c = new Node(30);
    const labels = new Map([
      [u1, 'u1'], [u2, 'u2'], [u3, 'u3'],
      [a, 'a'], [b, 'b'], [c, 'c'],
    ]);
    const herds = new Map([
      [u1, [a, c]],
      [u2, [a, b]],
      [u3, [b, c]],
    ]);
    const actual = connectedHerds({}, [u1, u2, u3], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // AA. duplicate herdOrder occurrences alter byNode duplicates but not component.uncles duplication
  it('AA_duplicate_herd_order_alter_by_node', () => {
    const expected = scenarios.AA_duplicate_herd_order_alter_by_node;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const labels = new Map([[u1, 'u1'], [u2, 'u2'], [a, 'a']]);
    const herds = new Map([
      [u1, [a]],
      [u2, [a]],
    ]);
    const actual = connectedHerds({}, [u1, u1, u2], herds);
    verifyComponents(actual, expected.components, labels);
  });

  // AB. cancellation after first uncle expansion in a multi-uncle connected component
  it('AB_cancellation_after_first_uncle_in_multi_uncle', () => {
    const expected = scenarios.AB_cancellation_after_first_uncle_in_multi_uncle;
    assert.equal(expected.success, false);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const shared = new Node(99);
    const herds = new Map([
      [u1, [shared]],
      [u2, [shared]],
    ]);
    const ctx = new CancelAfterChecks(1);
    assert.throws(
      () => connectedHerds(ctx, [u1, u2], herds),
      (err) => err.message === expected.error
    );
  });

  // AC. cancellation between disconnected components
  it('AC_cancellation_between_disconnected_components', () => {
    const expected = scenarios.AC_cancellation_between_disconnected_components;
    assert.equal(expected.success, false);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const a = new Node(10);
    const b = new Node(20);
    const herds = new Map([
      [u1, [a]],
      [u2, [b]],
    ]);
    const ctx = new CancelAfterChecks(1);
    assert.throws(
      () => connectedHerds(ctx, [u1, u2], herds),
      (err) => err.message === expected.error
    );
  });

  // AD. repeated call
  it('AD_repeated_call', () => {
    const expected = scenarios.AD_repeated_call;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const a = new Node(10);
    const labels = new Map([[u1, 'u1'], [a, 'a']]);
    const herds = new Map([[u1, [a]]]);
    const actual1 = connectedHerds({}, [u1], herds);
    const actual2 = connectedHerds({}, [u1], herds);
    assert.notEqual(actual1, actual2);
    verifyComponents(actual2, expected.components, labels);
  });

  // AE. discriminating FIFO topology
  it('AE_discriminating_fifo_topology', () => {
    const expected = scenarios.AE_discriminating_fifo_topology;
    assert.equal(expected.success, true);
    const u1 = new Node(1);
    const u2 = new Node(2);
    const u3 = new Node(3);
    const a = new Node(10);
    const x = new Node(91);
    const y = new Node(92);
    const b = new Node(20);
    const c = new Node(30);
    const labels = new Map([
      [u1, 'u1'], [u2, 'u2'], [u3, 'u3'],
      [a, 'a'], [x, 'x'], [y, 'y'], [b, 'b'], [c, 'c'],
    ]);
    const herds = new Map([
      [u1, [a, x, y]],
      [u2, [x, b]],
      [u3, [y, c]],
    ]);
    const actual = connectedHerds({}, [u1, u2, u3], herds);
    verifyComponents(actual, expected.components, labels);
  });
});
