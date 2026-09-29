import { describe, it, expect } from "bun:test";
import {
  Sequence,
  SequenceAdvance,
  sequenceAdvance,
  STEP_WEDGE_WIDTH,
  Graph,
  Node,
  Edge,
  EdgeAbduction,
  Point,
  cloneGraph,
} from "../../src/index.js";

class CountingWork {
  constructor() {
    this.steps = 0;
    this.finishes = 0;
  }

  Step() {
    this.steps++;
  }

  Finish() {
    this.finishes++;
  }
}

describe("Sequence Geometry Focused Unit Tests", () => {
  describe("SequenceAdvance", () => {
    it("should clamp non-positive width to 0", () => {
      expect(SequenceAdvance(-100)).toBe(0);
      expect(SequenceAdvance(-0.01)).toBe(0);
      expect(SequenceAdvance(0)).toBe(0);
    });

    it("should clamp wedge to half width for narrow steps (width <= STEP_WEDGE_WIDTH)", () => {
      expect(STEP_WEDGE_WIDTH).toBe(35.0);
      expect(SequenceAdvance(10)).toBe(5);
      expect(SequenceAdvance(20)).toBe(10);
      expect(SequenceAdvance(35)).toBe(17.5);
    });

    it("should subtract full STEP_WEDGE_WIDTH for wide steps (width > STEP_WEDGE_WIDTH)", () => {
      expect(SequenceAdvance(36)).toBe(1);
      expect(SequenceAdvance(70)).toBe(35);
      expect(SequenceAdvance(100)).toBe(65);
    });
  });

  describe("SyncGeometry and Resize", () => {
    it("should throw if work is null before mutating geometry", () => {
      const vessel = new Node(1n, 50, 50);
      const s1 = new Node(2n, 100, 100);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1],
      });
      expect(() => seq.SyncGeometryWithWork(null)).toThrow("sequence geometry requires work accounting");
      expect(vessel.Width).toBe(50);
      expect(vessel.Height).toBe(50);
    });

    it("should throw if Vessel is null", () => {
      const s1 = new Node(2n, 100, 100);
      const seq = new Sequence({
        Vessel: null,
        Nodes: [s1],
      });
      expect(() => seq.SyncGeometry()).toThrow("sequence is missing its vessel");
    });

    it("should correctly resize vessel before arranging steps", () => {
      const vessel = new Node(1n, 0, 0);
      vessel.TopLeft = new Point(100, 100);
      const s1 = new Node(2n, 100, 50);
      const s2 = new Node(3n, 100, 60);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(165); // 0+100=100; advance 65; 65+100=165
      expect(vessel.Height).toBe(60); // max(50, 60)
      expect(s1.TopLeft).toEqual(new Point(100, 100));
      expect(s2.TopLeft).toEqual(new Point(165, 100));
    });

    it("should clamp negative dimensions in visible contribution and advance", () => {
      const vessel = new Node(1n, 0, 0);
      const s1 = new Node(2n, -20, -10);
      const s2 = new Node(3n, 50, 40);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.SyncGeometry();

      // s1: max(0, -20) = 0 width, advance(-20) = 0 offset, max(0, -10) = 0 height
      // s2: max(0, 0 + 50) = 50 width, max(0, 40) = 40 height
      expect(vessel.Width).toBe(50);
      expect(vessel.Height).toBe(40);
    });

    it("should succeed on empty sequence leaving 0x0 vessel", () => {
      const vessel = new Node(1n, 88, 88);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [],
      });
      seq.SyncGeometry();
      expect(vessel.Width).toBe(0);
      expect(vessel.Height).toBe(0);
    });
  });

  describe("ArrangeSteps and Point Independence", () => {
    it("should leave step positions untouched and finish work if Vessel.TopLeft is null", () => {
      const vessel = new Node(1n, 100, 100);
      vessel.TopLeft = null;
      const s1 = new Node(2n, 50, 50);
      const s2 = new Node(3n, 50, 50);
      s1.TopLeft = new Point(10, 20);
      s2.TopLeft = new Point(30, 40);

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      const work = new CountingWork();
      seq.arrangeStepsWithWork(work);

      expect(s1.TopLeft).toEqual(new Point(10, 20));
      expect(s2.TopLeft).toEqual(new Point(30, 40));
      expect(work.steps).toBe(0);
      expect(work.finishes).toBe(1);
    });

    it("should allocate distinct independent Point instances for every step", () => {
      const vessel = new Node(1n, 200, 100);
      vessel.TopLeft = new Point(50, 60);
      const s1 = new Node(2n, 100, 50);
      const s2 = new Node(3n, 100, 50);

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.ArrangeSteps();

      expect(s1.TopLeft).not.toBe(vessel.TopLeft);
      expect(s2.TopLeft).not.toBe(vessel.TopLeft);
      expect(s1.TopLeft).not.toBe(s2.TopLeft);

      // Mutating s1 should not mutate vessel or s2
      s1.TopLeft.X = 9999;
      expect(vessel.TopLeft.X).toBe(50);
      expect(s2.TopLeft.X).toBe(115);
    });
  });

  describe("PlaceVessel", () => {
    it("should compute independent X and Y minima across steps", () => {
      const vessel = new Node(1n, 100, 100);
      const s1 = new Node(2n, 50, 50);
      const s2 = new Node(3n, 50, 50);
      const s3 = new Node(4n, 50, 50);
      s1.TopLeft = new Point(100, 20);
      s2.TopLeft = new Point(50, 80);
      s3.TopLeft = new Point(70, 10);

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });
      seq.PlaceVessel();

      expect(vessel.TopLeft.X).toBe(50);
      expect(vessel.TopLeft.Y).toBe(10);
    });

    it("should return immediately and preserve existing Vessel.TopLeft if any step has null TopLeft", () => {
      const vessel = new Node(1n, 100, 100);
      vessel.TopLeft = new Point(777, 888);
      const s1 = new Node(2n, 50, 50);
      const s2 = new Node(3n, 50, 50);
      s1.TopLeft = new Point(10, 20);
      s2.TopLeft = null;

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.PlaceVessel();

      expect(vessel.TopLeft.X).toBe(777);
      expect(vessel.TopLeft.Y).toBe(888);
    });

    it("should assign (+Infinity, +Infinity) when Nodes is empty", () => {
      const vessel = new Node(1n, 100, 100);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [],
      });
      seq.PlaceVessel();

      expect(vessel.TopLeft.X).toBe(Number.POSITIVE_INFINITY);
      expect(vessel.TopLeft.Y).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe("AbductedNodeByEdge", () => {
    it("should match by object identity and follow endpoint precedence", () => {
      const vessel = new Node(1n, 100, 100);
      const a = new Node(2n, 50, 50);
      const b = new Node(3n, 50, 50);
      const edgeMatch = new Edge(vessel, b);
      const edgeDifferent = new Edge(vessel, b);

      const ea1 = new EdgeAbduction({
        Edge: edgeMatch,
        CurrentFrom: vessel,
        CurrentTo: b,
        OriginallyFrom: a,
        OriginallyTo: b,
      });

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [a, b],
        EdgeAbductions: [ea1],
      });

      expect(seq.AbductedNodeByEdge(edgeMatch)).toBe(a);
      expect(seq.AbductedNodeByEdge(edgeDifferent)).toBeNull();

      // Precedence: when both CurrentFrom and CurrentTo are vessel
      const edgeBoth = new Edge(vessel, vessel);
      const eaBoth = new EdgeAbduction({
        Edge: edgeBoth,
        CurrentFrom: vessel,
        CurrentTo: vessel,
        OriginallyFrom: a,
        OriginallyTo: b,
      });
      seq.EdgeAbductions.push(eaBoth);
      expect(seq.AbductedNodeByEdge(edgeBoth)).toBe(a);
    });
  });

  describe("CountingWork Accounting Order", () => {
    it("should follow exact Go work-stepper accounting order in SyncGeometryWithWork", () => {
      const vessel = new Node(1n, 10, 10);
      vessel.TopLeft = new Point(100, 100);
      const s1 = new Node(2n, 100, 50);
      const s2 = new Node(3n, 100, 50);
      const s3 = new Node(4n, 100, 50);

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });

      const work = new CountingWork();
      seq.SyncGeometryWithWork(work);

      // Go accounting:
      // 1 initial Step() in SyncGeometryWithWork
      // + 3 Step() in resizeWithWork (1 per step)
      // + 3 Step() in arrangeStepsWithWork (1 per step)
      // = 7 Step() calls
      // + 1 Finish() in arrangeStepsWithWork
      expect(work.steps).toBe(7);
      expect(work.finishes).toBe(1);
    });

    it("should call work.Step() before failing on nil step", () => {
      const vessel = new Node(1n, 10, 10);
      const s1 = new Node(2n, 100, 50);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, null],
      });

      const work = new CountingWork();
      expect(() => seq.SyncGeometryWithWork(work)).toThrow("sequence contains a nil step");

      // 1 initial Step()
      // + 1 Step() for s1
      // + 1 Step() for null before throwing
      // = 3 steps
      expect(work.steps).toBe(3);
      expect(work.finishes).toBe(0);
    });
  });

  describe("Graph.SyncSequences and Clone Integration", () => {
    it("should synchronize active sequence on a cloned graph without mutating source", () => {
      const sourceGraph = new Graph();
      const vessel = new Node(1n, 10, 10);
      vessel.TopLeft = new Point(500, 500);
      const s1 = new Node(2n, 60, 40);
      const s2 = new Node(3n, 80, 50);

      vessel.Graph = sourceGraph;
      s1.Graph = sourceGraph;
      s2.Graph = sourceGraph;

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: sourceGraph,
      });

      sourceGraph.addNodeUnchecked(vessel);
      sourceGraph.addNodeUnchecked(s1);
      sourceGraph.addNodeUnchecked(s2);
      sourceGraph.Sequences.set(vessel, seq);

      // Clone graph
      const clonedGraph = cloneGraph(sourceGraph);

      // Modify cloned step dimensions before sync
      const clonedVessel = clonedGraph.Nodes.find(n => n.ID === 1n);
      const clonedSeq = clonedGraph.Sequences.get(clonedVessel);
      expect(clonedSeq).toBeDefined();
      const clonedS1 = clonedSeq.Nodes.find(n => n.ID === 2n);
      const clonedS2 = clonedSeq.Nodes.find(n => n.ID === 3n);
      clonedS1.Width = 100;
      clonedS2.Width = 120;

      // Sync cloned graph sequences
      clonedGraph.SyncSequences();

      // Cloned graph should have updated geometry
      expect(clonedVessel.Width).toBe(185); // 100 + (120 - 35) = 185
      expect(clonedS1.TopLeft).toEqual(new Point(500, 500));
      expect(clonedS2.TopLeft).toEqual(new Point(565, 500)); // 500 + (100 - 35) = 565

      // Source graph must remain completely untouched
      expect(vessel.Width).toBe(10);
      expect(vessel.Height).toBe(10);
      expect(s1.TopLeft).toBeNull();
      expect(s2.TopLeft).toBeNull();
      expect(s1.Width).toBe(60);
      expect(s2.Width).toBe(80);
    });

    it("should ignore sequence in Graph.Sequences if vessel is not reachable from Graph.Nodes", () => {
      const g = new Graph();
      const n1 = new Node(10n, 100, 100);
      g.addNodeUnchecked(n1);

      const vessel = new Node(20n, 10, 10);
      vessel.TopLeft = new Point(100, 100);
      const s1 = new Node(21n, 50, 50);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1],
        Graph: g,
      });
      g.Sequences.set(vessel, seq);

      g.SyncSequences();

      // Since vessel was not added to g.Nodes or any container, it was not visited by rdfsWalk
      expect(vessel.Width).toBe(10);
      expect(s1.TopLeft).toBeNull();
    });
  });
});
