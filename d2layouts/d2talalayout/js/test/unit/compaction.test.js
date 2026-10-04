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
  inflateAlongAxis,
  shiftSubgraphs,
} from "../../src/placement/compaction.js";

function add(g, id, x, y, w = 10, h = 10) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  g.AddNode(n);
  return n;
}

function compactionGuardTestGraph() {
  const g = new Graph();
  const moving = new Node(1n, 80, 80);
  moving.TopLeft = new Point(0, 0);
  g.AddNewNodeToContainer(null, moving);

  const child = new Node(2n, 10, 10);
  child.TopLeft = new Point(10, 10);
  g.AddNewNodeToContainer(moving, child);

  const anchor = new Node(3n, 50, 50);
  anchor.TopLeft = new Point(200, 0);
  g.AddNewNodeToContainer(null, anchor);

  const trailing = new Node(4n, 50, 50);
  trailing.TopLeft = new Point(400, 100);
  g.AddNewNodeToContainer(null, trailing);

  g.Connect(anchor, moving);
  g.Connect(moving, trailing);
  g.ComputeCellSize();
  return { g, moving, child, anchor, trailing };
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

  it("determines exact minimum CompactionMoves work boundary W, proves W succeeds, and W-1 rolls back exact state with cache sentinel", () => {
    const noopCtx = { Err: () => null };

    // 1. Binary search to find minimum work limit W matching Go TestCompactionMoveGuardExactWorkBoundaryRestoresAcceptedMove
    let minimum = 1n;
    let maximum = 250000000n;
    while (minimum < maximum) {
      const middle = minimum + (maximum - minimum) / 2n;
      const { g } = compactionGuardTestGraph();
      let err = null;
      try {
        compaction(noopCtx, g, {
          axis: LayoutAxis.Horizontal,
          includeSizes: true,
          factor: 1,
          moveWorkLimit: middle,
        });
      } catch (e) {
        err = e;
      }
      if (err == null) {
        maximum = middle;
      } else if (err.message && err.message.includes("optimization resource limit exceeded")) {
        minimum = middle + 1n;
      } else {
        throw err;
      }
    }

    // Verify exact W matches Go oracle
    assert.equal(minimum, 954n);

    // 2. Prove W succeeds with correct geometry, accepted moves, and routing costs
    const { g: exactGraph, child: exactChild } = compactionGuardTestGraph();
    const childBeforeRef = exactChild.TopLeft;
    const childBeforeVal = [exactChild.TopLeft.X, exactChild.TopLeft.Y];
    compaction(noopCtx, exactGraph, {
      axis: LayoutAxis.Horizontal,
      includeSizes: true,
      factor: 1,
      moveWorkLimit: minimum,
    });
    // Accepted movement occurred:
    assert.ok(exactChild.TopLeft.X !== childBeforeVal[0] || exactChild.TopLeft.Y !== childBeforeVal[1]);
    const costs = exactGraph.RoutingCosts();
    assert.ok(costs.Crossing !== 0 || costs.Turn !== 0 || costs.NonCenterPort !== 0);
    const expectedPositions = [
      { id: 1n, x: 0, y: 0 },
      { id: 2n, x: 105, y: 10 },
      { id: 3n, x: 150, y: 0 },
      { id: 4n, x: 150, y: 100 },
    ];
    exactGraph.Nodes.forEach((node, i) => {
      assert.equal(node.ID, expectedPositions[i].id);
      assert.equal(node.TopLeft.X, expectedPositions[i].x);
      assert.equal(node.TopLeft.Y, expectedPositions[i].y);
    });

    // 3. Prove W - 1 fails at CompactionMoves and restores exact positions, Point identities, routing costs, and cache sentinel
    const { g: limitedGraph, moving: limitedParent, child: limitedChild } = compactionGuardTestGraph();
    const limitedPositions = new Map();
    for (const node of limitedGraph.Nodes) {
      limitedPositions.set(node, {
        pointer: node.TopLeft,
        x: node.TopLeft.X,
        y: node.TopLeft.Y,
      });
    }
    const originalCosts = limitedGraph.RoutingCosts();

    // Seed placement cache sentinel
    const cacheState = 0x41;
    const cacheCost = 123.5;
    limitedGraph.StoreEdgeLengthCost(cacheState, cacheCost);
    const [seededCost, seededOk] = limitedGraph.LookupEdgeLengthCost(cacheState);
    assert.equal(seededOk, true);
    assert.equal(seededCost, cacheCost);
    const cacheEntries = limitedGraph.EdgeLengthCacheEntries();
    const cacheMapRef = limitedGraph.edgeLengthCache;

    assert.throws(
      () =>
        compaction(noopCtx, limitedGraph, {
          axis: LayoutAxis.Horizontal,
          includeSizes: true,
          factor: 1,
          moveWorkLimit: minimum - 1n,
        }),
      (err) => {
        assert.match(err.message, /CompactionMoves/);
        assert.match(err.message, /optimization resource limit exceeded/);
        return true;
      }
    );

    // Verify all positions and exact Point object identities restored
    for (const node of limitedGraph.Nodes) {
      const orig = limitedPositions.get(node);
      assert.equal(node.TopLeft, orig.pointer, `Node ${node.ID} Point reference identity must be preserved`);
      assert.equal(node.TopLeft.X, orig.x, `Node ${node.ID} X coordinate must be restored`);
      assert.equal(node.TopLeft.Y, orig.y, `Node ${node.ID} Y coordinate must be restored`);
    }
    assert.equal(limitedParent.TopLeft, limitedPositions.get(limitedParent).pointer);
    assert.equal(limitedChild.TopLeft, limitedPositions.get(limitedChild).pointer);

    // Verify routing costs restored
    assert.deepEqual(limitedGraph.RoutingCosts(), originalCosts);

    // Verify placement cache entries and sentinel strictly preserved
    assert.equal(limitedGraph.edgeLengthCache, cacheMapRef, "edgeLengthCache Map instance must survive");
    assert.equal(limitedGraph.EdgeLengthCacheEntries(), cacheEntries);
    const [costAfter, okAfter] = limitedGraph.LookupEdgeLengthCost(cacheState);
    assert.equal(okAfter, true);
    assert.equal(costAfter, cacheCost);
  });

  it("restores exact geometry, point identity, routing costs, and placement cache on panic during moves pass", () => {
    const { g, moving, child } = compactionGuardTestGraph();
    const positions = new Map();
    for (const node of g.Nodes) {
      positions.set(node, { pointer: node.TopLeft, x: node.TopLeft.X, y: node.TopLeft.Y });
    }
    const originalCosts = g.RoutingCosts();
    const cacheState = 0x42;
    const cacheCost = 456.25;
    g.StoreEdgeLengthCost(cacheState, cacheCost);
    const cacheEntries = g.EdgeLengthCacheEntries();
    const cacheMapRef = g.edgeLengthCache;

    let observed = false;
    const panicErr = new Error("compaction move guard probe");
    const ctx = {
      Err() {
        let geometryChanged = false;
        for (const [node, orig] of positions) {
          if (node.TopLeft !== orig.pointer || node.TopLeft.X !== orig.x || node.TopLeft.Y !== orig.y) {
            geometryChanged = true;
            break;
          }
        }
        const rc = g.RoutingCosts();
        const costsChanged =
          rc.Crossing !== originalCosts.Crossing ||
          rc.Turn !== originalCosts.Turn ||
          rc.NonCenterPort !== originalCosts.NonCenterPort;
        if (geometryChanged && costsChanged) {
          observed = true;
          throw panicErr;
        }
        return null;
      },
    };

    assert.throws(
      () =>
        compaction(ctx, g, {
          axis: LayoutAxis.Horizontal,
          includeSizes: true,
          factor: 1,
        }),
      (err) => err === panicErr
    );

    assert.equal(observed, true, "panic must have observed changed geometry and costs before throwing");
    for (const [node, orig] of positions) {
      assert.equal(node.TopLeft, orig.pointer);
      assert.equal(node.TopLeft.X, orig.x);
      assert.equal(node.TopLeft.Y, orig.y);
    }
    assert.equal(moving.TopLeft, positions.get(moving).pointer);
    assert.equal(child.TopLeft, positions.get(child).pointer);
    assert.deepEqual(g.RoutingCosts(), originalCosts);
    assert.equal(g.edgeLengthCache, cacheMapRef);
    assert.equal(g.EdgeLengthCacheEntries(), cacheEntries);
    const [c, ok] = g.LookupEdgeLengthCost(cacheState);
    assert.equal(ok, true);
    assert.equal(c, cacheCost);
  });

  it("restores exact state on cancellation and panic during trial move mutation", () => {
    for (const isPanic of [false, true]) {
      const { g, moving, child } = compactionGuardTestGraph();
      const positions = new Map();
      for (const node of g.Nodes) {
        positions.set(node, { pointer: node.TopLeft, x: node.TopLeft.X, y: node.TopLeft.Y });
      }
      const originalCosts = g.RoutingCosts();
      const cacheState = 0x43;
      const cacheCost = 789.75;
      g.StoreEdgeLengthCost(cacheState, cacheCost);
      const cacheEntries = g.EdgeLengthCacheEntries();

      let observed = false;
      const panicErr = new Error("compaction move mutation probe");
      const ctx = {
        Err() {
          // Check if any node is currently at a mutated position during trial move
          for (const [node, orig] of positions) {
            if (node.TopLeft.X !== orig.x || node.TopLeft.Y !== orig.y) {
              observed = true;
              if (isPanic) throw panicErr;
              return new Error("context canceled");
            }
          }
          return null;
        },
      };

      if (isPanic) {
        assert.throws(
          () =>
            compaction(ctx, g, {
              axis: LayoutAxis.Horizontal,
              includeSizes: true,
              factor: 1,
            }),
          (err) => err === panicErr
        );
      } else {
        assert.throws(
          () =>
            compaction(ctx, g, {
              axis: LayoutAxis.Horizontal,
              includeSizes: true,
              factor: 1,
            }),
          /context canceled/
        );
      }

      assert.equal(observed, true, "must reach trial move mutation");
      for (const [node, orig] of positions) {
        assert.equal(node.TopLeft, orig.pointer);
        assert.equal(node.TopLeft.X, orig.x);
        assert.equal(node.TopLeft.Y, orig.y);
      }
      assert.equal(moving.TopLeft, positions.get(moving).pointer);
      assert.equal(child.TopLeft, positions.get(child).pointer);
      assert.deepEqual(g.RoutingCosts(), originalCosts);
      assert.equal(g.EdgeLengthCacheEntries(), cacheEntries);
      const [c, ok] = g.LookupEdgeLengthCost(cacheState);
      assert.equal(ok, true);
      assert.equal(c, cacheCost);
    }
  });

  it("replicates TestVisibilityGraphOverlap from Go", () => {
    const g = new Graph();
    const a = add(g, 1, 5, 5, 5, 5);
    const b = add(g, 2, 6, 5, 5, 5);
    const vEdges = visibilityEdges({ Err: () => null }, g, true, true);
    assert.equal(vEdges.length, 1);
    assert.equal(vEdges[0].From, a);
    assert.equal(vEdges[0].To, b);
  });

  it("replicates TestVisibilityGraphInitialization from Go", () => {
    const g = new Graph();
    const a = add(g, 1, 0, 4, 4, 6);
    const b = add(g, 2, 12, 8, 6, 4);
    const c = add(g, 3, 25, 5, 9, 5);
    const d = add(g, 4, 38, 1, 9, 6);

    const vEdges = visibilityEdges({ Err: () => null }, g, true, true);
    const pairs = [
      [a, b],
      [a, c],
      [a, d],
      [b, c],
      [c, d],
    ];

    for (const [from, to] of pairs) {
      const found = vEdges.some((e) => e.From === from && e.To === to);
      assert.ok(found, `Edge ${from.ID} -> ${to.ID} that should exist doesn't exist`);
    }
  });

  it("replicates TestShiftSubgraphsWontChange from Go without drift", () => {
    const g = new Graph();
    const n15 = add(g, 15, -180, -60, 49, 60);
    const n19 = add(g, 19, -180, 60, 52, 46);
    const n21 = add(g, 21, 540, 180, 57, 57);
    const n17 = add(g, 17, -300, 60, 60, 50);
    const n22 = add(g, 22, 540, 60, 53, 47);
    const n18 = add(g, 18, 540, 300, 50, 53);
    const n16 = add(g, 16, 660, -60, 51, 48);
    const n20 = add(g, 20, 660, -180, 52, 60);
    g.Connect(n19, n15);
    g.Connect(n22, n21);
    g.Connect(n18, n21);
    g.CellSize = 60;

    const ctx = { Err: () => null };
    const isHorizontal = false;
    const includeSizes = true;
    const factor = 2.4015748031496065;
    const transition = false;

    const vEdges = visibilityEdges(ctx, g, isHorizontal, includeSizes);
    inflateAlongAxis(g, isHorizontal, includeSizes, factor, vEdges, transition);
    const changed = shiftSubgraphs(ctx, g, isHorizontal, includeSizes, factor, [], vEdges);
    assert.equal(changed, false, "Didn't expect any movement in TestShiftSubgraphsWontChange");
  });
});
