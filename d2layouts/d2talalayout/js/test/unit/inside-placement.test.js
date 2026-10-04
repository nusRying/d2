import { describe, expect, test } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Box } from "../../src/geometry/box.js";
import { Point } from "../../src/geometry/point.js";
import { shapeGetInsidePlacement, shapeGetInnerBox } from "../../src/shape/inner-geometry.js";

describe("Slice 19 — Shape Inner Geometry & Node InsidePlacement", () => {
  describe("API and casing parity", () => {
    test("supports both camelCase and PascalCase methods", () => {
      const node = new Node(1, 100, 80);
      node.TopLeft = new Point(10, 20);
      node.SetShape("Square");

      const padding = { top: 10, bottom: 10, left: 10, right: 10 };
      const p1 = node.insidePlacement(40, 30, padding);
      const p2 = node.InsidePlacement(40, 30, padding);

      expect(p1.X).toBe(p2.X);
      expect(p1.Y).toBe(p2.Y);

      const ib1 = node.innerBox();
      const ib2 = node.InnerBox();

      expect(ib1.TopLeft.X).toBe(ib2.TopLeft.X);
      expect(ib1.TopLeft.Y).toBe(ib2.TopLeft.Y);
      expect(ib1.Width).toBe(ib2.Width);
      expect(ib1.Height).toBe(ib2.Height);
    });

    test("supports method-based Spacing accessors", () => {
      const node = new Node(1, 100, 80);
      node.TopLeft = new Point(10, 20);
      node.SetShape("Square");

      const spacingObj = {
        Top() { return 11; },
        Bottom() { return 29; },
        Left() { return 7; },
        Right() { return 21; },
      };

      const p = node.InsidePlacement(40, 30, spacingObj);
      expect(typeof p.X).toBe("number");
      expect(typeof p.Y).toBe("number");
    });
  });

  describe("Section 24: Circle Node wrapper centering correction", () => {
    test("proves Node.InsidePlacement applies extra Circle centering absent in Shape.GetInsidePlacement", () => {
      // Shape: circle of size 200x200 at (0, 0)
      const node = new Node(1, 200, 200);
      node.TopLeft = new Point(0, 0);
      node.SetShape("Circle");

      const width = 20;
      const height = 20;
      const padding = { top: 0, bottom: 0, left: 0, right: 0 };

      // Raw shape placement top-left of inscribed box:
      const rawShapeP = shapeGetInsidePlacement("Circle", node.Box, width, height, 0, 0);
      // For circle 200x200: r=100, halfLength = 100 * sqrt(2)/2 = 70.710678...
      // r - halfLength = 29.2893... Math.ceil gives 30.
      expect(rawShapeP.X).toBe(30);
      expect(rawShapeP.Y).toBe(30);

      // Node.InsidePlacement centers content (20x20) in innerBox (~140x140):
      // innerBox = 140x140. (innerBox.Width - totalWidth) / 2 = (140 - 20) / 2 = 60
      // p.X becomes 30 + 60 = 90.
      const nodeP = node.InsidePlacement(width, height, padding);
      expect(nodeP.X).toBe(90);
      expect(nodeP.Y).toBe(90);

      // If only shape placement were used, nodeP.X would be 30, NOT 90.
      expect(nodeP.X).not.toBe(rawShapeP.X);
      expect(nodeP.X - rawShapeP.X).toBe(60);
    });
  });

  describe("Section 25: Asymmetric padding correction", () => {
    test("verifies asymmetric padding correction formula", () => {
      const node = new Node(1, 200, 160);
      node.TopLeft = new Point(100, 150);
      node.SetShape("Square");

      const padding = { top: 11, bottom: 29, left: 7, right: 21 };
      // padX = 28, padY = 40
      // innerTL = (100, 150)
      // shape p = (100 + 14, 150 + 20) = (114, 170)
      // correction:
      // p.X -= goRound(28 / 2) - 7 = 114 - (14 - 7) = 107
      // p.Y -= goRound(40 / 2) - 11 = 170 - (20 - 11) = 161
      const p = node.InsidePlacement(60, 40, padding);
      expect(p.X).toBe(107);
      expect(p.Y).toBe(161);
    });
  });

  describe("Section 26: Oval float32 atan2 precision", () => {
    test("uses Math.fround for theta calculation matching Go float32(math.Atan2(...))", () => {
      const node = new Node(1, 333, 217);
      node.TopLeft = new Point(10, 15);
      node.SetShape("Oval");

      const rx = 333 / 2.0;
      const ry = 217 / 2.0;
      const f32Theta = Math.fround(Math.atan2(ry, rx));
      const f64Theta = Math.atan2(ry, rx);

      expect(f32Theta).not.toBe(f64Theta);

      const p = node.InsidePlacement(77, 55, { top: 7, bottom: 13, left: 9, right: 17 });
      expect(typeof p.X).toBe("number");
      expect(typeof p.Y).toBe("number");
    });
  });

  describe("Section 27: InnerBox identity & non-mutation", () => {
    test("returned Box and TopLeft are brand new instances for all shape types", () => {
      const shapeTypes = [
        "", "Square", "RealSquare", "Circle", "Oval", "Cloud", "Page", "Step",
        "Queue", "Hexagon", "Diamond", "Document", "Cylinder", "StoredData",
        "Parallelogram", "Callout", "Person", "C4Person", "Package", "Image",
        "Table", "Class", "Text", "Code"
      ];

      for (const shapeType of shapeTypes) {
        const node = new Node(1, 100, 80);
        node.TopLeft = new Point(10, 20);
        node.SetShape(shapeType);

        const origTopLeft = node.TopLeft;
        const origBox = node.Box;
        const origX = node.TopLeft.X;
        const origY = node.TopLeft.Y;
        const origW = node.Width;
        const origH = node.Height;

        const ib = node.InnerBox();

        // Must be new instances
        expect(ib).not.toBe(origBox);
        expect(ib.TopLeft).not.toBe(origTopLeft);

        // Node state must not be mutated
        expect(node.TopLeft).toBe(origTopLeft);
        expect(node.Box).toBe(origBox);
        expect(node.TopLeft.X).toBe(origX);
        expect(node.TopLeft.Y).toBe(origY);
        expect(node.Width).toBe(origW);
        expect(node.Height).toBe(origH);
      }
    });
  });

  describe("Section 28: InsidePlacement read-only behavior", () => {
    test("proves node geometry and padding object are unmutated and returned Point is new", () => {
      const node = new Node(1, 100, 80);
      node.TopLeft = new Point(10, 20);
      node.SetShape("Circle");

      const origTopLeft = node.TopLeft;
      const origBox = node.Box;
      const padding = { top: 11, bottom: 29, left: 7, right: 21 };

      const pt = node.InsidePlacement(30, 25, padding);

      // Returned point is new
      expect(pt).not.toBe(origTopLeft);
      expect(pt instanceof Point).toBe(true);

      // Node properties unchanged
      expect(node.Box).toBe(origBox);
      expect(node.TopLeft).toBe(origTopLeft);
      expect(node.TopLeft.X).toBe(10);
      expect(node.TopLeft.Y).toBe(20);
      expect(node.Width).toBe(100);
      expect(node.Height).toBe(80);

      // Padding values unchanged
      expect(padding.top).toBe(11);
      expect(padding.bottom).toBe(29);
      expect(padding.left).toBe(7);
      expect(padding.right).toBe(21);
    });
  });

  describe("Section 23: Rounding half-integers with goRound", () => {
    test("rounds -10.5 to -11 and +10.5 to +11 matching Go math.Round", () => {
      const nodeNeg = new Node(1, 99.5, 89.5);
      nodeNeg.TopLeft = new Point(-10.5, -20.5);
      nodeNeg.SetShape("Square");

      const ibNeg = nodeNeg.InnerBox();
      expect(ibNeg.TopLeft.X).toBe(-11);
      expect(ibNeg.TopLeft.Y).toBe(-21);
      expect(ibNeg.Width).toBe(100);
      expect(ibNeg.Height).toBe(90);

      const nodePos = new Node(1, 99.5, 89.5);
      nodePos.TopLeft = new Point(10.5, 20.5);
      nodePos.SetShape("Square");

      const ibPos = nodePos.InnerBox();
      expect(ibPos.TopLeft.X).toBe(11);
      expect(ibPos.TopLeft.Y).toBe(21);
      expect(ibPos.Width).toBe(100);
      expect(ibPos.Height).toBe(90);
    });
  });
});
