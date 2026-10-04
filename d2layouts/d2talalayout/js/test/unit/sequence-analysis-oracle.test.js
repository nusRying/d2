import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  Graph,
  Node,
  Edge,
  Tree,
  Cluster,
  Sequence,
  Point,
  WorkGuard,
  MAX_ENGINE_WORK_UNITS,
  INT64_MIN,
  INT64_MAX,
  backgroundWorkContext,
} from "../../src/internal.js";

import {
  SequenceDefiningEdges,
  identifySequences,
  isValidRememberedSequence,
  hasNodeID,
  nextAvailableNodeID,
} from "../../src/grouping/index.js";

import { GoRand } from "../../src/random/go-math-rand.js";

const fixturePath = resolve(
  import.meta.dir,
  "../fixtures/go-sequence-analysis-reference.json"
);
const oracle = JSON.parse(readFileSync(fixturePath, "utf-8"));

function createWorkGuard() {
  return new WorkGuard(
    backgroundWorkContext(),
    "TestGuard",
    MAX_ENGINE_WORK_UNITS
  );
}

function buildActiveNodes(graph) {
  const active = new Set();
  if (graph?.Nodes) {
    for (const node of graph.Nodes) {
      active.add(node);
    }
  }
  return active;
}

describe("Slice 11 Go Sequence Analysis Oracle Parity", () => {
  test("asserts oracle metadata", () => {
    expect(oracle.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    expect(oracle.metadata.referencePackage).toBe(
      "github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
    );
    expect(oracle.metadata.runtimeGoVersion).toBeTruthy();
    expect(oracle.metadata.runtimeGOOS).toBeTruthy();
    expect(oracle.metadata.runtimeGOARCH).toBeTruthy();
  });

  describe("Replays Go Direct Public Accessors", () => {
    const acc = oracle.scenarios.accessors;

    test("Node.isContainer matches Go", () => {
      const c = new Node(1, 100, 100);
      c.isContainer = true;
      const o = new Node(2, 40, 30);
      expect(Boolean(c.isContainer)).toBe(acc.container_is_container);
      expect(Boolean(o.isContainer)).toBe(acc.ordinary_is_container);
    });

    test("Node.isSequenceStep matches Go", () => {
      const step = new Node(3, 40, 30);
      step.SetShape("Step");
      const square = new Node(4, 40, 30);
      square.SetShape("Square");
      expect(step.isSequenceStep()).toBe(acc.step_is_sequence_step);
      expect(square.isSequenceStep()).toBe(acc.square_is_sequence_step);
    });

    test("Node.ConnectionTo matches Go", () => {
      const g = new Graph();
      const nA = g.AddNode(new Node(10, 40, 30));
      const nB = g.AddNode(new Node(20, 40, 30));
      const nC = g.AddNode(new Node(30, 40, 30));
      const eAB = g.Connect(nA, nB);
      eAB.ID = 50;

      const connAB = nA.ConnectionTo(nB);
      expect(connAB != null && connAB.ID === eAB.ID).toBe(acc.connection_ab_exists);
      expect(nA.ConnectionTo(nC) === null).toBe(acc.connection_ac_nil);
    });

    test("Graph.SequenceOrder matches Go", () => {
      const g = new Graph();
      const v3 = new Node(300, 0, 0);
      const v1 = new Node(100, 0, 0);
      const v2 = new Node(200, 0, 0);
      g.Sequences.set(v3, new Sequence({ Vessel: v3 }));
      g.Sequences.set(v1, new Sequence({ Vessel: v1 }));
      g.Sequences.set(v2, new Sequence({ Vessel: v2 }));

      const ordered = g.SequenceOrder();
      const orderedIDs = ordered.map((n) => Number(n.ID));
      expect(orderedIDs).toEqual(acc.sequence_order_vessel_ids);
    });
  });

  describe("Replays Go SequenceDefiningEdges Scenarios", () => {
    const sde = oracle.scenarios.sequence_defining_edges;
    const ctx = backgroundWorkContext();

    function connectWithID(g, id, from, to) {
      const edge = g.Connect(from, to);
      edge.ID = id;
      return edge;
    }

    test("two_connected_steps", () => {
      const exp = sde.two_connected_steps;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 100, s1, s2);

      const beforeNodes = [...g.Nodes];
      const beforeEdges = [...g.Edges];

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);

      expect(g.Nodes.length).toBe(exp.nodeCountAfter);
      expect(g.Edges.length).toBe(exp.edgeCountAfter);
      expect(g.Sequences.size).toBe(exp.seqCountAfter);
      expect(g.Nodes).toEqual(beforeNodes);
      expect(g.Edges).toEqual(beforeEdges);
    });

    test("reverse_directed_edge", () => {
      const exp = sde.reverse_directed_edge;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 101, s2, s1);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("three_step_chain", () => {
      const exp = sde.three_step_chain;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      const s3 = new Node(3, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      s3.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, s3);
      connectWithID(g, 201, s1, s2);
      connectWithID(g, 202, s2, s3);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("two_separate_sequences", () => {
      const exp = sde.two_separate_sequences;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      const s3 = new Node(3, 40, 30);
      const s4 = new Node(4, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      s3.SetShape("Step");
      s4.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, s3);
      g.addNewNodeToContainer(null, s4);
      connectWithID(g, 301, s1, s2);
      connectWithID(g, 302, s3, s4);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("single_step_no_defining_edges", () => {
      const exp = sde.single_step_no_defining_edges;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      s1.SetShape("Step");
      g.addNewNodeToContainer(null, s1);

      const res = SequenceDefiningEdges(ctx, g);
      expect(res.size).toBe(0);
      expect(exp.definingEdgeIDs).toEqual([]);
    });

    test("non_step_nodes_ignored", () => {
      const exp = sde.non_step_nodes_ignored;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      n1.SetShape("Square");
      n2.SetShape("Square");
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      connectWithID(g, 401, n1, n2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(res.size).toBe(0);
      expect(exp.definingEdgeIDs).toEqual([]);
    });

    test("container_nodes_ignored", () => {
      const exp = sde.container_nodes_ignored;
      const g = new Graph();
      const c1 = new Node(1, 100, 100);
      c1.isContainer = true;
      c1.SetShape("Step");
      const s2 = new Node(2, 40, 30);
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, c1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 501, c1, s2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(res.size).toBe(0);
      expect(exp.definingEdgeIDs).toEqual([]);
    });

    test("cycle_connected_steps", () => {
      const exp = sde.cycle_connected_steps;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 601, s1, s2);
      connectWithID(g, 602, s2, s1);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("middle_non_step_disconnects", () => {
      const exp = sde.middle_non_step_disconnects;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      const other = new Node(3, 40, 30);
      const s3 = new Node(4, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      other.SetShape("Square");
      s3.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, other);
      g.addNewNodeToContainer(null, s3);
      connectWithID(g, 701, s1, s2);
      connectWithID(g, 702, s2, other);
      connectWithID(g, 703, other, s3);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("disconnected_steps_no_edges", () => {
      const exp = sde.disconnected_steps_no_edges;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(res.size).toBe(0);
      expect(exp.definingEdgeIDs).toEqual([]);
    });

    test("container_descendant_order", () => {
      const exp = sde.container_descendant_order;
      const g = new Graph();
      const c1 = new Node(10, 200, 200);
      const c2 = new Node(20, 200, 200);
      c1.isContainer = true;
      c2.isContainer = true;
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");

      g.addNewNodeToContainer(null, c1);
      g.addNewNodeToContainer(null, c2);
      g.addNewNodeToContainer(c1, s1);
      g.addNewNodeToContainer(c2, s2);
      connectWithID(g, 801, s1, s2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(res.size).toBe(0);
      expect(exp.definingEdgeIDs).toEqual([]);
    });

    test("cluster_container_order", () => {
      const exp = sde.cluster_container_order;
      const g = new Graph();
      const c1 = new Node(10, 200, 200);
      const c2 = new Node(20, 200, 200);
      c1.isContainer = true;
      c2.isContainer = true;
      g.addNewNodeToContainer(null, c1);
      g.addNewNodeToContainer(c1, c2);

      const r1 = new Node(1, 40, 30);
      const r2 = new Node(2, 40, 30);
      r1.SetShape("Step");
      r2.SetShape("Step");
      g.addNewNodeToContainer(null, r1);
      g.addNewNodeToContainer(null, r2);
      connectWithID(g, 901, r1, r2);

      const s3 = new Node(3, 40, 30);
      const s4 = new Node(4, 40, 30);
      s3.SetShape("Step");
      s4.SetShape("Step");
      g.addNewNodeToContainer(c1, s3);
      g.addNewNodeToContainer(c1, s4);
      connectWithID(g, 902, s3, s4);

      const s5 = new Node(5, 40, 30);
      const s6 = new Node(6, 40, 30);
      s5.SetShape("Step");
      s6.SetShape("Step");
      g.addNewNodeToContainer(c2, s5);
      g.addNewNodeToContainer(c2, s6);
      connectWithID(g, 903, s5, s6);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });
  });

  describe("Replays Go Direct identifySequences Bridge & WorkGuard Parity", () => {
    const idSeq = oracle.scenarios.identify_sequences;

    test("empty matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.empty;
      const g = new Graph();
      const guard = createWorkGuard();
      const res = identifySequences(g, [], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res).toBeNull();
    });

    test("one_step matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.one_step;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      s1.SetShape("Step");
      g.addNewNodeToContainer(null, s1);

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res).toBeNull();
    });

    test("connected_pair matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.connected_pair;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.Connect(s1, s2);

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1, s2], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res != null).toBe(true);
      const mapped = res.map((seq) => seq.map((n) => Number(n.ID)));
      expect(mapped).toEqual(exp.sequences);
    });

    test("disconnected_pair matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.disconnected_pair;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1, s2], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res).toBeNull();
    });

    test("late_edge_match matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.late_edge_match;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);

      for (let i = 0; i < 4; i++) {
        const d = new Node(10 + i, 10, 10);
        g.Connect(s1, d);
      }
      g.Connect(s1, s2);

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1, s2], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res != null).toBe(true);
      const mapped = res.map((seq) => seq.map((n) => Number(n.ID)));
      expect(mapped).toEqual(exp.sequences);
    });

    test("inactive_remembered_steps matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.inactive_remembered_steps;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);

      const vessel = new Node(100, 0, 0);
      vessel.Graph = null; // Inactive
      const seq = new Sequence({ Vessel: vessel, Graph: g });
      s1.Sequence = seq;
      s2.Sequence = seq;

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1, s2], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res).toBeNull();
    });

    test("active_sequence_membership matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.active_sequence_membership;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.Connect(s1, s2);

      const vessel = new Node(100, 40, 30);
      vessel.Graph = g; // Active
      const seq = new Sequence({ Vessel: vessel, Graph: g });
      s1.Sequence = seq;
      s2.Sequence = seq;

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1, s2], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res != null).toBe(true);
      const mapped = res.map((seq) => seq.map((n) => Number(n.ID)));
      expect(mapped).toEqual(exp.sequences);
    });

    test("duplicate_supplied_node_refs matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.duplicate_supplied_node_refs;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.Connect(s1, s2);

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1, s1, s2], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res != null).toBe(true);
      const mapped = res.map((seq) => seq.map((n) => Number(n.ID)));
      expect(mapped).toEqual(exp.sequences);
    });

    test("fixed_top_left matches Go result and exact WorkGuard Used()", () => {
      const exp = idSeq.fixed_top_left;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      s1.FixedTopLeft = new Point(10, 10);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.Connect(s1, s2);

      const guard = createWorkGuard();
      const res = identifySequences(g, [s1, s2], guard);

      expect(guard.Used()).toBe(BigInt(exp.workUsed));
      expect(res).toBeNull();
    });
  });

  describe("Replays Go Direct isValidRememberedSequence Bridge & WorkGuard Parity", () => {
    const rem = oracle.scenarios.remembered_validity;

    test("immediate_reject_nil_vessel: 0 work and invalid", () => {
      const exp = rem.immediate_reject_nil_vessel;
      const g = new Graph();
      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, null, new Sequence(), buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("immediate_reject_nil_sequence: 0 work and invalid", () => {
      const exp = rem.immediate_reject_nil_sequence;
      const g = new Graph();
      const vessel = new Node(100, 0, 0);
      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, null, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("immediate_reject_vessel_mismatch: 0 work and invalid", () => {
      const exp = rem.immediate_reject_vessel_mismatch;
      const g = new Graph();
      const vessel = new Node(100, 0, 0);
      const otherVessel = new Node(200, 0, 0);
      const seq = new Sequence({ Vessel: otherVessel, Graph: g, Nodes: [new Node(1, 10, 10), new Node(2, 10, 10)] });
      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("immediate_reject_graph_mismatch: 0 work and invalid", () => {
      const exp = rem.immediate_reject_graph_mismatch;
      const g = new Graph();
      const otherGraph = new Graph();
      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({ Vessel: vessel, Graph: otherGraph, Nodes: [new Node(1, 10, 10), new Node(2, 10, 10)] });
      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("immediate_reject_active_sequence: 0 work and invalid", () => {
      const exp = rem.immediate_reject_active_sequence;
      const g = new Graph();
      const vessel = new Node(100, 40, 30);
      vessel.Graph = g; // Active
      const seq = new Sequence({ Vessel: vessel, Graph: g, Nodes: [new Node(1, 10, 10), new Node(2, 10, 10)] });
      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("immediate_reject_less_than_two_nodes: 0 work and invalid", () => {
      const exp = rem.immediate_reject_less_than_two_nodes;
      const g = new Graph();
      const vessel = new Node(100, 0, 0);
      const s1 = new Node(1, 40, 30);
      const seq = new Sequence({ Vessel: vessel, Graph: g, Nodes: [s1] });
      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("immediate_reject_missing_containers_key: 0 work and invalid", () => {
      const exp = rem.immediate_reject_missing_containers_key;
      const g = new Graph();
      const vessel = new Node(100, 0, 0);
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      const seq = new Sequence({ Vessel: vessel, Graph: g, Nodes: [s1, s2] });
      g.Containers.delete(null);

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("immediate_reject_container_key_empty: matches Go work and invalid", () => {
      const exp = rem.immediate_reject_container_key_empty;
      const g = new Graph();
      const vessel = new Node(100, 0, 0);
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      const seq = new Sequence({ Vessel: vessel, Graph: g, Nodes: [s1, s2] });
      g.Containers.set(null, []); // Empty container

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("valid_pair: matches Go workUsed and valid=true", () => {
      const exp = rem.valid_pair;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("duplicate_child: matches Go workUsed and valid=false", () => {
      const exp = rem.duplicate_child;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNodeUnchecked(a);
      g.addNodeUnchecked(b);
      g.Containers.set(null, [a, a, b]);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("duplicate_sequence_member: matches Go workUsed and valid=false", () => {
      const exp = rem.duplicate_sequence_member;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, a],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("noncontiguous_sequence: matches Go workUsed and valid=false", () => {
      const exp = rem.noncontiguous_sequence;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const other = new Node(10, 20, 20);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNodeUnchecked(a);
      g.addNodeUnchecked(other);
      g.addNodeUnchecked(b);
      g.Containers.set(null, [a, other, b]);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("nil_sequence_member: matches Go workUsed and valid=false", () => {
      const exp = rem.nil_sequence_member;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, null],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("wrong_node_graph: matches Go workUsed and valid=false", () => {
      const exp = rem.wrong_node_graph;
      const g = new Graph();
      const otherGraph = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);
      a.Graph = otherGraph;

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("fixed_top_left: matches Go workUsed and valid=false", () => {
      const exp = rem.fixed_top_left;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      a.FixedTopLeft = new Point(10, 10);
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("wrong_node_sequence: matches Go workUsed and valid=false", () => {
      const exp = rem.wrong_node_sequence;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      const otherSeq = new Sequence({ Vessel: vessel });
      a.Sequence = seq;
      b.Sequence = otherSeq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("wrong_container: matches Go workUsed and valid=false", () => {
      const exp = rem.wrong_container;
      const g = new Graph();
      const c1 = new Node(10, 100, 100);
      c1.isContainer = true;
      g.addNewNodeToContainer(null, c1);

      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);
      b.Container = c1;

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("node_missing_from_children: matches Go workUsed and valid=false", () => {
      const exp = rem.node_missing_from_children;
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, a); // only 'a' is child

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });

    test("valid_contiguous_members_unrelated_neighbors: matches Go workUsed and valid=true", () => {
      const exp = rem.valid_contiguous_members_unrelated_neighbors;
      const g = new Graph();
      const u1 = new Node(10, 40, 30);
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      const u2 = new Node(20, 40, 30);
      a.SetShape("Step");
      b.SetShape("Step");
      g.addNewNodeToContainer(null, u1);
      g.addNewNodeToContainer(null, a);
      g.addNewNodeToContainer(null, b);
      g.addNewNodeToContainer(null, u2);

      const vessel = new Node(100, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        Graph: g,
        Container: null,
      });
      a.Sequence = seq;
      b.Sequence = seq;

      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, seq, buildActiveNodes(g), guard);
      expect(valid).toBe(exp.valid);
      expect(guard.Used()).toBe(BigInt(exp.workUsed));
    });
  });

  describe("Replays Go Direct hasNodeID Bridge Scenarios", () => {
    const has = oracle.scenarios.has_node_id;

    test("matches all direct Go hasNodeID queries", () => {
      const g = new Graph();

      // 1. graph.Nodes
      const ordinary = new Node(10, 40, 30);
      g.AddNode(ordinary);

      // 2. Cluster vessel & nodes
      const clusterVessel = new Node(20, 40, 30);
      clusterVessel.isClusterVessel = true;
      const clusterNode = new Node(21, 40, 30);
      g.Clusters.set(clusterVessel, new Cluster({ Vessel: clusterVessel, Nodes: [clusterNode] }));

      // 3. Sequence vessel & nodes
      const seqVessel = new Node(30, 40, 30);
      const seqNode = new Node(31, 40, 30);
      g.Sequences.set(seqVessel, new Sequence({ Vessel: seqVessel, Nodes: [seqNode] }));

      // 4. Tree sentinel, root, and nested child
      const sentinel = new Node(40, 40, 30);
      const rootNode = new Node(41, 40, 30);
      const childNode = new Node(42, 40, 30);
      const childTree = new Tree(childNode);
      const rootTree = new Tree(rootNode);
      rootTree.Children = [childTree];
      g.Trees.set(sentinel, [rootTree]);

      // Container child only (not in Nodes/Clusters/Sequences/Trees)
      const containerChild = new Node(50, 40, 30);
      g.Containers.set(ordinary, [containerChild]);

      expect(hasNodeID(g, 10)).toBe(has.graph_nodes_id);
      expect(hasNodeID(g, 20)).toBe(has.cluster_vessel_id);
      expect(hasNodeID(g, 21)).toBe(has.cluster_node_id);
      expect(hasNodeID(g, 30)).toBe(has.sequence_vessel_id);
      expect(hasNodeID(g, 31)).toBe(has.sequence_node_id);
      expect(hasNodeID(g, 40)).toBe(has.tree_sentinel_id);
      expect(hasNodeID(g, 41)).toBe(has.tree_node_id);
      expect(hasNodeID(g, 42)).toBe(has.nested_tree_child_id);
      expect(hasNodeID(g, 999)).toBe(has.absent_id);
      expect(hasNodeID(g, 50)).toBe(has.container_child_not_in_graph_nodes);
    });
  });

  describe("Replays Go Direct nextAvailableNodeID Bridge & ID Occupancy", () => {
    const ido = oracle.scenarios.id_occupancy;

    test("unavailable_set_collision matches Go nextAvailableNodeID", () => {
      const sc = ido.unavailable_set_collision;
      const g = new Graph();
      const unavailable = new Set([BigInt(sc.candidate)]);
      const res = nextAvailableNodeID(g, sc.candidate, unavailable);
      expect(res).toBe(BigInt(sc.expected));
    });

    test("multiple_consecutive_collisions matches Go nextAvailableNodeID", () => {
      const sc = ido.multiple_consecutive_collisions;
      const g = new Graph();
      g.AddNode(new Node(101, 40, 30));
      const unavailable = new Set([100n, 102n]);
      const res = nextAvailableNodeID(g, sc.candidate, unavailable);
      expect(res).toBe(BigInt(sc.expected));
    });

    test("max_int64_wraps_to_zero matches Go nextAvailableNodeID", () => {
      const sc = ido.max_int64_wraps_to_zero;
      const g = new Graph();
      const unavailable = new Set([INT64_MAX]);
      const res = nextAvailableNodeID(g, INT64_MAX, unavailable);
      expect(res).toBe(BigInt(sc.expected));
    });

    test("zero_to_one matches Go nextAvailableNodeID", () => {
      const sc = ido.zero_to_one;
      const g = new Graph();
      const unavailable = new Set([0n]);
      const res = nextAvailableNodeID(g, 0, unavailable);
      expect(res).toBe(BigInt(sc.expected));
    });

    test("seed_19_rng_continuation matches Go resolved ID and asserts zero RNG draws", () => {
      const sc = ido.seed_19_rng_continuation;
      const collidingID = BigInt(sc.collidingIDStr);
      const expectedID = BigInt(sc.expectedIDStr);

      const probe = new GoRand(sc.seed);
      const probeCandidate = probe.Int63();
      expect(probeCandidate).toBe(collidingID);

      const layoutRand = new GoRand(sc.seed);
      const candidate = layoutRand.Int63();
      expect(candidate).toBe(collidingID);

      const g = new Graph();
      g.AddNode(new Node(collidingID, 40, 30));

      const resolved = nextAvailableNodeID(g, candidate, new Set());
      expect(resolved).toBe(expectedID);

      // Assert RNG continuation matches Go probe exactly
      const nextDraw = layoutRand.Int63();
      const probeNextDraw = probe.Int63();
      expect(nextDraw).toBe(probeNextDraw);
      expect(nextDraw.toString()).toBe(sc.nextDrawStr);
    });

    test("cluster_vessel_collision matches Go nextAvailableNodeID", () => {
      const sc = ido.cluster_vessel_collision;
      const collidingID = BigInt(sc.collidingIDStr);
      const expectedID = BigInt(sc.expectedVesselIDStr);

      const g = new Graph();
      const clusterVessel = new Node(collidingID, 40, 30);
      clusterVessel.isClusterVessel = true;
      g.Clusters.set(clusterVessel, new Cluster({ Vessel: clusterVessel }));

      const nextID = nextAvailableNodeID(g, collidingID, new Set());
      expect(nextID).toBe(expectedID);
    });

    test("tree_sentinel_collision matches Go nextAvailableNodeID", () => {
      const sc = ido.tree_sentinel_collision;
      const collidingID = BigInt(sc.collidingIDStr);
      const expectedID = BigInt(sc.expectedVesselIDStr);

      const g = new Graph();
      const sentinel = new Node(collidingID, 40, 30);
      g.Trees.set(sentinel, []);

      const nextID = nextAvailableNodeID(g, collidingID, new Set());
      expect(nextID).toBe(expectedID);
    });

    test("tree_node_collision matches Go nextAvailableNodeID", () => {
      const sc = ido.tree_node_collision;
      const collidingID = BigInt(sc.collidingIDStr);
      const expectedID = BigInt(sc.expectedVesselIDStr);

      const g = new Graph();
      const sentinel = new Node(100, 40, 30);
      const treeNode = new Node(collidingID, 40, 30);
      const tree = new Tree(treeNode);
      g.Trees.set(sentinel, [tree]);

      const nextID = nextAvailableNodeID(g, collidingID, new Set());
      expect(nextID).toBe(expectedID);
    });
  });
});
