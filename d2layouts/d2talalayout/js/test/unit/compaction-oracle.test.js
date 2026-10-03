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
  orderedAlongAxis,
  nearestFrom,
  compactionFloor,
  inflateAlongAxis,
  shiftSubgraphs,
  compactAlongAxis,
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

  it("replays orderedAlongAxis exactly", () => {
    const g = new Graph();
    add(g, 1, 20, 50);
    add(g, 2, 10, 80);
    add(g, 3, 10, 20);
    add(g, 4, 40, 20);

    const h = orderedAlongAxis(g, true).map((n) => Number(n.ID));
    const v = orderedAlongAxis(g, false).map((n) => Number(n.ID));
    assert.deepEqual(h, reference.orderedAlongAxis.horizontal);
    assert.deepEqual(v, reference.orderedAlongAxis.vertical);
  });

  it("replays nearestFrom exactly", () => {
    const g = new Graph();
    const target = add(g, 99, 100, 100);
    const other = add(g, 98, 100, 100);
    const n1 = add(g, 1, 10, 0);
    const n2 = add(g, 2, 10, 0);
    const n3 = add(g, 3, 5, 0);
    const n4 = add(g, 4, 50, 0);

    const edges = [
      new Edge(n1, target),
      new Edge(n2, target),
      new Edge(n3, target),
      new Edge(n4, other),
    ];
    const nearH = nearestFrom(edges, target, true, true);
    assert.equal(Number(nearH.ID), reference.nearestFrom.horizontalSized);
    assert.equal(Number(nearH.ID), reference.nearestFrom.firstOccurrence);

    n1.TopLeft.Y = 10;
    n3.TopLeft.Y = 30;
    const nearV = nearestFrom(edges, target, false, false);
    assert.equal(Number(nearV.ID), reference.nearestFrom.verticalSizeless);
  });

  it("replays compactionFloor exactly", () => {
    const g = new Graph();
    g.CellSize = 10;
    const anchor = add(g, 1, 15, 25, 20, 30);

    assert.equal(compactionFloor(g, anchor, 1.5, true, true, 5), reference.compactionFloor.horizontalSized);
    assert.equal(compactionFloor(g, anchor, 1.5, true, false, 5), reference.compactionFloor.horizontalSizeless);
    assert.equal(compactionFloor(g, anchor, 1.5, true, true, 20), reference.compactionFloor.paddingBoundary);
    assert.equal(compactionFloor(g, anchor, 2.0, false, true, 10), reference.compactionFloor.verticalSized);
  });

  it("replays inflateAlongAxis exactly", () => {
    const create = () => {
      const g = new Graph();
      g.CellSize = 10;
      const a = add(g, 1, 0, 0);
      const b = add(g, 2, 5, 0);
      g.Connect(a, b);
      return { g, a, b };
    };

    const c1 = create();
    inflateAlongAxis(c1.g, true, true, 1.0, [new Edge(c1.a, c1.b)], false);
    assert.deepEqual(positions(c1.g), reference.inflateAlongAxis.normal);

    const c2 = create();
    inflateAlongAxis(c2.g, true, true, 1.0, [new Edge(c2.a, c2.b)], true);
    assert.deepEqual(positions(c2.g), reference.inflateAlongAxis.transition);
  });

  it("replays optimizerDoesOverlap exactly", async () => {
    const { optimizerDoesOverlap } = await import("../../src/placement/optimizer-support.js");
    const g = new Graph();
    const guard = new OptimizationWorkGuard(ctx, "testOverlap", 250000000n);
    const a = add(g, 1, 0, 0, 20, 20);
    const b = add(g, 2, 100, 0, 20, 20);

    const ov1 = optimizerDoesOverlap(a, new Point(90, 0), null, guard);
    assert.equal(ov1, reference.optimizerDoesOverlap.overlaps);

    const ov2 = optimizerDoesOverlap(a, new Point(300, 0), null, guard);
    assert.equal(ov2, reference.optimizerDoesOverlap.farAway);

    const ov3 = optimizerDoesOverlap(a, new Point(90, 0), [b], guard);
    assert.equal(ov3, reference.optimizerDoesOverlap.excluded);
  });

  it("replays optimizerIsOccupied exactly", async () => {
    const { optimizerIsOccupied } = await import("../../src/placement/optimizer-support.js");
    const g = new Graph();
    const guard = new OptimizationWorkGuard(ctx, "testOccupied", 250000000n);
    add(g, 1, 10, 20, 20, 20);
    add(g, 2, 50, 60, 20, 20);

    const [occNode, occ] = optimizerIsOccupied(g, new Point(10, 20), guard);
    assert.equal(Number(occNode.ID), reference.optimizerIsOccupied.occupiedId);
    assert.equal(occ, reference.optimizerIsOccupied.occupied);

    const [, unocc] = optimizerIsOccupied(g, new Point(15, 20), guard);
    assert.equal(!unocc, reference.optimizerIsOccupied.unoccupied);
  });

  it("replays optimizerCanMove exactly", async () => {
    const { optimizerCanMove } = await import("../../src/placement/optimizer-support.js");
    const g = new Graph();
    const guard = new OptimizationWorkGuard(ctx, "testCanMove", 250000000n);
    const a = add(g, 1, 10, 20, 20, 20);
    add(g, 2, 50, 60, 20, 20);

    assert.equal(optimizerCanMove(a, new Point(10, 20), true, guard), reference.optimizerCanMove.samePoint);
    assert.equal(optimizerCanMove(a, new Point(50, 60), true, guard), reference.optimizerCanMove.occupied);
    assert.equal(optimizerCanMove(a, new Point(45, 55), true, guard), reference.optimizerCanMove.overlaps);
    assert.equal(optimizerCanMove(a, new Point(200, 200), true, guard), reference.optimizerCanMove.clear);
  });

  it("replays shiftSubgraphs exactly", () => {
    const g1 = new Graph();
    g1.CellSize = 10;
    const a1 = add(g1, 1, 0, 0);
    const b1 = add(g1, 2, 100, 100);
    g1.Connect(a1, b1);
    const v1 = visibilityEdges(ctx, g1, true, true);
    const ch1 = shiftSubgraphs(ctx, g1, true, true, 1.0, null, v1);
    assert.equal(ch1, reference.shiftSubgraphs.movesChanged);
    assert.deepEqual(positions(g1), reference.shiftSubgraphs.movesPositions);

    const g2 = new Graph();
    add(g2, 15, -180, -60, 49, 60);
    add(g2, 19, -180, 60, 52, 46);
    add(g2, 21, 540, 180, 57, 57);
    add(g2, 17, -300, 60, 60, 50);
    add(g2, 22, 540, 60, 53, 47);
    add(g2, 18, 540, 300, 50, 53);
    add(g2, 16, 660, -60, 51, 48);
    add(g2, 20, 660, -180, 52, 60);
    const n19 = g2.Nodes.find((n) => Number(n.ID) === 19);
    const n15 = g2.Nodes.find((n) => Number(n.ID) === 15);
    const n22 = g2.Nodes.find((n) => Number(n.ID) === 22);
    const n21 = g2.Nodes.find((n) => Number(n.ID) === 21);
    const n18 = g2.Nodes.find((n) => Number(n.ID) === 18);
    g2.Connect(n19, n15);
    g2.Connect(n22, n21);
    g2.Connect(n18, n21);
    g2.CellSize = 60;
    const v2 = visibilityEdges(ctx, g2, false, true);
    const factor2 = 2.4015748031496065;
    inflateAlongAxis(g2, false, true, factor2, v2, false);
    const ch2 = shiftSubgraphs(ctx, g2, false, true, factor2, [], v2);
    assert.equal(ch2, reference.shiftSubgraphs.wontChangeChanged);
    assert.deepEqual(positions(g2), reference.shiftSubgraphs.wontChangePositions);
  });

  it("replays compactAlongAxis exactly", () => {
    const g = new Graph();
    const moving = add(g, 1, 0, 0, 80, 80);
    const child = new Node(2n, 10, 10);
    child.TopLeft = new Point(10, 10);
    g.AddNewNodeToContainer(moving, child);
    const anchor = add(g, 3, 200, 0, 50, 50);
    const trailing = add(g, 4, 400, 100, 50, 50);
    g.Connect(anchor, moving);
    g.Connect(moving, trailing);
    g.ComputeCellSize();

    const vEdges = visibilityEdges(ctx, g, true, true);
    inflateAlongAxis(g, true, true, 1.0, vEdges, false);
    for (let i = 0; i < 20; i++) {
      if (!shiftSubgraphs(ctx, g, true, true, 1.0, null, vEdges)) break;
    }
    const guard = new OptimizationWorkGuard(ctx, "CompactionMoves", 250000000n);
    const changed = compactAlongAxis(ctx, g, true, true, 1.0, null, vEdges, guard);
    assert.equal(changed, reference.compactAlongAxis.changed);
    assert.deepEqual(positions(g), reference.compactAlongAxis.positions);
    assert.equal(guard.Used(), BigInt(reference.compactAlongAxis.used));
  });

  it("replays exact CompactionMoves resource boundary and work count", () => {
    assert.equal(BigInt(reference.exactWorkBoundary.w), 954n);
    assert.equal(BigInt(reference.exactWorkBoundary.firstPassWork), 732n);
  });
});
