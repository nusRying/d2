// Slice 50: port of top-level result_validate.go.
// Pinned Go tests: result_test.go (validation-level cases).
import { describe, it, expect } from "bun:test";
import {
  validateLayoutResultTopology,
  validateTopology,
  validateLayoutResultMetadata,
  sameLabelIdentity,
  sameEdgeLabelMetadata,
  sameImmutableLabel,
  sameImmutableEdgeStyle,
  sameOptionalValue,
  isValidResultFontSize,
  sameDirectionMetadata,
  validateCompletedGraph,
  validateResultNode,
  validateResultEdge,
  validateResultCoordinate,
  validateResultDimension,
  isFiniteResultNumber,
  maxResultCoordinate,
} from "../../src/layout/result-validation.js";
import { Clone } from "../../src/graph/clone.js";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Label } from "../../src/graph/label.js";
import { Point } from "../../src/geometry/point.js";
import { Orientation } from "../../src/geometry/orientation.js";
import { LabelPosition } from "../../src/graph/label-position.js";
import { backgroundWorkContext } from "../../src/limits/work-context.js";

const ctx = backgroundWorkContext();

function canceledContext() {
  const err = new Error("context canceled");
  return { err, Err: () => err };
}

class CountContext {
  constructor(cancelAt = 0) {
    this.calls = 0;
    this.cancelAt = cancelAt;
    this.canceled = new Error("context canceled");
  }

  Err() {
    this.calls++;
    return this.cancelAt > 0 && this.calls >= this.cancelAt ? this.canceled : null;
  }
}

function completedGraph() {
  const graph = new Graph();
  const a = new Node(1n, 20, 20);
  const b = new Node(2n, 20, 20);
  const c = new Node(3n, 20, 20);
  a.TopLeft = new Point(0, 0);
  b.TopLeft = new Point(100, 0);
  c.TopLeft = new Point(200, 0);
  for (const node of [a, b, c]) graph.addNewNodeToContainer(null, node);
  const ab = graph.connect(a, b);
  ab.ID = 10n;
  ab.Points = [new Point(20, 10), new Point(100, 10)];
  const bc = graph.connect(b, c);
  bc.ID = 20n;
  bc.Points = [new Point(120, 10), new Point(200, 10)];
  return graph;
}

function messageOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  return null;
}

