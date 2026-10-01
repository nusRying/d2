import { describe, expect, test } from "bun:test";
import fixture from "../fixtures/go-position-container-children-reference.json";
import { Node } from "../../src/graph/node.js";
import { Graph } from "../../src/graph/graph.js";
import { Point } from "../../src/geometry/point.js";
import { Label } from "../../src/graph/label.js";
import { LabelPosition } from "../../src/graph/label-position.js";

describe("Slice 20 — Real-Go PositionContainerChildren Oracle Parity", () => {
  describe("Replay all Go oracle scenarios", () => {
    // 1. non_container_noop
    test("scenario: non_container_noop", () => {
      const sc = fixture.scenarios.non_container_noop;
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.isContainer = false;
      c.Graph = null;

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(c.TopLeft.X).toBe(sc.afterStates["1"].topLeft.x);
      expect(c.TopLeft.Y).toBe(sc.afterStates["1"].topLeft.y);
    });

    // 2. true_container_nil_graph_panics
    test("scenario: true_container_nil_graph_panics", () => {
      const sc = fixture.scenarios.true_container_nil_graph_panics;
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.setContainer(true);
      c.Graph = null;

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(c.TopLeft.X).toBe(sc.afterStates["1"].topLeft.x);
      expect(c.TopLeft.Y).toBe(sc.afterStates["1"].topLeft.y);
    });

    // 3. square_no_padding
    test("scenario: square_no_padding", () => {
      const sc = fixture.scenarios.square_no_padding;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.SetShape("Square");
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });

    // 4. square_with_padding
    test("scenario: square_with_padding", () => {
      const sc = fixture.scenarios.square_with_padding;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.SetShape("Square");
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });

    // 5. circle_no_padding
    test("scenario: circle_no_padding", () => {
      const sc = fixture.scenarios.circle_no_padding;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.SetShape("Circle");
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });

    // 6. circle_with_padding
    test("scenario: circle_with_padding", () => {
      const sc = fixture.scenarios.circle_with_padding;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.SetShape("Circle");
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });

    // 7. oval_or_cloud
    test("scenario: oval_or_cloud", () => {
      const sc = fixture.scenarios.oval_or_cloud;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.SetShape("Oval");
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });

    // 8. nested_descendants
    test("scenario: nested_descendants", () => {
      const sc = fixture.scenarios.nested_descendants;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);

      const child = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      child.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, child);

      const grandchild = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      grandchild.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(child, grandchild);

      const greatGrandchild = new Node(4, sc.beforeStates["4"].width, sc.beforeStates["4"].height);
      greatGrandchild.TopLeft = new Point(sc.beforeStates["4"].topLeft.x, sc.beforeStates["4"].topLeft.y);
      g.addNewNodeToContainer(grandchild, greatGrandchild);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(child.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(child.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(grandchild.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(grandchild.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
      expect(greatGrandchild.TopLeft.X).toBe(sc.afterStates["4"].topLeft.x);
      expect(greatGrandchild.TopLeft.Y).toBe(sc.afterStates["4"].topLeft.y);
    });

    // 9. boundary_long_label
    test("scenario: boundary_long_label", () => {
      const sc = fixture.scenarios.boundary_long_label;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch1.Label = new Label("lbl", 80, 15);
      ch1.Label.Position = LabelPosition.InsideTopLeft;
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });

    // 10. interior_long_label_ignored
    test("scenario: interior_long_label_ignored", () => {
      const sc = fixture.scenarios.interior_long_label_ignored;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);

      const left = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      left.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, left);

      const mid = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      mid.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      mid.Label = new Label("mid", 200, 20);
      mid.Label.Position = LabelPosition.InsideTopLeft;
      g.addNewNodeToContainer(c, mid);

      const right = new Node(4, sc.beforeStates["4"].width, sc.beforeStates["4"].height);
      right.TopLeft = new Point(sc.beforeStates["4"].topLeft.x, sc.beforeStates["4"].topLeft.y);
      g.addNewNodeToContainer(c, right);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(left.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(mid.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(right.TopLeft.X).toBe(sc.afterStates["4"].topLeft.x);
    });

    // 11. label_height_irrelevant
    test("scenario: label_height_irrelevant", () => {
      const sc = fixture.scenarios.label_height_irrelevant;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch1.Label = new Label("tall", 80, 500);
      ch1.Label.Position = LabelPosition.InsideTopLeft;
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
    });

    // 12. fixed_origin
    test("scenario: fixed_origin", () => {
      const sc = fixture.scenarios.fixed_origin;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch1.FixedTopLeft = new Point(sc.beforeStates["2"].fixedTopLeft.x, sc.beforeStates["2"].fixedTopLeft.y);
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch1.FixedTopLeft.X).toBe(sc.afterStates["2"].fixedTopLeft.x);
      expect(ch1.FixedTopLeft.Y).toBe(sc.afterStates["2"].fixedTopLeft.y);
    });

    // 13. empty_container_missing_key
    test("scenario: empty_container_missing_key", () => {
      const sc = fixture.scenarios.empty_container_missing_key;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);
      c.setContainer(true);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(c.TopLeft.X).toBe(sc.afterStates["1"].topLeft.x);
      expect(c.TopLeft.Y).toBe(sc.afterStates["1"].topLeft.y);
    });

    // 14. empty_container_empty_slice
    test("scenario: empty_container_empty_slice", () => {
      const sc = fixture.scenarios.empty_container_empty_slice;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);
      c.setContainer(true);
      g.Containers.set(c, []);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(c.TopLeft.X).toBe(sc.afterStates["1"].topLeft.x);
      expect(c.TopLeft.Y).toBe(sc.afterStates["1"].topLeft.y);
    });

    // 15. duplicate_child_occurrence
    test("scenario: duplicate_child_occurrence", () => {
      const sc = fixture.scenarios.duplicate_child_occurrence;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);
      c.setContainer(true);

      const ch = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch.Graph = g;
      g.Nodes.push(ch);
      ch.Container = c;
      g.Containers.set(c, [ch, ch]);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
    });

    // 16. nil_child_panics_before_movement
    test("scenario: nil_child_panics_before_movement", () => {
      const sc = fixture.scenarios.nil_child_panics_before_movement;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);
      c.setContainer(true);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch1.Graph = g;
      g.Nodes.push(ch1);
      ch1.Container = c;
      g.Containers.set(c, [ch1, null]);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
    });

    // 17. null_top_left_panics_before_movement
    test("scenario: null_top_left_panics_before_movement", () => {
      const sc = fixture.scenarios.null_top_left_panics_before_movement;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);
      c.setContainer(true);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch1.Graph = g;
      g.Nodes.push(ch1);
      ch1.Container = c;

      const chNoTL = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      chNoTL.TopLeft = null;
      chNoTL.Graph = g;
      g.Nodes.push(chNoTL);
      chNoTL.Container = c;

      g.Containers.set(c, [ch1, chNoTL]);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
    });

    // 18. detached_second_child_partial_mutation
    test("scenario: detached_second_child_partial_mutation", () => {
      const sc = fixture.scenarios.detached_second_child_partial_mutation;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      ch2.Container = c;
      ch2.Graph = null;
      g.Containers.get(c).push(ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });

    // 19. detached_child_zero_delta_no_panic
    test("scenario: detached_child_zero_delta_no_panic", () => {
      const sc = fixture.scenarios.detached_child_zero_delta_no_panic;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);
      c.setContainer(true);

      const ch = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch.Container = c;
      ch.Graph = null;
      g.Containers.set(c, [ch]);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
    });

    // 20. container_label_padding
    test("scenario: container_label_padding", () => {
      const sc = fixture.scenarios.container_label_padding;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      c.Label = new Label("cont", 100, 30);
      c.Label.Position = LabelPosition.InsideTopCenter;
      g.addNode(c);

      const ch = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      g.addNewNodeToContainer(c, ch);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
    });

    // 21. outside_label_fixed_bounds_ordering
    test("scenario: outside_label_fixed_bounds_ordering", () => {
      const sc = fixture.scenarios.outside_label_fixed_bounds_ordering;
      const g = new Graph();
      const c = new Node(1, sc.container.width, sc.container.height);
      c.TopLeft = new Point(sc.container.topLeft.x, sc.container.topLeft.y);
      g.addNode(c);

      const ch1 = new Node(2, sc.beforeStates["2"].width, sc.beforeStates["2"].height);
      ch1.TopLeft = new Point(sc.beforeStates["2"].topLeft.x, sc.beforeStates["2"].topLeft.y);
      ch1.Label = new Label("out", 40, 20);
      ch1.Label.Position = LabelPosition.OutsideLeftMiddle;
      g.addNewNodeToContainer(c, ch1);

      const ch2 = new Node(3, sc.beforeStates["3"].width, sc.beforeStates["3"].height);
      ch2.TopLeft = new Point(sc.beforeStates["3"].topLeft.x, sc.beforeStates["3"].topLeft.y);
      g.addNewNodeToContainer(c, ch2);

      let panicked = false;
      try {
        c.PositionContainerChildren(sc.withPadding);
      } catch {
        panicked = true;
      }

      expect(panicked).toBe(sc.panicked);
      expect(ch1.TopLeft.X).toBe(sc.afterStates["2"].topLeft.x);
      expect(ch1.TopLeft.Y).toBe(sc.afterStates["2"].topLeft.y);
      expect(ch2.TopLeft.X).toBe(sc.afterStates["3"].topLeft.x);
      expect(ch2.TopLeft.Y).toBe(sc.afterStates["3"].topLeft.y);
    });
  });

  describe("Section 37: Semantic fixture contract assertions", () => {
    test("non_container_noop: panicked == false and coordinates unchanged", () => {
      const sc = fixture.scenarios.non_container_noop;
      expect(sc.panicked).toBe(false);
      expect(sc.afterStates["1"].topLeft.x).toBe(sc.beforeStates["1"].topLeft.x);
      expect(sc.afterStates["1"].topLeft.y).toBe(sc.beforeStates["1"].topLeft.y);
    });

    test("boundary_long_label: movement reflects horizontally expanded bounds", () => {
      const sc = fixture.scenarios.boundary_long_label;
      expect(sc.panicked).toBe(false);
      // Delta moved child leftwards because label on left boundary expanded left bound from 100 to 70
      const dx = sc.afterStates["2"].topLeft.x - sc.beforeStates["2"].topLeft.x;
      expect(dx).toBe(-70);
    });

    test("interior_long_label_ignored: oversized interior label does not change delta", () => {
      const sc = fixture.scenarios.interior_long_label_ignored;
      expect(sc.panicked).toBe(false);
      // Children moved from tl=(50, 50) to container (0, 0), dx = -50
      const dx = sc.afterStates["2"].topLeft.x - sc.beforeStates["2"].topLeft.x;
      expect(dx).toBe(-50);
    });

    test("duplicate_child_occurrence: same object receives delta twice", () => {
      const sc = fixture.scenarios.duplicate_child_occurrence;
      expect(sc.panicked).toBe(false);
      // Initial is (10, 10), innerTL is (0, 0), dx = -10.
      // Receives delta twice -> 10 + 2 * (-10) = -10.
      expect(sc.afterStates["2"].topLeft.x).toBe(-10);
      expect(sc.afterStates["2"].topLeft.y).toBe(-10);
    });

    test("detached_second_child_partial_mutation: panicked == true, first child moved, second root moved before panic", () => {
      const sc = fixture.scenarios.detached_second_child_partial_mutation;
      expect(sc.panicked).toBe(true);
      // ch1 was moved
      expect(sc.afterStates["2"].topLeft.x).not.toBe(sc.beforeStates["2"].topLeft.x);
      // ch2 was translated in place before the descendant lookup panicked
      expect(sc.afterStates["3"].topLeft.x).not.toBe(sc.beforeStates["3"].topLeft.x);
    });

    test("detached_child_zero_delta_no_panic: panicked == false when delta is exactly zero", () => {
      const sc = fixture.scenarios.detached_child_zero_delta_no_panic;
      expect(sc.panicked).toBe(false);
      expect(sc.afterStates["2"].topLeft.x).toBe(sc.beforeStates["2"].topLeft.x);
      expect(sc.afterStates["2"].topLeft.y).toBe(sc.beforeStates["2"].topLeft.y);
    });

    test("fixed_origin: FixedTopLeft unchanged", () => {
      const sc = fixture.scenarios.fixed_origin;
      expect(sc.panicked).toBe(false);
      expect(sc.afterStates["2"].fixedTopLeft.x).toBe(sc.beforeStates["2"].fixedTopLeft.x);
      expect(sc.afterStates["2"].fixedTopLeft.y).toBe(sc.beforeStates["2"].fixedTopLeft.y);
      expect(sc.afterStates["2"].topLeft.x).not.toBe(sc.beforeStates["2"].topLeft.x);
    });
  });
});
