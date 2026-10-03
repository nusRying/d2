import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";
import { Orientation } from "../../src/geometry/orientation.js";
import { LayoutAxis } from "../../src/placement/axis.js";
import {
  MAX_COMPACTION_CANDIDATE_COUNT,
  candidateMoves,
  compaction,
  visibilityEdges,
} from "../../src/placement/compaction.js";

function add(g, id, x, y, w = 10, h = 10) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  g.AddNode(n);
  return n;
}

function graph3() {
  const g = new Graph();
  g.CellSize = 10;
  const a = add(g, 1, 0, 0);
  const b = add(g, 2, 100, 0);
  const c = add(g, 3, 200, 0);
  g.Connect(a, b);
  g.Connect(b, c);
  return { g, a, b, c };
}

function inflationGraph() {
  const g = new Graph();
  g.CellSize = 10;
  const a = add(g, 1, 0, 0);
  const b = add(g, 2, 20, 0);
  g.Connect(a, b);
  return { g, a, b };
}

describe("Slice 43 — Compaction direct gates", () => {
  it("rejects incomplete options before graph validation", () => {
    const ctx = { Err: () => null };
    assert.throws(() => compaction(ctx, null, {}), /TALA Compaction requires an axis/);
    assert.throws(
      () => compaction(ctx, null, { axis: LayoutAxis.Horizontal, factor: 0 }),
      /TALA Compaction requires a finite positive factor/
    );
    assert.throws(
      () => compaction(ctx, null, { axis: LayoutAxis.Horizontal, factor: Number.NaN }),
      /TALA Compaction requires a finite positive factor/
    );
  });

  it("restores exact point identities and routing costs after post-inflation cancellation", () => {
    const { g, b } = inflationGraph();
    const originalPoints = g.Nodes.map((n) => n.TopLeft);
    const originalValues = g.Nodes.map((n) => [n.TopLeft.X, n.TopLeft.Y]);
    g.crossingCost = 11;
    g.turnCost = 22;
    g.nonCenterPortCost = 33;

    const ctx = {
      Err() {
        return b.TopLeft.X !== 20 ? new Error("context canceled") : null;
      },
    };

    assert.throws(
      () => compaction(ctx, g, {
        axis: LayoutAxis.Horizontal,
        includeSizes: true,
        factor: 1,
      }),
      /Compaction: context canceled/
    );

    g.Nodes.forEach((node, i) => {
      assert.equal(node.TopLeft, originalPoints[i]);
      assert.deepEqual([node.TopLeft.X, node.TopLeft.Y], originalValues[i]);
    });
    assert.deepEqual(g.RoutingCosts(), { Crossing: 11, Turn: 22, NonCenterPort: 33 });
  });

  it("restores exact state if a context throws after inflation", () => {
    const { g, b } = inflationGraph();
    const originals = g.Nodes.map((n) => ({ ref: n.TopLeft, x: n.TopLeft.X, y: n.TopLeft.Y }));
    const panic = new Error("oracle post-inflation panic");
    const ctx = {
      Err() {
        if (b.TopLeft.X !== 20) throw panic;
        return null;
      },
    };

    assert.throws(
      () => compaction(ctx, g, {
        axis: LayoutAxis.Horizontal,
        includeSizes: true,
        factor: 1,
      }),
      (err) => err === panic
    );
    g.Nodes.forEach((node, i) => {
      assert.equal(node.TopLeft, originals[i].ref);
      assert.equal(node.TopLeft.X, originals[i].x);
      assert.equal(node.TopLeft.Y, originals[i].y);
    });
  });

  it("reports the CompactionMoves resource location and rolls back", () => {
    const { g } = graph3();
    const before = g.Nodes.map((n) => ({ ref: n.TopLeft, x: n.TopLeft.X, y: n.TopLeft.Y }));
    const ctx = { Err: () => null };
    assert.throws(
      () => compaction(ctx, g, {
        axis: LayoutAxis.Horizontal,
        includeSizes: true,
        factor: 1,
        moveWorkLimit: 1n,
      }),
      /CompactionMoves/
    );
    g.Nodes.forEach((node, i) => {
      assert.equal(node.TopLeft, before[i].ref);
      assert.equal(node.TopLeft.X, before[i].x);
      assert.equal(node.TopLeft.Y, before[i].y);
    });
  });

  it("applies table, loop-offset, and directional-margin spacing", () => {
    const g = new Graph();
    const a = add(g, 1, 0, 0);
    const b = add(g, 2, 200, 0);

    a.SetShape("Table");
    assert.equal(a.DeltaTo(b, a.TopLeft), 120);

    a.SetShape("");
    a.LoopOffsets = new Map([[Orientation.Right, 50]]);
    assert.equal(a.DeltaTo(b, a.TopLeft), 70);

    a.LoopOffsets = null;
    a._margin.right = 40;
    b._margin.left = 30;
    assert.equal(a.DeltaTo(b, a.TopLeft), 70);
  });

  it("reports exact DeltaTo invariant errors", () => {
    const g = new Graph();
    const a = add(g, 1, 0, 0);
    const b = add(g, 2, 100, 0);
    assert.throws(
      () => a.DeltaTo(null, a.TopLeft),
      /layout invariant violated: spacing check received incomplete nodes/
    );
    a.Edges.push({ From: null, To: b, MinWidth: 0, MinHeight: 0 });
    assert.throws(
      () => a.DeltaTo(b, a.TopLeft),
      /layout invariant violated: spacing check encountered an incomplete edge/
    );
  });

  it("rejects a non-finite candidate range", () => {
    const g = new Graph();
    g.CellSize = 10;
    const a = add(g, 1, 0, 0);
    const b = add(g, 2, Infinity, 0);
    assert.throws(
      () => candidateMoves({ Err: () => null }, g, b, 1, true, true, 0, []),
      /layout invariant violated: compaction candidate range is not finite/
    );
    void a;
  });

  it("bounds candidate generation at MAX_GRAPH_SIZE + 3", () => {
    const g = new Graph();
    g.CellSize = 1;
    const a = add(g, 1, 0, 0);
    const b = add(g, 2, MAX_COMPACTION_CANDIDATE_COUNT + 100, 0);
    const edge = g.Connect(a, b);
    assert.throws(
      () => candidateMoves({ Err: () => null }, g, b, 0.1, true, false, 0, [edge]),
      new RegExp(`candidate count .* exceeds limit ${MAX_COMPACTION_CANDIDATE_COUNT}`)
    );
  });

  it("uses exact visibility work location on cancellation", () => {
    let calls = 0;
    const ctx = {
      Err() {
        calls++;
        return calls >= 2 ? new Error("context canceled") : null;
      },
      isCancelled() {
        return false;
      },
    };
    const g = new Graph();
    add(g, 1, 0, 0);
    add(g, 2, 100, 0);
    assert.throws(() => visibilityEdges(ctx, g, true, true), /CompactionVisibility/);
  });
});
