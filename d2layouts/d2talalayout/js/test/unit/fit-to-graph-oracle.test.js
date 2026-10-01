import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, "../fixtures/go-fit-to-graph-reference.json");
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
  let ownerG = null;
  let argG = null;

  if (tc.name !== "nil_owner_graph_panics_after_bounds_before_resize") {
    ownerG = new Graph();
  }

  if (tc.name !== "nil_argument_graph_panics_before_mutation") {
    argG = new Graph();
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
    nodesById.set(id, n);
  }

  const target = nodesById.get(tc.targetId);
  if (target) {
    target.Graph = ownerG;
    if (ownerG) {
      ownerG.AddNode(target);
    }
  }

  // Shapes
  if (tc.name === "circle_basic") {
    target.setShape("Circle");
  } else if (tc.name === "oval_basic") {
    target.setShape("Oval");
  } else if (tc.name === "cloud_basic") {
    target.setShape("Cloud");
  } else if (tc.name === "real_square_basic") {
    target.setShape("RealSquare");
  }

  // Labels and Desired Dimensions on target
  if (tc.name === "target_inside_label") {
    target.Label = { Width: 200, Height: 100, Position: 17 }; // InsideTopLeft
  } else if (tc.name === "target_outside_label") {
    target.Label = { Width: 200, Height: 100, Position: 1 }; // OutsideTopLeft
  } else if (tc.name === "desired_width_larger") {
    target.DesiredWidth = 500;
  } else if (tc.name === "desired_height_larger") {
    target.DesiredHeight = 500;
  } else if (tc.name === "desired_width_zero") {
    target.DesiredWidth = 0;
  }

  // Scenario-specific graph node and container assignments
  if (tc.name === "ordinary_non_container_succeeds") {
    target.isContainer = false;
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);
  } else if (
    tc.name === "square_basic" ||
    tc.name === "circle_basic" ||
    tc.name === "oval_basic" ||
    tc.name === "cloud_basic" ||
    tc.name === "real_square_basic" ||
    tc.name === "asymmetric_padding" ||
    tc.name === "desired_width_larger" ||
    tc.name === "desired_height_larger" ||
    tc.name === "desired_width_zero" ||
    tc.name === "target_inside_label" ||
    tc.name === "target_outside_label"
  ) {
    // Single shared graph
    argG = ownerG;
    const n2 = nodesById.get("2");
    n2.Graph = ownerG;
    ownerG.Nodes.push(n2);
  } else if (tc.name === "different_argument_and_owner_graph") {
    target.isContainer = true;
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);

    const ch = nodesById.get("3");
    ch.Graph = ownerG;
    ch.Label = { Width: 300, Height: 30, Position: 17 };
    ownerG.Nodes.push(ch);
    ownerG.Containers.set(target, [ch]);
  } else if (tc.name === "argument_graph_nodes_ignore_owner_graph_nodes") {
    const extreme = nodesById.get("2");
    extreme.Graph = ownerG;
    ownerG.Nodes.push(extreme);

    const argNode = nodesById.get("3");
    argNode.Graph = argG;
    argG.Nodes.push(argNode);
  } else if (tc.name === "nil_argument_graph_panics_before_mutation") {
    argG = null;
  } else if (tc.name === "nil_owner_graph_panics_after_bounds_before_resize") {
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);
  } else if (tc.name === "empty_argument_graph") {
    // argG.Nodes remains empty []
  } else if (tc.name === "nil_argument_node_panics_before_mutation") {
    argG.Nodes = [null];
  } else if (tc.name === "argument_node_null_top_left_panics_before_mutation") {
    const n2 = nodesById.get("2");
    argG.Nodes = [n2];
  } else if (tc.name === "argument_graph_fixed_origin") {
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);
  } else if (tc.name === "argument_graph_outside_label") {
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    n2.Label = { Width: 80, Height: 30, Position: 1 };
    argG.Nodes.push(n2);
  } else if (tc.name === "owner_boundary_long_label") {
    target.isContainer = true;
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);

    const ch = nodesById.get("3");
    ch.Graph = ownerG;
    ch.Label = { Width: 200, Height: 30, Position: 17 };
    ownerG.Nodes.push(ch);
    ownerG.Containers.set(target, [ch]);
  } else if (tc.name === "owner_interior_long_label_ignored") {
    target.isContainer = true;
    const n2 = nodesById.get("2");
    const n3 = nodesById.get("3");
    const n4 = nodesById.get("4");
    n2.Graph = argG;
    n3.Graph = argG;
    n4.Graph = argG;
    argG.Nodes.push(n2, n3, n4);

    const chInterior = nodesById.get("5");
    chInterior.Graph = ownerG;
    chInterior.Label = { Width: 500, Height: 40, Position: 18 };
    ownerG.Nodes.push(chInterior);
    ownerG.Containers.set(target, [chInterior]);
  } else if (tc.name === "owner_child_null_top_left_with_label_panics") {
    target.isContainer = true;
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);

    const chNullTL = nodesById.get("3");
    chNullTL.Graph = ownerG;
    chNullTL.Label = { Width: 200, Height: 30, Position: 17 };
    ownerG.Containers.set(target, [chNullTL]);
  } else if (tc.name === "nil_owner_child_panics_before_resize") {
    target.isContainer = true;
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);
    ownerG.Containers.set(target, [null]);
  } else if (tc.name === "argument_graph_contains_target") {
    argG = ownerG;
    const n2 = nodesById.get("2");
    n2.Graph = ownerG;
    ownerG.Nodes.push(n2);
  } else if (tc.name === "target_null_top_left_not_in_argument_graph") {
    const n2 = nodesById.get("2");
    n2.Graph = argG;
    argG.Nodes.push(n2);
  }

  return { ownerG, argG, target, nodesById };
}

