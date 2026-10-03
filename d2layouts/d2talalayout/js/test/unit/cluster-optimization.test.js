import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { Point } from '../../src/geometry/point.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import {
  alignConnectedNodes,
  alignVessel,
  optimizeCluster,
  optimizeClusters,
  OptimizeClustersRollback,
} from '../../src/placement/cluster-optimization.js';

describe('Slice 44 — Cluster Optimization & Alignment', () => {
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

  function createCluster(g, vesselNode, memberNodes = [], arrangement = ClusterArrangement.Column) {
    const c = new Cluster(g);
    c.Vessel = vesselNode;
    c.Nodes = [vesselNode, ...memberNodes];
    c.Arrangement = arrangement;
    c.DesiredArrangement = arrangement;
    vesselNode.Cluster = c;
    vesselNode.isClusterVessel = true;
    g.Clusters.set(vesselNode, c);
    return c;
  }

  describe('OptimizeClustersRollback', () => {
    it('records desired arrangement and graph state and restores on failure', () => {
      const g = createGraph(10);
      const v = addNode(g, 1, 10, 10, 40, 40);
      const c = createCluster(g, v, [], ClusterArrangement.Column);

      const rollback = new OptimizeClustersRollback(g, 10);
      rollback.recordDesiredArrangement(c, ClusterArrangement.Row);
      c.DesiredArrangement = ClusterArrangement.Row;
      expect(c.DesiredArrangement).toBe(ClusterArrangement.Row);

      rollback.restore();
      expect(c.DesiredArrangement).toBe(ClusterArrangement.Column);
    });
  });

  describe('alignConnectedNodes and alignVessel', () => {
    it('handles empty external connections gracefully', () => {
      const g = createGraph();
      const v = addNode(g, 1, 10, 10);
      const c = createCluster(g, v);

      alignConnectedNodes(c, true);
      alignConnectedNodes(c, false);
      alignVessel(c, true);
      alignVessel(c, false);

      expect(v.TopLeft.X).toBe(10);
      expect(v.TopLeft.Y).toBe(10);
    });
  });

  describe('optimizeCluster', () => {
    it('runs cluster optimization without error', () => {
      const g = createGraph(10);
      const v = addNode(g, 1, 10, 10, 30, 30);
      const c = createCluster(g, v);

      const result = optimizeCluster(backgroundWorkContext(), c, true);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('optimizeClusters', () => {
    it('returns false when graph has no clusters', () => {
      const g = createGraph();
      addNode(g, 1, 0, 0);
      const changed = optimizeClusters(backgroundWorkContext(), g);
      expect(changed).toBe(false);
    });

    it('optimizes all clusters in graph', () => {
      const g = createGraph(10);
      const v = addNode(g, 1, 10, 10, 30, 30);
      createCluster(g, v);

      const changed = optimizeClusters(backgroundWorkContext(), g);
      expect(typeof changed).toBe('boolean');
    });
  });
});
