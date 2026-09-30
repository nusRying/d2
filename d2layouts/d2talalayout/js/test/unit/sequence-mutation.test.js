import { describe, expect, test } from "bun:test";

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
  WorkCanceledError,
  STEP_WEDGE_WIDTH,
  Validate,
} from "../../src/index.js";

import {
  clearRememberedSequenceMembership,
  buildSequence,
  addSequence,
  abductSequenceEdges,
  addSequences,
  AddSequences,
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

describe("Slice 12 Sequence Mutation Unit Tests", () => {
  // -------------------------------------------------------------------------
  // 1. clearRememberedSequenceMembership
  // -------------------------------------------------------------------------
  describe("clearRememberedSequenceMembership", () => {
    test("handles null sequence without error or work consumption", () => {
      const guard = createGuard(100);
      expect(() => clearRememberedSequenceMembership(null, guard)).not.toThrow();
      expect(guard.Used()).toBe(0n);
    });

    test("handles sequence with empty Nodes without error or work consumption", () => {
      const guard = createGuard(100);
      const seq = new Sequence({ Nodes: [] });
      expect(() => clearRememberedSequenceMembership(seq, guard)).not.toThrow();
      expect(guard.Used()).toBe(0n);
    });

    test("clears node.Sequence on matching sequence nodes and charges 1 step per node", () => {
      const guard = createGuard(100);
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const seq = new Sequence({ Nodes: [s1, s2] });
      s1.Sequence = seq;
      s2.Sequence = seq;

      clearRememberedSequenceMembership(seq, guard);

      expect(s1.Sequence).toBeNull();
      expect(s2.Sequence).toBeNull();
      expect(guard.Used()).toBe(2n);
    });

    test("skips null member nodes and nodes belonging to another sequence", () => {
      const guard = createGuard(100);
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const s3 = createStepNode(3);
      const otherSeq = new Sequence();

      const seq = new Sequence({ Nodes: [s1, null, s2, s3] });
      s1.Sequence = seq;
      s2.Sequence = otherSeq; // different sequence!
      s3.Sequence = seq;

      clearRememberedSequenceMembership(seq, guard);

      expect(s1.Sequence).toBeNull();
      expect(s2.Sequence).toBe(otherSeq);
      expect(s3.Sequence).toBeNull();
      expect(guard.Used()).toBe(4n);
    });

    test("charges work for duplicate member references", () => {
      const guard = createGuard(100);
      const s1 = createStepNode(1);
      const seq = new Sequence({ Nodes: [s1, s1, s1] });
      s1.Sequence = seq;

      clearRememberedSequenceMembership(seq, guard);

      expect(s1.Sequence).toBeNull();
      expect(guard.Used()).toBe(3n);
    });

    test("preserves partial mutations if guard limit throws partway through", () => {
      const guard = createGuard(1); // Limit 1 unit
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const seq = new Sequence({ Nodes: [s1, s2] });
      s1.Sequence = seq;
      s2.Sequence = seq;

      expect(() => clearRememberedSequenceMembership(seq, guard)).toThrow(WorkLimitError);
      expect(s1.Sequence).toBeNull();
      expect(s2.Sequence).toBe(seq);
      expect(guard.Used()).toBe(2n); // Rejected unit is counted in Used
    });
  });

  // -------------------------------------------------------------------------
  // 2. buildSequence
  // -------------------------------------------------------------------------
  describe("buildSequence", () => {
    test("normalizes width <= STEP_WEDGE_WIDTH (35.0) to 2 * STEP_WEDGE_WIDTH (70.0)", () => {
      const g = new Graph();
      const s1 = createStepNode(1, 20, 30);
      const s2 = createStepNode(2, 35, 30);
      const s3 = createStepNode(3, 50, 30); // > 35, preserved
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, s3);

      buildSequence([s1, s2, s3], g, null, 100n);

      expect(s1.Width).toBe(70);
      expect(s2.Width).toBe(70);
      expect(s3.Width).toBe(50);
    });

    test("normalizes all step heights to maxHeight starting at 0", () => {
      const g = new Graph();
      const s1 = createStepNode(1, 40, 20);
      const s2 = createStepNode(2, 40, 45);
      const s3 = createStepNode(3, 40, 15);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, s3);

      buildSequence([s1, s2, s3], g, null, 100n);

      expect(s1.Height).toBe(45);
      expect(s2.Height).toBe(45);
      expect(s3.Height).toBe(45);
    });

    test("normalizes all-negative heights to 0.0", () => {
      const g = new Graph();
      const s1 = createStepNode(1, 40, -10);
      const s2 = createStepNode(2, 40, -5);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);

      buildSequence([s1, s2], g, null, 100n);

      expect(s1.Height).toBe(0);
      expect(s2.Height).toBe(0);
    });

    test("disconnects defining edge between consecutive steps", () => {
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      const edge = g.connect(s1, s2);

      buildSequence([s1, s2], g, null, 100n);

      expect(g.Edges.includes(edge)).toBe(false);
      expect(s1.connectionTo(s2)).toBeNull();
    });

    test("succeeds when defining edge is already absent (remembered sequence rebuild)", () => {
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);

      let seq = null;
      expect(() => {
        seq = buildSequence([s1, s2], g, null, 100n);
      }).not.toThrow();
      expect(seq).not.toBeNull();
      expect(seq.Nodes.length).toBe(2);
    });

    test("disconnects only first connection when parallel defining edges exist", () => {
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      const e1 = g.connect(s1, s2);
      const e2 = g.connect(s1, s2);

      buildSequence([s1, s2], g, null, 100n);

      expect(g.Edges.length).toBe(1);
      expect(g.Edges[0]).toBe(e2);
      expect(g.Edges.includes(e1)).toBe(false);
    });

    test("positions vessel at min coordinates when steps are positioned, or leaves TopLeft null if unpositioned", () => {
      const g1 = new Graph();
      const u1 = createStepNode(1);
      const u2 = createStepNode(2);
      g1.addNewNodeToContainer(null, u1);
      g1.addNewNodeToContainer(null, u2);
      const seqUnpos = buildSequence([u1, u2], g1, null, 100n);
      expect(seqUnpos.Vessel.TopLeft).toBeNull();

      const g2 = new Graph();
      const p1 = createStepNode(1);
      const p2 = createStepNode(2);
      p1.TopLeft = new Point(25, 40);
      p2.TopLeft = new Point(60, 15);
      g2.addNewNodeToContainer(null, p1);
      g2.addNewNodeToContainer(null, p2);
      const seqPos = buildSequence([p1, p2], g2, null, 200n);
      expect(seqPos.Vessel.TopLeft).not.toBeNull();
      expect(seqPos.Vessel.TopLeft.X).toBe(25);
      expect(seqPos.Vessel.TopLeft.Y).toBe(15);
    });
  });

  // -------------------------------------------------------------------------
  // 3. abductSequenceEdges
  // -------------------------------------------------------------------------
  describe("abductSequenceEdges", () => {
    test("reconnects external edges and records EdgeAbductions while leaving internal edges untouched", () => {
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const extOut = new Node(3, 40, 30);
      const extIn = new Node(4, 40, 30);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.addNewNodeToContainer(null, extOut);
      g.addNewNodeToContainer(null, extIn);

      const eOut = g.connect(s1, extOut);
      const eIn = g.connect(extIn, s2);
      const eInternal = g.connect(s1, s2);

      const vessel = new Node(999n, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
      });

      abductSequenceEdges(seq);

      expect(seq.EdgeAbductions.length).toBe(2);

      // Outgoing edge abduction
      const abdOut = seq.EdgeAbductions.find((a) => a.Edge === eOut);
      expect(abdOut).toBeDefined();
      expect(abdOut.OriginallyFrom).toBe(s1);
      expect(abdOut.CurrentFrom).toBe(vessel);
      expect(abdOut.CurrentTo).toBe(extOut);
      expect(eOut.From).toBe(vessel);
      expect(eOut.To).toBe(extOut);

      // Incoming edge abduction
      const abdIn = seq.EdgeAbductions.find((a) => a.Edge === eIn);
      expect(abdIn).toBeDefined();
      expect(abdIn.OriginallyTo).toBe(s2);
      expect(abdIn.CurrentTo).toBe(vessel);
      expect(abdIn.CurrentFrom).toBe(extIn);
      expect(eIn.From).toBe(extIn);
      expect(eIn.To).toBe(vessel);

      // Internal edge untouched
      expect(eInternal.From).toBe(s1);
      expect(eInternal.To).toBe(s2);
    });
  });

  // -------------------------------------------------------------------------
  // 4. addSequence
  // -------------------------------------------------------------------------
  describe("addSequence", () => {
    test("installs vessel, points member.Sequence to sequence, removes members from container and graph.Nodes", () => {
      const g = new Graph();
      const container = new Node(10, 100, 100);
      container.isContainer = true;
      g.addNewNodeToContainer(null, container);

      const un1 = new Node(11, 40, 30);
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      const un2 = new Node(12, 40, 30);
      g.addNewNodeToContainer(container, un1);
      g.addNewNodeToContainer(container, s1);
      g.addNewNodeToContainer(container, s2);
      g.addNewNodeToContainer(container, un2);

      const vessel = new Node(500n, 0, 0);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: container,
      });

      addSequence(g, seq);

      // Vessel installed
      expect(g.Nodes.includes(vessel)).toBe(true);
      expect(vessel.Graph).toBe(g);
      expect(vessel.Container).toBe(container);

      // Container children updated: members removed, vessel added, unrelated retained
      const children = g.Containers.get(container);
      expect(children).toContain(un1);
      expect(children).toContain(un2);
      expect(children).toContain(vessel);
      expect(children).not.toContain(s1);
      expect(children).not.toContain(s2);

      // Member node properties
      expect(s1.Sequence).toBe(seq);
      expect(s2.Sequence).toBe(seq);
      expect(s1.Container).toBeNull();
      expect(s2.Container).toBeNull();
      expect(s1.Graph).toBe(g);
      expect(s2.Graph).toBe(g);
      expect(g.Nodes.includes(s1)).toBe(false);
      expect(g.Nodes.includes(s2)).toBe(false);

      // Sequences map
      expect(g.Sequences.get(vessel)).toBe(seq);
    });
  });

  // -------------------------------------------------------------------------
  // 5. addSequences Transaction and Atomicity
  // -------------------------------------------------------------------------
  describe("addSequences atomicity and transaction", () => {
    test("rejects invalid topology before snapshot with zero graph mutation", () => {
      const g = new Graph();
      // Cyclic container hierarchy causes Validate to fail
      const c1 = new Node(1, 100, 100);
      c1.isContainer = true;
      const c2 = new Node(2, 100, 100);
      c2.isContainer = true;
      g.addNewNodeToContainer(null, c1);
      g.addNewNodeToContainer(null, c2);
      c1.Container = c2;
      c2.Container = c1; // explicit container cycle!

      const s1 = createStepNode(10);
      const s2 = createStepNode(11);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.connect(s1, s2);

      const rng = new GoRand(1);
      expect(() => addSequences(backgroundWorkContext(), g, rng)).toThrow();
      expect(g.Sequences.size).toBe(0);
      expect(s1.Sequence).toBeNull();
    });

    test("cancellation during snapshot precedes mutation and leaves graph untouched", () => {
      const g = new Graph();
      const s1 = createStepNode(1, 20, 10);
      const s2 = createStepNode(2, 20, 10);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      const edge = g.connect(s1, s2);

      // Measure exact validation check count on the same graph using a non-cancelling probe
      let validationChecks = 0;
      const validationProbe = new WorkContext({
        isCancelled: () => {
          validationChecks++;
          return false;
        },
        doneAvailable: false,
      });

      Validate(validationProbe, "AddSequences", g);
      expect(validationChecks).toBeGreaterThan(0);

      const originalNodes = g.Nodes;
      const originalEdges = g.Edges;
      const originalContainers = g.Containers;
      const originalRootChildren = g.Containers.get(null);
      const originalSequencesMap = g.Sequences;

      // Cancel only AFTER all validation checks plus the AddSequences stage-guard constructor check,
      // so cancellation occurs in GraphState.updateWithWorkGuard()
      let checks = 0;
      const cancelAt = validationChecks + 2;
      const ctx = new WorkContext({
        isCancelled: () => {
          checks++;
          return checks >= cancelAt;
        },
        doneAvailable: false,
      });

      const probeRng = new GoRand(1);
      const probeFirstDraw = probeRng.Int63();

      const rng = new GoRand(1);
      let caughtError = null;
      try {
        addSequences(ctx, g, rng);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(WorkCanceledError);
      expect(caughtError.location).toBe("AddSequences");
      expect(checks).toBeGreaterThanOrEqual(cancelAt);

      // graph.Sequences is the exact original Map object
      expect(g.Sequences).toBe(originalSequencesMap);
      expect(g.Sequences.size).toBe(0);

      // Graph.Nodes exact original reference and content
      expect(g.Nodes).toBe(originalNodes);
      expect(g.Nodes.length).toBe(2);
      expect(g.Nodes[0]).toBe(s1);
      expect(g.Nodes[1]).toBe(s2);

      // Graph.Edges exact original reference and content
      expect(g.Edges).toBe(originalEdges);
      expect(g.Edges.length).toBe(1);
      expect(g.Edges[0]).toBe(edge);
      expect(edge.From).toBe(s1);
      expect(edge.To).toBe(s2);

      // Graph.Containers exact original Map and child array
      expect(g.Containers).toBe(originalContainers);
      expect(g.Containers.get(null)).toBe(originalRootChildren);
      expect(g.Containers.get(null).length).toBe(2);

      // node.Sequence unchanged
      expect(s1.Sequence).toBeNull();
      expect(s2.Sequence).toBeNull();

      // RNG has consumed zero draws!
      expect(rng.Int63()).toBe(probeFirstDraw);
    });

    test("late cancellation after sequence installation restores exact object aliases with edge abduction", () => {
      const g = new Graph();
      const outsideA = new Node(10, 50, 50);
      const step1 = createStepNode(1, 20, 10);
      const step2 = createStepNode(2, 20, 10);
      const outsideB = new Node(20, 50, 50);

      step1.TopLeft = new Point(100, 100);
      step2.TopLeft = new Point(150, 100);
      outsideA.TopLeft = new Point(10, 100);
      outsideB.TopLeft = new Point(250, 100);

      g.addNewNodeToContainer(null, outsideA);
      g.addNewNodeToContainer(null, step1);
      g.addNewNodeToContainer(null, step2);
      g.addNewNodeToContainer(null, outsideB);

      // outsideA -> step1 -> step2 -> outsideB
      const edgeIn = g.connect(outsideA, step1);
      const edgeDef = g.connect(step1, step2);
      const edgeOut = g.connect(step2, outsideB);

      // Give at least one external edge a non-empty Points route
      const p1 = new Point(15, 105);
      const p2 = new Point(95, 105);
      const originalRoutePoints = [p1, p2];
      edgeIn.Points = originalRoutePoints;

      // Capture exact object references and aliases before mutation
      const originalNodes = g.Nodes;
      const originalEdges = g.Edges;
      const originalContainers = g.Containers;
      const originalRootChildren = g.Containers.get(null);
      const originalSequencesMap = g.Sequences;

      const outsideAEdges = outsideA.Edges;
      const step1Edges = step1.Edges;
      const step2Edges = step2.Edges;
      const outsideBEdges = outsideB.Edges;

      let capturedVessel = null;
      let capturedSequence = null;

      // Cancel only when a sequence has actually been installed in g.Sequences
      const ctx = new WorkContext({
        isCancelled: () => {
          if (g.Sequences.size > 0) {
            for (const [vessel, seq] of g.Sequences.entries()) {
              capturedVessel = vessel;
              capturedSequence = seq;
            }
            return true;
          }
          return false;
        },
        doneAvailable: false,
      });

      const rng = new GoRand(1);
      expect(() => addSequences(ctx, g, rng)).toThrow(WorkCanceledError);

      // Verify that sequence installation and edge abduction definitely occurred before cancellation
      expect(capturedVessel).not.toBeNull();
      expect(capturedSequence).not.toBeNull();
      expect(capturedSequence.EdgeAbductions.length).toBeGreaterThan(0);

      // 1. Original graph arrays/maps restored by identity
      expect(g.Nodes).toBe(originalNodes);
      expect(g.Edges).toBe(originalEdges);
      expect(g.Containers).toBe(originalContainers);
      expect(g.Containers.get(null)).toBe(originalRootChildren);
      expect(g.Sequences).toBe(originalSequencesMap);

      // 2. Original container child arrays restored by identity & content
      expect(g.Containers.get(null).length).toBe(4);
      expect(g.Containers.get(null)[0]).toBe(outsideA);
      expect(g.Containers.get(null)[1]).toBe(step1);
      expect(g.Containers.get(null)[2]).toBe(step2);
      expect(g.Containers.get(null)[3]).toBe(outsideB);

      // 3. Defining edge restored to graph and original member endpoints
      expect(g.Edges.includes(edgeDef)).toBe(true);
      expect(edgeDef.From).toBe(step1);
      expect(edgeDef.To).toBe(step2);

      // 4. External edge endpoints restored from vessel -> original step
      expect(edgeIn.From).toBe(outsideA);
      expect(edgeIn.To).toBe(step1);
      expect(edgeOut.From).toBe(step2);
      expect(edgeOut.To).toBe(outsideB);

      // 5. External edge objects are identical, Points array and Point objects are identical
      expect(edgeIn.Points).toBe(originalRoutePoints);
      expect(edgeIn.Points[0]).toBe(p1);
      expect(edgeIn.Points[1]).toBe(p2);

      // 6. All Node.Edges arrays are exact original arrays
      expect(outsideA.Edges).toBe(outsideAEdges);
      expect(step1.Edges).toBe(step1Edges);
      expect(step2.Edges).toBe(step2Edges);
      expect(outsideB.Edges).toBe(outsideBEdges);

      // 7. Member dimensions / TopLeft restored
      expect(step1.Width).toBe(20);
      expect(step1.Height).toBe(10);
      expect(step1.TopLeft.X).toBe(100);
      expect(step1.TopLeft.Y).toBe(100);

      expect(step2.Width).toBe(20);
      expect(step2.Height).toBe(10);
      expect(step2.TopLeft.X).toBe(150);
      expect(step2.TopLeft.Y).toBe(100);

      // 8. Member Sequence / Container / Graph restored
      expect(step1.Sequence).toBeNull();
      expect(step2.Sequence).toBeNull();
      expect(step1.Container).toBeNull();
      expect(step2.Container).toBeNull();
      expect(step1.Graph).toBe(g);
      expect(step2.Graph).toBe(g);

      // 9. Graph contains no installed sequence vessel
      expect(g.Nodes.includes(capturedVessel)).toBe(false);
      expect(g.Containers.get(null).includes(capturedVessel)).toBe(false);
      expect(g.Sequences.has(capturedVessel)).toBe(false);
      expect(g.Sequences.size).toBe(0);
    });

    test("RNG state is not rolled back on failure", () => {
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.connect(s1, s2);

      const probe = new GoRand(1);
      const firstDraw = probe.Int63();
      const secondDraw = probe.Int63();

      const rng = new GoRand(1);
      // Cancel when sequence is installed (after drawing RNG for sequence ID)
      const ctx = new WorkContext({
        isCancelled: () => g.Sequences.size > 0,
        doneAvailable: false,
      });

      expect(() => addSequences(ctx, g, rng)).toThrow(WorkCanceledError);

      // rng consumed its first draw during sequence group ID generation; its next draw matches probe's second draw!
      expect(rng.Int63()).toBe(secondDraw);
    });

    test("successful AddSequences replaces graph.Sequences with a new Map", () => {
      const g = new Graph();
      const s1 = createStepNode(1);
      const s2 = createStepNode(2);
      g.addNewNodeToContainer(null, s1);
      g.addNewNodeToContainer(null, s2);
      g.connect(s1, s2);

      const originalMap = g.Sequences;
      const rng = new GoRand(42);

      addSequences(backgroundWorkContext(), g, rng);

      expect(g.Sequences).not.toBe(originalMap);
      expect(g.Sequences.size).toBe(1);
    });
  });
});
