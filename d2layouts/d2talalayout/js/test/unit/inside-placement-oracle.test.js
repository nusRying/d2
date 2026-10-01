import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/go-inside-placement-reference.json";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";

describe("Slice 19 — Real-Go Node InsidePlacement & InnerBox Oracle Parity", () => {
  describe("Node.InsidePlacement oracle scenarios", () => {
    for (const sc of fixture.insidePlacement) {
      test(`InsidePlacement scenario: ${sc.name} (shape=${sc.shape || "default"})`, () => {
        const node = new Node(1, sc.outerBox.width, sc.outerBox.height);
        node.TopLeft = new Point(sc.outerBox.topLeft.x, sc.outerBox.topLeft.y);
        node.SetShape(sc.shape);

        const pt = node.InsidePlacement(sc.contentWidth, sc.contentHeight, sc.padding);

        expect(pt.X).toBe(sc.point.x);
        expect(pt.Y).toBe(sc.point.y);
      });
    }
  });

  describe("Node.InnerBox oracle scenarios", () => {
    for (const sc of fixture.innerBox) {
      test(`InnerBox scenario: ${sc.name} (shape=${sc.shape || "default"})`, () => {
        const node = new Node(1, sc.outerBox.width, sc.outerBox.height);
        node.TopLeft = new Point(sc.outerBox.topLeft.x, sc.outerBox.topLeft.y);
        node.SetShape(sc.shape);

        const ib = node.InnerBox();

        expect(ib.TopLeft.X).toBe(sc.innerBox.topLeft.x);
        expect(ib.TopLeft.Y).toBe(sc.innerBox.topLeft.y);
        expect(ib.Width).toBe(sc.innerBox.width);
        expect(ib.Height).toBe(sc.innerBox.height);
      });
    }
  });

  describe("Semantic fixture assertions", () => {
    test("circle_content_smaller_than_inner exhibits post-placement centering in Go fixture", () => {
      const circleScenario = fixture.insidePlacement.find(
        (s) => s.name === "circle_content_smaller_than_inner"
      );
      expect(circleScenario).toBeDefined();

      // Outer circle is 200x200 at (0, 0), content is 40x40 with padding 10 on all sides.
      // Raw shape placement without centering would place at (r - halfLength + 10) = 40.
      // With Node.InsidePlacement centering, it shifts right and down by (140 - 60)/2 = 40.
      // So final point in Go fixture is (80, 80).
      expect(circleScenario.point.x).toBe(80);
      expect(circleScenario.point.y).toBe(80);

      // Verify that JS reproduces this exact point
      const node = new Node(1, circleScenario.outerBox.width, circleScenario.outerBox.height);
      node.TopLeft = new Point(circleScenario.outerBox.topLeft.x, circleScenario.outerBox.topLeft.y);
      node.SetShape(circleScenario.shape);

      const pt = node.InsidePlacement(
        circleScenario.contentWidth,
        circleScenario.contentHeight,
        circleScenario.padding
      );
      expect(pt.X).toBe(80);
      expect(pt.Y).toBe(80);
    });

    test("square_asymmetric_padding demonstrates asymmetric shift in Go fixture", () => {
      const asymScenario = fixture.insidePlacement.find(
        (s) => s.name === "square_asymmetric_padding"
      );
      expect(asymScenario).toBeDefined();
      expect(asymScenario.padding.top).toBe(11);
      expect(asymScenario.padding.bottom).toBe(29);
      expect(asymScenario.padding.left).toBe(7);
      expect(asymScenario.padding.right).toBe(21);
      expect(asymScenario.point.x).toBe(107);
      expect(asymScenario.point.y).toBe(161);
    });
  });
});
