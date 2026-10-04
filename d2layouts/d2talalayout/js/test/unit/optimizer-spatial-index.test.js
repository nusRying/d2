import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { OptimizationWorkGuard } from '../../src/limits/optimization.js';
import {
  OptimizerSpatialIndex,
  OPTIMIZER_SPATIAL_INDEX_MIN_NODES,
  indexedCanMove,
  indexedIsOccupied,
  indexedDoesOverlap,
} from '../../src/placement/optimizer-spatial-index.js';

describe('Slice 44 — Optimizer Spatial Index', () => {
  function createGraph(cellSize = 10) {
    const g = new Graph();
    g.CellSize = cellSize;
    return g;
  }

  function addNode(g, id, x, y, width = 20, height = 20) {
    const n = new Node(BigInt(id), width, height);
    n.TopLeft = new Point(x, y);
    n.Graph = g;
    g.addNode(n);
    return n;
  }

  it('rebuilds index and answers occupancy and overlap queries for small graphs (fallback path)', () => {
    const g = createGraph();
    const n1 = addNode(g, 1, 0, 0, 20, 20);
    const n2 = addNode(g, 2, 50, 50, 20, 20);

    const index = new OptimizerSpatialIndex();
    const guard = new OptimizationWorkGuard(backgroundWorkContext(), 'TestGuard', 1000000n);

    index.rebuild(g, guard);

    expect(index.spatialUsable).toBe(false); // < 96 nodes
    expect(index.occupancyUsable).toBe(true);

    const [occNode, isOcc] = index.isOccupied(g, new Point(0, 0), guard);
    expect(isOcc).toBe(true);
    expect(occNode).toBe(n1);

    const [nonOccNode, isNonOcc] = index.isOccupied(g, new Point(100, 100), guard);
    expect(isNonOcc).toBe(false);
    expect(nonOccNode).toBeNull();
  });

  it('builds segment tree interval index for >= 96 nodes and queries bounding box', () => {
    const g = createGraph();
    for (let i = 0; i < 100; i++) {
      addNode(g, i + 1, (i % 10) * 40, Math.floor(i / 10) * 40, 20, 20);
    }

    const index = new OptimizerSpatialIndex();
    const guard = new OptimizationWorkGuard(backgroundWorkContext(), 'TestGuard', 10000000n);

    index.rebuild(g, guard);
    expect(index.spatialUsable).toBe(true);
    expect(index.entries.length).toBe(100);

    // Query region [0, 0, 50, 50] should find nodes at (0,0), (40,0), (0,40), (40,40)
    const candidates = index.query(0, 0, 50, 50, guard);
    expect(candidates.length).toBeGreaterThanOrEqual(4);

    // Test indexed helpers
    const fakeOptim = { g, spatialIndex: index };
    const canMove = indexedCanMove(fakeOptim, g.Nodes[0], new Point(200, 200), guard);
    expect(typeof canMove).toBe('boolean');
  });
});
