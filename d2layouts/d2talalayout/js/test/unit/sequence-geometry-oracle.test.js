import { describe, it, expect } from "bun:test";
import reference from "../fixtures/go-sequence-geometry-reference.json";
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
} from "../../src/internal.js";

describe("Sequence Geometry Go Parity Oracle Tests", () => {
  it("should match metadata and constants from Go reference", () => {
    expect(reference.metadata.runtimeGoVersion).toBeTruthy();
    expect(reference.metadata.runtimeGOOS).toBeTruthy();
    expect(reference.metadata.runtimeGOARCH).toBeTruthy();
    expect(reference.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    expect(reference.metadata.referencePackage).toBe("github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph");
    expect(reference.metadata.stepWedgeWidth).toBe(STEP_WEDGE_WIDTH);
    expect(STEP_WEDGE_WIDTH).toBe(35.0);
  });

  it("should match all SequenceAdvance oracle cases", () => {
    for (const testCase of reference.cases.SequenceAdvance) {
      const adv = SequenceAdvance(testCase.width);
      expect(adv).toBe(testCase.advance);
      expect(sequenceAdvance(testCase.width)).toBe(testCase.advance);
    }
  });

  describe("SyncGeometry oracle cases", () => {
    it("should match ThreeWideSteps", () => {
      const expected = reference.cases.SyncGeometry.ThreeWideSteps;
      const vessel = new Node(1n, 10, 10);
      const s1 = new Node(2n, 100, 50);
      const s2 = new Node(3n, 100, 60);
      const s3 = new Node(4n, 100, 40);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
      expect(vessel.TopLeft).toBeNull();
      expect(s1.TopLeft).toBeNull();
      expect(s2.TopLeft).toBeNull();
      expect(s3.TopLeft).toBeNull();
    });

    it("should match TwoNarrowSteps", () => {
      const expected = reference.cases.SyncGeometry.TwoNarrowSteps;
      const vessel = new Node(10n, 10, 10);
      const s1 = new Node(11n, 10, 30);
      const s2 = new Node(12n, 20, 25);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
    });

    it("should match MixedNarrowAndWide", () => {
      const expected = reference.cases.SyncGeometry.MixedNarrowAndWide;
      const vessel = new Node(20n, 10, 10);
      const s1 = new Node(21n, 10, 40);
      const s2 = new Node(22n, 50, 20);
      const s3 = new Node(23n, 25, 60);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
    });

    it("should match NegativeDimensions", () => {
      const expected = reference.cases.SyncGeometry.NegativeDimensions;
      const vessel = new Node(30n, 10, 10);
      const s1 = new Node(31n, -10, -5);
      const s2 = new Node(32n, 50, 30);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
    });

    it("should match DifferentHeights", () => {
      const expected = reference.cases.SyncGeometry.DifferentHeights;
      const vessel = new Node(40n, 10, 10);
      const s1 = new Node(41n, 50, 10);
      const s2 = new Node(42n, 50, 100);
      const s3 = new Node(43n, 50, 50);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
    });

    it("should match EmptySequence", () => {
      const expected = reference.cases.SyncGeometry.EmptySequence;
      const vessel = new Node(50n, 99, 99);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
    });

    it("should match VesselWithoutTopLeft", () => {
      const vessel = new Node(60n, 10, 10);
      const s1 = new Node(61n, 50, 30);
      const s2 = new Node(62n, 60, 40);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.SyncGeometry();

      expect(vessel.TopLeft).toBeNull();
      expect(s1.TopLeft).toBeNull();
      expect(s2.TopLeft).toBeNull();
    });

    it("should match PositionedVessel", () => {
      const expected = reference.cases.SyncGeometry.PositionedVessel;
      const vessel = new Node(70n, 10, 10);
      vessel.TopLeft = new Point(200, 300);
      const s1 = new Node(71n, 50, 30);
      const s2 = new Node(72n, 60, 40);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.SyncGeometry();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
      expect(vessel.TopLeft.X).toBe(expected.vesselTopLeft.x);
      expect(vessel.TopLeft.Y).toBe(expected.vesselTopLeft.y);
      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
    });

    it("should match NilStepFailure", () => {
      const vessel = new Node(80n, 10, 10);
      const s1 = new Node(81n, 50, 30);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, null],
      });
      expect(() => seq.SyncGeometry()).toThrow("sequence contains a nil step");
    });

    it("should match MissingVesselFailure", () => {
      const s1 = new Node(91n, 50, 30);
      const seq = new Sequence({
        Vessel: null,
        Nodes: [s1],
      });
      expect(() => seq.SyncGeometry()).toThrow("sequence is missing its vessel");
    });
  });

  describe("ArrangeSteps oracle cases", () => {
    it("should match UnpositionedVessel", () => {
      const expected = reference.cases.ArrangeSteps.UnpositionedVessel;
      const vessel = new Node(100n, 100, 100);
      const s1 = new Node(101n, 50, 50);
      const s2 = new Node(102n, 60, 60);
      s1.TopLeft = new Point(10, 20);
      s2.TopLeft = new Point(30, 40);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.ArrangeSteps();

      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
    });

    it("should match OneStep", () => {
      const expected = reference.cases.ArrangeSteps.OneStep;
      const vessel = new Node(110n, 100, 100);
      vessel.TopLeft = new Point(10, 20);
      const s1 = new Node(111n, 50, 50);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1],
      });
      seq.ArrangeSteps();

      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
    });

    it("should match MultipleSteps", () => {
      const expected = reference.cases.ArrangeSteps.MultipleSteps;
      const vessel = new Node(120n, 200, 100);
      vessel.TopLeft = new Point(50, 60);
      const s1 = new Node(121n, 100, 50);
      const s2 = new Node(122n, 100, 50);
      const s3 = new Node(123n, 100, 50);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });
      seq.ArrangeSteps();

      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
      expect(s3.TopLeft.X).toBe(expected.s3TopLeft.x);
      expect(s3.TopLeft.Y).toBe(expected.s3TopLeft.y);
    });

    it("should match NarrowWidths", () => {
      const expected = reference.cases.ArrangeSteps.NarrowWidths;
      const vessel = new Node(130n, 50, 50);
      vessel.TopLeft = new Point(100, 200);
      const s1 = new Node(131n, 10, 30);
      const s2 = new Node(132n, 20, 30);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.ArrangeSteps();

      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
    });

    it("should match WideWidths", () => {
      const expected = reference.cases.ArrangeSteps.WideWidths;
      const vessel = new Node(140n, 200, 50);
      vessel.TopLeft = new Point(100, 200);
      const s1 = new Node(141n, 70, 40);
      const s2 = new Node(142n, 80, 40);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.ArrangeSteps();

      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
    });

    it("should match NegativeWidth", () => {
      const expected = reference.cases.ArrangeSteps.NegativeWidth;
      const vessel = new Node(150n, 100, 50);
      vessel.TopLeft = new Point(100, 200);
      const s1 = new Node(151n, -10, 40);
      const s2 = new Node(152n, 50, 40);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.ArrangeSteps();

      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
    });
  });

  describe("PlaceVessel oracle cases", () => {
    it("should match AllStepsPositioned", () => {
      const expected = reference.cases.PlaceVessel.AllStepsPositioned;
      const vessel = new Node(200n, 100, 100);
      const s1 = new Node(201n, 50, 50);
      const s2 = new Node(202n, 50, 50);
      const s3 = new Node(203n, 50, 50);
      s1.TopLeft = new Point(100, 50);
      s2.TopLeft = new Point(200, 80);
      s3.TopLeft = new Point(150, 30);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });
      seq.PlaceVessel();

      expect(vessel.TopLeft.X).toBe(expected.vesselTopLeft.x);
      expect(vessel.TopLeft.Y).toBe(expected.vesselTopLeft.y);
    });

    it("should match IndependentMinima", () => {
      const expected = reference.cases.PlaceVessel.IndependentMinima;
      const vessel = new Node(210n, 100, 100);
      const s1 = new Node(211n, 50, 50);
      const s2 = new Node(212n, 50, 50);
      const s3 = new Node(213n, 50, 50);
      s1.TopLeft = new Point(100, 20);
      s2.TopLeft = new Point(50, 80);
      s3.TopLeft = new Point(70, 10);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2, s3],
      });
      seq.PlaceVessel();

      expect(vessel.TopLeft.X).toBe(expected.vesselTopLeft.x);
      expect(vessel.TopLeft.Y).toBe(expected.vesselTopLeft.y);
    });

    it("should match OneMissingTopLeft", () => {
      const vessel = new Node(220n, 100, 100);
      const s1 = new Node(221n, 50, 50);
      const s2 = new Node(222n, 50, 50);
      s1.TopLeft = new Point(10, 20);
      s2.TopLeft = null;
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.PlaceVessel();

      expect(vessel.TopLeft).toBeNull();
    });

    it("should match ExistingTopLeftMissingStep", () => {
      const expected = reference.cases.PlaceVessel.ExistingTopLeftMissingStep;
      const vessel = new Node(230n, 100, 100);
      vessel.TopLeft = new Point(999, 999);
      const s1 = new Node(231n, 50, 50);
      const s2 = new Node(232n, 50, 50);
      s1.TopLeft = new Point(10, 20);
      s2.TopLeft = null;
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });
      seq.PlaceVessel();

      expect(vessel.TopLeft.X).toBe(expected.vesselTopLeft.x);
      expect(vessel.TopLeft.Y).toBe(expected.vesselTopLeft.y);
    });

    it("should match EmptyNodesInfinity", () => {
      const expected = reference.cases.PlaceVessel.EmptyNodesInfinity;
      const vessel = new Node(240n, 100, 100);
      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [],
      });
      seq.PlaceVessel();

      expect(expected.vesselTopLeft.xIsPositiveInfinity).toBe(true);
      expect(expected.vesselTopLeft.yIsPositiveInfinity).toBe(true);
      expect(vessel.TopLeft.X).toBe(Number.POSITIVE_INFINITY);
      expect(vessel.TopLeft.Y).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe("AbductedNodeByEdge oracle cases", () => {
    it("should match all AbductedNodeByEdge oracle outcomes", () => {
      const expected = reference.cases.AbductedNodeByEdge;
      const vessel = new Node(300n, 100, 100);
      const nodeA = new Node(301n, 50, 50);
      const nodeB = new Node(302n, 50, 50);
      const e1 = new Edge(vessel, nodeB);
      e1.ID = 1n;
      const e2 = new Edge(nodeA, vessel);
      e2.ID = 2n;
      const e3 = new Edge(vessel, vessel);
      e3.ID = 3n;
      const e4 = new Edge(nodeA, nodeB);
      e4.ID = 4n;
      const e5 = new Edge(nodeA, nodeB);
      e5.ID = 5n;

      const ea1 = new EdgeAbduction({
        Edge: e1,
        CurrentFrom: vessel,
        CurrentTo: nodeB,
        OriginallyFrom: nodeA,
        OriginallyTo: nodeB,
      });
      const ea2 = new EdgeAbduction({
        Edge: e2,
        CurrentFrom: nodeA,
        CurrentTo: vessel,
        OriginallyFrom: nodeA,
        OriginallyTo: nodeB,
      });
      const ea3 = new EdgeAbduction({
        Edge: e3,
        CurrentFrom: vessel,
        CurrentTo: vessel,
        OriginallyFrom: nodeA,
        OriginallyTo: nodeB,
      });
      const ea4 = new EdgeAbduction({
        Edge: e4,
        CurrentFrom: nodeA,
        CurrentTo: nodeB,
        OriginallyFrom: nodeA,
        OriginallyTo: nodeB,
      });

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [nodeA, nodeB],
        EdgeAbductions: [ea1, ea2, ea3, ea4],
      });

      const res1 = seq.AbductedNodeByEdge(e1);
      expect(res1 ? res1.ID.toString() : "").toBe(expected.CurrentFromVessel);

      const res2 = seq.AbductedNodeByEdge(e2);
      expect(res2 ? res2.ID.toString() : "").toBe(expected.CurrentToVessel);

      const res3 = seq.AbductedNodeByEdge(e3);
      expect(res3 ? res3.ID.toString() : "").toBe(expected.BothVesselPrecedence);

      const res4 = seq.AbductedNodeByEdge(e5);
      expect(res4 ? res4.ID.toString() : "").toBe(expected.DifferentEdgeObject);

      const res5 = seq.AbductedNodeByEdge(e4);
      expect(res5 ? res5.ID.toString() : "").toBe(expected.NoCurrentVesselEndpoint);
    });
  });

  describe("SyncSequences oracle cases", () => {
    it("should match NoSequences", () => {
      const g = new Graph();
      const n1 = new Node(401n, 100, 100);
      g.addNodeUnchecked(n1);
      g.SyncSequences();
      expect(n1.Width).toBe(reference.cases.SyncSequences.NoSequences.node1Width);
    });

    it("should match TopLevelSequenceVessel", () => {
      const expected = reference.cases.SyncSequences.TopLevelSequenceVessel;
      const g = new Graph();
      const vessel = new Node(410n, 10, 10);
      vessel.TopLeft = new Point(500, 500);
      const s1 = new Node(411n, 60, 40);
      const s2 = new Node(412n, 80, 50);
      vessel.Graph = g;
      s1.Graph = g;
      s2.Graph = g;

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
      });
      g.addNodeUnchecked(vessel);
      g.Sequences.set(vessel, seq);

      g.SyncSequences();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
      expect(vessel.TopLeft.X).toBe(expected.vesselTopLeft.x);
      expect(vessel.TopLeft.Y).toBe(expected.vesselTopLeft.y);
      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
    });

    it("should match NestedSequenceVessel", () => {
      const expected = reference.cases.SyncSequences.NestedSequenceVessel;
      const g = new Graph();
      const container = new Node(420n, 200, 200);
      const vessel = new Node(421n, 10, 10);
      vessel.TopLeft = new Point(1000, 1000);
      const s1 = new Node(422n, 50, 30);
      const s2 = new Node(423n, 70, 40);

      container.Graph = g;
      vessel.Graph = g;
      s1.Graph = g;
      s2.Graph = g;

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
        Container: container,
      });

      g.Containers.set(null, [container]);
      g.Containers.set(container, [vessel]);
      container.Container = null;
      container.isContainer = true;
      vessel.Container = container;

      g.addNodeUnchecked(container);
      g.Sequences.set(vessel, seq);

      g.SyncSequences();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
      expect(vessel.TopLeft.X).toBe(expected.vesselTopLeft.x);
      expect(vessel.TopLeft.Y).toBe(expected.vesselTopLeft.y);
      expect(s1.TopLeft.X).toBe(expected.s1TopLeft.x);
      expect(s1.TopLeft.Y).toBe(expected.s1TopLeft.y);
      expect(s2.TopLeft.X).toBe(expected.s2TopLeft.x);
      expect(s2.TopLeft.Y).toBe(expected.s2TopLeft.y);
    });

    it("should match UnreachableSequenceMapEntry", () => {
      const expected = reference.cases.SyncSequences.UnreachableSequenceMapEntry;
      const g = new Graph();
      const n1 = new Node(430n, 100, 100);
      g.addNodeUnchecked(n1);

      const vessel = new Node(431n, 10, 10);
      vessel.TopLeft = new Point(500, 500);
      const s1 = new Node(432n, 60, 40);
      const s2 = new Node(433n, 80, 50);
      vessel.Graph = g;
      s1.Graph = g;
      s2.Graph = g;

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
        Graph: g,
      });

      // Vessel in Sequences map, but NOT in g.Nodes or container children
      g.Sequences.set(vessel, seq);

      g.SyncSequences();

      expect(vessel.Width).toBe(expected.vesselWidth);
      expect(vessel.Height).toBe(expected.vesselHeight);
      expect(s1.TopLeft).toBeNull();
      expect(s2.TopLeft).toBeNull();
    });

    it("should match TwoReachableSequences", () => {
      const expected = reference.cases.SyncSequences.TwoReachableSequences;
      const g = new Graph();
      const v1 = new Node(440n, 10, 10);
      v1.TopLeft = new Point(100, 100);
      const v1_s1 = new Node(441n, 50, 30);
      const v1_s2 = new Node(442n, 50, 30);
      v1.Graph = g;
      v1_s1.Graph = g;
      v1_s2.Graph = g;

      const seq1 = new Sequence({
        Vessel: v1,
        Nodes: [v1_s1, v1_s2],
        Graph: g,
      });

      const v2 = new Node(450n, 10, 10);
      v2.TopLeft = new Point(300, 300);
      const v2_s1 = new Node(451n, 80, 60);
      const v2_s2 = new Node(452n, 90, 70);
      v2.Graph = g;
      v2_s1.Graph = g;
      v2_s2.Graph = g;

      const seq2 = new Sequence({
        Vessel: v2,
        Nodes: [v2_s1, v2_s2],
        Graph: g,
      });

      g.addNodeUnchecked(v1);
      g.addNodeUnchecked(v2);
      g.Sequences.set(v1, seq1);
      g.Sequences.set(v2, seq2);

      g.SyncSequences();

      expect(v1.Width).toBe(expected.v1Width);
      expect(v1.Height).toBe(expected.v1Height);
      expect(v1_s1.TopLeft.X).toBe(expected.v1_s1TopLeft.x);
      expect(v1_s1.TopLeft.Y).toBe(expected.v1_s1TopLeft.y);
      expect(v1_s2.TopLeft.X).toBe(expected.v1_s2TopLeft.x);
      expect(v1_s2.TopLeft.Y).toBe(expected.v1_s2TopLeft.y);

      expect(v2.Width).toBe(expected.v2Width);
      expect(v2.Height).toBe(expected.v2Height);
      expect(v2_s1.TopLeft.X).toBe(expected.v2_s1TopLeft.x);
      expect(v2_s1.TopLeft.Y).toBe(expected.v2_s1TopLeft.y);
      expect(v2_s2.TopLeft.X).toBe(expected.v2_s2TopLeft.x);
      expect(v2_s2.TopLeft.Y).toBe(expected.v2_s2TopLeft.y);
    });
  });
});
