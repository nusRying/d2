import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Point } from "../../src/geometry/point.js";
import { OptimizationWorkGuard } from "../../src/limits/optimization.js";
import { LayoutAxis } from "../../src/placement/axis.js";
import {
  visibilityEdges,
  candidateMoves,
  compaction,
} from "../../src/placement/compaction.js";
import { moveNodeToBest } from "../../src/placement/moves.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "go-compaction-reference.json"), "utf8")
);
const ctx = { Err: () => null };

function add(g, id, x, y, w = 10, h = 10) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  g.AddNode(n);
  return n;
}

function compactionGraph() {
  const g = new Graph();
  g.CellSize = 10;
  const a = add(g, 1, 0, 0);
  const b = add(g, 2, 100, 0);
  const c = add(g, 3, 200, 0);
  g.Connect(a, b);
  g.Connect(b, c);
  return g;
}

function positions(g) {
  return g.Nodes.map((n) => ({ id: Number(n.ID), x: n.TopLeft.X, y: n.TopLeft.Y }));
}

describe("Slice 43 — Real-Go compaction oracle replay", () => {
  it("replays DeltaTo gap policy exactly", () => {
    const g = new Graph();
    g.CellSize = 10;
    const a = add(g, 1, 0, 0);
    const b = add(g, 2, 100, 0);

    assert.equal(a.DeltaTo(b, a.TopLeft), reference.deltaTo.disconnected);
    const edge = g.Connect(a, b);
    assert.equal(a.DeltaTo(b, a.TopLeft), reference.deltaTo.connected);
    edge.MinWidth = 90;
    assert.equal(a.DeltaTo(b, a.TopLeft), reference.deltaTo.min_width_90);
  });

  it("replays visibility edge order exactly", () => {
    const g = new Graph();
    add(g, 1, 0, 4, 4, 6);
    add(g, 2, 12, 8, 6, 4);
    add(g, 3, 25, 5, 9, 5);
    add(g, 4, 38, 1, 9, 6);

    const edges = visibilityEdges(ctx, g, true, true);
    assert.deepEqual(
      edges.map((e) => ({ from: Number(e.From.ID), to: Number(e.To.ID) })),
      reference.visibility
    );
  });

  it("replays candidate generation exactly", () => {
    const g = new Graph();
    g.CellSize = 10;
    const a = add(g, 1, 0, 0);
    const b = add(g, 2, 100, 0);
    g.Connect(a, b);
    const v = [new Edge(a, b)];

    assert.deepEqual(
      candidateMoves(ctx, g, b, 1, true, true, 0, v).map((p) => ({ x: p.X, y: p.Y })),
      reference.candidates
    );
  });

  it("replays generic moveNodeToBest score/work result exactly", () => {
    const g = new Graph();
    g.CellSize = 10;
    const a = add(g, 1, 0, 0);
    const b = add(g, 2, 100, 0);
    g.Connect(a, b);

    const guard = new OptimizationWorkGuard(ctx, "oracleMove", 250000000n);
    const changed = moveNodeToBest(
      ctx,
      g,
      b,
      [new Point(20, 0), new Point(40, 0), new Point(100, 0)],
      null,
      true,
      guard
    );

    assert.equal(changed, reference.moveNodeBest.changed);
    assert.equal(b.TopLeft.X, reference.moveNodeBest.x);
    assert.equal(b.TopLeft.Y, reference.moveNodeBest.y);
    assert.equal(guard.Used(), BigInt(reference.moveNodeBest.used));
  });

  it("replays end-to-end sized compaction exactly", () => {
    const g = compactionGraph();
    compaction(ctx, g, {
      axis: LayoutAxis.Horizontal,
      includeSizes: true,
      factor: 1,
    });
    assert.deepEqual(positions(g), reference.compaction);
  });

  it("replays transition-only compaction exactly", () => {
    const g = compactionGraph();
    compaction(ctx, g, {
      axis: LayoutAxis.Horizontal,
      includeSizes: true,
      factor: 1,
      transition: true,
    });
    assert.deepEqual(positions(g), reference.transition);
  });
});
