// Slice 46 — ports of internal/hierarchy rank_correctness_test.go,
// resource_test.go (rank parts) and rank_fuzz_test.go invariants.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { setHierarchyRankWeight, hierarchyRankWeight } from '../../src/graph/structural-access.js';
import { OptimizationWorkGuard, isOptimizationResourceLimitError } from '../../src/limits/optimization.js';
import { MAX_ENGINE_NODES, MAX_OPTIMIZATION_WORK_UNITS } from '../../src/limits/constants.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { rankDAG, rankDAGWithLimit } from '../../src/hierarchy/rank.js';
import { longestPathLevels, newRankProblem } from '../../src/hierarchy/rank-graph.js';
import {
  certify,
  computeCutValues,
  computeHeadComponent,
  feasibleTree,
  newRankSimplex,
  optimize,
  rankSlack,
} from '../../src/hierarchy/rank-simplex.js';
import { makeSimpleDAG, mapDAGToGraphLevels } from '../../src/hierarchy/discovery.js';
import { ErrViolation } from '../../src/hierarchy/layoutgraph-support.js';
import { bg, capture, chainHas, countingContext } from './hierarchy-fixtures.js';

function newDirectedGraph(nodeCount, edges) {
  const g = new Graph();
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(g.addNode(new Node(BigInt(i + 1), 1, 1)));
  }
  for (const [from, to] of edges) {
    const edge = g.connect(nodes[from], nodes[to]);
    edge.ID = BigInt(g.Edges.length);
    edge.TargetArrowhead = 'triangle';
  }
  return [g, nodes];
}

function rankCost(g, levels) {
  let cost = 0;
  for (const edge of g.Edges) {
    const length = levels.get(edge.To) - levels.get(edge.From);
    expect(length).toBeGreaterThanOrEqual(1);
    cost += hierarchyRankWeight(edge) * length;
  }
  return cost;
}

function levelsOf(nodes, levels) {
  return nodes.map((n) => levels.get(n));
}

function minimumRankCost(g, nodes) {
  // Exhaustive search over levels 0..n-1 for small graphs.
  const n = nodes.length;
  let best = Infinity;
  const assignment = new Array(n).fill(0);
  const visit = (i) => {
    if (i === n) {
      let cost = 0;
      for (const e of g.Edges) {
        const from = nodes.indexOf(e.From);
        const to = nodes.indexOf(e.To);
        const span = assignment[to] - assignment[from];
        if (span < 1) return;
        cost += hierarchyRankWeight(e) * span;
      }
      best = Math.min(best, cost);
      return;
    }
    for (let level = 0; level < n; level++) {
      assignment[i] = level;
      visit(i + 1);
    }
  };
  visit(0);
  return best;
}

function isConnected(g, nodes) {
  const seen = new Set([nodes[0]]);
  const queue = [nodes[0]];
  for (let i = 0; i < queue.length; i++) {
    for (const e of queue[i].Edges) {
      const adj = queue[i].adjacent(e);
      if (!seen.has(adj)) {
        seen.add(adj);
        queue.push(adj);
      }
    }
  }
  return seen.size === nodes.length && g.Edges.length > 0;
}

function guard() {
  return new OptimizationWorkGuard(bg, 'test', MAX_OPTIMIZATION_WORK_UNITS);
}