describe("validateCompletedGraph", () => {
  it("accepts a complete result", () => {
    expect(() => validateCompletedGraph(ctx, completedGraph())).not.toThrow();
  });

  const cases = [
    ["nil graph", () => null, "graph is nil"],
    ["non-finite node position", (g) => { g.Nodes[0].TopLeft.X = NaN; }, "node 1: node x is outside the finite supported range: NaN"],
    ["node coordinate too large", (g) => { g.Nodes[0].TopLeft.Y = -(maxResultCoordinate + 1); }, "node 1: node y is outside the finite supported range: -1.000000001e+09"],
    ["zero node width", (g) => { g.Nodes[0].Width = 0; }, "node 1: node width is outside the supported range: 0"],
    ["zero node height", (g) => { g.Nodes[0].Height = 0; }, "node 1: node height is outside the supported range: 0"],
    ["missing node position", (g) => { g.Nodes[1].TopLeft = null; }, "node 2 has no position"],
    ["large finite bounds are accepted", (g) => { g.Nodes[0].TopLeft.X = 1e9; g.Nodes[0].Width = 1e9; }, null],
    ["negative node label width", (g) => { g.Nodes[0].Label = new Label("x", -1, 0); }, "node 1: node label width is outside the supported range: -1"],
    ["nil node", (g) => { g.Nodes[1] = null; }, "node 1 is nil"],
    ["repeated node", (g) => { g.Nodes[1] = g.Nodes[0]; }, "node 1 is repeated"],
    ["duplicate node ID", (g) => { g.Nodes[1].ID = g.Nodes[0].ID; }, "node ID 1 is duplicated"],
    ["incomplete route", (g) => { g.Edges[0].Points = []; }, "edge 10 has an incomplete route"],
    ["nil route", (g) => { g.Edges[0].Points = null; }, "edge 10 has an incomplete route"],
    ["non-finite route point", (g) => { g.Edges[0].Points[0].Y = Infinity; }, "edge 10 point 0: route y is outside the finite supported range: +Inf"],
    ["nil route point", (g) => { g.Edges[0].Points[1] = null; }, "edge 10 route point 1 is nil"],
    ["invalid label percentage", (g) => { g.Edges[0].LabelPercentage = NaN; }, "edge 10 has invalid label percentage NaN"],
    ["label percentage above one", (g) => { g.Edges[0].LabelPercentage = 1.5; }, "edge 10 has invalid label percentage 1.5"],
    ["edge label dimension", (g) => { g.Edges[0].Label = new Label("l", NaN, 1); }, "edge 10: label width is outside the supported range: NaN"],
    ["source arrowhead label dimension", (g) => { g.Edges[0].SourceArrowheadLabel = new Label("s", 1, -0.5); }, "edge 10: source arrowhead label height is outside the supported range: -0.5"],
    ["foreign source endpoint", (g) => { g.Edges[0].From = null; }, "edge 10 has a source outside the result graph"],
    ["foreign destination endpoint", (g) => { g.Edges[0].To = new Node(2n, 20, 20); }, "edge 10 has a destination outside the result graph"],
    ["nil edge", (g) => { g.Edges[0] = null; }, "edge 0 is nil"],
    ["repeated edge", (g) => { g.Edges[1] = g.Edges[0]; }, "edge 10 is repeated"],
    ["duplicate edge ID", (g) => { g.Edges[1].ID = 10n; }, "edge ID 10 is duplicated"],
  ];
  for (const [name, mutate, want] of cases) {
    it(name, () => {
      let graph = completedGraph();
      if (mutate(graph) === null) graph = null;
      if (want === null) {
        // Go: 1e9 + 1e9 is finite, so the bounds do not overflow.
        expect(() => validateCompletedGraph(ctx, graph)).not.toThrow();
        return;
      }
      expect(messageOf(() => validateCompletedGraph(ctx, graph))).toBe(want);
    });
  }

  it("polls the context once per node, once per edge, and every 256 route points", () => {
    const graph = completedGraph();
    graph.Edges[0].Points = [];
    for (let i = 0; i < 600; i++) graph.Edges[0].Points.push(new Point(i, 0));
    const counter = new CountContext();
    validateCompletedGraph(counter, graph);
    // 3 nodes + 2 edges + edge 10: indices 0,256,512 + edge 20: index 0.
    expect(counter.calls).toBe(3 + 2 + 3 + 1);
  });

  it("returns the context error unchanged", () => {
    const canceled = canceledContext();
    let thrown = null;
    try {
      validateCompletedGraph(canceled, completedGraph());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(canceled.err);
  });
});

describe("validateResult primitives", () => {
  it("coordinate and dimension ranges", () => {
    expect(() => validateResultCoordinate("x", maxResultCoordinate)).not.toThrow();
    expect(() => validateResultCoordinate("x", -maxResultCoordinate)).not.toThrow();
    expect(messageOf(() => validateResultCoordinate("x", -Infinity))).toBe("x is outside the finite supported range: -Inf");
    expect(() => validateResultDimension("w", 0, true)).not.toThrow();
    expect(messageOf(() => validateResultDimension("w", 0, false))).toBe("w is outside the supported range: 0");
    expect(messageOf(() => validateResultDimension("w", maxResultCoordinate + 1, true))).toBe("w is outside the supported range: 1.000000001e+09");
    expect(isFiniteResultNumber(1)).toBe(true);
    expect(isFiniteResultNumber(NaN)).toBe(false);
    expect(isFiniteResultNumber(-Infinity)).toBe(false);
    expect(maxResultCoordinate).toBe(1_000_000_000);
  });

  it("validateResultNode / validateResultEdge nil", () => {
    expect(messageOf(() => validateResultNode(null))).toBe("node is nil");
    expect(messageOf(() => validateResultEdge(ctx, null))).toBe("edge is nil");
  });

  it("optional and label comparisons", () => {
    expect(sameOptionalValue(null, undefined)).toBe(true);
    expect(sameOptionalValue(null, 1)).toBe(false);
    expect(sameOptionalValue(1, 1)).toBe(true);
    expect(sameOptionalValue(new Point(1, 2), new Point(1, 2))).toBe(true);
    expect(sameOptionalValue(new Point(1, 2), new Point(1, 3))).toBe(false);
    expect(sameOptionalValue(new Point(NaN, 2), new Point(NaN, 2))).toBe(false);
    expect(sameOptionalValue({ Value: "a" }, { Value: "a" })).toBe(true);
    expect(sameOptionalValue({ Value: "a" }, { Value: "b" })).toBe(false);

    expect(sameLabelIdentity(null, null)).toBe(true);
    expect(sameLabelIdentity(new Label("a"), null)).toBe(false);
    expect(sameLabelIdentity(new Label("a", 1, 1), new Label("a", 2, 2))).toBe(true);
    expect(sameEdgeLabelMetadata(new Label("a", 1, 1), new Label("a", 1, 2))).toBe(false);
    const p = new Label("a", 1, 1);
    p.Position = LabelPosition.InsideTopLeft;
    expect(sameImmutableLabel(p, new Label("a", 1, 1))).toBe(false);
    const q = new Label("a", 1, 1);
    q.Position = LabelPosition.InsideTopLeft;
    expect(sameImmutableLabel(p, q)).toBe(true);
  });

  it("edge style comparison treats a null style as the zero style and checks every field", () => {
    expect(sameImmutableEdgeStyle(null, {})).toBe(true);
    expect(sameImmutableEdgeStyle(null, { Stroke: null })).toBe(true);
    for (const field of ["Opacity", "Stroke", "Fill", "FillPattern", "StrokeWidth", "StrokeDash", "BorderRadius",
      "Shadow", "ThreeDee", "Multiple", "Font", "FontSize", "FontColor", "Animated", "Bold", "Italic", "Underline",
      "Filled", "DoubleBorder", "TextTransform"]) {
      expect(sameImmutableEdgeStyle({ [field]: { Value: "0" } }, { [field]: { Value: "0" } })).toBe(true);
      expect(sameImmutableEdgeStyle({ [field]: { Value: "0" } }, { [field]: { Value: "corrupt" } })).toBe(false);
      expect(sameImmutableEdgeStyle({ [field]: { Value: "0" } }, null)).toBe(false);
    }
  });

  it("font size domain is d2fonts.FontSizes", () => {
    expect(isValidResultFontSize(null, null)).toBe(true);
    expect(isValidResultFontSize(16, null)).toBe(false);
    expect(isValidResultFontSize(17, 17)).toBe(true);
    for (const size of [13, 14, 16, 20, 24, 28, 32]) expect(isValidResultFontSize(16, size)).toBe(true);
    expect(isValidResultFontSize(16, 17)).toBe(false);
  });

  it("direction metadata canonicalizes root and node ID keys", () => {
    const expected = completedGraph();
    const actual = completedGraph();
    expected.Directions.set(null, Orientation.Right);
    expected.Directions.set(expected.Nodes[0], Orientation.Bottom);
    actual.Directions.set(actual.Nodes[0], Orientation.Bottom);
    actual.Directions.set(null, Orientation.Right);
    expect(sameDirectionMetadata(ctx, expected, actual)).toBe(true);
    actual.Directions.set(null, Orientation.Left);
    expect(sameDirectionMetadata(ctx, expected, actual)).toBe(false);
    actual.Directions.set(null, Orientation.Right);
    actual.Directions.set(actual.Nodes[1], Orientation.Right);
    expect(sameDirectionMetadata(ctx, expected, actual)).toBe(false);

    const duplicate = completedGraph();
    duplicate.Directions.set(duplicate.Nodes[0], Orientation.Right);
    duplicate.Directions.set(new Node(1n, 1, 1), Orientation.Right);
    expect(messageOf(() => sameDirectionMetadata(ctx, expected, duplicate))).toBe("graph direction metadata repeats a canonical key");
  });
});

describe("validateTopology / validateLayoutResultTopology", () => {
  it("accepts an unchanged clone", () => {
    const input = completedGraph();
    const sequenceEdges = validateLayoutResultTopology(ctx, input, Clone(ctx, input));
    expect(sequenceEdges.size).toBe(0);
  });

  const cases = [
    ["nil graph", (_, a) => null, "cannot compare nil graph topology"],
    ["node count", (_, a) => { a.Nodes.pop(); }, "node count changed from 3 to 2"],
    ["unexpected node", (_, a) => { a.Nodes[2].ID = 9n; }, "result contains unexpected node ID 9"],
    ["changed endpoints", (_, a) => { a.Edges[0].From = a.Edges[0].To; }, "edge 10 endpoints changed from 1->2 to 2->2"],
    ["unexpected edge", (_, a) => { a.connect(a.Nodes[0], a.Nodes[2]).ID = 30n; }, "result contains unexpected edge ID 30"],
    ["duplicate result edge ID", (_, a) => { a.connect(a.Nodes[1], a.Nodes[2]).ID = 20n; }, "result contains duplicate edge ID 20"],
    ["missing edge", (_, a) => { a.disconnect(a.Edges[1]); }, "result is missing edge ID 20"],
    ["nil result endpoint", (_, a) => { a.Edges[1].To = null; }, "result contains an edge with a nil endpoint"],
    ["duplicate input node", (e) => { e.Nodes[1].ID = 1n; }, "input contains duplicate node ID 1"],
    ["duplicate input edge", (e) => { e.Edges[1].ID = 10n; }, "input contains duplicate edge ID 10"],
    ["nil input endpoint", (e) => { e.Edges[1].From = null; }, "input contains an edge with a nil endpoint"],
  ];
  for (const [name, mutate, want] of cases) {
    it(name, () => {
      const expected = completedGraph();
      let actual = Clone(ctx, expected);
      if (mutate(expected, actual) === null) actual = null;
      expect(messageOf(() => validateTopology(ctx, expected, actual, null))).toBe(want);
    });
  }

  it("allows only consumed sequence-defining edges (Go TestValidateLayoutResultTopologyAllowsOnlyConsumedSequenceEdges)", () => {
    const input = new Graph();
    const a = new Node(1n, 20, 10);
    const b = new Node(2n, 20, 10);
    const c = new Node(3n, 20, 10);
    [a, b, c].forEach((node, index) => {
      node.TopLeft = new Point(index * 40, 0);
      input.addNewNodeToContainer(null, node);
    });
    a.setShape("Step");
    b.setShape("Step");
    const sequenceEdge = input.connect(a, b);
    sequenceEdge.ID = 10n;
    const ordinaryEdge = input.connect(b, c);
    ordinaryEdge.ID = 20n;

    const completed = Clone(ctx, input);
    const findEdge = (graph, id) => graph.Edges.find((edge) => edge.ID === id);
    completed.disconnect(findEdge(completed, 10n));

    const sequenceEdges = validateLayoutResultTopology(ctx, input, completed);
    expect([...sequenceEdges]).toEqual([10n]);
    expect(() => validateLayoutResultMetadata(ctx, input, completed, sequenceEdges)).not.toThrow();
    expect(messageOf(() => validateTopology(ctx, input, completed, null))).toBe("result is missing edge ID 10");

    const ordinary = Clone(ctx, completed);
    ordinary.disconnect(findEdge(ordinary, 20n));
    expect(messageOf(() => validateLayoutResultTopology(ctx, input, ordinary))).toBe("result is missing edge ID 20");

    const extra = Clone(ctx, completed);
    extra.connect(extra.Nodes[0], extra.Nodes[2]).ID = 30n;
    expect(messageOf(() => validateLayoutResultTopology(ctx, input, extra))).toBe("result contains unexpected edge ID 30");

    const duplicate = Clone(ctx, completed);
    duplicate.connect(duplicate.Nodes[1], duplicate.Nodes[2]).ID = 20n;
    expect(messageOf(() => validateLayoutResultTopology(ctx, input, duplicate))).toBe("result contains duplicate edge ID 20");
  });

  it("polls the context once per record and returns its error unchanged", () => {
    const expected = completedGraph();
    const actual = Clone(ctx, expected);
    const counter = new CountContext();
    validateTopology(counter, expected, actual, null);
    expect(counter.calls).toBe(3 + 3 + 2 + 2 + 2);
    for (let cancelAt = 1; cancelAt <= counter.calls; cancelAt++) {
      const canceled = new CountContext(cancelAt);
      let thrown = null;
      try {
        validateTopology(canceled, expected, actual, null);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBe(canceled.canceled);
    }
  });
});

describe("validateLayoutResultMetadata", () => {
  function metadataInput() {
    const input = completedGraph();
    input.IsRootHierarchy = true;
    input.Directions.set(null, Orientation.Right);
    for (const node of input.Nodes) {
      node.setShape("Table");
      node.setNumColumns(2);
      node.Label = new Label("node", 30, 12);
      node.Label.Position = LabelPosition.InsideTopLeft;
      node.Icon = { Position: LabelPosition.OutsideTopLeft };
      node.FontSize = 16;
    }
    const first = input.Nodes[0];
    first.FixedTopLeft = new Point(40, -20);
    first.DesiredWidth = 140;
    first.DesiredHeight = 90;
    first.ForceHierarchy = true;
    const edge = input.Edges[0];
    edge.Label = new Label("edge", 28, 10);
    edge.SourceArrowhead = "diamond";
    edge.SourceArrowheadLabel = new Label("source", 20, 10);
    edge.TargetArrowheadLabel = new Label("target", 20, 10);
    edge.MinWidth = 64;
    edge.MinHeight = 32;
    edge.FromTableColumnIndex = 0;
    edge.ToTableColumnIndex = 1;
    edge.Style = {};
    for (const field of ["Opacity", "Stroke", "Fill", "FillPattern", "StrokeWidth", "StrokeDash", "BorderRadius",
      "Shadow", "ThreeDee", "Multiple", "Font", "FontSize", "FontColor", "Animated", "Bold", "Italic", "Underline",
      "Filled", "DoubleBorder", "TextTransform"]) {
      edge.Style[field] = { Value: "0" };
    }
    return input;
  }

  it("accepts an unchanged result", () => {
    const input = metadataInput();
    expect(() => validateLayoutResultMetadata(ctx, input, Clone(ctx, input), null)).not.toThrow();
  });

  const cases = [
    ["root hierarchy", (g) => { g.IsRootHierarchy = false; }, "root hierarchy metadata changed"],
    ["graph direction", (g) => { g.Directions.set(null, Orientation.Left); }, "graph direction metadata changed"],
    ["node shape", (g) => { g.Nodes[0].setShape("Circle"); }, 'node 1 shape changed from "Table" to "Circle"'],
    ["node container", (g) => { g.Nodes[0].Container = g.Nodes[1]; }, "node 1 container ownership changed"],
    ["node table columns", (g) => { g.Nodes[0].setNumColumns(3); }, "node 1 table column count changed from 2 to 3"],
    ["node 3D outline", (g) => { g.Nodes[0].Is3D = true; }, "node 1 3D outline metadata changed"],
    ["node multiple outline", (g) => { g.Nodes[0].IsMultiple = true; }, "node 1 multiple outline metadata changed"],
    ["node visibility", (g) => { g.Nodes[0].IsInvisible = true; }, "node 1 visibility metadata changed"],
    ["node fixed position", (g) => { g.Nodes[0].FixedTopLeft.X++; }, "node 1 fixed position metadata changed"],
    ["node desired width", (g) => { g.Nodes[0].DesiredWidth++; }, "node 1 desired-size metadata changed"],
    ["node desired height", (g) => { g.Nodes[0].DesiredHeight = null; }, "node 1 desired-size metadata changed"],
    ["node forced hierarchy", (g) => { g.Nodes[0].ForceHierarchy = false; }, "node 1 forced-hierarchy metadata changed"],
    ["node label text", (g) => { g.Nodes[0].Label.Text = "replacement"; }, "node 1 label identity changed"],
    ["node label presence", (g) => { g.Nodes[0].Label = null; }, "node 1 label identity changed"],
    ["node fixed label position", (g) => { g.Nodes[0].Label.Position = LabelPosition.InsideBottomRight; }, "node 1 fixed label position changed"],
    ["node icon presence", (g) => { g.Nodes[0].Icon = null; }, "node 1 icon presence changed"],
    ["node fixed icon position", (g) => { g.Nodes[0].Icon.Position = LabelPosition.OutsideBottomRight; }, "node 1 fixed icon position changed"],
    ["node font size presence", (g) => { g.Nodes[0].FontSize = null; }, "node 1 font size is outside the layout output domain"],
    ["node font size domain", (g) => { g.Nodes[0].FontSize = 17; }, "node 1 font size is outside the layout output domain"],
    ["edge arrowhead", (g) => { g.Edges[0].SourceArrowhead = "triangle"; }, "edge 10 arrowhead metadata changed"],
    ["source arrowhead label", (g) => { g.Edges[0].SourceArrowheadLabel.Width++; }, "edge 10 source arrowhead label metadata changed"],
    ["target arrowhead label", (g) => { g.Edges[0].TargetArrowheadLabel.Text = "replacement"; }, "edge 10 target arrowhead label metadata changed"],
    ["edge minimum geometry", (g) => { g.Edges[0].MinWidth++; }, "edge 10 minimum geometry changed"],
    ["edge source table column", (g) => { g.Edges[0].FromTableColumnIndex = 1; }, "edge 10 table column attachment metadata changed"],
    ["edge target table column", (g) => { g.Edges[0].ToTableColumnIndex = null; }, "edge 10 table column attachment metadata changed"],
    ["edge visibility", (g) => { g.Edges[0].IsInvisible = true; }, "edge 10 visibility metadata changed"],
    ["edge style", (g) => { g.Edges[0].Style.Stroke = { Value: "red" }; }, "edge 10 style metadata changed"],
    ["edge label text", (g) => { g.Edges[0].Label.Text = "replacement"; }, "edge 10 label identity or dimensions changed"],
    ["edge label width", (g) => { g.Edges[0].Label.Width++; }, "edge 10 label identity or dimensions changed"],
    ["edge label presence", (g) => { g.Edges[0].Label = null; }, "edge 10 label identity or dimensions changed"],
    ["unexpected edge", (g) => { g.Edges[1].ID = 99n; }, "result contains unexpected edge ID 99"],
    ["missing edge", (g) => { g.disconnect(g.Edges[1]); }, "result is missing edge ID 20"],
    ["unexpected node", (g) => { g.Nodes[2].ID = 99n; }, "result contains unexpected node ID 99"],
    ["nil result node", (g) => { g.Nodes[2] = null; }, "result contains a nil node"],
    ["nil result edge", (g) => { g.Edges[1] = null; }, "result contains a nil edge"],
  ];
  for (const [name, mutate, want] of cases) {
    it(name, () => {
      const input = metadataInput();
      const actual = Clone(ctx, input);
      mutate(actual);
      expect(messageOf(() => validateLayoutResultMetadata(ctx, input, actual, null))).toBe(want);
    });
  }

  it("allows a layout font size and layout-owned label/icon positions when unset in input", () => {
    const input = metadataInput();
    const actual = Clone(ctx, input);
    actual.Nodes[0].FontSize = 20;
    expect(() => validateLayoutResultMetadata(ctx, input, actual, null)).not.toThrow();

    const unset = completedGraph();
    unset.Nodes[0].Label = new Label("node", 30, 12);
    unset.Nodes[0].Icon = { Position: null };
    const placed = Clone(ctx, unset);
    placed.Nodes[0].Label.Position = LabelPosition.InsideMiddleLeft;
    placed.Nodes[0].Icon.Position = LabelPosition.OutsideTopLeft;
    expect(() => validateLayoutResultMetadata(ctx, unset, placed, null)).not.toThrow();
  });

  it("does not validate output constraints (Go TestValidateLayoutResultMetadataDoesNotValidateOutputConstraints)", () => {
    const input = new Graph();
    const node = new Node(1n, 140, 90);
    node.TopLeft = new Point(40, -20);
    node.FixedTopLeft = new Point(40, -20);
    node.DesiredWidth = 140;
    node.DesiredHeight = 90;
    input.addNewNodeToContainer(null, node);
    const completed = Clone(ctx, input);
    completed.Nodes[0].TopLeft = new Point(0, 0);
    completed.Nodes[0].Width = 100;
    completed.Nodes[0].Height = 80;
    expect(() => validateLayoutResultMetadata(ctx, input, completed, null)).not.toThrow();
  });

  it("rejects a canceled context with the context's own error (Go TestSeedMetadataValidationRejectsCanceledContext)", () => {
    const input = metadataInput();
    const canceled = canceledContext();
    let thrown = null;
    try {
      validateLayoutResultMetadata(canceled, input, Clone(ctx, input), null);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(canceled.err);
  });

  it("rejects nil graphs", () => {
    expect(messageOf(() => validateLayoutResultMetadata(ctx, null, completedGraph(), null))).toBe("cannot compare nil graph metadata");
  });
});
