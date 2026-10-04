// Slice 50: port of top-level result.go (evaluateSeedResult, layoutScore).
// Pinned Go tests: result_test.go.
import { describe, it, expect } from "bun:test";
import { evaluateSeedResult, SeedResult } from "../../src/layout/result.js";
import { Score } from "../../src/quality/score.js";
import { EvaluateWithArea } from "../../src/quality/scoring.js";
import { Clone } from "../../src/graph/clone.js";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";
import { backgroundWorkContext } from "../../src/limits/work-context.js";

const ctx = backgroundWorkContext();

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
  bc.Points = [new Point(120, 10), new Point(160, 10), new Point(160, 30), new Point(200, 30)];
  return graph;
}

function thrownBy(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

describe("Score.Compare equals Go layoutScore.compare (TestScoreCompare)", () => {
  const cases = [
    ["lower penalty", [1, 100], [2, 1], -1],
    ["higher penalty", [2, 1], [1, 100], 1],
    ["smaller area", [1, 10], [1, 20], -1],
    ["larger area", [1, 20], [1, 10], 1],
    ["fractional area", [1, 10.25], [1, 10.5], -1],
    ["large area", [1, 1e18], [1, 1e18 + 256], -1],
    ["equivalent", [1, 10], [1, 10], 0],
    ["finite before NaN", [1, 0], [NaN, 0], -1],
    ["NaN after finite", [NaN, 0], [1, 0], 1],
    ["invalid penalties equivalent", [Infinity, 0], [NaN, 0], 0],
    ["valid area before NaN", [1, 10], [1, NaN], -1],
    ["NaN area after valid", [1, NaN], [1, 10], 1],
    ["valid area before infinity", [1, 10], [1, Infinity], -1],
    ["valid area before negative", [1, 10], [1, -1], -1],
    ["invalid areas equivalent", [1, -Infinity], [1, NaN], 0],
    // Additional Go cmp.Compare edges: negative penalties are valid; -0 == 0.
    ["negative penalty is valid", [-1, 0], [0, 0], -1],
    ["signed zero penalties equivalent", [-0, 0], [0, 0], 0],
    ["signed zero areas equivalent", [1, -0], [1, 0], 0],
  ];
  for (const [name, left, right, want] of cases) {
    it(name, () => {
      expect(new Score(...left).Compare(new Score(...right))).toBe(want);
    });
  }
});

describe("evaluateSeedResult", () => {
  it("validates and scores an unmodified result with the shared quality Score", () => {
    const input = { graph: completedGraph() };
    const attempt = Clone(ctx, input.graph);
    const result = evaluateSeedResult(ctx, input, attempt);
    expect(result).toBeInstanceOf(SeedResult);
    expect(result.graph).toBe(attempt);
    expect(result.score).toBeInstanceOf(Score);
    const reference = EvaluateWithArea(ctx, Clone(ctx, input.graph));
    expect(result.score.Penalty).toBe(reference.penalty);
    expect(result.score.Area).toBe(reference.area);
    expect(result.sequenceEdges).toBeInstanceOf(Set);
    expect(result.sequenceEdges.size).toBe(0);
  });

  it("checks the context, input, and result in Go order", () => {
    const canceled = new Error("context canceled");
    const canceledCtx = { Err: () => canceled };
    expect(thrownBy(() => evaluateSeedResult(canceledCtx, null, null))).toBe(canceled);
    expect(thrownBy(() => evaluateSeedResult(ctx, { graph: null }, null)).message).toBe("TALA seed input is empty");
    expect(thrownBy(() => evaluateSeedResult(ctx, null, null)).message).toBe("TALA seed input is empty");
    expect(thrownBy(() => evaluateSeedResult(ctx, { graph: completedGraph() }, null)).message).toBe("TALA seed result is empty");
  });

  const invalid = [
    ["non-finite node position", (g) => { g.Nodes[0].TopLeft.X = NaN; }, "validate TALA seed result: node 1: node x is outside the finite supported range: NaN"],
    ["zero node width", (g) => { g.Nodes[0].Width = 0; }, "validate TALA seed result: node 1: node width is outside the supported range: 0"],
    ["zero node height", (g) => { g.Nodes[0].Height = 0; }, "validate TALA seed result: node 1: node height is outside the supported range: 0"],
    ["incomplete route", (g) => { g.Edges[0].Points = []; }, "validate TALA seed result: edge 10 has an incomplete route"],
    ["non-finite route point", (g) => { g.Edges[0].Points[0].Y = Infinity; }, "validate TALA seed result: edge 10 point 0: route y is outside the finite supported range: +Inf"],
    ["invalid label percentage", (g) => { g.Edges[0].LabelPercentage = NaN; }, "validate TALA seed result: edge 10 has invalid label percentage NaN"],
    ["foreign endpoint", (g) => { g.Edges[0].From = null; }, "validate TALA seed result: edge 10 has a source outside the result graph"],
    ["duplicate node ID", (g) => { g.Nodes[1].ID = g.Nodes[0].ID; }, "validate TALA seed result: node ID 1 is duplicated"],
    ["duplicate edge ID", (g) => { g.Edges[1].ID = 10n; }, "validate TALA seed result: edge ID 10 is duplicated"],
    ["changed topology", (g) => { g.Edges[0].From = g.Edges[0].To; }, "validate TALA seed result topology: edge 10 endpoints changed from 1->2 to 2->2"],
    ["unexpected edge", (g) => {
      const e = g.connect(g.Nodes[0], g.Nodes[2]);
      e.ID = 30n;
      e.Points = [new Point(0, 0), new Point(200, 0)];
    }, "validate TALA seed result topology: result contains unexpected edge ID 30"],
    ["changed immutable node metadata", (g) => { g.Nodes[0].Is3D = true; }, "validate TALA seed result metadata: node 1 3D outline metadata changed"],
    ["changed immutable edge metadata", (g) => { g.Edges[0].MinWidth = 5; }, "validate TALA seed result metadata: edge 10 minimum geometry changed"],
    ["changed graph metadata", (g) => { g.IsRootHierarchy = true; }, "validate TALA seed result metadata: root hierarchy metadata changed"],
  ];
  for (const [name, mutate, want] of invalid) {
    it(`rejects ${name} with a wrapped cause`, () => {
      const input = { graph: completedGraph() };
      const attempt = Clone(ctx, input.graph);
      mutate(attempt);
      const err = thrownBy(() => evaluateSeedResult(ctx, input, attempt));
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe(want);
      expect(err.cause).toBeInstanceOf(Error);
      expect(want.endsWith(err.cause.message)).toBe(true);
    });
  }

  it("allows sequence-defining edge omission", () => {
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
    sequenceEdge.Points = [new Point(20, 5), new Point(40, 5)];
    const ordinaryEdge = input.connect(b, c);
    ordinaryEdge.ID = 20n;
    ordinaryEdge.Points = [new Point(60, 5), new Point(80, 5)];

    const attempt = Clone(ctx, input);
    attempt.disconnect(attempt.Edges.find((edge) => edge.ID === 10n));
    const result = evaluateSeedResult(ctx, { graph: input }, attempt);
    expect([...result.sequenceEdges]).toEqual([10n]);

    const missingOrdinary = Clone(ctx, input);
    missingOrdinary.disconnect(missingOrdinary.Edges.find((edge) => edge.ID === 20n));
    expect(thrownBy(() => evaluateSeedResult(ctx, { graph: input }, missingOrdinary)).message)
      .toBe("validate TALA seed result topology: result is missing edge ID 20");
  });

  it("cancellation precedes validation (Go TestEvaluateSeedCancellationPrecedesValidation)", () => {
    const input = { graph: completedGraph() };
    const attempt = Clone(ctx, input.graph);
    attempt.Edges[0].Points = [];
    const canceled = new Error("context canceled");
    expect(thrownBy(() => evaluateSeedResult({ Err: () => canceled }, input, attempt))).toBe(canceled);
  });

  it("wraps cancellation observed during validation with the stage prefix", () => {
    const input = { graph: completedGraph() };
    const attempt = Clone(ctx, input.graph);
    let calls = 0;
    const canceled = new Error("context canceled");
    const late = { Err: () => (++calls >= 2 ? canceled : null) };
    const err = thrownBy(() => evaluateSeedResult(late, input, attempt));
    expect(err.message).toBe("validate TALA seed result: context canceled");
    expect(err.cause).toBe(canceled);
  });

  it("rejects derived evaluation work beyond the engine budget (Go TestEvaluateSeedRejectsDerivedEvaluationWork)", () => {
    const graph = new Graph();
    const a = new Node(1n, 20, 20);
    const b = new Node(2n, 20, 20);
    a.TopLeft = new Point(0, 0);
    b.TopLeft = new Point(100, 100);
    graph.addNewNodeToContainer(null, a);
    graph.addNewNodeToContainer(null, b);
    for (let i = 0; i < 7_100; i++) {
      const edge = graph.connect(a, b);
      edge.ID = BigInt(i + 1);
      edge.Points = [new Point(0, i), new Point(100, i + 1)];
    }
    const err = thrownBy(() => evaluateSeedResult(ctx, { graph }, graph));
    expect(err).not.toBeNull();
    expect(err.message).toContain("TALA Evaluate work exceeds limit 50000000");
  });
});