describe("Slice 23 FitToGraph Oracle Replay", () => {
  for (const [name, tc] of Object.entries(reference.scenarios)) {
    it(`replays ${name}`, () => {
      const { target, argG, nodesById } = setupScenario(tc);

      if (tc.panicked) {
        expect(() => {
          target.FitToGraph(argG, tc.padding);
        }).toThrow();
      } else {
        target.FitToGraph(argG, tc.padding);
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

  describe("Section 43 Semantic Assertions", () => {
    it("ordinary_non_container_succeeds: resizes node without isContainer requirement", () => {
      const tc = reference.scenarios.ordinary_non_container_succeeds;
      expect(tc.panicked).toBe(false);
      expect(tc.afterStates["1"].width).toBe("70");
      expect(tc.afterStates["1"].height).toBe("70");
      expect(tc.afterStates["2"].width).toBe(tc.beforeStates["2"].width);
    });

    it("different_argument_and_owner_graph: bounds from argGraph, labels from ownerGraph", () => {
      const tc = reference.scenarios.different_argument_and_owner_graph;
      expect(tc.panicked).toBe(false);
      // Width reflects child label (300) + padding (20) = 320
      expect(tc.afterStates["1"].width).toBe("320");
      // Height reflects argument node height (50) + padding (20) = 70
      expect(tc.afterStates["1"].height).toBe("70");
    });

    it("argument_graph_nodes_ignore_owner_graph_nodes: owner graph nodes do not affect bounds", () => {
      const tc = reference.scenarios.argument_graph_nodes_ignore_owner_graph_nodes;
      expect(tc.panicked).toBe(false);
      // Width: argNode 100 + 20 = 120 (ignores extreme node 500 at 10000)
      expect(tc.afterStates["1"].width).toBe("120");
      expect(tc.afterStates["1"].height).toBe("100");
    });

    it("empty_argument_graph: produces non-finite (+Inf) target dimensions without throwing", () => {
      const tc = reference.scenarios.empty_argument_graph;
      expect(tc.panicked).toBe(false);
      expect(tc.afterStates["1"].width).toBe("+Inf");
      expect(tc.afterStates["1"].height).toBe("+Inf");
      expect(tc.afterStates["1"].topLeft.x).toBe("10");
      expect(tc.afterStates["1"].topLeft.y).toBe("10");
    });

    it("nil_argument_graph_panics_before_mutation: fails before mutating target", () => {
      const tc = reference.scenarios.nil_argument_graph_panics_before_mutation;
      expect(tc.panicked).toBe(true);
      expect(tc.beforeStates["1"].width).toBe(tc.afterStates["1"].width);
      expect(tc.beforeStates["1"].height).toBe(tc.afterStates["1"].height);
    });

    it("nil_owner_graph_panics_after_bounds_before_resize: fails in expandForLabels before resize", () => {
      const tc = reference.scenarios.nil_owner_graph_panics_after_bounds_before_resize;
      expect(tc.panicked).toBe(true);
      expect(tc.beforeStates["1"].width).toBe(tc.afterStates["1"].width);
      expect(tc.beforeStates["1"].height).toBe(tc.afterStates["1"].height);
    });

    it("argument_graph_fixed_origin: fixed origin affects graph bounding box and target size", () => {
      const tc = reference.scenarios.argument_graph_fixed_origin;
      expect(tc.panicked).toBe(false);
      // TopLeft (50, 50), FixedTopLeft (20, 15) -> fixedOrigin = (30, 35) replaces tl
      expect(tc.afterStates["1"].width).toBe("90");
      expect(tc.afterStates["1"].height).toBe("85");
    });

    it("argument_graph_outside_label: outside label expands argument graph footprint", () => {
      const tc = reference.scenarios.argument_graph_outside_label;
      expect(tc.panicked).toBe(false);
      expect(tc.afterStates["1"].width).toBe("80");
      expect(tc.afterStates["1"].height).toBe("110");
    });

    it("owner_interior_long_label_ignored: interior label does not expand bounds", () => {
      const tc = reference.scenarios.owner_interior_long_label_ignored;
      expect(tc.panicked).toBe(false);
      expect(tc.afterStates["1"].width).toBe("210");
      expect(tc.afterStates["1"].height).toBe("70");
    });

    it("desired_dimensions: larger and zero semantics match Go", () => {
      const tcW = reference.scenarios.desired_width_larger;
      const tcH = reference.scenarios.desired_height_larger;
      const tcZero = reference.scenarios.desired_width_zero;

      expect(tcW.afterStates["1"].width).toBe("500");
      expect(tcW.afterStates["1"].height).toBe("80");

      expect(tcH.afterStates["1"].width).toBe("80");
      expect(tcH.afterStates["1"].height).toBe("500");

      // 0 is non-null, size is clamped by content (80)
      expect(tcZero.afterStates["1"].width).toBe("80");
      expect(tcZero.afterStates["1"].height).toBe("80");
    });

    it("target_inside_label vs target_outside_label: only inside label forces min dimensions", () => {
      const tcIn = reference.scenarios.target_inside_label;
      const tcOut = reference.scenarios.target_outside_label;

      // Inside label enforces minWidth = 200 - 20 + 40 = 220, minHeight = 100 - 20 + 40 = 120
      expect(tcIn.afterStates["1"].width).toBe("220");
      expect(tcIn.afterStates["1"].height).toBe("120");

      // Outside label does not enforce inside min dimensions
      expect(tcOut.afterStates["1"].width).toBe("90");
      expect(tcOut.afterStates["1"].height).toBe("190");
    });

    it("target_null_top_left_not_in_argument_graph: succeeds and leaves target TopLeft null", () => {
      const tc = reference.scenarios.target_null_top_left_not_in_argument_graph;
      expect(tc.panicked).toBe(false);
      expect(tc.afterStates["1"].topLeft).toBeNull();
      expect(tc.afterStates["1"].width).toBe("80");
      expect(tc.afterStates["1"].height).toBe("60");
    });
  });
});
