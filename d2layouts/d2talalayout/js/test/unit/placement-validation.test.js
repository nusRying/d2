import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";
import {
  validateCellSize,
  validatePlacedNodes,
  validateGridAlignment,
} from "../../src/placement/validation.js";
import * as placementBarrel from "../../src/placement/index.js";
import * as rootBarrel from "../../src/internal.js";

describe("Placement Validation Direct Tests", () => {
  describe("validateCellSize", () => {
    it("accepts valid positive integers", () => {
      const g = new Graph();
      for (const size of [1, 2, 10, 100, 1000]) {
        g.CellSize = size;
        expect(() => validateCellSize(g)).not.toThrow();
      }
    });

    it("rejects 0 and negative numbers", () => {
      const g = new Graph();
      g.CellSize = 0;
      expect(() => validateCellSize(g)).toThrow("layout invariant violated: invalid cell size 0");

      g.CellSize = -1;
      expect(() => validateCellSize(g)).toThrow("layout invariant violated: invalid cell size -1");
    });

    it("rejects fractional cell sizes", () => {
      const g = new Graph();
      g.CellSize = 0.5;
      expect(() => validateCellSize(g)).toThrow("layout invariant violated: invalid cell size 0.5");

      g.CellSize = 10.5;
      expect(() => validateCellSize(g)).toThrow("layout invariant violated: invalid cell size 10.5");
    });

    it("rejects NaN, +Infinity, -Infinity with Go-compatible formatting", () => {
      const g = new Graph();
      g.CellSize = NaN;
      expect(() => validateCellSize(g)).toThrow("layout invariant violated: invalid cell size NaN");

      g.CellSize = Infinity;
      expect(() => validateCellSize(g)).toThrow("layout invariant violated: invalid cell size +Inf");

      g.CellSize = -Infinity;
      expect(() => validateCellSize(g)).toThrow("layout invariant violated: invalid cell size -Inf");
    });
  });

  describe("validatePlacedNodes", () => {
    it("succeeds when all nodes have TopLeft", () => {
      const root = new Node(1n);
      const n1 = new Node(2n);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(3n);
      n2.TopLeft = new Point(10, 20);

      expect(() => validatePlacedNodes(root, [n1, n2])).not.toThrow();
    });

    it("succeeds on empty nodes array", () => {
      const root = new Node(1n);
      expect(() => validatePlacedNodes(root, [])).not.toThrow();
    });

    it("fails on the first unplaced node in source order", () => {
      const root = new Node(100n);
      const n1 = new Node(10n);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(20n); // unplaced
      const n3 = new Node(30n); // unplaced

      expect(() => validatePlacedNodes(root, [n1, n2, n3])).toThrow(
        "layout invariant violated: node 20 was not placed under container 100"
      );
    });

    it("formats nil root as container 0", () => {
      const n1 = new Node(42n);
      expect(() => validatePlacedNodes(null, [n1])).toThrow(
        "layout invariant violated: node 42 was not placed under container 0"
      );
    });
  });

  describe("validateGridAlignment", () => {
    it("validates cell size first before scanning nodes", () => {
      const g = new Graph();
      g.CellSize = 0;
      const n = new Node(1n);
      n.TopLeft = new Point(1, 1);
      g.Nodes.push(n);

      expect(() => validateGridAlignment(g)).toThrow("layout invariant violated: invalid cell size 0");
    });

    it("accepts aligned coordinates positive and negative", () => {
      const g = new Graph();
      g.CellSize = 10;
      const n1 = new Node(1n);
      n1.TopLeft = new Point(20, 30);
      const n2 = new Node(2n);
      n2.TopLeft = new Point(-20, -30);
      g.Nodes.push(n1, n2);

      expect(() => validateGridAlignment(g)).not.toThrow();
    });

    it("rejects non-fixed nodes with null TopLeft", () => {
      const g = new Graph();
      g.CellSize = 10;
      const n = new Node(1n);
      g.Nodes.push(n);

      expect(() => validateGridAlignment(g)).toThrow("layout invariant violated: node 1 has no position");
    });

    it("rejects misaligned x coordinates", () => {
      const g = new Graph();
      g.CellSize = 10;
      const n = new Node(1n);
      n.TopLeft = new Point(21, 30);
      g.Nodes.push(n);

      expect(() => validateGridAlignment(g)).toThrow("layout invariant violated: node 1 at (21, 30) is not aligned to cell size 10");
    });

    it("rejects misaligned y coordinates", () => {
      const g = new Graph();
      g.CellSize = 10;
      const n = new Node(1n);
      n.TopLeft = new Point(20, 35);
      g.Nodes.push(n);

      expect(() => validateGridAlignment(g)).toThrow("layout invariant violated: node 1 at (20, 35) is not aligned to cell size 10");
    });

    it("rejects fractional coordinates", () => {
      const g = new Graph();
      g.CellSize = 10;
      const n = new Node(1n);
      n.TopLeft = new Point(20.5, 30);
      g.Nodes.push(n);

      expect(() => validateGridAlignment(g)).toThrow("layout invariant violated: node 1 at (20.5, 30) is not aligned to cell size 10");
    });

    it("exempts fixed nodes from alignment check even if misaligned", () => {
      const g = new Graph();
      g.CellSize = 10;
      const n = new Node(1n);
      n.FixedTopLeft = new Point(13, 27);
      n.TopLeft = new Point(13, 27);
      g.Nodes.push(n);

      expect(() => validateGridAlignment(g)).not.toThrow();
    });

    it("exempts fixed nodes from unplaced check even if TopLeft is null", () => {
      const g = new Graph();
      g.CellSize = 10;
      const n = new Node(1n);
      n.FixedTopLeft = new Point(10, 20);
      n.TopLeft = null;
      g.Nodes.push(n);

      expect(() => validateGridAlignment(g)).not.toThrow();
    });
  });

  describe("barrel isolation", () => {
    it("validation helpers are not exposed in placement or root barrels", () => {
      expect(placementBarrel.validateCellSize).toBeUndefined();
      expect(placementBarrel.validatePlacedNodes).toBeUndefined();
      expect(placementBarrel.validateGridAlignment).toBeUndefined();

      expect(rootBarrel.validateCellSize).toBeUndefined();
      expect(rootBarrel.validatePlacedNodes).toBeUndefined();
      expect(rootBarrel.validateGridAlignment).toBeUndefined();
    });
  });
});
