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
  SequenceDefiningEdges,
  isValidRememberedSequence,
  hasNodeID,
  nextAvailableNodeID,
  WorkGuard,
  MAX_ENGINE_WORK_UNITS,
  backgroundWorkContext,
} from "../../src/index.js";

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

    test("Node.IsContainer matches Go", () => {
      const c = new Node(1, 100, 100);
      c.isContainer = true;
      const o = new Node(2, 40, 30);
      expect(c.IsContainer()).toBe(acc.container_is_container);
      expect(o.IsContainer()).toBe(acc.ordinary_is_container);
    });

    test("Node.IsSequenceStep matches Go", () => {
      const step = new Node(3, 40, 30);
      step.SetShape("Step");
      const square = new Node(4, 40, 30);
      square.SetShape("Square");
      expect(step.IsSequenceStep()).toBe(acc.step_is_sequence_step);
      expect(square.IsSequenceStep()).toBe(acc.square_is_sequence_step);
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
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      connectWithID(g, 100, s1, s2);

      const beforeNodes = [...g.Nodes];
      const beforeEdges = [...g.Edges];

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);

      // Read-only asserts
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
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
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
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      g.AddNewNodeToContainer(null, s3);
      connectWithID(g, 100, s1, s2);
      connectWithID(g, 101, s2, s3);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("two_separate_runs", () => {
      const exp = sde.two_separate_runs;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      const s3 = new Node(3, 40, 30);
      const s4 = new Node(4, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      s3.SetShape("Step");
      s4.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      g.AddNewNodeToContainer(null, s3);
      g.AddNewNodeToContainer(null, s4);
      connectWithID(g, 100, s1, s2);
      connectWithID(g, 101, s3, s4);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("single_step", () => {
      const exp = sde.single_step;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      s1.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);

      const res = SequenceDefiningEdges(ctx, g);
      expect(Array.from(res)).toEqual(exp.definingEdgeIDs);
    });

    test("non_step_pair", () => {
      const exp = sde.non_step_pair;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      n1.SetShape("Square");
      n2.SetShape("Square");
      g.AddNewNodeToContainer(null, n1);
      g.AddNewNodeToContainer(null, n2);
      connectWithID(g, 100, n1, n2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(Array.from(res)).toEqual(exp.definingEdgeIDs);
    });

    test("step_container_skipped", () => {
      const exp = sde.step_container_skipped;
      const g = new Graph();
      const c1 = new Node(1, 100, 100);
      c1.SetShape("Step");
      c1.isContainer = true;
      const s2 = new Node(2, 40, 30);
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, c1);
      g.AddNewNodeToContainer(null, s2);
      connectWithID(g, 100, c1, s2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(Array.from(res)).toEqual(exp.definingEdgeIDs);
    });

    test("fixed_top_left_step_skipped", () => {
      const exp = sde.fixed_top_left_step_skipped;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      s1.FixedTopLeft = new Point(10, 10);
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      connectWithID(g, 100, s1, s2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(Array.from(res)).toEqual(exp.definingEdgeIDs);
    });

    test("inactive_remembered_steps_skipped", () => {
      const exp = sde.inactive_remembered_steps_skipped;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      connectWithID(g, 100, s1, s2);

      const remSeq = new Sequence({
        Vessel: new Node(3, 0, 0),
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      // Vessel.Graph is null -> inactive
      s1.Sequence = remSeq;
      s2.Sequence = remSeq;

      const res = SequenceDefiningEdges(ctx, g);
      expect(Array.from(res)).toEqual(exp.definingEdgeIDs);
    });

    test("node_absent_graph_nodes_skipped", () => {
      const exp = sde.node_absent_graph_nodes_skipped;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      connectWithID(g, 100, s1, s2);

      // Remove s2 from graph.Nodes while keeping it in Containers
      g.RemoveNode(s2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(Array.from(res)).toEqual(exp.definingEdgeIDs);
    });

    test("interleaved_non_step_child", () => {
      const exp = sde.interleaved_non_step_child;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const other = new Node(2, 40, 30);
      const s3 = new Node(3, 40, 30);
      s1.SetShape("Step");
      other.SetShape("Square");
      s3.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, other);
      g.AddNewNodeToContainer(null, s3);
      connectWithID(g, 100, s1, s3);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("parallel_edges_first_chosen", () => {
      const exp = sde.parallel_edges_first_chosen;
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      connectWithID(g, 200, s1, s2);
      connectWithID(g, 201, s1, s2);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });

    test("container_local_split", () => {
      const exp = sde.container_local_split;
      const g = new Graph();
      const c1 = new Node(10, 100, 100);
      const c2 = new Node(20, 100, 100);
      c1.isContainer = true;
      c2.isContainer = true;
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, c1);
      g.AddNewNodeToContainer(null, c2);
      g.AddNewNodeToContainer(c1, s1);
      g.AddNewNodeToContainer(c2, s2);
      connectWithID(g, 100, s1, s2);

      const res = SequenceDefiningEdges(ctx, g);
      expect(Array.from(res)).toEqual(exp.definingEdgeIDs);
    });

    test("nested_containers", () => {
      const exp = sde.nested_containers;
      const g = new Graph();
      const c1 = new Node(10, 200, 200);
      const c2 = new Node(20, 100, 100);
      c1.isContainer = true;
      c2.isContainer = true;
      g.AddNewNodeToContainer(null, c1);
      g.AddNewNodeToContainer(c1, c2);

      // Root steps
      const r1 = new Node(1, 40, 30);
      const r2 = new Node(2, 40, 30);
      r1.SetShape("Step");
      r2.SetShape("Step");
      g.AddNewNodeToContainer(null, r1);
      g.AddNewNodeToContainer(null, r2);
      connectWithID(g, 100, r1, r2);

      // C1 steps
      const s3 = new Node(3, 40, 30);
      const s4 = new Node(4, 40, 30);
      s3.SetShape("Step");
      s4.SetShape("Step");
      g.AddNewNodeToContainer(c1, s3);
      g.AddNewNodeToContainer(c1, s4);
      connectWithID(g, 101, s3, s4);

      // C2 steps
      const s5 = new Node(5, 40, 30);
      const s6 = new Node(6, 40, 30);
      s5.SetShape("Step");
      s6.SetShape("Step");
      g.AddNewNodeToContainer(c2, s5);
      g.AddNewNodeToContainer(c2, s6);
      connectWithID(g, 102, s5, s6);

      const res = SequenceDefiningEdges(ctx, g);
      const ids = Array.from(res).map(Number).sort((a, b) => a - b);
      expect(ids).toEqual(exp.definingEdgeIDs);
    });
  });

  describe("Replays Go Remembered-State Validity Scenarios", () => {
    const rem = oracle.scenarios.remembered_validity;

    test("valid_reconstruction_without_defining_edge", () => {
      const exp = rem.valid_reconstruction_without_defining_edge;
      expect(exp.expectedValidRemembered).toBe(true);
      expect(exp.vesselIDPreserved).toBe(true);
      expect(exp.edgeSurvivesAfterCleanup).toBe(false);

      // Replay pre-rebuild state in JS
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      // Notice: NO edge connecting s1 and s2 (defining edge absent after cleanup)

      const vesselID = BigInt(exp.initialVesselIDStr);
      const vessel = new Node(vesselID, 0, 0);
      const sequence = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      // Inactive: vessel.Graph is null
      vessel.Graph = null;
      s1.Sequence = sequence;
      s2.Sequence = sequence;
      g.Sequences.set(vessel, sequence);

      const activeNodes = buildActiveNodes(g);
      const guard = createWorkGuard();
      const valid = isValidRememberedSequence(g, vessel, sequence, activeNodes, guard);
      expect(valid).toBe(true);
    });

    test("shape_changed is invalid", () => {
      const exp = rem.shape_changed;
      expect(exp.expectedValidRemembered).toBe(false);

      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Square"); // Mutated
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);

      const vessel = new Node(100, 0, 0);
      const sequence = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = sequence;
      s2.Sequence = sequence;

      const activeNodes = buildActiveNodes(g);
      const guard = createWorkGuard();
      expect(isValidRememberedSequence(g, vessel, sequence, activeNodes, guard)).toBe(false);
    });

    test("container_changed is invalid", () => {
      const exp = rem.container_changed;
      expect(exp.expectedValidRemembered).toBe(false);

      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      const c = new Node(10, 100, 100);
      c.isContainer = true;
      g.AddNewNodeToContainer(null, c);
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(c, s2); // Different container

      const vessel = new Node(100, 0, 0);
      const sequence = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = sequence;
      s2.Sequence = sequence;

      const activeNodes = buildActiveNodes(g);
      const guard = createWorkGuard();
      expect(isValidRememberedSequence(g, vessel, sequence, activeNodes, guard)).toBe(false);
    });

    test("membership_cleared is invalid", () => {
      const exp = rem.membership_cleared;
      expect(exp.expectedValidRemembered).toBe(false);

      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);

      const vessel = new Node(100, 0, 0);
      const sequence = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = sequence;
      s2.Sequence = null; // Cleared

      const activeNodes = buildActiveNodes(g);
      const guard = createWorkGuard();
      expect(isValidRememberedSequence(g, vessel, sequence, activeNodes, guard)).toBe(false);
    });

    test("members_noncontiguous is invalid", () => {
      const exp = rem.members_noncontiguous;
      expect(exp.expectedValidRemembered).toBe(false);

      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const other = new Node(10, 20, 20);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, other); // Interleaved in container
      g.AddNewNodeToContainer(null, s2);

      const vessel = new Node(100, 0, 0);
      const sequence = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = sequence;
      s2.Sequence = sequence;

      const activeNodes = buildActiveNodes(g);
      const guard = createWorkGuard();
      expect(isValidRememberedSequence(g, vessel, sequence, activeNodes, guard)).toBe(false);
    });

    test("removed_graph_node is invalid", () => {
      const exp = rem.removed_graph_node;
      expect(exp.expectedValidRemembered).toBe(false);

      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);

      const vessel = new Node(100, 0, 0);
      const sequence = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = sequence;
      s2.Sequence = sequence;

      // s2 is removed from Graph.Nodes
      g.RemoveNode(s2);

      const activeNodes = buildActiveNodes(g);
      const guard = createWorkGuard();
      expect(isValidRememberedSequence(g, vessel, sequence, activeNodes, guard)).toBe(false);
    });
  });

  describe("Replays Go ID Occupancy Scenarios", () => {
    const ido = oracle.scenarios.id_occupancy;

    test("ordinary_node_collision matches Go nextAvailableNodeID", () => {
      const sc = ido.ordinary_node_collision;
      const collidingID = BigInt(sc.collidingIDStr);
      const expectedID = BigInt(sc.expectedVesselIDStr);

      const g = new Graph();
      const ordinary = new Node(collidingID, 40, 30);
      g.AddNode(ordinary);

      const reserved = new Set([collidingID]);
      const nextID = nextAvailableNodeID(g, collidingID, reserved);
      expect(nextID).toBe(expectedID);
    });

    test("cluster_vessel_collision matches Go nextAvailableNodeID", () => {
      const sc = ido.cluster_vessel_collision;
      const collidingID = BigInt(sc.collidingIDStr);
      const expectedID = BigInt(sc.expectedVesselIDStr);

      const g = new Graph();
      const clusterVessel = new Node(collidingID, 40, 30);
      clusterVessel.isClusterVessel = true;
      g.Clusters.set(clusterVessel, new Cluster({ Vessel: clusterVessel }));

      const reserved = new Set();
      const nextID = nextAvailableNodeID(g, collidingID, reserved);
      expect(nextID).toBe(expectedID);
    });

    test("tree_sentinel_collision matches Go nextAvailableNodeID", () => {
      const sc = ido.tree_sentinel_collision;
      const collidingID = BigInt(sc.collidingIDStr);
      const expectedID = BigInt(sc.expectedVesselIDStr);

      const g = new Graph();
      const sentinel = new Node(collidingID, 40, 30);
      g.Trees.set(sentinel, []);

      const reserved = new Set();
      const nextID = nextAvailableNodeID(g, collidingID, reserved);
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

      const reserved = new Set();
      const nextID = nextAvailableNodeID(g, collidingID, reserved);
      expect(nextID).toBe(expectedID);
    });
  });
});
