import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Point } from "../../src/geometry/point.js";
import {
  normalize,
  Normalize,
  pad,
  Pad,
  placementPadding,
} from "../../src/placement/stage-geometry.js";
import * as placementBarrel from "../../src/placement/index.js";
import * as rootBarrel from "../../src/internal.js";

describe("Placement Stage Geometry Direct Tests", () => {
  it("defines placementPadding as 1000", () => {
    expect(placementPadding).toBe(1000);
  });

  describe("normalize / Normalize", () => {
    it("shifts nodes so geometric minimum is at (0, 0)", () => {
      const g = new Graph();
      const n1 = new Node(1n);
      n1.TopLeft = new Point(100, 250);
      const n2 = new Node(2n);
      n2.TopLeft = new Point(300, 50);
      g.Nodes.push(n1, n2);

      normalize(g);

      // minX = 100, minY = 50
      expect(n1.TopLeft.X).toBe(0);
      expect(n1.TopLeft.Y).toBe(200);
      expect(n2.TopLeft.X).toBe(200);
      expect(n2.TopLeft.Y).toBe(0);
    });

    it("shifts edge route points by the discovered geometric minimum", () => {
      const g = new Graph();
      const n1 = new Node(1n);
      n1.TopLeft = new Point(100, 100);
      g.Nodes.push(n1);

      const edge = new Edge(n1, n1);
      edge.Points = [new Point(20, 30), new Point(150, 150)];
      g.Edges.push(edge);

      Normalize(g);

      // minX = 20, minY = 30
      expect(n1.TopLeft.X).toBe(80);
      expect(n1.TopLeft.Y).toBe(70);
      expect(edge.Points[0].X).toBe(0);
      expect(edge.Points[0].Y).toBe(0);
      expect(edge.Points[1].X).toBe(130);
      expect(edge.Points[1].Y).toBe(120);
    });

    it("applies fixed-node oddity: shifts by exactly (-1000, -1000) when fixed node exists", () => {
      const g = new Graph();
      const n1 = new Node(1n);
      n1.TopLeft = new Point(500, 500);
      n1.FixedTopLeft = new Point(500, 500);

      const n2 = new Node(2n);
      n2.TopLeft = new Point(2000, 3000);

      const edge = new Edge(n1, n2);
      edge.Points = [new Point(600, 700)];

      g.Nodes.push(n1, n2);
      g.Edges.push(edge);

      normalize(g);

      // minX = 1000, minY = 1000 unconditionally
      expect(n1.TopLeft.X).toBe(-500);
      expect(n1.TopLeft.Y).toBe(-500);
      // FixedTopLeft is not shifted
      expect(n1.FixedTopLeft.X).toBe(500);
      expect(n1.FixedTopLeft.Y).toBe(500);

      expect(n2.TopLeft.X).toBe(1000);
      expect(n2.TopLeft.Y).toBe(2000);

      expect(edge.Points[0].X).toBe(-400);
      expect(edge.Points[0].Y).toBe(-300);
    });

    it("does nothing to an empty graph", () => {
      const g = new Graph();
      expect(() => normalize(g)).not.toThrow();
    });
  });

  describe("pad / Pad", () => {
    it("shifts all node positions by +1000, +1000 without touching edges or FixedTopLeft", () => {
      const g = new Graph();
      const n1 = new Node(1n);
      n1.TopLeft = new Point(50, 100);
      n1.FixedTopLeft = new Point(50, 100);

      const edge = new Edge(n1, n1);
      edge.Points = [new Point(10, 20)];

      g.Nodes.push(n1);
      g.Edges.push(edge);

      Pad(g);

      expect(n1.TopLeft.X).toBe(1050);
      expect(n1.TopLeft.Y).toBe(1100);
      expect(n1.FixedTopLeft.X).toBe(50);
      expect(n1.FixedTopLeft.Y).toBe(100);

      // Edge route points NOT shifted by Pad
      expect(edge.Points[0].X).toBe(10);
      expect(edge.Points[0].Y).toBe(20);
    });

    it("succeeds on empty graph", () => {
      const g = new Graph();
      expect(() => pad(g)).not.toThrow();
    });
  });

  describe("Normalize + Pad composition", () => {
    it("normalizes to origin and pads to (1000, 1000) for ordinary graphs", () => {
      const g = new Graph();
      const n = new Node(1n);
      n.TopLeft = new Point(50, 50);
      g.Nodes.push(n);

      normalize(g);
      expect(n.TopLeft.X).toBe(0);
      expect(n.TopLeft.Y).toBe(0);

      pad(g);
      expect(n.TopLeft.X).toBe(1000);
      expect(n.TopLeft.Y).toBe(1000);
    });

    it("restores node coordinates on fixed graphs, while edge route remains offset by -1000", () => {
      const g = new Graph();
      const n = new Node(1n);
      n.TopLeft = new Point(200, 300);
      n.FixedTopLeft = new Point(200, 300);

      const edge = new Edge(n, n);
      edge.Points = [new Point(500, 500)];

      g.Nodes.push(n);
      g.Edges.push(edge);

      normalize(g);
      // Nodes shifted by -1000
      expect(n.TopLeft.X).toBe(-800);
      expect(n.TopLeft.Y).toBe(-700);
      // Edge shifted by -1000
      expect(edge.Points[0].X).toBe(-500);
      expect(edge.Points[0].Y).toBe(-500);

      pad(g);
      // Nodes restored: -800 + 1000 = 200, -700 + 1000 = 300
      expect(n.TopLeft.X).toBe(200);
      expect(n.TopLeft.Y).toBe(300);
      // Edge NOT padded: remains -500, -500
      expect(edge.Points[0].X).toBe(-500);
      expect(edge.Points[0].Y).toBe(-500);
    });
  });

  describe("barrel isolation", () => {
    it("stage geometry helpers are not exposed in placement or root barrels", () => {
      expect(placementBarrel.normalize).toBeUndefined();
      expect(placementBarrel.Normalize).toBeUndefined();
      expect(placementBarrel.pad).toBeUndefined();
      expect(placementBarrel.Pad).toBeUndefined();
      expect(placementBarrel.placementPadding).toBeUndefined();

      expect(rootBarrel.normalize).toBeUndefined();
      expect(rootBarrel.Normalize).toBeUndefined();
      expect(rootBarrel.pad).toBeUndefined();
      expect(rootBarrel.Pad).toBeUndefined();
      expect(rootBarrel.placementPadding).toBeUndefined();
    });
  });
});
