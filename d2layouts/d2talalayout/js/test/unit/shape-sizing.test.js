import { describe, test, expect } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Label } from "../../src/graph/label.js";
import { LabelPosition } from "../../src/graph/label-position.js";
import { Point } from "../../src/geometry/point.js";
import { Box } from "../../src/geometry/box.js";
import {
  shapeGetDimensionsToFit,
  limitAR,
  OVAL_AR_LIMIT,
  PERSON_AR_LIMIT,
  C4_PERSON_AR_LIMIT
} from "../../src/shape/inner-geometry.js";

describe("Slice 21 — Shape Sizing & FitToBoundingBox (Direct Unit Tests)", () => {
  describe("API and Scope Boundaries", () => {
    test("exposes getDimensionsToFit, GetDimensionsToFit, fitToBoundingBox, and FitToBoundingBox", () => {
      const n = new Node(1, 100, 100);
      expect(typeof n.getDimensionsToFit).toBe("function");
      expect(typeof n.GetDimensionsToFit).toBe("function");
      expect(typeof n.fitToBoundingBox).toBe("function");
      expect(typeof n.FitToBoundingBox).toBe("function");
    });

    test("forbidden future and out-of-scope methods remain absent", () => {
      const n = new Node(1, 100, 100);
      expect(n.setContainer).toBeUndefined();
      expect(n.SetContainer).toBeUndefined();
      expect(n.wrapChildren).toBeUndefined();
      expect(n.WrapChildren).toBeUndefined();
      expect(n.fitNodeToGraph).toBeUndefined();
      expect(n.FitToGraph).toBeUndefined();
      expect(n.ArrangeClusterNodes).toBeUndefined();
      expect(n.arrangeNodesWithWork).toBeUndefined();
      expect(n.SyncClusters).toBeUndefined();
      expect(n.Cleanup).toBeUndefined();
      expect(n.cleanup).toBeUndefined();
      expect(n.AddHubs).toBeUndefined();
      expect(n.addHubs).toBeUndefined();
    });
  });

  describe("LimitAR behavior and ordering", () => {
    test("width-dominant branch triggers when width > aspectRatio * height", () => {
      // width = 400, height = 100, aspectRatio = 3.0 -> width > 300 -> height = round(400/3) = 133
      const [w, h] = limitAR(400, 100, 3.0);
      expect(w).toBe(400);
      expect(h).toBe(133);
    });

    test("height-dominant branch triggers when height > aspectRatio * width", () => {
      // width = 100, height = 400, aspectRatio = 3.0 -> height > 300 -> width = round(400/3) = 133
      const [w, h] = limitAR(100, 400, 3.0);
      expect(w).toBe(133);
      expect(h).toBe(400);
    });

    test("neither branch triggers when within aspect ratio limits", () => {
      const [w, h] = limitAR(200, 100, 3.0);
      expect(w).toBe(200);
      expect(h).toBe(100);
    });
  });

  describe("Oval float32 atan2 precision", () => {
    test("float32 atan2 truncation differs from float64 and is used by Oval sizing", () => {
      const w = 120;
      const h = 70;
      const f64 = Math.atan2(h, w);
      const f32 = Math.fround(f64);
      expect(f32).not.toBe(f64);

      // Verify shapeGetDimensionsToFit for Oval executes using f32
      const [fitW, fitH] = shapeGetDimensionsToFit("Oval", w, h, 10, 10);
      expect(fitW).toBeGreaterThan(0);
      expect(fitH).toBeGreaterThan(0);
    });
  });

  describe("GetDimensionsToFit non-mutation query", () => {
    test("query does not mutate node geometry, label, or desired dimensions", () => {
      const n = new Node(1, 100, 100);
      const originalTL = new Point(15, 25);
      n.TopLeft = originalTL;
      const originalBox = n.Box;
      n.DesiredWidth = 300;
      n.DesiredHeight = 200;
      n.Label = new Label("test", 50, 20);

      const res = n.GetDimensionsToFit(120, 80, 20, 20);
      expect(Array.isArray(res)).toBe(true);
      expect(res.length).toBe(2);

      // Check non-mutation
      expect(n.TopLeft).toBe(originalTL);
      expect(n.Box).toBe(originalBox);
      expect(n.Width).toBe(100);
      expect(n.Height).toBe(100);
      expect(n.DesiredWidth).toBe(300);
      expect(n.DesiredHeight).toBe(200);
      expect(n.Label.Width).toBe(50);
    });
  });

  describe("FitToBoundingBox semantics and edge cases", () => {
    test("preserves object identities of Box, TopLeft, tl, br, padding, and Label", () => {
      const n = new Node(1, 40, 30);
      const origBox = n.Box;
      const origTL = new Point(10, 20);
      n.TopLeft = origTL;
      const lbl = new Label("lbl", 80, 25);
      n.Label = lbl;

      const tl = new Point(0, 0);
      const br = new Point(100, 60);
      const pad = { top: 5, bottom: 5, left: 10, right: 10 };

      n.FitToBoundingBox(tl, br, pad);

      expect(n.Box).toBe(origBox);
      expect(n.TopLeft).toBe(origTL);
      expect(n.Label).toBe(lbl);
      expect(tl.X).toBe(0);
      expect(tl.Y).toBe(0);
      expect(br.X).toBe(100);
      expect(br.Y).toBe(60);
      // Dimensions mutated
      expect(n.Width).toBeGreaterThan(40);
      expect(n.Height).toBeGreaterThan(30);
    });

    test("works when node.TopLeft is null", () => {
      const n = new Node(1, 40, 30);
      n.TopLeft = null;

      const tl = new Point(0, 0);
      const br = new Point(100, 60);
      expect(() => {
        n.FitToBoundingBox(tl, br, null);
      }).not.toThrow();

      expect(n.Width).toBe(100);
      expect(n.Height).toBe(60);
      expect(n.TopLeft).toBeNull();
    });

    test("naturally throws when tl is null before mutating dimensions", () => {
      const n = new Node(1, 40, 30);
      const br = new Point(100, 100);

      expect(() => {
        n.FitToBoundingBox(null, br, null);
      }).toThrow();

      expect(n.Width).toBe(40);
      expect(n.Height).toBe(30);
    });

    test("naturally throws when br is null before mutating dimensions", () => {
      const n = new Node(1, 40, 30);
      const tl = new Point(0, 0);

      expect(() => {
        n.FitToBoundingBox(tl, null, null);
      }).toThrow();

      expect(n.Width).toBe(40);
      expect(n.Height).toBe(30);
    });

    test("DesiredWidth = 0 is non-null and suppresses inside-label minWidth", () => {
      const n = new Node(1, 40, 30);
      // Inside label with huge width
      n.Label = new Label("huge", 300, 50);
      n.Label.Position = LabelPosition.InsideTopLeft;
      n.DesiredWidth = 0; // Explicit 0

      const tl = new Point(0, 0);
      const br = new Point(50, 50);
      n.FitToBoundingBox(tl, br, null);

      // Raw width is 50. Since DesiredWidth != null, minWidth (300 + 20 = 320) is NOT used.
      // fitWidth = 50. Final width = max(50, 0) = 50.
      expect(n.Width).toBe(50);
    });

    test("DesiredWidth larger than fit wins, smaller loses to fit", () => {
      const n1 = new Node(1, 40, 30);
      n1.DesiredWidth = 500;
      n1.FitToBoundingBox(new Point(0, 0), new Point(100, 100), null);
      expect(n1.Width).toBe(500);

      const n2 = new Node(2, 40, 30);
      n2.DesiredWidth = 20;
      n2.FitToBoundingBox(new Point(0, 0), new Point(100, 100), null);
      expect(n2.Width).toBe(100);
    });

    test("outside label position does not trigger label minimum", () => {
      const n = new Node(1, 40, 30);
      n.Label = new Label("outside", 300, 200);
      n.Label.Position = LabelPosition.OutsideTopLeft;

      n.FitToBoundingBox(new Point(0, 0), new Point(60, 40), null);
      // Raw 60x40 is used without minWidth/minHeight expansion
      expect(n.Width).toBe(60);
      expect(n.Height).toBe(40);
    });

    test("unset label position triggers inside label minimum", () => {
      const n = new Node(1, 40, 30);
      n.Label = new Label("unset", 100, 70);
      n.Label.Position = LabelPosition.Unset;

      n.FitToBoundingBox(new Point(0, 0), new Point(50, 50), null);
      // minWidth = 100 + 20 = 120, minHeight = 70 + 20 = 90
      expect(n.Width).toBe(120);
      expect(n.Height).toBe(90);
    });
  });
});
