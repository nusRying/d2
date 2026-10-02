import { describe, it, expect } from "bun:test";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Point } from "../../src/geometry/point.js";
import { goRound } from "../../src/geometry/math.js";

describe("Slice 24 — Cluster Arrangement & SyncGeometry Direct Unit Tests", () => {
  describe("API and Scope Boundaries", () => {
    it("exposes arrangeClusterNodes, ArrangeClusterNodes, syncGeometry, and SyncGeometry on Cluster", () => {
      const c = new Cluster();
      expect(typeof c.arrangeClusterNodes).toBe("function");
      expect(typeof c.ArrangeClusterNodes).toBe("function");
      expect(typeof c.syncGeometry).toBe("function");
      expect(typeof c.SyncGeometry).toBe("function");

      // Existing methods remain
      expect(typeof c.resize).toBe("function");
      expect(typeof c.Resize).toBe("function");
      expect(typeof c.flip).toBe("function");
      expect(typeof c.Flip).toBe("function");
    });

    it("forbidden future and out-of-scope methods remain strictly absent", () => {
      const c = new Cluster();
      const g = new Graph();
      const n = new Node(1, 100, 100);

      // Cluster work-accounting methods
      expect(c.arrangeNodesWithWork).toBeUndefined();
      expect(c.resizeWithWork).toBeUndefined();
      expect(c.maximumsWithWork).toBeUndefined();
      expect(c.SyncGeometryWithWork).toBeUndefined();
      expect(c.binPackClusterGeometryWork).toBeUndefined();

      // Graph cluster sync methods

      expect(g.syncNested).toBeUndefined();

      // Grouping / Node future methods
      expect(n.setContainer).toBeUndefined();
      expect(n.SetContainer).toBeUndefined();
      expect(g.Cleanup).toBeUndefined();
      expect(n.Join).toBeUndefined();
      expect(n.AddHubs).toBeUndefined();
    });
  });

  describe("Section 58: Direct JS PositionContainerChildren(false) spy", () => {
    it("calls positionContainerChildren exactly once with false for unplaced container member", () => {
      const g = new Graph();
      const vessel = new Node(100, 300, 100);
      vessel.TopLeft = new Point(100, 200);

      const member = new Node(1, 120, 80);
      member.TopLeft = null; // unplaced
      member.isContainer = true;
      member.Graph = g;
      g.AddNode(member);

      const child = new Node(2, 40, 30);
      child.TopLeft = new Point(0, 0);
      child.Container = member;
      child.Graph = g;
      g.AddNode(child);
      g.Containers.set(member, [child]);

      const original = member.positionContainerChildren.bind(member);
      const calls = [];
      member.positionContainerChildren = (withPadding) => {
        calls.push(withPadding);
        return original(withPadding);
      };

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [member],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      expect(calls.length).toBe(1);
      expect(calls[0]).toBe(false);
    });
  });

  describe("Section 59: Direct Rounding Regression", () => {
    it("distinguishes goRound(-0.5) from native Math.round(-0.5)", () => {
      expect(Math.round(-0.5)).toBe(-0);
      expect(goRound(-0.5)).toBe(-1);

      // In column arrangement:
      // vesselCenter = vessel.TopLeft.X + vessel.Width / 2
      // dx = goRound(vesselCenter - (node.TopLeft.X + node.Width / 2))
      const vessel = new Node(100, 50, 300);
      vessel.TopLeft = new Point(100, 100); // vesselCenter = 125

      const n1 = new Node(1, 41, 40);
      n1.TopLeft = new Point(105, 10); // center = 105 + 20.5 = 125.5
      // vesselCenter - center = 125 - 125.5 = -0.5
      const g = new Graph();
      n1.Graph = g;
      g.AddNode(n1);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Arrangement: ClusterArrangement.Column,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      // With goRound(-0.5) = -1, dx = -1, new X = 105 - 1 = 104
      // With Math.round(-0.5) = -0, dx = 0, new X = 105
      expect(n1.TopLeft.X).toBe(104);
    });

    it("verifies positive half rounds away from zero (+0.5 -> +1)", () => {
      const vessel = new Node(100, 300, 50);
      vessel.TopLeft = new Point(100, 100); // vesselCenter = 125

      const n1 = new Node(1, 40, 41);
      n1.TopLeft = new Point(10, 104); // center = 104 + 20.5 = 124.5
      // vesselCenter - center = 125 - 124.5 = +0.5 -> dy = +1
      const g = new Graph();
      n1.Graph = g;
      g.AddNode(n1);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      expect(n1.TopLeft.Y).toBe(105);
    });
  });

  describe("Section 60: Direct Identity Assertions", () => {
    it("preserves Point and Box identities for positioned member and descendant", () => {
      const g = new Graph();
      const vessel = new Node(100, 300, 100);
      const vTopLeft = new Point(100, 200);
      vessel.TopLeft = vTopLeft;
      const vBox = vessel.Box;

      const parent = new Node(1, 100, 80);
      const pTopLeft = new Point(10, 10);
      parent.TopLeft = pTopLeft;
      const pBox = parent.Box;
      parent.isContainer = true;
      parent.Graph = g;
      g.AddNode(parent);

      const child = new Node(2, 40, 30);
      const cTopLeft = new Point(20, 20);
      child.TopLeft = cTopLeft;
      child.Container = parent;
      child.Graph = g;
      g.AddNode(child);
      g.Containers.set(parent, [child]);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [parent],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      // TopLeft references must be strictly preserved
      expect(vessel.TopLeft).toBe(vTopLeft);
      expect(parent.TopLeft).toBe(pTopLeft);
      expect(child.TopLeft).toBe(cTopLeft);

      // Box references must be strictly preserved
      expect(vessel.Box).toBe(vBox);
      expect(parent.Box).toBe(pBox);
    });

    it("creates a new Point instance for unplaced member", () => {
      const g = new Graph();
      const vessel = new Node(100, 300, 100);
      vessel.TopLeft = new Point(100, 200);

      const n1 = new Node(1, 50, 40);
      n1.TopLeft = null;
      n1.Graph = g;
      g.AddNode(n1);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      expect(n1.TopLeft).not.toBeNull();
      expect(n1.TopLeft instanceof Point).toBe(true);
      expect(n1.TopLeft.X).toBe(100);
    });
  });

  describe("Section 61: Direct Edge-Route Non-Mutation Assertion", () => {
    it("does not mutate Edge.Points or port geometry when cluster member moves", () => {
      const g = new Graph();
      const vessel = new Node(100, 300, 100);
      vessel.TopLeft = new Point(100, 200);

      const n1 = new Node(1, 50, 40);
      n1.TopLeft = new Point(10, 10);
      n1.Graph = g;
      g.AddNode(n1);

      const other = new Node(2, 50, 40);
      other.TopLeft = new Point(500, 500);
      other.Graph = g;
      g.AddNode(other);

      const edge = new Edge(1, n1, other);
      const p1 = new Point(15, 20);
      const p2 = new Point(505, 520);
      const pointsArray = [p1, p2];
      edge.Points = pointsArray;
      edge.SourcePort = new Point(5, 5);
      edge.TargetPort = new Point(10, 10);
      g.AddEdge(edge);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      // Edge route points array and coordinate values must remain completely untouched
      expect(edge.Points).toBe(pointsArray);
      expect(edge.Points[0]).toBe(p1);
      expect(edge.Points[1]).toBe(p2);
      expect(p1.X).toBe(15);
      expect(p1.Y).toBe(20);
      expect(p2.X).toBe(505);
      expect(p2.Y).toBe(520);
      expect(edge.SourcePort.X).toBe(5);
      expect(edge.SourcePort.Y).toBe(5);
      expect(edge.TargetPort.X).toBe(10);
      expect(edge.TargetPort.Y).toBe(10);
    });
  });

  describe("Section 26 & 27: Dimensions Non-Mutation and Idempotence", () => {
    it("ArrangeClusterNodes does not resize vessel or members", () => {
      const vessel = new Node(100, 300, 100);
      vessel.TopLeft = new Point(100, 200);

      const g = new Graph();
      const n1 = new Node(1, 40, 60);
      n1.TopLeft = new Point(10, 10);
      n1.Graph = g;
      g.AddNode(n1);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      expect(vessel.Width).toBe(300);
      expect(vessel.Height).toBe(100);
      expect(n1.Width).toBe(40);
      expect(n1.Height).toBe(60);
    });

    it("ArrangeClusterNodes is idempotent across repeated calls", () => {
      const g = new Graph();
      const vessel = new Node(100, 300, 100);
      vessel.TopLeft = new Point(100, 200);

      const n1 = new Node(1, 40, 60);
      n1.TopLeft = new Point(10, 10);
      g.AddNewNodeToContainer(null, n1);

      const n2 = new Node(2, 80, 40);
      n2.TopLeft = new Point(50, 50);
      g.AddNewNodeToContainer(null, n2);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();
      const x1_after1 = n1.TopLeft.X;
      const y1_after1 = n1.TopLeft.Y;
      const x2_after1 = n2.TopLeft.X;
      const y2_after1 = n2.TopLeft.Y;

      cluster.ArrangeClusterNodes();
      expect(n1.TopLeft.X).toBe(x1_after1);
      expect(n1.TopLeft.Y).toBe(y1_after1);
      expect(n2.TopLeft.X).toBe(x2_after1);
      expect(n2.TopLeft.Y).toBe(y2_after1);
    });

    it("preserves FixedTopLeft property through arrangement", () => {
      const g = new Graph();
      const vessel = new Node(100, 300, 100);
      vessel.TopLeft = new Point(100, 200);

      const n1 = new Node(1, 40, 60);
      n1.TopLeft = new Point(10, 10);
      const fixedPt = new Point(5, 5);
      n1.FixedTopLeft = fixedPt;
      g.AddNewNodeToContainer(null, n1);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      cluster.ArrangeClusterNodes();

      expect(n1.FixedTopLeft).toBe(fixedPt);
      expect(n1.FixedTopLeft.X).toBe(5);
      expect(n1.FixedTopLeft.Y).toBe(5);
    });
  });

  describe("SyncGeometry vessel invariant", () => {
    it("throws 'cluster is missing its vessel' if Vessel is null", () => {
      const c = new Cluster({
        Vessel: null,
        Nodes: [new Node(1, 40, 40)],
        Arrangement: ClusterArrangement.Row,
      });
      expect(() => c.SyncGeometry()).toThrow("cluster is missing its vessel");
    });
  });
});
