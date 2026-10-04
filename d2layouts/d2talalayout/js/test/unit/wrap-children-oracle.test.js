import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, "../fixtures/go-wrap-children-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf8"));

function parseNumberClass(s) {
  if (s == null) return null;
  if (s === "NaN") return NaN;
  if (s === "+Inf" || s === "+Infinity" || s === "Infinity") return Infinity;
  if (s === "-Inf" || s === "-Infinity") return -Infinity;
  return parseFloat(s);
}

function expectNumMatch(actual, expectedStr) {
  const expected = parseNumberClass(expectedStr);
  if (Number.isNaN(expected)) {
    expect(Number.isNaN(actual)).toBe(true);
  } else {
    expect(actual).toBe(expected);
  }
}

function setupScenario(tc) {
  let g = null;
  if (tc.name !== "true_container_nil_graph_panics" && tc.name !== "non_container_noop") {
    g = new Graph();
  }

  const nodesById = new Map();

  for (const [id, state] of Object.entries(tc.beforeStates)) {
    const w = parseNumberClass(state.width);
    const h = parseNumberClass(state.height);
    const n = new Node(id, w, h);
    if (state.topLeft) {
      n.TopLeft = new Point(
        parseNumberClass(state.topLeft.x),
        parseNumberClass(state.topLeft.y)
      );
    } else {
      n.TopLeft = null;
    }
    if (state.fixedTopLeft) {
      n.FixedTopLeft = new Point(
        parseNumberClass(state.fixedTopLeft.x),
        parseNumberClass(state.fixedTopLeft.y)
      );
    }
    n.Graph = g;
    nodesById.set(id, n);
  }

  const container = nodesById.get(tc.containerId);

  // Set container property
  if (tc.name !== "non_container_noop") {
    container.isContainer = true;
  }

  // Set shapes and labels for specific scenarios
  if (tc.name === "circle_basic") {
    container.setShape("Circle");
  } else if (tc.name === "oval_basic") {
    container.setShape("Oval");
  } else if (tc.name === "cloud_basic") {
    container.setShape("Cloud");
  }

  if (tc.name === "boundary_long_label") {
    const ch2 = nodesById.get("2");
    ch2.Label = { Width: 200, Height: 30, Position: 17 }; // InsideTopLeft
  } else if (tc.name === "interior_long_label_ignored") {
    const ch3 = nodesById.get("3");
    ch3.Label = { Width: 500, Height: 40, Position: 18 }; // InsideTopCenter
  } else if (tc.name === "child_outside_label_or_icon") {
    const ch2 = nodesById.get("2");
    ch2.Label = { Width: 80, Height: 30, Position: 1 }; // OutsideTopLeft
  } else if (tc.name === "container_label_padding") {
    container.Label = { Width: 120, Height: 40, Position: 17 }; // InsideTopLeft
  } else if (tc.name === "desired_width_larger") {
    container.DesiredWidth = 500;
  } else if (tc.name === "desired_height_larger") {
    container.DesiredHeight = 500;
  } else if (tc.name === "desired_width_zero") {
    container.DesiredWidth = 0;
  } else if (tc.name === "detached_child_graph_still_succeeds") {
    const ch2 = nodesById.get("2");
    ch2.Graph = null;
  }

  if (g) {
    if (tc.name === "nested_descendants_unchanged") {
      const ch2 = nodesById.get("2");
      const gc3 = nodesById.get("3");
      g.Containers.set(container, [ch2]);
      g.Containers.set(ch2, [gc3]);
    } else if (tc.name === "nil_child_panics_before_mutation") {
      g.Containers.set(container, [null]);
    } else if (tc.name === "empty_container_missing_key") {
      // Do not set key in g.Containers
    } else if (tc.name === "empty_container_empty_slice") {
      g.Containers.set(container, []);
    } else if (tc.directOrder) {
      const children = tc.directOrder.map((id) => nodesById.get(id));
      g.Containers.set(container, children);
    }
  }

  return { g, container, nodesById };
}

