import { describe, it, expect, vi } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Point } from "../../src/geometry/point.js";
import { Box } from "../../src/geometry/box.js";

describe("Slice 22 — WrapChildren Composition (Direct Unit Tests)", () => {
  describe("API and Scope Boundaries", () => {
    it("exposes wrapChildren and WrapChildren on Node", () => {
      const n = new Node(1, 100, 100);
      expect(typeof n.wrapChildren).toBe("function");
      expect(typeof n.WrapChildren).toBe("function");
    });

    it("forbidden future and out-of-scope methods remain absent", () => {
      const g = new Graph();
      const n = new Node(1, 100, 100);
      expect(n.setContainer).toBeUndefined();
      expect(n.SetContainer).toBeUndefined();
      expect(n.fitNodeToGraph).toBeUndefined();
      expect(n.FitToGraph).toBeUndefined();
      expect(n.binPackWrapChildren).toBeUndefined();
      expect(n.ArrangeClusterNodes).toBeUndefined();
      expect(n.arrangeNodesWithWork).toBeUndefined();
      expect(g.SyncClusters).toBeUndefined();
      expect(g.SyncNestedGeometry).toBeUndefined();
      expect(g.Cleanup).toBeUndefined();
      expect(g.cleanup).toBeUndefined();
      expect(n.AddHubs).toBeUndefined();
      expect(n.addHubs).toBeUndefined();
      expect(n.Join).toBeUndefined();
      expect(n.JoinDistancedClusters).toBeUndefined();
    });
  });

  describe("Section 1: Non-container early return", () => {
    it("early returns as a no-op when isContainer is false even if Graph or TopLeft is null", () => {
      const n = new Node(1, 200, 200);
      n.isContainer = false;
      n.Graph = null;
      n.TopLeft = null;

      expect(() => n.wrapChildren()).not.toThrow();
      expect(n.Width).toBe(200);
      expect(n.Height).toBe(200);
      expect(n.TopLeft).toBeNull();
    });
  });

  describe("Section 4: containerPadding invocation", () => {
    it("calls Graph.containerPadding exactly once with (this, false)", () => {
      const g = new Graph();
      const container = new Node(1, 40, 30);
      container.isContainer = true;
      container.TopLeft = new Point(0, 0);
      container.Graph = g;
      g.Containers.set(container, []);

      let calls = 0;
      let passedConsiderChildren = null;
      const originalContainerPadding = g.containerPadding.bind(g);
      g.containerPadding = (c, considerChildren) => {
        calls++;
        passedConsiderChildren = considerChildren;
        return originalContainerPadding(c, considerChildren);
      };

      container.wrapChildren();

      expect(calls).toBe(1);
      expect(passedConsiderChildren).toBe(false);
    });
  });

  describe("Section 10: Container moves only; children and grandchildren remain stationary", () => {
    it("moves and resizes container while child and grandchild remain completely unchanged", () => {
      const g = new Graph();
      const container = new Node(1, 40, 30);
      container.isContainer = true;
      container.TopLeft = new Point(0, 0);
      container.Graph = g;

      const child = new Node(2, 60, 60);
      child.isContainer = true;
      child.TopLeft = new Point(10, 15);
      child.Graph = g;

      const grandchild = new Node(3, 20, 20);
      grandchild.TopLeft = new Point(15, 20);
      grandchild.Graph = g;

      g.Containers.set(container, [child]);
      g.Containers.set(child, [grandchild]);

      const childTLBefore = new Point(child.TopLeft.X, child.TopLeft.Y);
      const grandchildTLBefore = new Point(grandchild.TopLeft.X, grandchild.TopLeft.Y);

      container.wrapChildren();

      // Container shifted and resized
      expect(container.Width).toBeGreaterThan(40);
      expect(container.Height).toBeGreaterThan(30);

      // Child and grandchild stayed completely stationary
      expect(child.TopLeft.X).toBe(childTLBefore.X);
      expect(child.TopLeft.Y).toBe(childTLBefore.Y);
      expect(grandchild.TopLeft.X).toBe(grandchildTLBefore.X);
      expect(grandchild.TopLeft.Y).toBe(grandchildTLBefore.Y);
    });
  });

  describe("Section 11: Container edge routes do not move", () => {
    it("does not mutate edge route points when container is translated", () => {
      const g = new Graph();
      const container = new Node(1, 40, 30);
      container.isContainer = true;
      container.TopLeft = new Point(0, 0);
      container.Graph = g;

      const child = new Node(2, 50, 50);
      child.TopLeft = new Point(10, 10);
      child.Graph = g;
      g.Containers.set(container, [child]);

      const other = new Node(3, 40, 40);
      other.TopLeft = new Point(300, 300);
      other.Graph = g;

      const edge = new Edge("e1", container, other);
      const p1 = new Point(5, 5);
      const p2 = new Point(250, 250);
      edge.Route = [p1, p2];
      container.Edges.push(edge);

      container.wrapChildren();

      expect(edge.Route[0].X).toBe(5);
      expect(edge.Route[0].Y).toBe(5);
      expect(edge.Route[1].X).toBe(250);
      expect(edge.Route[1].Y).toBe(250);
      expect(edge.Route[0]).toBe(p1);
      expect(edge.Route[1]).toBe(p2);
    });
  });

  describe("Section 12: Object identity preservation", () => {
    it("preserves object identities of Box, TopLeft, Containers map, and child arrays", () => {
      const g = new Graph();
      const container = new Node(1, 40, 30);
      container.isContainer = true;
      const originalContainerTL = new Point(0, 0);
      container.TopLeft = originalContainerTL;
      const originalContainerBox = container.Box;
      container.Graph = g;

      const child = new Node(2, 50, 50);
      const originalChildTL = new Point(10, 10);
      child.TopLeft = originalChildTL;
      const originalChildBox = child.Box;
      child.Graph = g;

      const childrenArray = [child];
      g.Containers.set(container, childrenArray);

      container.wrapChildren();

      expect(container.Box).toBe(originalContainerBox);
      expect(container.TopLeft).toBe(originalContainerTL);
      expect(child.Box).toBe(originalChildBox);
      expect(child.TopLeft).toBe(originalChildTL);
      expect(g.Containers.get(container)).toBe(childrenArray);
      expect(childrenArray[0]).toBe(child);
    });
  });

  describe("Section 13: FixedTopLeft preservation", () => {
    it("preserves container FixedTopLeft and child FixedTopLeft", () => {
      const g = new Graph();
      const container = new Node(1, 40, 30);
      container.isContainer = true;
      container.TopLeft = new Point(0, 0);
      const containerFixed = new Point(0, 0);
      container.FixedTopLeft = containerFixed;
      container.Graph = g;

      const child = new Node(2, 50, 50);
      child.TopLeft = new Point(50, 50);
      const childFixed = new Point(20, 15);
      child.FixedTopLeft = childFixed;
      child.Graph = g;
      g.Containers.set(container, [child]);

      container.wrapChildren();

      expect(container.FixedTopLeft).toBe(containerFixed);
      expect(container.FixedTopLeft.X).toBe(0);
      expect(container.FixedTopLeft.Y).toBe(0);
      expect(child.FixedTopLeft).toBe(childFixed);
      expect(child.FixedTopLeft.X).toBe(20);
      expect(child.FixedTopLeft.Y).toBe(15);
    });
  });
});
