import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Point } from "../../src/geometry/point.js";

describe("Slice 23 — FitToGraph (Direct Unit Tests)", () => {
  describe("API and Scope Boundaries", () => {
    it("exposes fitNodeToGraph and FitToGraph on Node", () => {
      const n = new Node(1, 10, 10);
      expect(typeof n.fitNodeToGraph).toBe("function");
      expect(typeof n.FitToGraph).toBe("function");
    });

    it("forbidden future and out-of-scope methods remain absent", () => {
      const g = new Graph();
      const n = new Node(1, 100, 100);
      expect(n.setContainer).toBeUndefined();
      expect(n.SetContainer).toBeUndefined();
      expect(n.binPackWrapChildren).toBeUndefined();
      expect(n.ArrangeClusterNodes).toBeUndefined();
      expect(n.arrangeNodesWithWork).toBeUndefined();
      expect(g.SyncNestedGeometry).toBeUndefined();
      expect(g.Cleanup).toBeUndefined();
      expect(g.cleanup).toBeUndefined();
      expect(n.AddHubs).toBeUndefined();
      expect(n.addHubs).toBeUndefined();
      expect(n.Join).toBeUndefined();
      expect(n.JoinDistancedClusters).toBeUndefined();
    });
  });

  describe("Section 3: Ordinary non-container succeeds", () => {
    it("resizes non-container node without requiring isContainer === true", () => {
      const ownerG = new Graph();
      const argG = new Graph();

      const target = new Node(1, 40, 30);
      target.isContainer = false;
      target.TopLeft = new Point(0, 0);
      target.Graph = ownerG;

      const argNode = new Node(2, 50, 50);
      argNode.TopLeft = new Point(10, 10);
      argNode.Graph = argG;
      argG.Nodes.push(argNode);

      target.FitToGraph(argG, { top: 10, bottom: 10, left: 10, right: 10 });

      expect(target.Width).toBe(70);
      expect(target.Height).toBe(70);
      expect(target.isContainer).toBe(false);
    });
  });

  describe("Section 44: Direct JS dual-graph test", () => {
    it("reads fixed bounds from argumentGraph.Nodes and label expansion from ownerGraph.Containers", () => {
      const ownerG = new Graph();
      const argG = new Graph();

      const target = new Node(1, 40, 30);
      target.isContainer = true;
      target.TopLeft = new Point(0, 0);
      target.Graph = ownerG;
      ownerG.Nodes.push(target);

      // Huge unrelated node in ownerGraph.Nodes that would distort bounds if read
      const hugeNode = new Node(99, 1000, 1000);
      hugeNode.TopLeft = new Point(50000, 50000);
      hugeNode.Graph = ownerG;
      ownerG.Nodes.push(hugeNode);

      // Argument graph defines bounds: x: 50..150 (width 100), y: 50..100 (height 50)
      const argNode = new Node(2, 100, 50);
      argNode.TopLeft = new Point(50, 50);
      argNode.Graph = argG;
      argG.Nodes.push(argNode);

      // Target's children in ownerGraph: boundary child at x=50 with wide label (300)
      const child = new Node(3, 50, 50);
      child.TopLeft = new Point(50, 50);
      child.Graph = ownerG;
      child.Label = { Width: 300, Height: 30, Position: 17 }; // InsideTopLeft
      ownerG.Containers.set(target, [child]);

      // argumentGraph has no containers or different container entry
      argG.Containers.set(target, []);

      target.FitToGraph(argG, { top: 10, bottom: 10, left: 10, right: 10 });

      // Width: 300 (label expansion on left boundary) + 20 (padding) = 320
      // Height: 50 (argNode height) + 20 (padding) = 70
      expect(target.Width).toBe(320);
      expect(target.Height).toBe(70);
    });
  });

  describe("Section 45: Direct no-containerPadding test", () => {
    it("uses explicit padding and never calls containerPadding on either graph", () => {
      const ownerG = new Graph();
      const argG = new Graph();

      ownerG.containerPadding = () => {
        throw new Error("ownerGraph.containerPadding must not be called");
      };
      argG.containerPadding = () => {
        throw new Error("argGraph.containerPadding must not be called");
      };

      const target = new Node(1, 40, 30);
      target.TopLeft = new Point(0, 0);
      target.Graph = ownerG;

      const argNode = new Node(2, 60, 40);
      argNode.TopLeft = new Point(10, 10);
      argNode.Graph = argG;
      argG.Nodes.push(argNode);

      expect(() => {
        target.FitToGraph(argG, { top: 10, bottom: 10, left: 10, right: 10 });
      }).not.toThrow();

      expect(target.Width).toBe(80);
      expect(target.Height).toBe(60);
    });
  });

  describe("Section 30: No translation", () => {
    it("mutates target dimensions only, leaving TopLeft object and coordinates unchanged", () => {
      const ownerG = new Graph();
      const argG = new Graph();

      const target = new Node(1, 40, 30);
      const originalTL = new Point(123, 456);
      target.TopLeft = originalTL;
      target.Graph = ownerG;

      const argNode = new Node(2, 60, 40);
      argNode.TopLeft = new Point(10, 10);
      argNode.Graph = argG;
      argG.Nodes.push(argNode);

      target.FitToGraph(argG, { top: 10, bottom: 10, left: 10, right: 10 });

      expect(target.TopLeft).toBe(originalTL);
      expect(target.TopLeft.X).toBe(123);
      expect(target.TopLeft.Y).toBe(456);
      expect(target.Width).toBe(80);
      expect(target.Height).toBe(60);
    });
  });

  describe("Section 46: Direct identity and non-mutation test", () => {
    it("preserves object identities of Box, TopLeft, argument nodes, owner containers, and edge routes", () => {
      const ownerG = new Graph();
      const argG = new Graph();

      const target = new Node(1, 40, 30);
      const originalTargetBox = target.Box;
      const originalTargetTL = new Point(0, 0);
      target.TopLeft = originalTargetTL;
      target.Graph = ownerG;

      const argNode = new Node(2, 60, 40);
      const originalArgTL = new Point(10, 10);
      const originalArgBox = argNode.Box;
      argNode.TopLeft = originalArgTL;
      argNode.Graph = argG;
      argG.Nodes.push(argNode);

      const ownerChild = new Node(3, 50, 50);
      const originalOwnerChildTL = new Point(20, 20);
      ownerChild.TopLeft = originalOwnerChildTL;
      ownerChild.Graph = ownerG;
      const ownerChildArray = [ownerChild];
      ownerG.Containers.set(target, ownerChildArray);

      const other = new Node(4, 40, 40);
      other.TopLeft = new Point(200, 200);
      other.Graph = ownerG;

      const edge = new Edge(target, other);
      const p1 = new Point(5, 5);
      const p2 = new Point(250, 250);
      edge.Points = [p1, p2];
      target.Edges.push(edge);

      const pointsArray = edge.Points;
      const argNodesArray = argG.Nodes;

      target.FitToGraph(argG, { top: 10, bottom: 10, left: 10, right: 10 });

      // Target
      expect(target.Box).toBe(originalTargetBox);
      expect(target.TopLeft).toBe(originalTargetTL);

      // Argument graph
      expect(argG.Nodes).toBe(argNodesArray);
      expect(argNode.Box).toBe(originalArgBox);
      expect(argNode.TopLeft).toBe(originalArgTL);
      expect(argNode.TopLeft.X).toBe(10);
      expect(argNode.TopLeft.Y).toBe(10);

      // Owner graph
      expect(ownerG.Containers.get(target)).toBe(ownerChildArray);
      expect(ownerChild.TopLeft).toBe(originalOwnerChildTL);
      expect(ownerChild.TopLeft.X).toBe(20);
      expect(ownerChild.TopLeft.Y).toBe(20);

      // Edge
      expect(edge.Points).toBe(pointsArray);
      expect(edge.Points[0]).toBe(p1);
      expect(edge.Points[1]).toBe(p2);
      expect(p1.X).toBe(5);
      expect(p1.Y).toBe(5);
      expect(p2.X).toBe(250);
      expect(p2.Y).toBe(250);
      expect(edge.sourcePort()).toBe(p1);
      expect(edge.targetPort()).toBe(p2);
    });
  });
});