describe('rankDAG correctness', () => {
  it('finds optimal ranks', () => {
    const [g] = newDirectedGraph(5, [[0, 1], [0, 2], [0, 4], [1, 3], [2, 3], [2, 4]]);
    expect(rankCost(g, rankDAG(bg, g).nodeToLevel)).toBe(7);
  });

  it('improves longest path through a simplex exchange', () => {
    const [g, nodes] = newDirectedGraph(4, [[0, 3], [1, 2], [2, 3]]);
    const result = rankDAG(bg, g);
    expect(rankCost(g, result.nodeToLevel)).toBe(3);
    expect(levelsOf(nodes, result.nodeToLevel)).toEqual([1, 0, 1, 2]);
  });

  it('uses the deterministic normalized optimum', () => {
    const [g, nodes] = newDirectedGraph(5, [[0, 1], [1, 2], [2, 3], [0, 4], [4, 3]]);
    expect(levelsOf(nodes, rankDAG(bg, g).nodeToLevel)).toEqual([0, 1, 2, 3, 1]);
  });

  it('keeps the simplex basis tie without a secondary postpass', () => {
    const [g, nodes] = newDirectedGraph(6, [[0, 1], [2, 3], [4, 0], [4, 3], [5, 1], [5, 2]]);
    expect(levelsOf(nodes, rankDAG(bg, g).nodeToLevel)).toEqual([2, 3, 1, 2, 1, 0]);
  });

  it('certifies the tree flow and rejects a nonoptimal tree', () => {
    const [g] = newDirectedGraph(4, [[0, 1], [0, 2], [0, 3], [1, 3], [2, 3]]);
    [2, 1, 1, 1, 3].forEach((w, i) => setHierarchyRankWeight(g.Edges[i], w));
    const wg = guard();
    const problem = newRankProblem(g, wg);
    const levels = longestPathLevels(problem, wg);
    const solver = newRankSimplex(problem, wg);
    const tree = feasibleTree(solver, levels, wg);
    // The longest-path tight tree is not optimal for these weights.
    const { err } = capture(() => certify(solver, levels, tree, wg));
    expect(err).not.toBeNull();
    expect(chainHas(err, ErrViolation)).toBe(true);
    optimize(solver, levels, tree, wg);
    expect(certify(solver, levels, tree, wg)).toBeGreaterThan(0);
  });

  it('handles a degenerate pivot with Bland order', () => {
    const [g] = newDirectedGraph(5, [[0, 1], [0, 2], [1, 3], [1, 4], [2, 3], [2, 4]]);
    [1, 1, 1, 1, 2, 2].forEach((w, i) => setHierarchyRankWeight(g.Edges[i], w));
    const wg = guard();
    const problem = newRankProblem(g, wg);
    const levels = longestPathLevels(problem, wg);
    const original = levels.slice();
    const solver = newRankSimplex(problem, wg);
    const tree = feasibleTree(solver, levels, wg);
    computeCutValues(solver, tree, wg);
    let leaving = -1;
    for (const edgeIndex of problem.pivotOrder) {
      if (tree[edgeIndex] && solver.scratch.cutValue[edgeIndex] < 0) {
        leaving = edgeIndex;
        break;
      }
    }
    expect(problem.edges[leaving].id).toBe(2n);
    computeHeadComponent(solver, tree, leaving, wg);
    const eligible = [];
    for (const edgeIndex of problem.pivotOrder) {
      const edge = problem.edges[edgeIndex];
      if (tree[edgeIndex] || !solver.scratch.head[edge.from] || solver.scratch.head[edge.to]) continue;
      if (rankSlack(edge, levels) === 0) eligible.push(edge.id);
    }
    expect(eligible).toEqual([5n, 6n]);
    optimize(solver, levels, tree, wg);
    expect(levels).toEqual(original);
    problem.edges.forEach((edge, i) => {
      if (edge.id === 5n) expect(tree[i]).toBe(true);
      if (edge.id === 6n) expect(tree[i]).toBe(false);
    });
    certify(solver, levels, tree, wg);
  });

  it('preserves parallel-edge rank weight through makeSimpleDAG', () => {
    const edges = [[0, 1], [1, 2], [2, 3], [0, 4]];
    for (let i = 0; i < 10; i++) edges.push([4, 3]);
    const [g, nodes] = newDirectedGraph(5, edges);
    const dag = makeSimpleDAG(bg, g);
    const levels = mapDAGToGraphLevels(g, rankDAG(bg, dag).nodeToLevel);
    expect(rankCost(g, levels)).toBe(15);
    expect(nodes.every((n) => levels.has(n))).toBe(true);
  });

  it('finds optimal ranks for every small connected DAG', () => {
    for (let nodeCount = 2; nodeCount <= 4; nodeCount++) {
      const pairs = [];
      for (let from = 0; from < nodeCount; from++) {
        for (let to = from + 1; to < nodeCount; to++) pairs.push([from, to]);
      }
      for (let mask = 1; mask < (1 << pairs.length); mask++) {
        const edges = pairs.filter((_, i) => mask & (1 << i));
        const [g, nodes] = newDirectedGraph(nodeCount, edges);
        if (!isConnected(g, nodes)) continue;
        expect(rankCost(g, rankDAG(bg, g).nodeToLevel)).toBe(minimumRankCost(g, nodes));
      }
    }
  });

  it('finds optimal ranks for random weighted DAGs', () => {
    const rng = new GoRand(46);
    for (let trial = 0; trial < 60; trial++) {
      const nodeCount = 3 + Number(rng.Int63() % 3n);
      const edges = [];
      for (let to = 1; to < nodeCount; to++) edges.push([Number(rng.Int63() % BigInt(to)), to]);
      for (let from = 0; from < nodeCount; from++) {
        for (let to = from + 1; to < nodeCount; to++) {
          if (rng.Int63() % 3n === 0n && !edges.some(([a, b]) => a === from && b === to)) edges.push([from, to]);
        }
      }
      const [g, nodes] = newDirectedGraph(nodeCount, edges);
      for (const e of g.Edges) setHierarchyRankWeight(e, 1 + Number(rng.Int63() % 5n));
      expect(rankCost(g, rankDAG(bg, g).nodeToLevel)).toBe(minimumRankCost(g, nodes));
    }
  });

  it('is independent of input slice order', () => {
    const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [2, 3], [2, 4]];
    const [g, nodes] = newDirectedGraph(5, edges);
    const want = levelsOf(nodes, rankDAG(bg, g).nodeToLevel);
    g.Nodes.reverse();
    g.Edges.reverse();
    for (const n of g.Nodes) n.Edges.reverse();
    expect(levelsOf(nodes, rankDAG(bg, g).nodeToLevel)).toEqual(want);
  });

  it('rejects cycles, invalid weights, and disconnected input', () => {
    const [cyclic] = newDirectedGraph(3, [[0, 1], [1, 2], [2, 0]]);
    expect(capture(() => rankDAG(bg, cyclic)).err.message).toBe('TALA RankDAG failed: input graph contains a directed cycle');
    for (const weight of [0, -1, 50_001]) {
      const [g] = newDirectedGraph(2, [[0, 1]]);
      setHierarchyRankWeight(g.Edges[0], weight);
      expect(capture(() => rankDAG(bg, g)).err.message).toBe(`TALA RankDAG failed: edge 1 has invalid rank weight ${weight}`);
    }
    const [disconnected] = newDirectedGraph(2, []);
    expect(capture(() => rankDAG(bg, disconnected)).err.message).toBe('TALA RankDAG failed: input graph is disconnected');
    const empty = rankDAG(bg, new Graph());
    expect(empty.levelCount).toBe(0);
    expect(empty.nodeToLevel.size).toBe(0);
    expect(capture(() => rankDAG(bg, null)).err.message).toBe('TALA RankDAG failed: graph is required');
  });
});

