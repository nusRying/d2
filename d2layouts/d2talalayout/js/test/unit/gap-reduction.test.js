import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import {
  isBetween,
  nearestBetween,
  nearestConnectedAhead,
  reduceGapToNeighbors,
  gapNormalization,
} from '../../src/placement/gap-reduction.js';
import { LayoutAxis, TraversalDirection } from '../../src/placement/axis.js';

describe('Slice 44 — Gap Reduction Substrate', () => {
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

  function addEdge(g, from, to) {
    const e = new Edge(g);
    e.ID = BigInt(g.Edges.length + 1);
    e.From = from;
    e.To = to;
    from.Edges.push(e);
    to.Edges.push(e);
    g.Edges.push(e);
    return e;
  }

  describe('isBetween', () => {
    it('determines if node is between behind and ahead horizontally', () => {
      const g = createGraph();
      const behind = addNode(g, 1, 0, 0, 20, 20);
      const ahead = addNode(g, 2, 100, 0, 20, 20);
      const mid = addNode(g, 3, 50, 0, 20, 20);
      const outside = addNode(g, 4, 150, 0, 20, 20);

      expect(isBetween(mid, behind, ahead, true, true)).toBe(true);
      expect(isBetween(outside, behind, ahead, true, true)).toBe(false);
    });

    it('determines if node is between behind and ahead vertically', () => {
      const g = createGraph();
      const behind = addNode(g, 1, 0, 0, 20, 20);
      const ahead = addNode(g, 2, 0, 100, 20, 20);
      const mid = addNode(g, 3, 0, 50, 20, 20);
      const outside = addNode(g, 4, 0, 150, 20, 20);

      expect(isBetween(mid, behind, ahead, false, true)).toBe(true);
      expect(isBetween(outside, behind, ahead, false, true)).toBe(false);
    });
  });

  describe('nearestBetween and nearestConnectedAhead', () => {
    it('finds nearest connected node ahead', () => {
      const g = createGraph();
      const a = addNode(g, 1, 0, 0, 20, 20);
      const b = addNode(g, 2, 60, 0, 20, 20);
      const c = addNode(g, 3, 120, 0, 20, 20);
      addEdge(g, a, b);
      addEdge(g, a, c);

      const nearest = nearestConnectedAhead(a, true, true);
      expect(nearest).toBe(b);
    });

    it('finds nearest node between behind and ahead', () => {
      const g = createGraph();
      const behind = addNode(g, 1, 0, 0, 20, 20);
      const ahead = addNode(g, 2, 100, 0, 20, 20);
      const n1 = addNode(g, 3, 40, 0, 20, 20);
      const n2 = addNode(g, 4, 70, 0, 20, 20);

      const nearest = nearestBetween([n1, n2], behind, ahead, null, true, true);
      expect(nearest).toBe(n1);
    });
  });

  describe('reduceGapToNeighbors & gapNormalization', () => {
    it('runs reduceGapToNeighbors on connected nodes', () => {
      const g = createGraph(10);
      const a = addNode(g, 1, 0, 0, 20, 20);
      const b = addNode(g, 2, 300, 0, 20, 20);
      addEdge(g, a, b);

      const [changed] = reduceGapToNeighbors(backgroundWorkContext(), a, null, {
        axis: LayoutAxis.Horizontal,
        direction: TraversalDirection.Forward,
        attemptRecoverSymmetry: true,
      });
      expect(typeof changed).toBe('boolean');
    });

    it('runs gapNormalization across all nodes in graph', () => {
      const g = createGraph(10);
      const a = addNode(g, 1, 0, 0, 20, 20);
      const b = addNode(g, 2, 300, 0, 20, 20);
      addEdge(g, a, b);

      const [txn] = g.newRequestTransaction(backgroundWorkContext(), { affectContainers: true });
      const changed = gapNormalization(backgroundWorkContext(), g.Nodes, txn, g, {
        axis: LayoutAxis.Horizontal,
        direction: TraversalDirection.Forward,
      });
      expect(typeof changed).toBe('boolean');
    });
  });
});
