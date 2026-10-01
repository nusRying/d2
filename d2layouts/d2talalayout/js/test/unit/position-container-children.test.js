import { describe, expect, test } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Graph } from "../../src/graph/graph.js";
import { Point } from "../../src/geometry/point.js";
import { Label } from "../../src/graph/label.js";
import { LabelPosition } from "../../src/graph/label-position.js";
import { Edge } from "../../src/graph/edge.js";

describe("Slice 20 — Container Child Positioning (Direct Unit Tests)", () => {
  describe("API and Scope Boundaries", () => {
    test("exposes positionContainerChildren and PositionContainerChildren", () => {
      const n = new Node(1, 100, 100);
      expect(typeof n.positionContainerChildren).toBe("function");
      expect(typeof n.PositionContainerChildren).toBe("function");
    });

    test("exposes internal camelCase expandForLabels but NOT public ExpandForLabels", () => {
      const n = new Node(1, 100, 100);
      expect(typeof n.expandForLabels).toBe("function");
      expect(n.ExpandForLabels).toBeUndefined();
    });

    test("forbidden future methods remain absent", () => {
      const g = new Graph();
      const n = new Node(1, 100, 100);
      expect(n.wrapChildren).toBeUndefined();
      expect(n.WrapChildren).toBeUndefined();
      expect(n.fitToBoundingBox).toBeUndefined();
      expect(n.FitToBoundingBox).toBeUndefined();
      expect(g.SyncClusters).toBeUndefined();
      expect(g.Cleanup).toBeUndefined();
      expect(g.cleanup).toBeUndefined();
    });
  });

  describe("Section 1: Non-container early return", () => {
    test("early returns as a no-op when isContainer is false even if Graph or TopLeft is null", () => {
      const n = new Node(1, 200, 200);
      n.isContainer = false;
      n.Graph = null;
      n.TopLeft = null;

      expect(() => {
        n.PositionContainerChildren(false);
      }).not.toThrow();

      expect(() => {
        n.positionContainerChildren(true);
      }).not.toThrow();
    });
  });

  describe("Section 4 & 5: withPadding parameter behavior", () => {
    test("withPadding=false strictly bypasses Graph.containerPadding", () => {
      const g = new Graph();
      const c = new Node(1, 300, 300);
      c.TopLeft = new Point(0, 0);
      g.addNode(c);
      g.addNewNodeToContainer(c, new Node(2, 50, 50));
      c.Graph.Containers.get(c)[0].TopLeft = new Point(10, 10);

      g.containerPadding = () => {
        throw new Error("containerPadding must NOT be called when withPadding=false");
      };

      expect(() => {
        c.PositionContainerChildren(false);
      }).not.toThrow();
    });

    test("withPadding=true delegates to Graph.containerPadding(node, false)", () => {
      const g = new Graph();
      const c = new Node(1, 300, 300);
      c.TopLeft = new Point(0, 0);
      g.addNode(c);
      const ch = new Node(2, 50, 50);
      ch.TopLeft = new Point(10, 10);
      g.addNewNodeToContainer(c, ch);

      let calledWith = null;
      const originalCP = g.containerPadding.bind(g);
      g.containerPadding = (container, considerChildren) => {
        calledWith = { container, considerChildren };
        return originalCP(container, considerChildren);
      };

      c.PositionContainerChildren(true);

      expect(calledWith).not.toBeNull();
      expect(calledWith.container).toBe(c);
      expect(calledWith.considerChildren).toBe(false);
    });
  });

  describe("Section 8, 9, 10, 11: expandForLabels semantics", () => {
    test("expandForLabels ignores Label.Height and Label.Position", () => {
      const g = new Graph();
      const c = new Node(1, 400, 400);
      c.TopLeft = new Point(0, 0);
      g.addNode(c);
      c.setContainer(true);

      const ch1 = new Node(2, 20, 20);
      ch1.TopLeft = new Point(100, 100);
      ch1.Label = new Label("test", 80, 10);
      ch1.Label.Position = LabelPosition.InsideBottomRight;
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, 20, 20);
      ch2.TopLeft = new Point(200, 100);
      g.addNewNodeToContainer(c, ch2);

      const tlA = new Point(100, 100);
      const brA = new Point(220, 120);
      c.expandForLabels(tlA, brA);

      // Now change Label.Height drastically and change Position
      ch1.Label.Height = 9999;
      ch1.Label.Position = LabelPosition.OutsideTopLeft;

      const tlB = new Point(100, 100);
      const brB = new Point(220, 120);
      c.expandForLabels(tlB, brB);

      expect(tlA.X).toBe(tlB.X);
      expect(tlA.Y).toBe(tlB.Y);
      expect(brA.X).toBe(brB.X);
      expect(brA.Y).toBe(brB.Y);
    });

    test("expandForLabels ignores interior long labels", () => {
      const g = new Graph();
      const c = new Node(1, 500, 300);
      c.TopLeft = new Point(0, 0);
      g.addNode(c);
      c.setContainer(true);

      const left = new Node(2, 40, 40);
      left.TopLeft = new Point(50, 50);
      g.addNewNodeToContainer(c, left);

      const mid = new Node(3, 40, 40);
      mid.TopLeft = new Point(150, 50);
      mid.Label = new Label("wide", 250, 20);
      mid.Label.Position = LabelPosition.InsideMiddleCenter;
      g.addNewNodeToContainer(c, mid);

      const right = new Node(4, 40, 40);
      right.TopLeft = new Point(250, 50);
      g.addNewNodeToContainer(c, right);

      const tl = new Point(50, 50);
      const br = new Point(290, 90);
      c.expandForLabels(tl, br);

      // Boundaries must not have expanded because mid is not at boundary
      expect(tl.X).toBe(50);
      expect(br.X).toBe(290);
    });
  });

  describe("Section 29: Identity preservation", () => {
    test("preserves object identities of container TopLeft, child TopLeft, and child FixedTopLeft", () => {
      const g = new Graph();
      const c = new Node(1, 400, 400);
      const cTL = new Point(0, 0);
      c.TopLeft = cTL;
      g.addNode(c);

      const ch = new Node(2, 50, 50);
      const chTL = new Point(10, 10);
      const chFTL = new Point(5, 5);
      ch.TopLeft = chTL;
      ch.FixedTopLeft = chFTL;
      g.addNewNodeToContainer(c, ch);

      const containersMap = g.Containers;
      const childrenArray = g.Containers.get(c);

      c.PositionContainerChildren(false);

      expect(c.TopLeft).toBe(cTL);
      expect(ch.TopLeft).toBe(chTL);
      expect(ch.FixedTopLeft).toBe(chFTL);
      expect(g.Containers).toBe(containersMap);
      expect(g.Containers.get(c)).toBe(childrenArray);
    });
  });

  describe("Section 30: Edge routes unaffected", () => {
    test("does not translate edge points or route points", () => {
      const g = new Graph();
      const c = new Node(1, 300, 300);
      c.TopLeft = new Point(0, 0);
      g.addNode(c);

      const ch1 = new Node(2, 50, 50);
      ch1.TopLeft = new Point(10, 10);
      const ch2 = new Node(3, 50, 50);
      ch2.TopLeft = new Point(80, 80);

      g.addNewNodeToContainer(c, ch1);
      g.addNewNodeToContainer(c, ch2);

      const edge = new Edge(1, ch1, ch2);
      const pt1 = new Point(15, 15);
      const pt2 = new Point(85, 85);
      edge.Points = [pt1, pt2];
      g.addEdge(edge);

      c.PositionContainerChildren(false);

      // Edge points must not be mutated
      expect(edge.Points[0]).toBe(pt1);
      expect(edge.Points[0].X).toBe(15);
      expect(edge.Points[0].Y).toBe(15);
      expect(edge.Points[1]).toBe(pt2);
      expect(edge.Points[1].X).toBe(85);
      expect(edge.Points[1].Y).toBe(85);
    });
  });
});