describe("Slice 22 WrapChildren Oracle Replay", () => {
  for (const [name, tc] of Object.entries(reference.scenarios)) {
    it(`replays ${name}`, () => {
      const { container, nodesById } = setupScenario(tc);

      if (tc.panicked) {
        expect(() => {
          container.wrapChildren();
        }).toThrow();
      } else {
        container.wrapChildren();
      }

      // Verify after states
      for (const [id, afterState] of Object.entries(tc.afterStates)) {
        const node = nodesById.get(id);
        expect(node).toBeDefined();

        expectNumMatch(node.Width, afterState.width);
        expectNumMatch(node.Height, afterState.height);

        if (afterState.topLeft == null) {
          expect(node.TopLeft).toBeNull();
        } else {
          expect(node.TopLeft).not.toBeNull();
          expectNumMatch(node.TopLeft.X, afterState.topLeft.x);
          expectNumMatch(node.TopLeft.Y, afterState.topLeft.y);
        }
      }
    });
  }

  describe("Section 39 Semantic Assertions", () => {
    it("non_container_noop: does not mutate node geometry or throw", () => {
      const tc = reference.scenarios.non_container_noop;
      expect(tc.panicked).toBe(false);
      expect(tc.beforeStates["1"].width).toBe(tc.afterStates["1"].width);
      expect(tc.beforeStates["1"].height).toBe(tc.afterStates["1"].height);
      expect(tc.beforeStates["1"].topLeft.x).toBe(tc.afterStates["1"].topLeft.x);
      expect(tc.beforeStates["1"].topLeft.y).toBe(tc.afterStates["1"].topLeft.y);
    });

    it("square_basic: container resized and translated, children stationary", () => {
      const tc = reference.scenarios.square_basic;
      expect(tc.panicked).toBe(false);

      // Child 2 is stationary
      expect(tc.beforeStates["2"].topLeft.x).toBe(tc.afterStates["2"].topLeft.x);
      expect(tc.beforeStates["2"].topLeft.y).toBe(tc.afterStates["2"].topLeft.y);

      // Container 1 resized and translated
      expect(tc.beforeStates["1"].width).not.toBe(tc.afterStates["1"].width);
      expect(tc.beforeStates["1"].height).not.toBe(tc.afterStates["1"].height);
      expect(tc.beforeStates["1"].topLeft.x).not.toBe(tc.afterStates["1"].topLeft.x);
      expect(tc.beforeStates["1"].topLeft.y).not.toBe(tc.afterStates["1"].topLeft.y);
    });

    it("circle_basic: matches Go geometry exact", () => {
      const tc = reference.scenarios.circle_basic;
      expect(tc.panicked).toBe(false);
      expect(tc.afterStates["1"].width).toBe(tc.afterStates["1"].height);
    });

    it("nested_descendants_unchanged: child and grandchild unchanged", () => {
      const tc = reference.scenarios.nested_descendants_unchanged;
      expect(tc.panicked).toBe(false);

      // Child unchanged
      expect(tc.beforeStates["2"].topLeft.x).toBe(tc.afterStates["2"].topLeft.x);
      expect(tc.beforeStates["2"].topLeft.y).toBe(tc.afterStates["2"].topLeft.y);

      // Grandchild unchanged
      expect(tc.beforeStates["3"].topLeft.x).toBe(tc.afterStates["3"].topLeft.x);
      expect(tc.beforeStates["3"].topLeft.y).toBe(tc.afterStates["3"].topLeft.y);
    });

    it("boundary_long_label: affects container width and position", () => {
      const tc = reference.scenarios.boundary_long_label;
      const tcBasic = reference.scenarios.square_basic;
      expect(tc.panicked).toBe(false);
      // Container width is much wider than basic
      expect(parseNumberClass(tc.afterStates["1"].width)).toBeGreaterThan(
        parseNumberClass(tcBasic.afterStates["1"].width)
      );
    });

    it("interior_long_label_ignored: interior label does not expand bounds", () => {
      const tc = reference.scenarios.interior_long_label_ignored;
      expect(tc.panicked).toBe(false);
      // Children positions 10, 80, 150 each width 50 -> raw bounds x: 10 to 200 (width 190).
      // Padding 20 each side -> 190 + 40 = 230.
      // If interior label (500) were considered, width would be > 600!
      expect(parseNumberClass(tc.afterStates["1"].width)).toBe(310);
      expect(parseNumberClass(tc.afterStates["1"].width)).toBeLessThan(500);
    });

    it("empty_container: not a no-op, produces non-finite geometry", () => {
      const tc1 = reference.scenarios.empty_container_missing_key;
      const tc2 = reference.scenarios.empty_container_empty_slice;
      expect(tc1.panicked).toBe(false);
      expect(tc2.panicked).toBe(false);

      expect(tc1.afterStates["1"].width).toBe("+Inf");
      expect(tc1.afterStates["1"].height).toBe("+Inf");
      expect(tc1.afterStates["1"].topLeft.x).toBe("-Inf");
      expect(tc1.afterStates["1"].topLeft.y).toBe("-Inf");

      expect(tc2.afterStates["1"].width).toBe("+Inf");
      expect(tc2.afterStates["1"].height).toBe("+Inf");
      expect(tc2.afterStates["1"].topLeft.x).toBe("-Inf");
      expect(tc2.afterStates["1"].topLeft.y).toBe("-Inf");
    });

    it("nil_child_panics_before_mutation: panics before container mutation", () => {
      const tc = reference.scenarios.nil_child_panics_before_mutation;
      expect(tc.panicked).toBe(true);
      expect(tc.beforeStates["1"].width).toBe(tc.afterStates["1"].width);
      expect(tc.beforeStates["1"].height).toBe(tc.afterStates["1"].height);
    });

    it("null_child_top_left_panics_before_mutation: panics before container mutation", () => {
      const tc = reference.scenarios.null_child_top_left_panics_before_mutation;
      expect(tc.panicked).toBe(true);
      expect(tc.beforeStates["1"].width).toBe(tc.afterStates["1"].width);
      expect(tc.beforeStates["1"].height).toBe(tc.afterStates["1"].height);
    });

    it("null_container_top_left_partial_resize: panics AFTER Width/Height mutation without rollback", () => {
      const tc = reference.scenarios.null_container_top_left_partial_resize;
      expect(tc.panicked).toBe(true);
      // TopLeft remained null
      expect(tc.beforeStates["1"].topLeft).toBeNull();
      expect(tc.afterStates["1"].topLeft).toBeNull();
      // Width and Height DID mutate!
      expect(tc.beforeStates["1"].width).toBe("40");
      expect(tc.beforeStates["1"].height).toBe("30");
      expect(tc.afterStates["1"].width).toBe("170");
      expect(tc.afterStates["1"].height).toBe("170");
    });

    it("duplicate_child_occurrence: child remains stationary", () => {
      const tc = reference.scenarios.duplicate_child_occurrence;
      expect(tc.panicked).toBe(false);
      expect(tc.beforeStates["2"].topLeft.x).toBe(tc.afterStates["2"].topLeft.x);
      expect(tc.beforeStates["2"].topLeft.y).toBe(tc.afterStates["2"].topLeft.y);
    });

    it("desired_width_larger: reflects non-nil desired width while child is unchanged", () => {
      const tc = reference.scenarios.desired_width_larger;
      expect(tc.panicked).toBe(false);
      expect(parseNumberClass(tc.afterStates["1"].width)).toBe(500);
      expect(parseNumberClass(tc.afterStates["1"].height)).toBe(170);
      // Child unchanged
      expect(tc.beforeStates["2"].topLeft.x).toBe(tc.afterStates["2"].topLeft.x);
      expect(tc.beforeStates["2"].topLeft.y).toBe(tc.afterStates["2"].topLeft.y);
      expect(tc.beforeStates["2"].width).toBe(tc.afterStates["2"].width);
      expect(tc.beforeStates["2"].height).toBe(tc.afterStates["2"].height);
    });

    it("desired_height_larger: reflects non-nil desired height while child is unchanged", () => {
      const tc = reference.scenarios.desired_height_larger;
      expect(tc.panicked).toBe(false);
      expect(parseNumberClass(tc.afterStates["1"].width)).toBe(170);
      expect(parseNumberClass(tc.afterStates["1"].height)).toBe(500);
      // Child unchanged
      expect(tc.beforeStates["2"].topLeft.x).toBe(tc.afterStates["2"].topLeft.x);
      expect(tc.beforeStates["2"].topLeft.y).toBe(tc.afterStates["2"].topLeft.y);
      expect(tc.beforeStates["2"].width).toBe(tc.afterStates["2"].width);
      expect(tc.beforeStates["2"].height).toBe(tc.afterStates["2"].height);
    });

    it("desired_width_zero: 0 is treated as non-null and container geometry matches Go", () => {
      const tc = reference.scenarios.desired_width_zero;
      expect(tc.panicked).toBe(false);
      expect(parseNumberClass(tc.afterStates["1"].width)).toBe(170);
      expect(parseNumberClass(tc.afterStates["1"].height)).toBe(170);
      // Child unchanged
      expect(tc.beforeStates["2"].topLeft.x).toBe(tc.afterStates["2"].topLeft.x);
      expect(tc.beforeStates["2"].topLeft.y).toBe(tc.afterStates["2"].topLeft.y);
      expect(tc.beforeStates["2"].width).toBe(tc.afterStates["2"].width);
      expect(tc.beforeStates["2"].height).toBe(tc.afterStates["2"].height);
    });
  });
});