describe('rankDAG resource limits', () => {
  it('low limit is non-vacuous', () => {
    const [g] = newDirectedGraph(2, [[0, 1]]);
    const { err } = capture(() => rankDAGWithLimit(bg, g, 2n));
    expect(isOptimizationResourceLimitError(err)).toBe(true);
    expect(err.message).toBe('TALA optimization resource limit exceeded: TALA RankDAG work exceeds limit 2');
  });

  it('observes cancellation before and during validation', () => {
    const [g] = newDirectedGraph(1, []);
    const canceled = countingContext(1);
    const before = capture(() => rankDAG(canceled, g)).err;
    expect(before.message).toBe('TALA RankDAG failed: RankDAG: context canceled');
    expect(chainHas(before, canceled.canceled)).toBe(true);
    const during = countingContext(2);
    expect(capture(() => rankDAG(during, g)).err.message).toBe('TALA RankDAG failed: RankDAG: context canceled');
  });

  it('propagates a context panic without wrapping it', () => {
    const [g] = newDirectedGraph(2, [[0, 1]]);
    const { err } = capture(() => rankDAG(countingContext(0, 1), g));
    expect(err.message).toBe('s46 injected panic');
  });

  it('hostile depth is iterative (10,000-node reversed chain)', () => {
    const g = new Graph();
    const nodes = [];
    for (let i = 0; i < MAX_ENGINE_NODES; i++) {
      nodes.push(new Node(BigInt(i + 1), 10, 10));
      g.addNodeUnchecked(nodes[i]);
      if (i > 0) {
        const edge = g.connect(nodes[i - 1], nodes[i]);
        edge.TargetArrowhead = 'triangle';
        edge.ID = BigInt(i);
      }
    }
    g.Nodes.reverse();
    const result = rankDAG(bg, g);
    expect(result.levelCount).toBe(MAX_ENGINE_NODES);
    expect(result.nodeToLevel.get(nodes[0])).toBe(0);
    expect(result.nodeToLevel.get(nodes[MAX_ENGINE_NODES - 1])).toBe(MAX_ENGINE_NODES - 1);
  });

  it('has no topology-independent iteration cap (250 nodes, 1000 weighted edges)', () => {
    const g = new Graph();
    const nodes = [];
    for (let i = 0; i < 250; i++) {
      nodes.push(new Node(BigInt(i + 1), 10, 10));
      g.addNodeUnchecked(nodes[i]);
    }
    const connect = (from, to) => {
      const edge = g.connect(nodes[from], nodes[to]);
      edge.ID = BigInt(g.Edges.length);
      edge.TargetArrowhead = 'triangle';
      setHierarchyRankWeight(edge, 1 + (g.Edges.length % 97));
    };
    for (let i = 0; i + 1 < 250; i++) connect(i, i + 1);
    for (let span = 2; g.Edges.length < 1000; span++) {
      for (let from = 0; from + span < 250 && g.Edges.length < 1000; from++) connect(from, from + span);
    }
    const result = rankDAG(bg, g);
    expect(result.levelCount).toBe(250);
    for (const edge of g.Edges) {
      expect(result.nodeToLevel.get(edge.To) - result.nodeToLevel.get(edge.From)).toBeGreaterThanOrEqual(1);
    }
  });
});
