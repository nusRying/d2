import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";
import { OptimizationWorkGuard } from "../../src/limits/optimization.js";
import { moveNodeToBest } from "../../src/placement/moves.js";

const noopCtx = { Err: () => null };

function createTestGraph() {
  const g = new Graph();
  g.CellSize = 10;
  const a = new Node(1n, 10, 10);
  a.TopLeft = new Point(0, 0);
  g.AddNewNodeToContainer(null, a);

  const b = new Node(2n, 10, 10);
  b.TopLeft = new Point(100, 0);
  g.AddNewNodeToContainer(null, b);

  g.Connect(a, b);
  return { g, a, b };
}

describe("Slice 43 — Generic moveNodeToBest unit tests", () => {
  it("rejects missing guard", () => {
    const { g, b } = createTestGraph();
    assert.throws(
      () => moveNodeToBest(noopCtx, g, b, [new Point(100, 0)], null, true, null),
      /TALA moveNodeToBest requires a work guard/
    );
  });

  it("throws on nil/null placement point with guard location", () => {
    const { g, b } = createTestGraph();
    const guard = new OptimizationWorkGuard(noopCtx, "CompactionMoves", 100000n);
    assert.throws(
      () => moveNodeToBest(noopCtx, g, b, [null], null, true, guard),
      /TALA CompactionMoves found a nil placement point/
    );
  });

  it("throws when no valid placement can be found", () => {
    const { g, b } = createTestGraph();
    const guard = new OptimizationWorkGuard(noopCtx, "CompactionMoves", 100000n);
    // b is at (100, 0). (0, 0) is occupied by a (same point and overlapping), and not current position.
    assert.throws(
      () => moveNodeToBest(noopCtx, g, b, [new Point(0, 0)], null, true, guard),
      /sizedOptimizer\.moveNodeToBest: could not find any placement/
    );
  });

  it("prefers current-position on strict scoring ties", () => {
    const g = new Graph();
    g.CellSize = 10;
    const a = new Node(1n, 10, 10);
    a.TopLeft = new Point(50, 0);
    g.AddNewNodeToContainer(null, a);

    // Node isolated without edges has cost 0 everywhere.
    // Given candidate at (20, 0) and candidate at current position (50, 0).
    const guard = new OptimizationWorkGuard(noopCtx, "CompactionMoves", 100000n);
    const changed = moveNodeToBest(
      noopCtx,
      g,
      a,
      [new Point(20, 0), new Point(50, 0)],
      null,
      false,
      guard
    );
    // Because (50, 0) is current position and ties (both score 0),
    // tie-breaker prefers current position!
    assert.equal(changed, false);
    assert.equal(a.TopLeft.X, 50);
    assert.equal(a.TopLeft.Y, 0);
  });

  it("accepts candidate that strictly improves placement score", () => {
    const { g, a, b } = createTestGraph();
    // b is at (100, 0) connected to a at (0, 0).
    // Moving b closer to a (to 30, 0) decreases edge length from 100 to 30.
    const guard = new OptimizationWorkGuard(noopCtx, "CompactionMoves", 100000n);
    const changed = moveNodeToBest(
      noopCtx,
      g,
      b,
      [new Point(100, 0), new Point(30, 0)],
      null,
      false,
      guard
    );
    assert.equal(changed, true);
    assert.equal(b.TopLeft.X, 30);
    assert.equal(b.TopLeft.Y, 0);
    void a;
  });

  it("respects fixed-origin constraints on candidate positions", () => {
    const g = new Graph();
    g.CellSize = 10;
    const container = new Node(99n, 200, 200);
    container.TopLeft = new Point(50, 50);
    container.FixedTopLeft = new Point(50, 50);
    g.AddNewNodeToContainer(null, container);

    const child = new Node(1n, 20, 20);
    child.TopLeft = new Point(60, 60);
    g.AddNewNodeToContainer(container, child);

    // Candidates before container fixed origin (50, 50) must be skipped.
    const guard = new OptimizationWorkGuard(noopCtx, "CompactionMoves", 100000n);
    const changed = moveNodeToBest(
      noopCtx,
      g,
      child,
      [new Point(10, 10), new Point(60, 60)],
      null,
      true,
      guard
    );
    assert.equal(changed, false);
    assert.equal(child.TopLeft.X, 60);
    assert.equal(child.TopLeft.Y, 60);
  });

  it("preserves guard cancellation location matching Go", () => {
    const g = new Graph();
    g.CellSize = 10;
    const moving = new Node(1n, 10, 10);
    moving.TopLeft = new Point(0, 0);
    g.AddNewNodeToContainer(null, moving);

    const anchor = new Node(3n, 10, 10);
    anchor.TopLeft = new Point(100, 0);
    g.AddNewNodeToContainer(null, anchor);
    g.Connect(moving, anchor);

    let checkCount = 0;
    const guardCtx = {
      Err() {
        checkCount++;
        return checkCount > 1 ? new Error("context canceled") : null;
      },
    };
    const guard = new OptimizationWorkGuard(guardCtx, "CompactionMoves", 250000000n);

    assert.throws(
      () =>
        moveNodeToBest(
          noopCtx,
          g,
          moving,
          [new Point(0, 0)],
          null,
          true,
          guard
        ),
      /CompactionMoves.*context canceled/
    );
  });

  it("accounts work through OptimizationWorkGuard", () => {
    const { g, b } = createTestGraph();
    const guard = new OptimizationWorkGuard(noopCtx, "CompactionMoves", 100000n);
    moveNodeToBest(
      noopCtx,
      g,
      b,
      [new Point(20, 0), new Point(40, 0), new Point(100, 0)],
      null,
      true,
      guard
    );
    assert.ok(guard.Used() > 0n);
  });
});
