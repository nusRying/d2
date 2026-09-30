import { describe, expect, test } from "bun:test";
import referenceData from "../fixtures/go-sequence-mutation-reference.json";

import {
  Graph,
  Node,
  Edge,
  Sequence,
  Point,
  WorkGuard,
  WorkContext,
  MAX_ENGINE_WORK_UNITS,
  backgroundWorkContext,
  WorkLimitError,
} from "../../src/index.js";

import {
  clearRememberedSequenceMembership,
  buildSequence,
  addSequence,
  abductSequenceEdges,
  addSequences,
} from "../../src/grouping/index.js";

import { GoRand } from "../../src/random/go-math-rand.js";

function createGuard(limit = MAX_ENGINE_WORK_UNITS) {
  return new WorkGuard(backgroundWorkContext(), "TestGuard", limit);
}

function createStepNode(id, width = 40, height = 30) {
  const node = new Node(id, width, height);
  node.setShape("Step");
  return node;
}

function connectWithID(g, id, from, to) {
  const edge = g.connect(from, to);
  edge.ID = BigInt(id);
  return edge;
}

function testCleanupSequences(graph) {
  for (const vessel of graph.sequenceOrder()) {
    const sequence = graph.Sequences.get(vessel);
    if (!sequence) continue;
    sequence.arrangeSteps();
    for (const node of sequence.Nodes) {
      graph.addNewNodeToContainer(sequence.Container, node);
    }
    for (const abduction of sequence.EdgeAbductions || []) {
      if (abduction.OriginallyFrom != null) {
        abduction.Edge.reconnect(abduction.OriginallyFrom, false);
      }
      if (abduction.OriginallyTo != null) {
        abduction.Edge.reconnect(abduction.OriginallyTo, true);
      }
    }
    graph.removeNode(sequence.Vessel);
    const updated = [];
    for (const child of graph.Containers.get(sequence.Container) || []) {
      if (child !== sequence.Vessel) {
        updated.push(child);
      }
    }
    graph.Containers.set(sequence.Container, updated);
    sequence.Vessel.Container = null;
    sequence.Vessel.Graph = null;
  }
}

function fingerprintGraph(g, relevantNodes = [], rng = null) {
  const nodes = (g.Nodes || []).map((n) => String(n.ID));

  const edges = (g.Edges || []).map((e) => ({
    id: String(e.ID),
    from: e.From ? String(e.From.ID) : "",
    to: e.To ? String(e.To.ID) : "",
  }));

  const containers = [];
  const containerKeys = [];
  if (g.Containers) {
    for (const c of g.Containers.keys()) {
      if (c !== null && c !== undefined) {
        containerKeys.push(c);
      }
    }
  }
  containerKeys.sort((a, b) => {
    const aID = BigInt(a.ID);
    const bID = BigInt(b.ID);
    if (aID < bID) return -1;
    if (aID > bID) return 1;
    return 0;
  });

  const allC = [null, ...containerKeys];
  for (const c of allC) {
    if (!g.Containers.has(c) && c !== null) {
      continue;
    }
    const children = g.Containers.get(c) || [];
    containers.push({
      container: c ? String(c.ID) : null,
      children: children.filter((x) => x != null).map((x) => String(x.ID)),
    });
  }

  const sequences = [];
  const vessels = g.sequenceOrder();
  for (const vessel of vessels) {
    const seq = g.Sequences.get(vessel);
    if (!seq) continue;
    sequences.push({
      vesselID: String(vessel.ID),
      width: vessel.Width,
      height: vessel.Height,
      topLeft: vessel.TopLeft ? { x: vessel.TopLeft.X, y: vessel.TopLeft.Y } : null,
      container: seq.Container ? String(seq.Container.ID) : null,
      members: (seq.Nodes || []).filter((m) => m != null).map((m) => String(m.ID)),
      edgeAbductions: (seq.EdgeAbductions && seq.EdgeAbductions.length > 0) ? (seq.EdgeAbductions || []).map((ea) => ({
        edgeID: String(ea.Edge.ID),
        originallyFrom: ea.OriginallyFrom ? String(ea.OriginallyFrom.ID) : null,
        originallyTo: ea.OriginallyTo ? String(ea.OriginallyTo.ID) : null,
        currentFrom: ea.CurrentFrom ? String(ea.CurrentFrom.ID) : null,
        currentTo: ea.CurrentTo ? String(ea.CurrentTo.ID) : null,
      })) : null,
    });
  }

  const seenNodes = new Set();
  const nodeList = [];
  for (const n of relevantNodes) {
    if (n && !seenNodes.has(n)) {
      seenNodes.add(n);
      nodeList.push(n);
    }
  }
  for (const n of g.Nodes || []) {
    if (n && !seenNodes.has(n)) {
      seenNodes.add(n);
      nodeList.push(n);
    }
  }
  if (g.Sequences) {
    for (const vessel of g.Sequences.keys()) {
      if (vessel && !seenNodes.has(vessel)) {
        seenNodes.add(vessel);
        nodeList.push(vessel);
      }
    }
  }

  nodeList.sort((a, b) => {
    const aID = BigInt(a.ID);
    const bID = BigInt(b.ID);
    if (aID < bID) return -1;
    if (aID > bID) return 1;
    return 0;
  });

  const inGraphSet = new Set(g.Nodes || []);
  const allNodes = nodeList.map((n) => ({
    id: String(n.ID),
    width: n.Width,
    height: n.Height,
    topLeft: n.TopLeft ? { x: n.TopLeft.X, y: n.TopLeft.Y } : null,
    container: n.Container ? String(n.Container.ID) : null,
    sequence: n.Sequence && n.Sequence.Vessel ? String(n.Sequence.Vessel.ID) : null,
    inGraph: inGraphSet.has(n),
  }));

  let nextInt63 = "";
  if (rng != null) {
    const draw = typeof rng.Int63 === "function" ? rng.Int63() : rng.int63();
    nextInt63 = String(draw);
  }

  return {
    nodes,
    edges,
    containers,
    sequences,
    allNodes,
    nextInt63,
  };
}

