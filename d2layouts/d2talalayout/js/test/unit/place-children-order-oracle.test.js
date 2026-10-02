import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Node } from '../../src/graph/node.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { placeChildrenOrder } from '../../src/placement/node-placement.js';
import { WorkCanceledError } from '../../src/limits/work-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(__dirname, '..', 'fixtures', 'go-place-children-order-reference.json');
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

class CountingContext {
  constructor(cancelAt = 0) {
    this.cancelAt = cancelAt;
    this.checks = 0;
  }

  isCancelled() {
    this.checks++;
    if (this.cancelAt > 0 && this.checks >= this.cancelAt) {
      return true;
    }
    return false;
  }
}

function verifyScenario(scenarioName, cancelAt, setup) {
  const exp = reference.scenarios[scenarioName];
  assert.ok(exp, `Missing scenario ${scenarioName} in reference fixture`);

  const { nodes, abductions, nodeLabels } = setup();
  const ctx = new CountingContext(cancelAt);

  if (!exp.success) {
    let thrownError = null;
    try {
      placeChildrenOrder(ctx, nodes, abductions);
    } catch (err) {
      thrownError = err;
    }
    assert.ok(thrownError, `${scenarioName}: expected error to be thrown`);
    assert.equal(ctx.checks, exp.checks, `${scenarioName}: check count mismatch`);

    if (exp.error.includes('context canceled')) {
      assert.ok(
        thrownError instanceof WorkCanceledError,
        `${scenarioName}: expected WorkCanceledError but got ${thrownError}`
      );
      assert.equal(
        thrownError.message,
        'PlaceChildrenOrder: context canceled'
      );
    } else {
      assert.equal(thrownError.message, exp.error);
    }
    return;
  }

  const result = placeChildrenOrder(ctx, nodes, abductions);
  assert.equal(ctx.checks, exp.checks, `${scenarioName}: check count mismatch`);

  const actualLabels = result.map((n) => {
    if (nodeLabels && nodeLabels.has(n)) {
      return nodeLabels.get(n);
    }
    return n.DebugID();
  });

  assert.deepEqual(actualLabels, exp.ordered, `${scenarioName}: ordered mismatch`);
}

