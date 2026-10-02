import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Node, nodeDebugID } from '../../src/graph/node.js';
import { Cluster, clusterDebugID } from '../../src/graph/cluster.js';
import { Sequence, sequenceDebugID } from '../../src/graph/sequence.js';
import { Graph } from '../../src/graph/graph.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const referencePath = path.join(__dirname, '..', 'fixtures', 'go-debug-ids-reference.json');
const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

describe('DebugID Go Oracle Replay', () => {
  const scenarios = reference.scenarios;

  // A. nil node
  it('A_nil_node', () => {
    const expected = scenarios.A_nil_node;
    assert.equal(expected.success, true);
    assert.equal(nodeDebugID(null), expected.output);
    assert.equal(nodeDebugID(undefined), expected.output);
  });

  // B. zero ID
  it('B_zero_id', () => {
    const expected = scenarios.B_zero_id;
    const n = new Node(0);
    assert.equal(n.DebugID(), expected.output);
    assert.equal(n.debugID(), expected.output);
  });

  // C. positive ID
  it('C_positive_id', () => {
    const expected = scenarios.C_positive_id;
    const n = new Node(42);
    assert.equal(n.DebugID(), expected.output);
    assert.equal(n.debugID(), expected.output);
  });

  // D. negative ID
  it('D_negative_id', () => {
    const expected = scenarios.D_negative_id;
    const n = new Node(-42);
    assert.equal(n.DebugID(), expected.output);
  });

  // E. INT64_MAX
  it('E_int64_max', () => {
    const expected = scenarios.E_int64_max;
    const n = new Node(9223372036854775807n);
    assert.equal(n.DebugID(), expected.output);
  });

  // F. INT64_MIN
  it('F_int64_min', () => {
    const expected = scenarios.F_int64_min;
    const n = new Node(-9223372036854775808n);
    assert.equal(n.DebugID(), expected.output);
  });

  // G. D2ID ordinary string
  it('G_d2id_ordinary_string', () => {
    const expected = scenarios.G_d2id_ordinary_string;
    const n = new Node(1);
    n.D2ID = 'alpha.beta';
    assert.equal(n.DebugID(), expected.output);
  });

  // H. D2ID empty string
  it('H_d2id_empty_string', () => {
    const expected = scenarios.H_d2id_empty_string;
    const n = new Node(2);
    n.D2ID = '';
    assert.equal(n.DebugID(), expected.output);
  });

  // I. D2ID overrides cluster vessel
  it('I_d2id_overrides_cluster_vessel', () => {
    const expected = scenarios.I_d2id_overrides_cluster_vessel;
    const g = new Graph();
    const n = new Node(3);
    n.D2ID = 'd2.wins';
    n.Graph = g;
    n.SetClusterVessel(true);
    const c = new Cluster();
    c.Vessel = n;
    c.Nodes = [new Node(100)];
    c.Arrangement = 'Row';
    g.Clusters.set(n, c);
    assert.equal(n.DebugID(), expected.output);
  });

  // J. D2ID overrides sequence vessel
  it('J_d2id_overrides_sequence_vessel', () => {
    const expected = scenarios.J_d2id_overrides_sequence_vessel;
    const g = new Graph();
    const n = new Node(4);
    n.D2ID = 'd2.seq.wins';
    n.Graph = g;
    const s = new Sequence();
    s.Vessel = n;
    s.Nodes = [new Node(200)];
    g.Sequences.set(n, s);
    assert.equal(n.DebugID(), expected.output);
  });

  // K. cluster vessel canonical
  it('K_cluster_vessel_canonical', () => {
    const expected = scenarios.K_cluster_vessel_canonical;
    const g = new Graph();
    const vessel = new Node(5);
    vessel.Graph = g;
    vessel.SetClusterVessel(true);
    const c = new Cluster();
    c.Vessel = vessel;
    c.Nodes = [new Node(10), new Node(20)];
    c.Arrangement = 'Row';
    g.Clusters.set(vessel, c);
    assert.equal(vessel.DebugID(), expected.output);
  });

  // L. cluster vessel + Graph nil -> natural failure
  it('L_cluster_vessel_nil_graph', () => {
    const expected = scenarios.L_cluster_vessel_nil_graph;
    assert.equal(expected.success, false);
    const n = new Node(6);
    n.SetClusterVessel(true);
    assert.throws(() => n.DebugID(), TypeError);
  });

  // M. cluster vessel + graph exists + missing cluster map entry -> natural failure
  it('M_cluster_vessel_missing_cluster_entry', () => {
    const expected = scenarios.M_cluster_vessel_missing_cluster_entry;
    assert.equal(expected.success, false);
    const g = new Graph();
    const n = new Node(7);
    n.Graph = g;
    n.SetClusterVessel(true);
    assert.throws(() => n.DebugID(), TypeError);
  });

  // N. cluster vessel AND sequence vessel -> cluster path wins
  it('N_cluster_vessel_and_sequence_vessel', () => {
    const expected = scenarios.N_cluster_vessel_and_sequence_vessel;
    const g = new Graph();
    const n = new Node(8);
    n.Graph = g;
    n.SetClusterVessel(true);
    const c = new Cluster();
    c.Vessel = n;
    c.Nodes = [new Node(11)];
    c.Arrangement = 'Column';
    const s = new Sequence();
    s.Vessel = n;
    s.Nodes = [new Node(22)];
    g.Clusters.set(n, c);
    g.Sequences.set(n, s);
    assert.equal(n.DebugID(), expected.output);
  });

  // O. Graph nil non-cluster node -> falls back numeric
  it('O_graph_nil_non_cluster_node', () => {
    const expected = scenarios.O_graph_nil_non_cluster_node;
    const n = new Node(9);
    assert.equal(n.DebugID(), expected.output);
  });

  // P. Graph Sequences empty -> falls back numeric
  it('P_graph_sequences_empty', () => {
    const expected = scenarios.P_graph_sequences_empty;
    const g = new Graph();
    const n = new Node(10);
    n.Graph = g;
    assert.equal(n.DebugID(), expected.output);
  });

  // Q. Graph Sequences non-empty but node absent -> falls back numeric
  it('Q_graph_sequences_node_absent', () => {
    const expected = scenarios.Q_graph_sequences_node_absent;
    const g = new Graph();
    const other = new Node(99);
    other.Graph = g;
    const s = new Sequence();
    s.Vessel = other;
    s.Nodes = [new Node(101)];
    g.Sequences.set(other, s);

    const n = new Node(11);
    n.Graph = g;
    assert.equal(n.DebugID(), expected.output);
  });

  // R. Graph Sequences contains node
  it('R_graph_sequences_contains_node', () => {
    const expected = scenarios.R_graph_sequences_contains_node;
    const g = new Graph();
    const n = new Node(12);
    n.Graph = g;
    const s = new Sequence();
    s.Vessel = n;
    s.Nodes = [new Node(301), new Node(302)];
    g.Sequences.set(n, s);
    assert.equal(n.DebugID(), expected.output);
  });

  // S. Graph Sequences contains node mapped to nil -> natural failure
  it('S_graph_sequences_contains_node_mapped_to_nil', () => {
    const expected = scenarios.S_graph_sequences_contains_node_mapped_to_nil;
    assert.equal(expected.success, false);
    const g = new Graph();
    const n = new Node(13);
    n.Graph = g;
    g.Sequences.set(n, null);
    assert.throws(() => n.DebugID(), TypeError);
  });

  // T. empty cluster default arrangement
  it('T_empty_cluster_default_arrangement', () => {
    const expected = scenarios.T_empty_cluster_default_arrangement;
    const c = new Cluster();
    c.Nodes = [];
    c.Arrangement = '';
    assert.equal(c.DebugID(), expected.output);
    assert.equal(c.debugID(), expected.output);
  });

  // U. empty Row cluster
  it('U_empty_row_cluster', () => {
    const expected = scenarios.U_empty_row_cluster;
    const c = new Cluster();
    c.Nodes = [];
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), expected.output);
  });

  // V. empty Column cluster
  it('V_empty_column_cluster', () => {
    const expected = scenarios.V_empty_column_cluster;
    const c = new Cluster();
    c.Nodes = [];
    c.Arrangement = 'Column';
    assert.equal(c.DebugID(), expected.output);
  });

  // W. one numeric member
  it('W_one_numeric_member', () => {
    const expected = scenarios.W_one_numeric_member;
    const c = new Cluster();
    c.Nodes = [new Node(1)];
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), expected.output);
  });

  // X. members preserve order (30, 10, 20)
  it('X_members_preserve_order', () => {
    const expected = scenarios.X_members_preserve_order;
    const c = new Cluster();
    c.Nodes = [new Node(30), new Node(10), new Node(20)];
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), expected.output);
  });

  // Y. nil member
  it('Y_nil_member', () => {
    const expected = scenarios.Y_nil_member;
    const c = new Cluster();
    c.Nodes = [new Node(1), null, new Node(2)];
    c.Arrangement = 'Column';
    assert.equal(c.DebugID(), expected.output);
  });

  // Z. D2ID member
  it('Z_d2id_member', () => {
    const expected = scenarios.Z_d2id_member;
    const c = new Cluster();
    const n1 = new Node(1);
    n1.D2ID = 'a.b';
    c.Nodes = [n1, new Node(2)];
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), expected.output);
  });

  // AA. member is sequence vessel
  it('AA_member_is_sequence_vessel', () => {
    const expected = scenarios.AA_member_is_sequence_vessel;
    const g = new Graph();
    const seqVessel = new Node(50);
    seqVessel.Graph = g;
    const s = new Sequence();
    s.Vessel = seqVessel;
    s.Nodes = [new Node(51), new Node(52)];
    g.Sequences.set(seqVessel, s);

    const c = new Cluster();
    c.Nodes = [seqVessel, new Node(99)];
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), expected.output);
  });

  // AB. nil cluster receiver
  it('AB_nil_cluster_receiver', () => {
    const expected = scenarios.AB_nil_cluster_receiver;
    assert.equal(expected.success, false);
    assert.throws(() => clusterDebugID(null), TypeError);
    assert.throws(() => clusterDebugID(undefined), TypeError);
  });

  // AC. empty sequence
  it('AC_empty_sequence', () => {
    const expected = scenarios.AC_empty_sequence;
    const s = new Sequence();
    s.Nodes = [];
    assert.equal(s.DebugID(), expected.output);
    assert.equal(s.debugID(), expected.output);
  });

  // AD. one member
  it('AD_one_member', () => {
    const expected = scenarios.AD_one_member;
    const s = new Sequence();
    s.Nodes = [new Node(1)];
    assert.equal(s.DebugID(), expected.output);
  });

  // AE. ordered members
  it('AE_ordered_members', () => {
    const expected = scenarios.AE_ordered_members;
    const s = new Sequence();
    s.Nodes = [new Node(30), new Node(10), new Node(20)];
    assert.equal(s.DebugID(), expected.output);
  });

  // AF. nil member
  it('AF_nil_member', () => {
    const expected = scenarios.AF_nil_member;
    const s = new Sequence();
    s.Nodes = [new Node(1), null, new Node(2)];
    assert.equal(s.DebugID(), expected.output);
  });

  // AG. D2ID member
  it('AG_d2id_member', () => {
    const expected = scenarios.AG_d2id_member;
    const s = new Sequence();
    const n1 = new Node(1);
    n1.D2ID = 'a.b';
    s.Nodes = [n1, new Node(2)];
    assert.equal(s.DebugID(), expected.output);
  });

  // AH. member is cluster vessel
  it('AH_member_is_cluster_vessel', () => {
    const expected = scenarios.AH_member_is_cluster_vessel;
    const g = new Graph();
    const clusterVessel = new Node(60);
    clusterVessel.Graph = g;
    clusterVessel.SetClusterVessel(true);
    const c = new Cluster();
    c.Vessel = clusterVessel;
    c.Nodes = [new Node(61), new Node(62)];
    c.Arrangement = 'Row';
    g.Clusters.set(clusterVessel, c);

    const s = new Sequence();
    s.Nodes = [clusterVessel, new Node(77)];
    assert.equal(s.DebugID(), expected.output);
  });

  // AI. nil sequence receiver
  it('AI_nil_sequence_receiver', () => {
    const expected = scenarios.AI_nil_sequence_receiver;
    assert.equal(expected.success, false);
    assert.throws(() => sequenceDebugID(null), TypeError);
    assert.throws(() => sequenceDebugID(undefined), TypeError);
  });

  // AJ. cluster nil nodes slice
  it('AJ_cluster_nil_nodes_slice', () => {
    const expected = scenarios.AJ_cluster_nil_nodes_slice;
    const c = new Cluster();
    c.Nodes = null;
    c.Arrangement = 'Row';
    assert.equal(c.DebugID(), expected.output);
  });

  // AK. sequence nil nodes slice
  it('AK_sequence_nil_nodes_slice', () => {
    const expected = scenarios.AK_sequence_nil_nodes_slice;
    const s = new Sequence();
    s.Nodes = null;
    assert.equal(s.DebugID(), expected.output);
  });

  // AL. deep nesting
  it('AL_nested_cluster_in_sequence_in_cluster', () => {
    const expected = scenarios.AL_nested_cluster_in_sequence_in_cluster;
    const g = new Graph();
    const leafSeqVessel = new Node(80);
    leafSeqVessel.Graph = g;
    const s1 = new Sequence();
    s1.Vessel = leafSeqVessel;
    const leafNode = new Node(81);
    leafNode.D2ID = 'deep.leaf';
    s1.Nodes = [leafNode];
    g.Sequences.set(leafSeqVessel, s1);

    const midClusterVessel = new Node(90);
    midClusterVessel.Graph = g;
    midClusterVessel.SetClusterVessel(true);
    const c1 = new Cluster();
    c1.Vessel = midClusterVessel;
    c1.Nodes = [leafSeqVessel];
    c1.Arrangement = 'Column';
    g.Clusters.set(midClusterVessel, c1);

    const outerSeq = new Sequence();
    outerSeq.Nodes = [midClusterVessel];
    assert.equal(outerSeq.DebugID(), expected.output);
  });
});
