import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Point } from '../../src/geometry/point.js';
import {
  initializeNodes,
  InitializeNodes,
  nodeCandidatePositions,
} from '../../src/placement/initialize.js';
import { newSizelessOptimizer } from '../../src/placement/sizeless-optimizer.js';

const bg = { Err: () => null, isCancelled: () => false };

function addTestEdge(g, from, to) {
  const e = new Edge(from, to);
  from.Edges.push(e);
  to.Edges.push(e);
  g.AddEdge(e);
  return e;
}

describe('Slice 42 — initializeNodes Unit Tests', () => {
  it('handles empty graphs gracefully', () => {
    const g = new Graph();
    g.CellSize = 10;
    assert.doesNotThrow(() => initializeNodes(bg, g));
  });

  it('positions single isolated node at (len, len) = (1, 1)', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n = g.AddNode(new Node(1, 10, 10));
    initializeNodes(bg, g);
    assert.notStrictEqual(n.TopLeft, null);
    assert.strictEqual(n.TopLeft.X, 1);
    assert.strictEqual(n.TopLeft.Y, 1);
  });

  it('scans candidate positions in ascending order for non-majority targets', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n2.TopLeft = new Point(50, 50);
    const e = addTestEdge(g, n1, n2);
    // n1 -> n2, so n1 is source, not majority target
    e.TargetArrowhead = 'arrow';

    const opt = newSizelessOptimizer(bg, g, null);
    const cands = nodeCandidatePositions(bg, n1, g, opt);
    assert(cands.length > 0);

    // First candidate must be at minimal (topLeftX, topLeftY)
    const first = cands[0];
    const second = cands[1];
    assert(first.X <= second.X || (first.X === second.X && first.Y <= second.Y));
  });

  it('scans candidate positions in descending order for majority targets', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    n1.TopLeft = new Point(50, 50);
    const e = addTestEdge(g, n1, n2);
    // n1 -> n2, so n2 is majority target
    e.TargetArrowhead = 'arrow';

    const opt = newSizelessOptimizer(bg, g, null);
    const cands = nodeCandidatePositions(bg, n2, g, opt);
    assert(cands.length > 0);

    // First candidate must be at maximal (bottomRightX, bottomRightY)
    const first = cands[0];
    const second = cands[1];
    assert(first.X >= second.X || (first.X === second.X && first.Y >= second.Y));
  });

  it('clamps candidate positions to non-negative coordinates when graph has fixed nodes', () => {
    const g = new Graph();
    g.CellSize = 10;
    const nFixed = g.AddNode(new Node(1, 10, 10));
    nFixed.FixedTopLeft = new Point(0, 0);
    nFixed.TopLeft = new Point(0, 0);
    const nMoving = g.AddNode(new Node(2, 10, 10));
    addTestEdge(g, nFixed, nMoving);

    const opt = newSizelessOptimizer(bg, g, null);
    const cands = nodeCandidatePositions(bg, nMoving, g, opt);

    for (const pt of cands) {
      assert(pt.X >= 0, `X coordinate ${pt.X} must be >= 0 when graph has fixed nodes`);
      assert(pt.Y >= 0, `Y coordinate ${pt.Y} must be >= 0 when graph has fixed nodes`);
    }
  });

  it('rolls back completely on context cancellation', () => {
    const g = new Graph();
    g.CellSize = 10;
    const n1 = g.AddNode(new Node(1, 10, 10));
    const n2 = g.AddNode(new Node(2, 10, 10));
    const n3 = g.AddNode(new Node(3, 10, 10));
    n1.TopLeft = new Point(10, 20);
    n2.TopLeft = new Point(30, 40);
    n3.TopLeft = new Point(50, 60);
    addTestEdge(g, n1, n2);
    addTestEdge(g, n2, n3);

    const canceledCtx = { Err: () => new Error('canceled'), isCancelled: () => true };

    assert.throws(
      () => initializeNodes(canceledCtx, g),
      (err) => {
        assert(err != null);
        return true;
      }
    );

    // All original positions must be restored
    assert.strictEqual(n1.TopLeft.X, 10);
    assert.strictEqual(n1.TopLeft.Y, 20);
    assert.strictEqual(n2.TopLeft.X, 30);
    assert.strictEqual(n2.TopLeft.Y, 40);
    assert.strictEqual(n3.TopLeft.X, 50);
    assert.strictEqual(n3.TopLeft.Y, 60);
  });

  it('preserves exact context error messages at initializeNodes direct boundary', () => {
    const makeGraph = () => {
      const g = new Graph();
      g.CellSize = 10;
      const n1 = g.AddNode(new Node(1, 10, 10));
      const n2 = g.AddNode(new Node(2, 10, 10));
      addTestEdge(g, n1, n2);
      return g;
    };

    assert.throws(
      () => initializeNodes({ Err: () => new Error('context canceled') }, makeGraph()),
      (err) => {
        assert.strictEqual(err.message, 'InitializeNodes: context canceled');
        return true;
      }
    );

    assert.throws(
      () => initializeNodes({ Err: () => new Error('context deadline exceeded') }, makeGraph()),
      (err) => {
        assert.strictEqual(err.message, 'InitializeNodes: context deadline exceeded');
        return true;
      }
    );

    assert.throws(
      () => initializeNodes({ Err: () => new Error('oracle custom initialize error') }, makeGraph()),
      (err) => {
        assert.strictEqual(err.message, 'InitializeNodes: oracle custom initialize error');
        return true;
      }
    );
  });
});