describe("Slice 12 Go Sequence Mutation Reference Oracle Replay", () => {
  const scenarios = referenceData.scenarios;

  // -------------------------------------------------------------------------
  // 1. clearRememberedSequenceMembership Oracle
  // -------------------------------------------------------------------------
  describe("clearRememberedSequenceMembership Go Parity", () => {
    const clearRef = scenarios.clearRememberedSequenceMembership;

    test("nil_sequence", () => {
      const expected = clearRef.nil_sequence;
      const guard = createGuard(100);
      expect(() => clearRememberedSequenceMembership(null, guard)).not.toThrow();
      expect(guard.Used()).toBe(BigInt(expected.guardUsed));
    });

    test("empty_nodes", () => {
      const expected = clearRef.empty_nodes;
      const guard = createGuard(100);
      const seq = new Sequence({ Nodes: [] });
      expect(() => clearRememberedSequenceMembership(seq, guard)).not.toThrow();
      expect(guard.Used()).toBe(BigInt(expected.guardUsed));
    });

    test("normal_two_node", () => {
      const expected = clearRef.normal_two_node;
      const guard = createGuard(100);
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const seq = new Sequence({ Nodes: [s1, s2] });
      s1.Sequence = seq;
      s2.Sequence = seq;

      clearRememberedSequenceMembership(seq, guard);

      expect(s1.Sequence === null).toBe(expected.n1SeqCleared);
      expect(s2.Sequence === null).toBe(expected.n2SeqCleared);
      expect(guard.Used()).toBe(BigInt(expected.guardUsed));
    });

    test("nil_member", () => {
      const expected = clearRef.nil_member;
      const guard = createGuard(100);
      const s3 = createStepNode(3);
      const s4 = createStepNode(4);
      const seq = new Sequence({ Nodes: [s3, null, s4] });
      s3.Sequence = seq;
      s4.Sequence = seq;

      clearRememberedSequenceMembership(seq, guard);

      expect(s3.Sequence === null).toBe(expected.n3SeqCleared);
      expect(s4.Sequence === null).toBe(expected.n4SeqCleared);
      expect(guard.Used()).toBe(BigInt(expected.guardUsed));
    });

    test("member_other_sequence", () => {
      const expected = clearRef.member_other_sequence;
      const guard = createGuard(100);
      const s5 = createStepNode(5);
      const s6 = createStepNode(6);
      const seqA = new Sequence({ Nodes: [s5, s6] });
      const seqOther = new Sequence({ Nodes: [s6] });
      s5.Sequence = seqA;
      s6.Sequence = seqOther;

      clearRememberedSequenceMembership(seqA, guard);

      expect(s5.Sequence === null).toBe(expected.n5SeqCleared);
      expect(s6.Sequence === seqOther).toBe(expected.n6SeqUntouched);
      expect(guard.Used()).toBe(BigInt(expected.guardUsed));
    });

    test("duplicate_member", () => {
      const expected = clearRef.duplicate_member;
      const guard = createGuard(100);
      const s7 = createStepNode(7);
      const seq = new Sequence({ Nodes: [s7, s7] });
      s7.Sequence = seq;

      clearRememberedSequenceMembership(seq, guard);

      expect(s7.Sequence === null).toBe(expected.n7SeqCleared);
      expect(guard.Used()).toBe(BigInt(expected.guardUsed));
    });

    test("work_guard_limit_partial", () => {
      const expected = clearRef.work_guard_limit_partial;
      const guard = createGuard(1);
      const s8 = createStepNode(8);
      const s9 = createStepNode(9);
      const seq = new Sequence({ Nodes: [s8, s9] });
      s8.Sequence = seq;
      s9.Sequence = seq;

      expect(() => clearRememberedSequenceMembership(seq, guard)).toThrow(WorkLimitError);
      expect(s8.Sequence === null).toBe(expected.n8SeqCleared);
      expect(s9.Sequence === seq).toBe(expected.n9SeqRetained);
      expect(guard.Used()).toBe(BigInt(expected.guardUsed));
    });
  });

  // -------------------------------------------------------------------------
  // 2. buildSequence Oracle
  // -------------------------------------------------------------------------
  describe("buildSequence Go Parity", () => {
    const buildRef = scenarios.buildSequence;

    test("two_step_unpositioned", () => {
      const exp = buildRef.two_step_unpositioned;
      const g = new Graph();
      const s1 = createStepNode(1, 40, 30);
      const s2 = createStepNode(2, 40, 30);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      const e1 = connectWithID(g, 10, s1, s2);

      const seq = buildSequence([s1, s2], g, null, 100n);

      expect(String(seq.Vessel.ID)).toBe(exp.vesselID);
      expect(seq.Vessel.Width).toBe(exp.vesselWidth);
      expect(seq.Vessel.Height).toBe(exp.vesselHeight);
      expect(seq.Vessel.TopLeft === null).toBe(exp.vesselTopLeft);
      expect(s1.Width).toBe(exp.s1Width);
      expect(s1.Height).toBe(exp.s1Height);
      expect(s2.Width).toBe(exp.s2Width);
      expect(s2.Height).toBe(exp.s2Height);
      expect(g.Edges.length === 0 && s1.connectionTo(s2) === null).toBe(exp.definingEdgeRemoved);
      expect(String(e1.ID)).toBe(exp.originalEdgeID);
    });

    test("three_step_positioned", () => {
      const exp = buildRef.three_step_positioned;
      const g = new Graph();
      const s1 = createStepNode(1, 40, 30);
      const s2 = createStepNode(2, 40, 20);
      const s3 = createStepNode(3, 40, 50);
      s1.TopLeft = new Point(10, 20);
      s2.TopLeft = new Point(50, 15);
      s3.TopLeft = new Point(90, 30);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, s3);
      connectWithID(g, 11, s1, s2);
      connectWithID(g, 12, s2, s3);

      const seq = buildSequence([s1, s2, s3], g, null, 200n);

      expect(String(seq.Vessel.ID)).toBe(exp.vesselID);
      expect(seq.Vessel.Width).toBe(exp.vesselWidth);
      expect(seq.Vessel.Height).toBe(exp.vesselHeight);
      expect(seq.Vessel.TopLeft.X).toBe(exp.vesselTLX);
      expect(seq.Vessel.TopLeft.Y).toBe(exp.vesselTLY);
      expect([s1.Height, s2.Height, s3.Height]).toEqual(exp.stepHeights);
    });

    test("narrow_width", () => {
      const exp = buildRef.narrow_width;
      const g = new Graph();
      const sn = createStepNode(1, 20, 30);
      const sNorm = createStepNode(2, 50, 30);
      g.addNewNodeToContainer(null, sn);
      g.addNewNodeToContainer(null, sNorm);

      buildSequence([sn, sNorm], g, null, 300n);

      expect(sn.Width).toBe(exp.snWidth);
      expect(sNorm.Width).toBe(exp.sNormWidth);
    });

    test("width_exactly_wedge", () => {
      const exp = buildRef.width_exactly_wedge;
      const g = new Graph();
      const sWedge = createStepNode(1, 35, 30);
      g.addNewNodeToContainer(null, sWedge);

      buildSequence([sWedge], g, null, 400n);

      expect(sWedge.Width).toBe(exp.sWedgeWidth);
    });

    test("all_negative_heights", () => {
      const exp = buildRef.all_negative_heights;
      const g = new Graph();
      const sNeg1 = createStepNode(1, 40, -10);
      const sNeg2 = createStepNode(2, 40, -5);
      g.addNewNodeToContainer(null, sNeg1);
      g.addNewNodeToContainer(null, sNeg2);

      buildSequence([sNeg1, sNeg2], g, null, 500n);

      expect(sNeg1.Height).toBe(exp.height1);
      expect(sNeg2.Height).toBe(exp.height2);
    });

    test("remembered_rebuild_no_edge", () => {
      const exp = buildRef.remembered_rebuild_no_edge;
      const g = new Graph();
      const sa = createStepNode(1, 40, 30);
      const sb = createStepNode(2, 40, 30);
      g.addNewNodeToContainer(null, sa);
      g.addNewNodeToContainer(null, sb);

      const seq = buildSequence([sa, sb], g, null, 600n);

      expect(String(seq.Vessel.ID)).toBe(exp.vesselID);
      expect(seq.Nodes.length).toBe(exp.nodesCount);
    });

    test("parallel_defining_edges", () => {
      const exp = buildRef.parallel_defining_edges;
      const g = new Graph();
      const p1 = createStepNode(1, 40, 30);
      const p2 = createStepNode(2, 40, 30);
      g.addNewNodeToContainer(null, p1);
      g.addNewNodeToContainer(null, p2);
      const eFirst = connectWithID(g, 101, p1, p2);
      const eSecond = connectWithID(g, 102, p1, p2);

      buildSequence([p1, p2], g, null, 700n);

      expect(g.Edges.length).toBe(exp.remainingEdges);
      expect(String(g.Edges[0].ID)).toBe(exp.survivingEdgeID);
      expect(g.Edges[0] === eSecond).toBe(exp.survivingMatchesSecond);
    });

    test("external_and_internal_edges", () => {
      const exp = buildRef.external_and_internal_edges;
      const g = new Graph();
      const stepA = createStepNode(1, 40, 30);
      const stepB = createStepNode(2, 40, 30);
      const stepC = createStepNode(3, 40, 30);
      const extOut = new Node(4, 40, 30);
      const extIn = new Node(5, 40, 30);
      g.addNewNodeToContainer(null, stepA);
      g.addNewNodeToContainer(null, stepB);
      g.addNewNodeToContainer(null, stepC);
      g.addNewNodeToContainer(null, extOut);
      g.addNewNodeToContainer(null, extIn);
      connectWithID(g, 1, stepA, stepB);
      connectWithID(g, 2, stepB, stepC);
      const eOutgoing = connectWithID(g, 3, stepA, extOut);
      const eIncoming = connectWithID(g, 4, extIn, stepC);
      const eInternal = connectWithID(g, 5, stepA, stepC);

      const seq = buildSequence([stepA, stepB, stepC], g, null, 800n);

      expect(seq.EdgeAbductions.length).toBe(exp.abductionsCount);
      expect(String(eOutgoing.From.ID)).toBe(exp.outgoingCurrentFrom);
      expect(String(eOutgoing.To.ID)).toBe(exp.outgoingCurrentTo);
      expect(String(eIncoming.From.ID)).toBe(exp.incomingCurrentFrom);
      expect(String(eIncoming.To.ID)).toBe(exp.incomingCurrentTo);
      expect(String(eInternal.From.ID)).toBe(exp.internalFrom);
      expect(String(eInternal.To.ID)).toBe(exp.internalTo);
    });
  });

  // -------------------------------------------------------------------------
  // 3. abductSequenceEdges Oracle
  // -------------------------------------------------------------------------
  describe("abductSequenceEdges Go Parity", () => {
    const abductRef = scenarios.abductSequenceEdges.direct_abduction;

    test("direct_abduction", () => {
      const g = new Graph();
      const s1 = createStepNode(1, 40, 30);
      const s2 = createStepNode(2, 40, 30);
      const ext1 = new Node(3, 40, 30);
      const ext2 = new Node(4, 40, 30);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, ext1);
      g.addNewNodeToContainer(null, ext2);
      const eOut = connectWithID(g, 201, s1, ext1);
      const eIn = connectWithID(g, 202, ext2, s2);
      const eInternal = connectWithID(g, 203, s1, s2);

      const vessel = new Node(999n, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
      });

      abductSequenceEdges(seq);

      const actualAbductions = seq.EdgeAbductions.map((ea) => ({
        edgeID: String(ea.Edge.ID),
        originallyFrom: ea.OriginallyFrom ? String(ea.OriginallyFrom.ID) : null,
        originallyTo: ea.OriginallyTo ? String(ea.OriginallyTo.ID) : null,
        currentFrom: ea.CurrentFrom ? String(ea.CurrentFrom.ID) : null,
        currentTo: ea.CurrentTo ? String(ea.CurrentTo.ID) : null,
      }));

      expect(actualAbductions).toEqual(abductRef.abductions);
      expect(String(eOut.From.ID)).toBe(abductRef.eOutFrom);
      expect(String(eOut.To.ID)).toBe(abductRef.eOutTo);
      expect(String(eIn.From.ID)).toBe(abductRef.eInFrom);
      expect(String(eIn.To.ID)).toBe(abductRef.eInTo);
      expect(String(eInternal.From.ID)).toBe(abductRef.eInternalFrom);
      expect(String(eInternal.To.ID)).toBe(abductRef.eInternalTo);
    });
  });

  // -------------------------------------------------------------------------
  // 4. addSequence Oracle
  // -------------------------------------------------------------------------
  describe("addSequence Go Parity", () => {
    const addRef = scenarios.addSequence.direct_add_sequence;

    test("direct_add_sequence", () => {
      const g = new Graph();
      const container = new Node(10, 100, 100);
      container.isContainer = true;
      g.addNewNodeToContainer(null, container);

      const unrelated1 = new Node(11, 40, 30);
      const s1 = createStepNode(1, 40, 30);
      const s2 = createStepNode(2, 40, 30);
      const unrelated2 = new Node(12, 40, 30);
      g.addNewNodeToContainer(container, unrelated1);
      g.addNewNodeToContainer(container, s1);
      g.addNewNodeToContainer(container, s2);
      g.addNewNodeToContainer(container, unrelated2);

      const vessel = new Node(500n, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: container,
      });

      addSequence(g, seq);

      expect(g.Nodes.includes(vessel)).toBe(addRef.vesselInGraphNodes);
      expect(g.Nodes.includes(s1)).toBe(addRef.s1InGraphNodes);
      expect(g.Nodes.includes(s2)).toBe(addRef.s2InGraphNodes);

      const children = (g.Containers.get(container) || []).map((c) => String(c.ID));
      expect(children).toEqual(addRef.containerChildren);

      expect(s1.Sequence === seq).toBe(addRef.s1SequencePointsSeq);
      expect(s2.Sequence === seq).toBe(addRef.s2SequencePointsSeq);
      expect(s1.Container ? String(s1.Container.ID) : null).toBe(addRef.s1Container);
      expect(s2.Container ? String(s2.Container.ID) : null).toBe(addRef.s2Container);
      expect(s1.Graph === g).toBe(addRef.s1Graph);
      expect(s2.Graph === g).toBe(addRef.s2Graph);
      expect(g.Sequences.get(vessel) === seq).toBe(addRef.seqInMap);
      expect(vessel.Graph === g).toBe(addRef.vesselGraph);
      expect(vessel.Container ? String(vessel.Container.ID) : null).toBe(addRef.vesselContainer);
    });
  });

  // -------------------------------------------------------------------------
  // 5. AddSequences Public Scenarios Go Fingerprint Parity
  // -------------------------------------------------------------------------
  describe("AddSequences Public Scenarios Go Fingerprint Parity", () => {
    const addRef = scenarios.addSequences;

    test("simple_two_step", () => {
      const expectedFP = addRef.simple_two_step;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      const rng = new GoRand(1);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("three_step_chain", () => {
      const expectedFP = addRef.three_step_chain;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const s3 = createStepNode(3);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, s3);
      connectWithID(g, 10, s1, s2);
      connectWithID(g, 11, s2, s3);

      const rng = new GoRand(42);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2, s3], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("two_separate_runs", () => {
      const expectedFP = addRef.two_separate_runs;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const s3 = createStepNode(3);
      const s4 = createStepNode(4);
      for (const s of [s1, s2, s3, s4]) {
        g.addNewNodeToContainer(null, s);
      }
      connectWithID(g, 10, s1, s2);
      connectWithID(g, 11, s3, s4);

      const rng = new GoRand(77);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2, s3, s4], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("no_sequence_candidates", () => {
      const expectedFP = addRef.no_sequence_candidates;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      connectWithID(g, 10, n1, n2);

      const rng = new GoRand(1);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [n1, n2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("fixed_step_skipped", () => {
      const expectedFP = addRef.fixed_step_skipped;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      s1.FixedTopLeft = new Point(0, 0);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      const rng = new GoRand(1);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("container_step_skipped", () => {
      const expectedFP = addRef.container_step_skipped;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      s1.isContainer = true;
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      const rng = new GoRand(1);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("nested_containers", () => {
      const expectedFP = addRef.nested_containers;
      const g = new Graph();
      const parent = new Node(10, 100, 100);
      parent.isContainer = true;
      g.addNewNodeToContainer(null, parent);

      const child = new Node(20, 80, 80);
      child.isContainer = true;
      g.addNewNodeToContainer(parent, child);

      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(child, s1);
      g.addNewNodeToContainer(child, s2);
      connectWithID(g, 10, s1, s2);

      const rng = new GoRand(123);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [parent, child, s1, s2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("multiple_containers_rdfs", () => {
      const expectedFP = addRef.multiple_containers_rdfs;
      const g = new Graph();
      const cB = new Node(100, 100, 100);
      cB.isContainer = true;
      const cA = new Node(200, 100, 100);
      cA.isContainer = true;
      g.addNewNodeToContainer(null, cB);
      g.addNewNodeToContainer(null, cA);

      const sA1 = createStepNode(1);
      const sA2 = createStepNode(2);
      g.addNewNodeToContainer(cA, sA1);
      g.addNewNodeToContainer(cA, sA2);
      connectWithID(g, 10, sA1, sA2);

      const sB1 = createStepNode(3);
      const sB2 = createStepNode(4);
      g.addNewNodeToContainer(cB, sB1);
      g.addNewNodeToContainer(cB, sB2);
      connectWithID(g, 20, sB1, sB2);

      const rng = new GoRand(99);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [cA, cB, sA1, sA2, sB1, sB2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("external_edge_abduction", () => {
      const expectedFP = addRef.external_edge_abduction;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const extOut = new Node(3, 40, 30);
      const extIn = new Node(4, 40, 30);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, extOut);
      g.addNewNodeToContainer(null, extIn);
      connectWithID(g, 1, s1, s2);
      connectWithID(g, 2, s2, extOut);
      connectWithID(g, 3, extIn, s1);

      const rng = new GoRand(5);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2, extOut, extIn], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("positioned_step_geometry", () => {
      const expectedFP = addRef.positioned_step_geometry;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      s1.TopLeft = new Point(25, 40);
      s2.TopLeft = new Point(60, 15);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      const rng = new GoRand(7);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("narrow_step_geometry", () => {
      const expectedFP = addRef.narrow_step_geometry;
      const g = new Graph();
      const s1 = createStepNode(1, 20, 30);
      const s2 = createStepNode(2, 35, 30);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      const rng = new GoRand(8);
      addSequences(backgroundWorkContext(), g, rng);

      const actualFP = fingerprintGraph(g, [s1, s2], rng);
      expect(actualFP).toEqual(expectedFP);
    });

    test("valid_remembered_rebuild", () => {
      const expected = addRef.valid_remembered_rebuild;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      const rng1 = new GoRand(1);
      addSequences(backgroundWorkContext(), g, rng1);

      let oldVessel = null;
      for (const v of g.Sequences.keys()) {
        oldVessel = v;
      }
      expect(String(oldVessel.ID)).toBe(expected.oldVesselID);

      // Simulate Cleanup (as tested in Go Cleanup)
      testCleanupSequences(g);

      // Rebuild with different seed (999)
      const rng2 = new GoRand(999);
      addSequences(backgroundWorkContext(), g, rng2);

      let newVessel = null;
      for (const v of g.Sequences.keys()) {
        newVessel = v;
      }
      expect(String(newVessel.ID)).toBe(expected.newVesselID);
      expect(oldVessel.ID === newVessel.ID).toBe(expected.idsMatch);

      const actualFP = fingerprintGraph(g, [s1, s2], rng2);
      expect(actualFP).toEqual(expected.fingerprint);
    });

    test("stale_remembered_shape", () => {
      const expected = addRef.stale_remembered_shape;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      addSequences(backgroundWorkContext(), g, new GoRand(1));

      // Simulate Cleanup & shape mutation
      testCleanupSequences(g);
      s1.setShape("Square"); // Mutate shape

      const rng = new GoRand(2);
      addSequences(backgroundWorkContext(), g, rng);

      expect(g.Sequences.size).toBe(expected.seqCount);
      expect(s1.Sequence === null).toBe(expected.s1Seq);
      expect(s2.Sequence === null).toBe(expected.s2Seq);
      expect(fingerprintGraph(g, [s1, s2], rng)).toEqual(expected.fingerprint);
    });

    test("stale_remembered_container", () => {
      const expected = addRef.stale_remembered_container;
      const g = new Graph();
      const c1 = new Node(10, 100, 100);
      c1.isContainer = true;
      const c2 = new Node(20, 100, 100);
      c2.isContainer = true;
      g.addNewNodeToContainer(null, c1);
      g.addNewNodeToContainer(null, c2);

      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(c1, s1);
      g.addNewNodeToContainer(c1, s2);
      connectWithID(g, 10, s1, s2);

      addSequences(backgroundWorkContext(), g, new GoRand(1));

      // Simulate Cleanup & move s2 to c2
      testCleanupSequences(g);
      g.Containers.set(c1, [s1]);
      g.addNewNodeToContainer(c2, s2);

      const rng = new GoRand(2);
      addSequences(backgroundWorkContext(), g, rng);

      expect(g.Sequences.size).toBe(expected.seqCount);
      expect(fingerprintGraph(g, [c1, c2, s1, s2], rng)).toEqual(expected.fingerprint);
    });

    test("stale_remembered_noncontiguous", () => {
      const expected = addRef.stale_remembered_noncontiguous;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const other = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      addSequences(backgroundWorkContext(), g, new GoRand(1));

      // Simulate Cleanup & noncontiguous placement
      testCleanupSequences(g);
      g.Containers.set(null, [s1, other, s2]);

      const rng = new GoRand(3);
      addSequences(backgroundWorkContext(), g, rng);

      expect(g.Sequences.size).toBe(expected.seqCount);
      expect(fingerprintGraph(g, [s1, s2, other], rng)).toEqual(expected.fingerprint);
    });

    test("removed_remembered_member", () => {
      const expected = addRef.removed_remembered_member;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      addSequences(backgroundWorkContext(), g, new GoRand(1));

      // Simulate Cleanup & remove s2
      testCleanupSequences(g);
      g.removeNode(s2);

      const rng = new GoRand(4);
      addSequences(backgroundWorkContext(), g, rng);

      expect(g.Sequences.size).toBe(expected.seqCount);
      expect(g.Nodes.includes(s2)).toBe(expected.s2InNodes);
      expect(fingerprintGraph(g, [s1, s2], rng)).toEqual(expected.fingerprint);
    });

    test("ordinary_id_collision_seed_19", () => {
      const expected = addRef.ordinary_id_collision_seed_19;
      const g = new Graph();

      const probe = new GoRand(19);
      const firstDraw = probe.Int63();
      const probeNextDraw = probe.Int63();

      const collidingNode = new Node(firstDraw, 10, 10);
      g.addNewNodeToContainer(null, collidingNode);

      const s1 = createStepNode(100);
      const s2 = createStepNode(101);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 20, s1, s2);

      const layoutRand = new GoRand(19);
      addSequences(backgroundWorkContext(), g, layoutRand);

      let vesselID = null;
      for (const v of g.Sequences.keys()) {
        vesselID = v.ID;
      }

      const nextDraw = layoutRand.Int63();

      expect(String(firstDraw)).toBe(expected.firstDraw);
      expect(String(vesselID)).toBe(expected.expectedVessel);
      expect(String(vesselID)).toBe(expected.resolvedVessel);
      expect(String(nextDraw)).toBe(expected.nextDraw);
      expect(String(nextDraw)).toBe(expected.probeNextDraw);
      expect(nextDraw === probeNextDraw).toBe(expected.streamParity);

      expect(fingerprintGraph(g, [collidingNode, s1, s2], layoutRand)).toEqual(expected.fingerprint);
    });

    test("remembered_ids_reserved_across_containers_seed_73", () => {
      const expected = addRef.remembered_ids_reserved_across_containers_seed_73;
      const g = new Graph();

      const cB = new Node(100, 100, 100);
      cB.isContainer = true;
      const cA = new Node(200, 100, 100);
      cA.isContainer = true;
      g.addNewNodeToContainer(null, cB);
      g.addNewNodeToContainer(null, cA);

      const addSteps = (container, firstID) => {
        const first = createStepNode(firstID);
        const second = createStepNode(firstID + 1);
        g.addNewNodeToContainer(container, first);
        g.addNewNodeToContainer(container, second);
        connectWithID(g, firstID + 1000, first, second);
        return [first, second];
      };

      const oldA = addSteps(cA, 1);
      const oldB = addSteps(cB, 3);

      const seed = 73;
      addSequences(backgroundWorkContext(), g, new GoRand(seed));

      const oldAID = oldA[0].Sequence.Vessel.ID;
      const oldBID = oldB[0].Sequence.Vessel.ID;
      expect(String(oldAID)).toBe(expected.oldAID);
      expect(String(oldBID)).toBe(expected.oldBID);

      // Simulate Cleanup on g
      testCleanupSequences(g);

      const newA = addSteps(cA, 5);

      const rng = new GoRand(seed);
      addSequences(backgroundWorkContext(), g, rng);

      expect(String(newA[0].Sequence.Vessel.ID)).toBe(expected.newAVesselID);
      expect(newA[0].Sequence.Vessel.ID !== oldBID).toBe(expected.newADidNotReuseB);
      expect(g.Sequences.size).toBe(expected.sequenceCount);

      const allVesselIDs = [];
      for (const v of g.Sequences.keys()) {
        allVesselIDs.push(String(v.ID));
      }
      allVesselIDs.sort();
      expect(allVesselIDs).toEqual(expected.allVesselIDs);

      const allSteps = [...oldA, ...oldB, ...newA];
      expect(fingerprintGraph(g, allSteps, rng)).toEqual(expected.fingerprint);
    });

    test("stale_remembered_membership", () => {
      const expected = addRef.stale_remembered_membership;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      connectWithID(g, 10, s1, s2);

      addSequences(backgroundWorkContext(), g, new GoRand(1));

      // Simulate Cleanup & clear s1.Sequence
      testCleanupSequences(g);
      s1.Sequence = null;

      const rng = new GoRand(5);
      addSequences(backgroundWorkContext(), g, rng);

      expect(g.Sequences.size).toBe(expected.seqCount);
      expect(s1.Sequence === null).toBe(expected.s1Seq);
      expect(s2.Sequence === null).toBe(expected.s2Seq);
      expect(fingerprintGraph(g, [s1, s2], rng)).toEqual(expected.fingerprint);
    });

    test("repeated_deterministic_reconstruction", () => {
      const expected = addRef.repeated_deterministic_reconstruction;
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const s3 = createStepNode(3);
      const ext = new Node(99, 50, 50);
      s1.TopLeft = new Point(10, 20);
      s2.TopLeft = new Point(60, 20);
      s3.TopLeft = new Point(110, 20);
      ext.TopLeft = new Point(200, 20);

      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, s3);
      g.addNewNodeToContainer(null, ext);
      connectWithID(g, 10, s1, s2);
      connectWithID(g, 11, s2, s3);
      connectWithID(g, 12, s3, ext);

      const runSeed = 42;

      // Initial creation
      addSequences(backgroundWorkContext(), g, new GoRand(runSeed));

      // First reconstruction: Cleanup + AddSequences
      testCleanupSequences(g);
      const rngA = new GoRand(runSeed);
      addSequences(backgroundWorkContext(), g, rngA);
      const fpA = fingerprintGraph(g, [s1, s2, s3, ext], rngA);

      // Second reconstruction: Cleanup + AddSequences
      testCleanupSequences(g);
      const rngB = new GoRand(runSeed);
      addSequences(backgroundWorkContext(), g, rngB);
      const fpB = fingerprintGraph(g, [s1, s2, s3, ext], rngB);

      expect(fpA).toEqual(expected.fingerprintA);
      expect(fpB).toEqual(expected.fingerprintB);
      expect(fpA).toEqual(fpB);
    });
  });
});
