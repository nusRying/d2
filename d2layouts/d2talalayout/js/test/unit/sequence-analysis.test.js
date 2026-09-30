import { describe, expect, test } from "bun:test";

import {
  Graph,
  Node,
  Edge,
  Tree,
  Cluster,
  Sequence,
  Point,
  SequenceDefiningEdges,
  identifySequences,
  isValidRememberedSequence,
  hasNodeID,
  nextAvailableNodeID,
  WorkGuard,
  MAX_ENGINE_WORK_UNITS,
  INT64_MAX,
  backgroundWorkContext,
  WorkLimitError,
  WorkCanceledError,
} from "../../src/index.js";

function createGuard(limit = MAX_ENGINE_WORK_UNITS) {
  return new WorkGuard(backgroundWorkContext(), "TestGuard", limit);
}

function buildActiveSet(graph) {
  const set = new Set();
  if (graph?.Nodes) {
    for (const n of graph.Nodes) {
      set.add(n);
    }
  }
  return set;
}

describe("Slice 11 Sequence Analysis Unit Tests", () => {
  // -------------------------------------------------------------
  // SequenceOrder Semantics (Sections 7, 61)
  // -------------------------------------------------------------
  describe("SequenceOrder semantics", () => {
    test("orders negative ID, normal Number ID, and BigInt above MAX_SAFE_INTEGER in signed numeric order", () => {
      const g = new Graph();
      const nNeg = new Node(-5, 0, 0);
      const nTwo = new Node(2, 0, 0);
      const nBig = new Node(9007199254740993n, 0, 0);

      // Insert in unordered fashion
      g.Sequences.set(nBig, new Sequence({ Vessel: nBig }));
      g.Sequences.set(nNeg, new Sequence({ Vessel: nNeg }));
      g.Sequences.set(nTwo, new Sequence({ Vessel: nTwo }));

      const order = g.SequenceOrder();
      expect(order.length).toBe(3);
      expect(order[0]).toBe(nNeg);
      expect(order[1]).toBe(nTwo);
      expect(order[2]).toBe(nBig);
      expect(order.map((n) => BigInt(n.ID))).toEqual([-5n, 2n, 9007199254740993n]);
    });
  });

  // -------------------------------------------------------------
  // identifySequences (Sections 8-25)
  // -------------------------------------------------------------
  describe("identifySequences", () => {
    test("returns null for empty candidates or single candidate", () => {
      const g = new Graph();
      const guard1 = createGuard();
      expect(identifySequences(g, null, guard1)).toBeNull();
      expect(guard1.Used()).toBe(0n);

      const guard2 = createGuard();
      expect(identifySequences(g, [], guard2)).toBeNull();
      expect(guard2.Used()).toBe(0n);

      const s1 = new Node(1, 40, 30);
      s1.SetShape("Step");
      g.AddNode(s1);
      const guard3 = createGuard();
      expect(identifySequences(g, [s1], guard3)).toBeNull();
      // 1 step in activeNodes, 1 step in candidates = 2
      expect(guard3.Used()).toBe(2n);
    });

    test("returns [[s1, s2]] for two connected steps", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNode(s1);
      g.AddNode(s2);
      g.Connect(s1, s2);

      const guard = createGuard();
      const seqs = identifySequences(g, [s1, s2], guard);
      expect(seqs).not.toBeNull();
      expect(seqs?.length).toBe(1);
      expect(seqs?.[0]).toEqual([s1, s2]);
      // active: 2, candidates: 2, outer loop i=1: 1, inner edge loop: 1 => 6
      expect(guard.Used()).toBe(6n);
    });

    test("returns null for two disconnected steps", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNode(s1);
      g.AddNode(s2);

      const guard = createGuard();
      const seqs = identifySequences(g, [s1, s2], guard);
      expect(seqs).toBeNull();
      // active: 2, candidates: 2, outer loop: 1, edges: 0 => 5
      expect(guard.Used()).toBe(5n);
    });

    test("returns multiple runs for disconnected intermediate pairs", () => {
      const g = new Graph();
      const a = new Node(1, 40, 30);
      const b = new Node(2, 40, 30);
      const c = new Node(3, 40, 30);
      const d = new Node(4, 40, 30);
      const e = new Node(5, 40, 30);
      for (const n of [a, b, c, d, e]) {
        n.SetShape("Step");
        g.AddNode(n);
      }
      g.Connect(a, b);
      g.Connect(b, c);
      // c and d disconnected
      g.Connect(d, e);

      const guard = createGuard();
      const seqs = identifySequences(g, [a, b, c, d, e], guard);
      expect(seqs).toEqual([
        [a, b, c],
        [d, e],
      ]);
    });

    test("skips container steps, fixed steps, and inactive remembered steps", () => {
      const g = new Graph();
      const c1 = new Node(1, 100, 100);
      c1.SetShape("Step");
      c1.isContainer = true;

      const f2 = new Node(2, 40, 30);
      f2.SetShape("Step");
      f2.FixedTopLeft = new Point(0, 0);

      const r3 = new Node(3, 40, 30);
      r3.SetShape("Step");
      const remSeq = new Sequence({ Vessel: new Node(99, 0, 0), Nodes: [r3], Graph: g });
      // Inactive: Vessel.Graph is null
      r3.Sequence = remSeq;

      for (const n of [c1, f2, r3]) {
        g.AddNode(n);
      }

      const guard = createGuard();
      const seqs = identifySequences(g, [c1, f2, r3], guard);
      expect(seqs).toBeNull();
      // active: 3, candidates: 3 => 6
      expect(guard.Used()).toBe(6n);
    });

    test("skips nodes absent from Graph.Nodes even if in candidate list", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNode(s1);
      // s2 NOT added to g.Nodes
      g.Connect(s1, s2);

      const guard = createGuard();
      const seqs = identifySequences(g, [s1, s2], guard);
      expect(seqs).toBeNull();
      // active: 1 (s1), candidates: 2 (s1, s2), stepNodes has only s1 <= 1 -> null
      expect(guard.Used()).toBe(3n);
    });

    test("collapses irrelevant siblings: Step A, Non-Step X, Step B directly connected forms sequence", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const nonStep = new Node(2, 40, 30);
      const s3 = new Node(3, 40, 30);
      s1.SetShape("Step");
      nonStep.SetShape("Square");
      s3.SetShape("Step");
      for (const n of [s1, nonStep, s3]) {
        g.AddNode(n);
      }
      g.Connect(s1, s3);

      const guard = createGuard();
      const seqs = identifySequences(g, [s1, nonStep, s3], guard);
      expect(seqs).toEqual([[s1, s3]]);
    });

    test("edge-list search charges guard for each scanned edge until first connection", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      const otherA = new Node(10, 40, 30);
      const otherB = new Node(20, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      for (const n of [s1, s2, otherA, otherB]) {
        g.AddNode(n);
      }
      // Add 2 non-connecting edges to s1 first, then the connecting edge
      g.Connect(s1, otherA);
      g.Connect(s1, otherB);
      g.Connect(s1, s2);

      const guard = createGuard();
      const seqs = identifySequences(g, [s1, s2], guard);
      expect(seqs).toEqual([[s1, s2]]);
      // active: 4, candidates: 2, outer loop: 1, edge loop: 3 edges scanned => 4 + 2 + 1 + 3 = 10
      expect(guard.Used()).toBe(10n);
    });

    test("WorkLimit failure: succeeds at required limit, throws WorkLimitError at required - 1", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNode(s1);
      g.AddNode(s2);
      g.Connect(s1, s2);

      // Required units = 6
      const guardSuccess = createGuard(6);
      const seqs = identifySequences(g, [s1, s2], guardSuccess);
      expect(seqs).toEqual([[s1, s2]]);

      const beforeNodes = [...g.Nodes];
      const beforeEdges = [...g.Edges];

      const guardFail = createGuard(5);
      expect(() => identifySequences(g, [s1, s2], guardFail)).toThrow(WorkLimitError);

      // Non-mutation check
      expect(g.Nodes).toEqual(beforeNodes);
      expect(g.Edges).toEqual(beforeEdges);
    });

    test("identifySequences is strictly read-only", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      const edge = g.Connect(s1, s2);

      const nodesRef = g.Nodes;
      const edgesRef = g.Edges;
      const containersRef = g.Containers;
      const s1EdgesRef = s1.Edges;

      const guard = createGuard();
      identifySequences(g, [s1, s2], guard);

      expect(g.Nodes).toBe(nodesRef);
      expect(g.Edges).toBe(edgesRef);
      expect(g.Containers).toBe(containersRef);
      expect(s1.Edges).toBe(s1EdgesRef);
      expect(edge.From).toBe(s1);
      expect(edge.To).toBe(s2);
      expect(s1.Sequence).toBeNull();
      expect(s2.Sequence).toBeNull();
    });
  });

  // -------------------------------------------------------------
  // SequenceDefiningEdges (Sections 26-36)
  // -------------------------------------------------------------
  describe("SequenceDefiningEdges", () => {
    test("discovers defining edges and ends with Finish()", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      const edge = g.Connect(s1, s2);
      edge.ID = 42;

      const res = SequenceDefiningEdges(backgroundWorkContext(), g);
      expect(res.size).toBe(1);
      expect(res.has(42)).toBe(true);
    });

    test("throws WorkCanceledError for already-canceled context", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      g.Connect(s1, s2);

      const controller = new AbortController();
      controller.abort();

      expect(() => SequenceDefiningEdges(controller.signal, g)).toThrow("GetSequenceDefiningEdges: context canceled");
    });

    test("throws missing defining edge error when steps in sequence lack connecting edge", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);

      // Create a mock sequence in container that identifySequences wouldn't normally produce
      // but test the defensive branch:
      // If we disconnect edge between identifySequences and defining-edge resolution
      // We can test the exact branch by monkey-patching or passing a scenario
      const origEdges = s1.Edges;
      // In normal operation, identifySequences only finds connected steps.
      // But if steps[i-1].Edges has no connecting edge to steps[i], it throws:
      // "TALA sequence steps 1 and 2 have no defining edge"
      // Let's verify through identifySequences returning a pair whose edge was stripped:
      const edge = g.Connect(s1, s2);
      // Strip edge from s1.Edges right before defining-edge scan by getter:
      Object.defineProperty(s1, "Edges", {
        get() {
          const stack = new Error().stack || "";
          if (stack.includes("identifySequences") || stack.includes("validateEngineGraph")) {
            return [edge];
          }
          return [];
        },
        configurable: true,
      });

      expect(() => SequenceDefiningEdges(backgroundWorkContext(), g)).toThrow(
        "TALA sequence steps 1 and 2 have no defining edge"
      );
    });

    test("remains completely read-only on success and failure", () => {
      const g = new Graph();
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNewNodeToContainer(null, s1);
      g.AddNewNodeToContainer(null, s2);
      const edge = g.Connect(s1, s2);

      const nodesRef = g.Nodes;
      const edgesRef = g.Edges;
      const containersRef = g.Containers;

      SequenceDefiningEdges(backgroundWorkContext(), g);

      expect(g.Nodes).toBe(nodesRef);
      expect(g.Edges).toBe(edgesRef);
      expect(g.Containers).toBe(containersRef);
      expect(edge.From).toBe(s1);
      expect(edge.To).toBe(s2);
      expect(s1.Sequence).toBeNull();
      expect(s2.Sequence).toBeNull();
    });
  });

  // -------------------------------------------------------------
  // isValidRememberedSequence (Sections 37-46)
  // -------------------------------------------------------------
  describe("isValidRememberedSequence", () => {
    test("immediate false conditions charge zero work units", () => {
      const g = new Graph();
      const v = new Node(10, 0, 0);
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);

      // vessel == null
      const g1 = createGuard();
      expect(isValidRememberedSequence(g, null, new Sequence(), new Set(), g1)).toBe(false);
      expect(g1.Used()).toBe(0n);

      // sequence == null
      const g2 = createGuard();
      expect(isValidRememberedSequence(g, v, null, new Set(), g2)).toBe(false);
      expect(g2.Used()).toBe(0n);

      // sequence.IsActive() == true
      const g3 = createGuard();
      v.Graph = g; // Active!
      const activeSeq = new Sequence({ Vessel: v, Nodes: [s1, s2], Graph: g });
      expect(isValidRememberedSequence(g, v, activeSeq, new Set(), g3)).toBe(false);
      expect(g3.Used()).toBe(0n);
      v.Graph = null; // Reset

      // sequence.Vessel !== vessel
      const g4 = createGuard();
      const otherV = new Node(99, 0, 0);
      const diffVesselSeq = new Sequence({ Vessel: otherV, Nodes: [s1, s2], Graph: g });
      expect(isValidRememberedSequence(g, v, diffVesselSeq, new Set(), g4)).toBe(false);
      expect(g4.Used()).toBe(0n);

      // sequence.Graph !== graph
      const g5 = createGuard();
      const otherG = new Graph();
      const diffGraphSeq = new Sequence({ Vessel: v, Nodes: [s1, s2], Graph: otherG });
      expect(isValidRememberedSequence(g, v, diffGraphSeq, new Set(), g5)).toBe(false);
      expect(g5.Used()).toBe(0n);

      // sequence.Nodes.length < 2
      const g6 = createGuard();
      const shortSeq = new Sequence({ Vessel: v, Nodes: [s1], Graph: g });
      expect(isValidRememberedSequence(g, v, shortSeq, new Set(), g6)).toBe(false);
      expect(g6.Used()).toBe(0n);
    });

    test("inactive container or missing container key returns false", () => {
      const g = new Graph();
      const c = new Node(100, 100, 100);
      c.isContainer = true;
      const v = new Node(10, 0, 0);
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");

      const seq = new Sequence({
        Vessel: v,
        Nodes: [s1, s2],
        Graph: g,
        Container: c,
      });

      // c is not in activeNodes
      const guard1 = createGuard();
      expect(isValidRememberedSequence(g, v, seq, new Set(), guard1)).toBe(false);

      // c is in activeNodes, but g.Containers does not have c
      const active = new Set([c, s1, s2]);
      const guard2 = createGuard();
      expect(isValidRememberedSequence(g, v, seq, active, guard2)).toBe(false);
    });

    test("duplicate container child invalidates sequence", () => {
      const g = new Graph();
      const v = new Node(10, 0, 0);
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNode(s1);
      g.AddNode(s2);
      // Malformed container with duplicate s1
      g.Containers.set(null, [s1, s1, s2]);

      const seq = new Sequence({
        Vessel: v,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = seq;
      s2.Sequence = seq;

      const guard = createGuard();
      const valid = isValidRememberedSequence(g, v, seq, buildActiveSet(g), guard);
      expect(valid).toBe(false);
      // 3 children in container: charges 3 steps. Then 1st node s1 in sequence: charges 1 step => 4
      expect(guard.Used()).toBe(4n);
    });

    test("duplicate node in sequence.Nodes invalidates sequence", () => {
      const g = new Graph();
      const v = new Node(10, 0, 0);
      const s1 = new Node(1, 40, 30);
      s1.SetShape("Step");
      g.AddNode(s1);
      g.Containers.set(null, [s1]);

      const seq = new Sequence({
        Vessel: v,
        Nodes: [s1, s1], // duplicate in sequence
        Graph: g,
        Container: null,
      });
      s1.Sequence = seq;

      const guard = createGuard();
      const valid = isValidRememberedSequence(g, v, seq, buildActiveSet(g), guard);
      expect(valid).toBe(false);
      // container children: 1 step. 1st sequence node: 1 step. 2nd sequence node: 1 step => 3
      expect(guard.Used()).toBe(3n);
    });

    test("valid 2-step remembered sequence charges exact work units and requires NO defining edge", () => {
      const g = new Graph();
      const v = new Node(10, 0, 0);
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Step");
      s2.SetShape("Step");
      g.AddNode(s1);
      g.AddNode(s2);
      g.Containers.set(null, [s1, s2]);

      const seq = new Sequence({
        Vessel: v,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = seq;
      s2.Sequence = seq;

      // Note: NO edges between s1 and s2!
      const guard = createGuard();
      const valid = isValidRememberedSequence(g, v, seq, buildActiveSet(g), guard);
      expect(valid).toBe(true);
      // 2 children in container: 2 steps. 2 nodes in sequence: 2 steps => 4
      expect(guard.Used()).toBe(4n);
    });

    test("isValidRememberedSequence is strictly read-only and does not clear Node.Sequence", () => {
      const g = new Graph();
      const v = new Node(10, 0, 0);
      const s1 = new Node(1, 40, 30);
      const s2 = new Node(2, 40, 30);
      s1.SetShape("Square"); // Invalid shape
      s2.SetShape("Step");
      g.AddNode(s1);
      g.AddNode(s2);
      g.Containers.set(null, [s1, s2]);

      const seq = new Sequence({
        Vessel: v,
        Nodes: [s1, s2],
        Graph: g,
        Container: null,
      });
      s1.Sequence = seq;
      s2.Sequence = seq;

      const guard = createGuard();
      const valid = isValidRememberedSequence(g, v, seq, buildActiveSet(g), guard);
      expect(valid).toBe(false);
      // MUST NOT clear node.Sequence
      expect(s1.Sequence).toBe(seq);
      expect(s2.Sequence).toBe(seq);
    });
  });

  // -------------------------------------------------------------
  // hasNodeID (Sections 47-52)
  // -------------------------------------------------------------
  describe("hasNodeID", () => {
    test("finds ordinary Node", () => {
      const g = new Graph();
      g.AddNode(new Node(42, 10, 10));
      expect(hasNodeID(g, 42)).toBe(true);
      expect(hasNodeID(g, 42n)).toBe(true);
      expect(hasNodeID(g, 99)).toBe(false);
    });

    test("finds Cluster vessel and cluster children", () => {
      const g = new Graph();
      const vessel = new Node(100, 10, 10);
      const child = new Node(101, 10, 10);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [child] });
      g.Clusters.set(vessel, cluster);

      expect(hasNodeID(g, 100)).toBe(true);
      expect(hasNodeID(g, 101)).toBe(true);
      expect(hasNodeID(g, 102)).toBe(false);
    });

    test("finds Sequence vessel and sequence children", () => {
      const g = new Graph();
      const vessel = new Node(200, 10, 10);
      const child = new Node(201, 10, 10);
      const seq = new Sequence({ Vessel: vessel, Nodes: [child] });
      g.Sequences.set(vessel, seq);

      expect(hasNodeID(g, 200)).toBe(true);
      expect(hasNodeID(g, 201)).toBe(true);
      expect(hasNodeID(g, 202)).toBe(false);
    });

    test("finds Tree sentinel, tree root, and recursively nested children", () => {
      const g = new Graph();
      const sentinel = new Node(300, 10, 10);
      const rootNode = new Node(301, 10, 10);
      const childNode = new Node(302, 10, 10);
      const grandchild = new Node(303, 10, 10);

      const subTree = new Tree(grandchild);
      const childTree = new Tree(childNode);
      childTree.Children = [subTree];
      const rootTree = new Tree(rootNode);
      rootTree.Children = [childTree];

      g.Trees.set(sentinel, [rootTree]);

      expect(hasNodeID(g, 300)).toBe(true);
      expect(hasNodeID(g, 301)).toBe(true);
      expect(hasNodeID(g, 302)).toBe(true);
      expect(hasNodeID(g, 303)).toBe(true);
      expect(hasNodeID(g, 304)).toBe(false);
    });

    test("does not search non-source domains like Containers or Nears", () => {
      const g = new Graph();
      const phantom = new Node(999, 10, 10);
      // Put phantom only into Containers, not in Nodes/Clusters/Sequences/Trees
      g.Containers.set(null, [phantom]);

      expect(hasNodeID(g, 999)).toBe(false);
    });

    test("handles mixed Number and BigInt without precision loss", () => {
      const g = new Graph();
      const bigID = 9007199254740993n;
      g.AddNode(new Node(bigID, 10, 10));

      expect(hasNodeID(g, bigID)).toBe(true);
      expect(hasNodeID(g, 9007199254740993n)).toBe(true);
      expect(hasNodeID(g, 9007199254740994n)).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // nextAvailableNodeID (Sections 53-60)
  // -------------------------------------------------------------
  describe("nextAvailableNodeID", () => {
    test("returns candidate immediately when free in unavailable and absent in graph", () => {
      const g = new Graph();
      const reserved = new Set();
      expect(nextAvailableNodeID(g, 10, reserved)).toBe(10n);
    });

    test("advances past collisions in unavailable Set and graph domains", () => {
      const g = new Graph();
      g.AddNode(new Node(10, 0, 0));
      const reserved = new Set([11n, 12n]);

      // 10 is in graph.Nodes, 11 and 12 in reserved => next free is 13n
      expect(nextAvailableNodeID(g, 10, reserved)).toBe(13n);
    });

    test("supports free negative candidates", () => {
      const g = new Graph();
      const reserved = new Set();
      expect(nextAvailableNodeID(g, -5, reserved)).toBe(-5n);
    });

    test("wraps from INT64_MAX to 0n (Section 55)", () => {
      const g = new Graph();
      // INT64_MAX is occupied in unavailable
      const reserved = new Set([INT64_MAX]);
      // 0n is free
      const result = nextAvailableNodeID(g, INT64_MAX, reserved);
      expect(result).toBe(0n);
    });

    test("wraps from INT64_MAX to 0n and advances to 1n when 0n is also occupied (Section 56)", () => {
      const g = new Graph();
      // Both INT64_MAX and 0n are occupied
      const reserved = new Set([INT64_MAX, 0n]);
      // 1n is free
      const result = nextAvailableNodeID(g, INT64_MAX, reserved);
      expect(result).toBe(1n);
    });
  });
});
