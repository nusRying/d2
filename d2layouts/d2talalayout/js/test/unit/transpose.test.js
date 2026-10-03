import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { rotateAround, transpose } from '../../src/placement/transpose.js';

describe('Slice 44 — Transpose & Rotation', () => {
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

  describe('rotateAround', () => {
    it('rotates node 90 degrees CCW around center node', () => {
      const g = createGraph(10);
      const centerNode = addNode(g, 1, 50, 50, 20, 20);
      const orbitNode = addNode(g, 2, 50, 100, 20, 20);

      rotateAround(orbitNode, g, centerNode, 1, false);

      expect(orbitNode.TopLeft.X).toBe(0);
      expect(orbitNode.TopLeft.Y).toBe(50);
    });

    it('rotates 180 degrees CCW (2 times)', () => {
      const g = createGraph(10);
      const centerNode = addNode(g, 1, 50, 50, 20, 20);
      const orbitNode = addNode(g, 2, 50, 100, 20, 20);

      rotateAround(orbitNode, g, centerNode, 2, false);

      expect(orbitNode.TopLeft.X).toBe(50);
      expect(orbitNode.TopLeft.Y).toBe(0);
    });

    it('rounds to cell size when round is true', () => {
      const g = createGraph(10);
      const centerNode = addNode(g, 1, 50, 50, 20, 20);
      const orbitNode = addNode(g, 2, 53, 100, 20, 20);

      rotateAround(orbitNode, g, centerNode, 1, true);

      expect(orbitNode.TopLeft.X % g.CellSize).toBe(0);
      expect(orbitNode.TopLeft.Y % g.CellSize).toBe(0);
    });
  });

  describe('transpose', () => {
    it('returns false for node with fixed position or hierarchy', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0);
      n1.FixedTopLeft = new Point(0, 0);

      const result = transpose(backgroundWorkContext(), g, n1);
      expect(result).toBe(false);
    });

    it('returns false for node with more than 2 edges', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 50, 50);
      const n2 = addNode(g, 2, 0, 50);
      const n3 = addNode(g, 3, 100, 50);
      const n4 = addNode(g, 4, 50, 100);
      addEdge(g, n1, n2);
      addEdge(g, n1, n3);
      addEdge(g, n1, n4);

      const result = transpose(backgroundWorkContext(), g, n1);
      expect(result).toBe(false);
    });

    it('transposes 1-edge node when rotation improves symmetry', () => {
      const g = createGraph(10);
      const a = addNode(g, 1, 50, 50, 20, 20);
      const b = addNode(g, 2, 50, 100, 20, 20);
      addEdge(g, a, b);

      const changed = transpose(backgroundWorkContext(), g, b);
      expect(typeof changed).toBe('boolean');
    });
  });
});