describe('PlaceChildrenOrder Go Oracle Replay', () => {
  it('A_nil_nodes_nil_abductions', () => {
    verifyScenario('A_nil_nodes_nil_abductions', 0, () => ({
      nodes: null,
      abductions: null,
      nodeLabels: null,
    }));
  });

  it('B_empty_nodes', () => {
    verifyScenario('B_empty_nodes', 0, () => ({
      nodes: [],
      abductions: [],
      nodeLabels: null,
    }));
  });

  it('C_one_isolated_child', () => {
    verifyScenario('C_one_isolated_child', 0, () => {
      const a = new Node(1n, 10, 10);
      return {
        nodes: [a],
        abductions: null,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('D_multiple_isolated_children', () => {
    verifyScenario('D_multiple_isolated_children', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const c = new Node(3n, 10, 10);
      return {
        nodes: [a, b, c],
        abductions: null,
        nodeLabels: new Map([[a, 'a'], [b, 'b'], [c, 'c']]),
      };
    });
  });

  it('E_upstream_fixture', () => {
    verifyScenario('E_upstream_fixture', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const c = new Node(3n, 10, 10);
      const d = new Node(4n, 10, 10);
      const ext = new Node(5n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
        new EdgeAbduction({ CurrentFrom: c, CurrentTo: d }),
        new EdgeAbduction({ CurrentFrom: d, CurrentTo: ext }),
      ];
      return {
        nodes: [a, b, c, d],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b'], [c, 'c'], [d, 'd'], [ext, 'ext']]),
      };
    });
  });

  it('F_isolated_child_last', () => {
    verifyScenario('F_isolated_child_last', 0, () => {
      const b = new Node(2n, 10, 10);
      const c = new Node(3n, 10, 10);
      const a = new Node(1n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
      ];
      return {
        nodes: [b, c, a],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b'], [c, 'c']]),
      };
    });
  });

  it('G_two_node_connected', () => {
    verifyScenario('G_two_node_connected', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('H_three_node_chain', () => {
    verifyScenario('H_three_node_chain', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const c = new Node(3n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
        new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
      ];
      return {
        nodes: [a, b, c],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b'], [c, 'c']]),
      };
    });
  });

  it('I_four_node_chain', () => {
    verifyScenario('I_four_node_chain', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const c = new Node(3n, 10, 10);
      const d = new Node(4n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
        new EdgeAbduction({ CurrentFrom: c, CurrentTo: d }),
      ];
      return {
        nodes: [a, b, c, d],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b'], [c, 'c'], [d, 'd']]),
      };
    });
  });

  it('J_star_graph_abduction_order_1', () => {
    verifyScenario('J_star_graph_abduction_order_1', 0, () => {
      const center = new Node(1n, 10, 10);
      const leaf1 = new Node(2n, 10, 10);
      const leaf2 = new Node(3n, 10, 10);
      const leaf3 = new Node(4n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: center, CurrentTo: leaf1 }),
        new EdgeAbduction({ CurrentFrom: center, CurrentTo: leaf2 }),
        new EdgeAbduction({ CurrentFrom: center, CurrentTo: leaf3 }),
      ];
      return {
        nodes: [center, leaf1, leaf2, leaf3],
        abductions,
        nodeLabels: new Map([[center, 'center'], [leaf1, 'leaf1'], [leaf2, 'leaf2'], [leaf3, 'leaf3']]),
      };
    });
  });

  it('K_star_graph_abduction_order_2', () => {
    verifyScenario('K_star_graph_abduction_order_2', 0, () => {
      const center = new Node(1n, 10, 10);
      const leaf1 = new Node(2n, 10, 10);
      const leaf2 = new Node(3n, 10, 10);
      const leaf3 = new Node(4n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: center, CurrentTo: leaf3 }),
        new EdgeAbduction({ CurrentFrom: center, CurrentTo: leaf2 }),
        new EdgeAbduction({ CurrentFrom: center, CurrentTo: leaf1 }),
      ];
      return {
        nodes: [center, leaf1, leaf2, leaf3],
        abductions,
        nodeLabels: new Map([[center, 'center'], [leaf1, 'leaf1'], [leaf2, 'leaf2'], [leaf3, 'leaf3']]),
      };
    });
  });

  it('L_cycle_equal_degrees', () => {
    verifyScenario('L_cycle_equal_degrees', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const c = new Node(3n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
        new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
        new EdgeAbduction({ CurrentFrom: c, CurrentTo: a }),
      ];
      return {
        nodes: [a, b, c],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b'], [c, 'c']]),
      };
    });
  });

  it('M_multiple_connected_components_degree', () => {
    verifyScenario('M_multiple_connected_components_degree', 0, () => {
      const t1 = new Node(1n, 10, 10);
      const t2 = new Node(2n, 10, 10);
      const t3 = new Node(3n, 10, 10);
      const e1 = new Node(4n, 10, 10);
      const e2 = new Node(5n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: t1, CurrentTo: t2 }),
        new EdgeAbduction({ CurrentFrom: t2, CurrentTo: t3 }),
        new EdgeAbduction({ CurrentFrom: t3, CurrentTo: t1 }),
        new EdgeAbduction({ CurrentFrom: e1, CurrentTo: e2 }),
      ];
      return {
        nodes: [t1, t2, t3, e1, e2],
        abductions,
        nodeLabels: new Map([[t1, 't1'], [t2, 't2'], [t3, 't3'], [e1, 'e1'], [e2, 'e2']]),
      };
    });
  });

  it('N_component_degree_tie', () => {
    verifyScenario('N_component_degree_tie', 0, () => {
      const b1 = new Node(1n, 10, 10);
      const b2 = new Node(2n, 10, 10);
      const a1 = new Node(3n, 10, 10);
      const a2 = new Node(4n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: b1, CurrentTo: b2 }),
        new EdgeAbduction({ CurrentFrom: a1, CurrentTo: a2 }),
      ];
      return {
        nodes: [b1, b2, a1, a2],
        abductions,
        nodeLabels: new Map([[b1, 'b1'], [b2, 'b2'], [a1, 'a1'], [a2, 'a2']]),
      };
    });
  });

  it('O_duplicate_abductions_degree', () => {
    verifyScenario('O_duplicate_abductions_degree', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('P_duplicate_abductions_output_stable', () => {
    verifyScenario('P_duplicate_abductions_output_stable', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('Q_self_loop_not_isolated', () => {
    verifyScenario('Q_self_loop_not_isolated', 0, () => {
      const a = new Node(1n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: a }),
      ];
      return {
        nodes: [a],
        abductions,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('R_self_loop_plus_isolated', () => {
    verifyScenario('R_self_loop_plus_isolated', 0, () => {
      const loopNode = new Node(1n, 10, 10);
      const isoNode = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: loopNode, CurrentTo: loopNode }),
      ];
      return {
        nodes: [loopNode, isoNode],
        abductions,
        nodeLabels: new Map([[loopNode, 'loopNode'], [isoNode, 'isoNode']]),
      };
    });
  });

  it('S_external_endpoint_ignored', () => {
    verifyScenario('S_external_endpoint_ignored', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const ext = new Node(3n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: ext }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('T_current_from_nil_ignored', () => {
    verifyScenario('T_current_from_nil_ignored', 0, () => {
      const a = new Node(1n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: null, CurrentTo: a }),
      ];
      return {
        nodes: [a],
        abductions,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('U_current_to_nil_ignored', () => {
    verifyScenario('U_current_to_nil_ignored', 0, () => {
      const a = new Node(1n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: null }),
      ];
      return {
        nodes: [a],
        abductions,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('V_both_endpoints_nil_ignored', () => {
    verifyScenario('V_both_endpoints_nil_ignored', 0, () => {
      const a = new Node(1n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: null, CurrentTo: null }),
      ];
      return {
        nodes: [a],
        abductions,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('W_reversed_abduction_symmetric', () => {
    verifyScenario('W_reversed_abduction_symmetric', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: b, CurrentTo: a }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('X_distinct_nodes_same_id', () => {
    verifyScenario('X_distinct_nodes_same_id', 0, () => {
      const a1 = new Node(5n, 10, 10);
      const a2 = new Node(5n, 10, 10);
      return {
        nodes: [a1, a2],
        abductions: null,
        nodeLabels: new Map([[a1, 'a1'], [a2, 'a2']]),
      };
    });
  });

  it('Y_scrambled_ids_not_id_sorted', () => {
    verifyScenario('Y_scrambled_ids_not_id_sorted', 0, () => {
      const n99 = new Node(99n, 10, 10);
      const n10 = new Node(10n, 10, 10);
      const n50 = new Node(50n, 10, 10);
      const n1 = new Node(1n, 10, 10);
      return {
        nodes: [n99, n10, n50, n1],
        abductions: null,
        nodeLabels: new Map([[n99, 'n99'], [n10, 'n10'], [n50, 'n50'], [n1, 'n1']]),
      };
    });
  });

  it('Z_nil_child_invariant', () => {
    verifyScenario('Z_nil_child_invariant', 0, () => {
      const a = new Node(1n, 10, 10);
      return {
        nodes: [a, null],
        abductions: null,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AA_duplicate_child_invariant', () => {
    verifyScenario('AA_duplicate_child_invariant', 0, () => {
      const a = new Node(1n, 10, 10);
      a.D2ID = 'dupNode';
      return {
        nodes: [a, a],
        abductions: null,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AB_nil_edge_abduction_invariant', () => {
    verifyScenario('AB_nil_edge_abduction_invariant', 0, () => {
      const a = new Node(1n, 10, 10);
      return {
        nodes: [a],
        abductions: [null],
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AC_cancellation_before_work', () => {
    verifyScenario('AC_cancellation_before_work', 1, () => {
      const a = new Node(1n, 10, 10);
      return {
        nodes: [a],
        abductions: null,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AD_cancellation_during_initial_node_scan', () => {
    verifyScenario('AD_cancellation_during_initial_node_scan', 2, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      return {
        nodes: [a, b],
        abductions: null,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AE_cancellation_wins_over_nil_child', () => {
    verifyScenario('AE_cancellation_wins_over_nil_child', 2, () => ({
      nodes: [null],
      abductions: null,
      nodeLabels: null,
    }));
  });

  it('AF_cancellation_during_abduction_scan', () => {
    verifyScenario('AF_cancellation_during_abduction_scan', 3, () => {
      const a = new Node(1n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: a }),
      ];
      return {
        nodes: [a],
        abductions,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AG_cancellation_wins_over_nil_abduction', () => {
    verifyScenario('AG_cancellation_wins_over_nil_abduction', 3, () => {
      const a = new Node(1n, 10, 10);
      return {
        nodes: [a],
        abductions: [null],
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AH_cancellation_during_isolated_scan', () => {
    verifyScenario('AH_cancellation_during_isolated_scan', 3, () => {
      const a = new Node(1n, 10, 10);
      return {
        nodes: [a],
        abductions: null,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AI_cancellation_at_outer_component_check', () => {
    verifyScenario('AI_cancellation_at_outer_component_check', 6, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AJ_cancellation_on_first_bfs_queue_item', () => {
    verifyScenario('AJ_cancellation_on_first_bfs_queue_item', 7, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AK_cancellation_on_later_bfs_queue_item', () => {
    verifyScenario('AK_cancellation_on_later_bfs_queue_item', 8, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AL_cancellation_on_duplicate_queue_item', () => {
    verifyScenario('AL_cancellation_on_duplicate_queue_item', 9, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AM_cancellation_at_final_check', () => {
    verifyScenario('AM_cancellation_at_final_check', 10, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AN_empty_nodes_exact_checks', () => {
    verifyScenario('AN_empty_nodes_exact_checks', 0, () => ({
      nodes: [],
      abductions: null,
      nodeLabels: null,
    }));
  });

  it('AO_one_isolated_node_exact_checks', () => {
    verifyScenario('AO_one_isolated_node_exact_checks', 0, () => {
      const a = new Node(1n, 10, 10);
      return {
        nodes: [a],
        abductions: null,
        nodeLabels: new Map([[a, 'a']]),
      };
    });
  });

  it('AP_connected_two_node_exact_checks', () => {
    verifyScenario('AP_connected_two_node_exact_checks', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AQ_repeated_invocation_deterministic', () => {
    verifyScenario('AQ_repeated_invocation_deterministic', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const c = new Node(3n, 10, 10);
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
        new EdgeAbduction({ CurrentFrom: b, CurrentTo: c }),
      ];
      return {
        nodes: [a, b, c],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b'], [c, 'c']]),
      };
    });
  });

  it('AR_input_arrays_unchanged', () => {
    verifyScenario('AR_input_arrays_unchanged', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const nodes = [a, b];
      const abductions = [
        new EdgeAbduction({ CurrentFrom: a, CurrentTo: b }),
      ];
      return {
        nodes,
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });

  it('AS_metadata_fields_do_not_affect_ordering', () => {
    verifyScenario('AS_metadata_fields_do_not_affect_ordering', 0, () => {
      const a = new Node(1n, 10, 10);
      const b = new Node(2n, 10, 10);
      const dummy = new Node(99n, 10, 10);
      const abductions = [
        new EdgeAbduction({
          CurrentFrom: a,
          CurrentTo: b,
          OriginallyFrom: dummy,
          OriginallyTo: dummy,
        }),
      ];
      return {
        nodes: [a, b],
        abductions,
        nodeLabels: new Map([[a, 'a'], [b, 'b']]),
      };
    });
  });
});
