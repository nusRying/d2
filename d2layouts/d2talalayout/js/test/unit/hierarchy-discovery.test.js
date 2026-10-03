// Slice 46 — ports of internal/hierarchy discovery_test.go,
// discovery_correctness_test.go, flow_rules_test.go,
// fixed_hierarchy_correctness_test.go and self_loop_correctness_test.go.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { newHierarchy } from '../../src/graph/hierarchy.js';
import { hierarchyRankWeight } from '../../src/graph/structural-access.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { assign, candidates, place } from '../../src/hierarchy/index.js';
import {
  build,
  countEdgeDirection,
  findCycleEdges,
  isValid,
  makeSimpleDAG,
  removeDuplicateEdges,
} from '../../src/hierarchy/discovery.js';
import { isEligibleContainer } from '../../src/hierarchy/eligibility.js';
import { isSink, isSource, newPlacementNode } from '../../src/hierarchy/placement.js';
import { bg, capture, chainHas, countingContext } from './hierarchy-fixtures.js';

function hierarchyWithLevels(entries) {
  const h = newHierarchy();
  h.ReplaceLevels(new Map(entries));
  return h;
}

function connectDirected(g, from, to) {
  const e = g.connect(from, to);
  e.TargetArrowhead = 'triangle';
  return e;
}

function flowRuleGraph(count, edges) {
  const g = new Graph();
  for (let i = 0; i < count; i++) g.addNode(new Node(BigInt(i + 1), 100, 60));
  edges.forEach(([a, b], i) => {
    const e = g.connect(g.Nodes[a], g.Nodes[b]);
    e.ID = BigInt(count + i + 1);
    e.SourceArrowhead = 'none';
    e.TargetArrowhead = 'triangle';
  });
  return g;
}

function reverseAuthoredEndpoints(g) {
  for (const e of g.Edges) {
    const from = e.From;
    e.From = e.To;
    e.To = from;
    e.SourceArrowhead = 'triangle';
    e.TargetArrowhead = 'none';
  }
}

function automaticHierarchyGraph() {
  const g = new Graph();
  const nodes = [];
  for (let i = 0; i < 8; i++) {
    nodes.push(new Node(BigInt(i + 1), 100, 100));
    g.addNewNodeToContainer(null, nodes[i]);
  }
  for (const [a, b] of [[0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6], [4, 7], [5, 7], [6, 7]]) {
    connectDirected(g, nodes[a], nodes[b]);
  }
  return [g, nodes];
}

function expectSharedHierarchy(nodes) {
  const h = nodes[0].Hierarchy;
  expect(h).not.toBeNull();
  for (const n of nodes) expect(n.Hierarchy).toBe(h);
}

describe('flow rules (build)', () => {
  const workflow = [[0, 1], [1, 2], [2, 3], [2, 4], [3, 5], [4, 5], [5, 6], [6, 7], [1, 7], [3, 7], [4, 7]];
  const chain = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]];
  const cases = [
    ['branched_workflow', 8, workflow, null, false, true],
    ['left_arrow_workflow', 8, workflow, reverseAuthoredEndpoints, false, true],
    ['multiple_entry_workflow', 9, [...workflow, [8, 2]], null, false, false],
    ['multiple_exit_workflow', 9, [...workflow, [5, 8]], null, false, false],
    ['feedback_workflow', 8, [...workflow, [4, 2]], null, false, false],
    ['plain_chain', 8, chain, null, false, false],
    ['chain_with_parallel_arrows_and_loops', 8, [...chain, [2, 3], [0, 0], [7, 7]], null, false, false],
    ['forced_chain', 8, chain, null, true, true],
    ['fanin', 3, [[0, 2], [1, 2]], null, false, false],
    ['fanout', 3, [[0, 1], [0, 2]], null, false, false],
    ['left_arrow_fanin', 3, [[0, 2], [1, 2]], reverseAuthoredEndpoints, false, false],
    ['fan_with_parallel_arrows_and_loops', 3, [[0, 2], [1, 2], [0, 2], [0, 0], [2, 2]], null, false, false],
    ['pair_with_parallel_arrows', 2, [[0, 1], [0, 1], [0, 1]], null, false, false],
    ['two_by_two_is_not_a_fan', 4, [[0, 2], [0, 3], [1, 2], [1, 3]], null, false, false],
    ['undirected_fan', 3, [[0, 2], [1, 2]], (g) => { g.Edges[0].TargetArrowhead = 'none'; }, false, false],
    ['bidirectional_fan', 3, [[0, 2], [1, 2]], (g) => { g.Edges[0].SourceArrowhead = 'triangle'; }, false, false],
    ['one_many_one_retained', 4, [[0, 1], [0, 2], [1, 3], [2, 3]], null, false, false],
    ['wide_fan_retained', 10, [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]], null, false, false],
    ['dense_fan_retained', 3, [[0, 2], [0, 2], [0, 2], [1, 2], [1, 2]], null, false, false],
  ];
  for (const [name, count, edges, mutate, force, want] of cases) {
    it(name, () => {
      const g = flowRuleGraph(count, edges);
      if (mutate) mutate(g);
      expect(build(bg, g, force, candidates(g), null) != null).toBe(want);
    });
  }

  it('cancellation', () => {
    const g = flowRuleGraph(3, [[0, 2], [1, 2]]);
    const ctx = countingContext(1);
    const { err } = capture(() => build(ctx, g, false, candidates(g), null));
    expect(chainHas(err, ctx.canceled)).toBe(true);
  });

  it('automatic workflow bounds', () => {
    const cases2 = [
      [128, 0, 0, 0, true], [129, 0, 0, 0, false], [126, 2, 0, 0, true], [127, 2, 0, 0, false],
      [128, 0, 128, 0, true], [128, 0, 129, 0, false], [128, 0, 128, 3, true],
    ];
    for (const [nodes, descendants, parallel, loops, want] of cases2) {
      let edges = [[0, 1], [0, 2], [1, 3], [2, 3]];
      for (let i = 3; i < nodes - 1; i++) edges.push([i, i + 1]);
      const original = edges.slice();
      for (let i = 0; i < parallel; i++) edges.push(original[i % original.length]);
      for (let i = 0; i < loops; i++) edges.push([0, 0]);
      const g = flowRuleGraph(nodes, edges);
      if (descendants !== 0) {
        const container = g.Nodes[3];
        const children = [];
        for (let i = 0; i < descendants; i++) children.push(new Node(BigInt(nodes + edges.length + i + 1), 30, 30));
        g.Containers.set(container, children);
        container.isContainer = true;
        for (const child of children) child.Container = container;
      }
      const levels = new Map();
      g.Nodes.forEach((n, i) => levels.set(n, i === 1 ? 1 : Math.max(0, i - 1)));
      const h = newHierarchy();
      h.ReplaceLevels(levels);
      h.LevelCount = nodes - 1;
      expect(isValid(h, g, null, 1, 1)).toBe(want);
    }
  });

  it('preserves ordinary compact hierarchies above workflow limits', () => {
    const levels = 12;
    const columns = 12;
    const edges = [];
    for (let level = 0; level < levels - 1; level++) {
      for (let column = 0; column < columns; column++) edges.push([level * columns + column, (level + 1) * columns + column]);
    }
    for (let column = 0; column < columns - 1; column++) edges.push([column, column + 1]);
    const g = flowRuleGraph(levels * columns, edges);
    const h = newHierarchy();
    h.ReplaceLevels(new Map(g.Nodes.map((n, i) => [n, Math.trunc(i / columns)])));
    h.LevelCount = levels;
    expect(isValid(h, g, null, 1, columns)).toBe(true);
  });

  it('screens the automatic workflow minimum extent', () => {
    const edges = [[0, 1], [0, 2], [1, 3], [2, 3]];
    for (let i = 3; i < 80; i++) edges.push([i, i + 1]);
    for (const [direction, width, height, force, want] of [
      [Orientation.Bottom, 80, 300, false, false],
      [Orientation.Right, 300, 80, false, false],
      [Orientation.Bottom, 300, 80, false, true],
      [Orientation.Right, 80, 300, false, true],
      [Orientation.Bottom, 80, 300, true, true],
    ]) {
      const g = flowRuleGraph(81, edges);
      g.Directions.set(null, direction);
      for (const n of g.Nodes) {
        n.Width = width;
        n.Height = height;
      }
      expect(build(bg, g, force, candidates(g), null) != null).toBe(want);
    }
  });
});

describe('1-N-1 and assignment', () => {
  function oneManyOne(full) {
    const g = new Graph();
    for (let i = 0; i < 8; i++) g.addNewNodeToContainer(null, new Node(BigInt(i), 50, 50));
    for (let i = 1; i < 7; i++) {
      connectDirected(g, g.Nodes[0], g.Nodes[i]).SourceArrowhead = 'none';
      if (full || i % 2 === 0) connectDirected(g, g.Nodes[i], g.Nodes[7]).SourceArrowhead = 'none';
    }
    return g;
  }

  it('ignores 1-N-1 hierarchies', () => {
    const g = oneManyOne(true);
    assign(bg, g, null, candidates(g));
    for (const n of g.Nodes) expect(n.Hierarchy).toBeNull();
  });

  it('accepts a partial 1-N-1', () => {
    const g = oneManyOne(false);
    assign(bg, g, null, candidates(g));
    for (const n of g.Nodes) expect(n.Hierarchy).not.toBeNull();
  });

  it('recomputes derived membership on repeated layouts', () => {
    const [g, nodes] = automaticHierarchyGraph();
    assign(bg, g, null, candidates(g));
    expectSharedHierarchy(nodes);
    const first = nodes[0].Hierarchy;
    assign(bg, g, null, candidates(g));
    expectSharedHierarchy(nodes);
    expect(nodes[0].Hierarchy).not.toBe(first);
    expect(first.Levels().size).toBe(0);
  });

  it('late cancellation rolls back every component', () => {
    const g = new Graph();
    g.IsRootHierarchy = true;
    const components = [];
    for (const base of [10, 20]) {
      const comp = [];
      for (let i = 0; i < 3; i++) {
        const n = new Node(BigInt(base + i), 20, 20);
        n.TopLeft = new Point(base * 10 + i * 30, base);
        g.addNewNodeToContainer(null, n);
        comp.push(n);
      }
      for (let i = 1; i < 3; i++) connectDirected(g, comp[i - 1], comp[i]);
      components.push(comp);
    }
    const all = (nodes, assigned) => nodes.every((n) => (n.Hierarchy != null) === assigned);
    const canceled = new Error('context canceled');
    const ctx = {
      Err() {
        if ((all(components[0], true) && all(components[1], false)) || (all(components[1], true) && all(components[0], false))) {
          return canceled;
        }
        return null;
      },
    };
    const refs = g.Nodes.map((n) => [n.Graph, n.Edges.slice()]);
    const endpoints = g.Edges.map((e) => [e.From, e.To]);
    const { err } = capture(() => assign(ctx, g, null, candidates(g)));
    expect(chainHas(err, canceled)).toBe(true);
    g.Nodes.forEach((n, i) => {
      expect(n.Hierarchy).toBeNull();
      expect(n.Graph).toBe(refs[i][0]);
      expect(n.Edges).toEqual(refs[i][1]);
    });
    g.Edges.forEach((e, i) => expect([e.From, e.To]).toEqual(endpoints[i]));
  });
});

describe('fixed hierarchy', () => {
  it('keeps an unrelated forced component and does not move a fixed isolate', () => {
    const g = new Graph();
    g.IsRootHierarchy = true;
    const chain = [1, 2, 3].map((id) => new Node(BigInt(id), 40, 30));
    for (const n of chain) g.addNewNodeToContainer(null, n);
    connectDirected(g, chain[0], chain[1]);
    connectDirected(g, chain[1], chain[2]);
    const fixed = new Node(10n, 40, 30);
    fixed.TopLeft = new Point(700, 350);
    fixed.FixedTopLeft = fixed.TopLeft.copy();
    g.addNewNodeToContainer(null, fixed);
    assign(bg, g, null, candidates(g));
    for (const n of chain) expect(n.Hierarchy).not.toBeNull();
    expect(fixed.Hierarchy).toBeNull();
    place(bg, g, null, new GoRand(1));
    expect([fixed.TopLeft.X, fixed.TopLeft.Y]).toEqual([700, 350]);
  });

  it('keeps an unrelated automatic component', () => {
    const g = new Graph();
    const nodes = [];
    for (let i = 0; i < 8; i++) {
      nodes.push(new Node(BigInt(i + 1), 40, 30));
      g.addNewNodeToContainer(null, nodes[i]);
    }
    for (const [a, b] of [[0, 2], [1, 3], [2, 4], [3, 5], [2, 5], [4, 6], [5, 7]]) connectDirected(g, nodes[a], nodes[b]);
    const fixed = new Node(20n, 40, 30);
    fixed.TopLeft = new Point(700, 350);
    fixed.FixedTopLeft = fixed.TopLeft.copy();
    g.addNewNodeToContainer(null, fixed);
    assign(bg, g, null, candidates(g));
    expectSharedHierarchy(nodes);
    expect(fixed.Hierarchy).toBeNull();
  });

  it('does not move a fixed descendant', () => {
    const g = new Graph();
    const container = new Node(1n, 200, 160);
    container.TopLeft = new Point(100, 100);
    const peer = new Node(2n, 50, 40);
    peer.TopLeft = new Point(500, 100);
    const fixedChild = new Node(3n, 50, 40);
    fixedChild.TopLeft = new Point(130, 130);
    fixedChild.FixedTopLeft = fixedChild.TopLeft.copy();
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(null, peer);
    g.addNewNodeToContainer(container, fixedChild);
    connectDirected(g, container, peer);
    const h = hierarchyWithLevels([[container, 0], [fixedChild, 0], [peer, 1]]);
    container.Hierarchy = h;
    fixedChild.Hierarchy = h;
    peer.Hierarchy = h;
    place(bg, g, null, new GoRand(1));
    expect([fixedChild.TopLeft.X, fixedChild.TopLeft.Y]).toEqual([130, 130]);
  });

  it('rejects a container with a fixed descendant', () => {
    const g = new Graph();
    g.IsRootHierarchy = true;
    const container = new Node(1n, 200, 160);
    const peer = new Node(2n, 50, 40);
    const fixedChild = new Node(3n, 50, 40);
    fixedChild.TopLeft = new Point(130, 130);
    fixedChild.FixedTopLeft = fixedChild.TopLeft.copy();
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(null, peer);
    g.addNewNodeToContainer(container, fixedChild);
    connectDirected(g, container, peer);
    assign(bg, g, null, candidates(g));
    for (const n of [container, peer, fixedChild]) expect(n.Hierarchy).toBeNull();
  });
});

describe('self loops', () => {
  it('edge direction ignores self loops', () => {
    const g = new Graph();
    const a = g.addNode(new Node(1n, 10, 10));
    const b = g.addNode(new Node(2n, 10, 10));
    connectDirected(g, a, b);
    connectDirected(g, a, a);
    expect(countEdgeDirection(hierarchyWithLevels([[a, 0], [b, 1]]), g)).toEqual([1, 0]);
    expect(newPlacementNode(0, a).degree()).toBe(1);
  });

  it('classification ignores source and repeated self loops', () => {
    {
      const [g, nodes] = automaticHierarchyGraph();
      connectDirected(g, nodes[0], nodes[0]);
      assign(bg, g, null, candidates(g));
      expectSharedHierarchy(nodes);
    }
    {
      const [g, nodes] = automaticHierarchyGraph();
      for (const n of nodes) connectDirected(g, n, n);
      assign(bg, g, null, candidates(g));
      expectSharedHierarchy(nodes);
    }
    {
      const [g, nodes] = automaticHierarchyGraph();
      for (let i = 0; i < 5; i++) connectDirected(g, nodes[1], nodes[1]);
      assign(bg, g, null, candidates(g));
      expectSharedHierarchy(nodes);
    }
  });

  it('a hierarchical container ignores a descendant self loop', () => {
    const [g, nodes] = automaticHierarchyGraph();
    nodes[0].Height = 40;
    const child = new Node(9n, 20, 10);
    g.addNewNodeToContainer(nodes[0], child);
    connectDirected(g, child, child);
    expect(isEligibleContainer(g, nodes[0])).toBe(true);
    assign(bg, g, null, candidates(g));
    expectSharedHierarchy(nodes);
  });

  it('1-N-1 classification ignores self-loop order', () => {
    for (const [loopNode, loopFirst] of [[1, true], [1, false], [0, true]]) {
      const g = new Graph();
      const nodes = [];
      for (let i = 0; i < 5; i++) {
        nodes.push(new Node(BigInt(i + 1), 100, 100));
        g.addNewNodeToContainer(null, nodes[i]);
      }
      if (loopFirst) connectDirected(g, nodes[loopNode], nodes[loopNode]);
      for (let middle = 1; middle <= 3; middle++) {
        connectDirected(g, nodes[0], nodes[middle]);
        connectDirected(g, nodes[middle], nodes[4]);
      }
      if (!loopFirst) connectDirected(g, nodes[loopNode], nodes[loopNode]);
      assign(bg, g, null, candidates(g));
      for (const n of nodes) expect(n.Hierarchy).toBeNull();
    }
  });
});

describe('simple DAG preparation', () => {
  it('makes a simple DAG from mixed arrowheads and ignores loops', () => {
    const g = new Graph();
    const a = g.addNode(new Node(1n, 11, 11));
    a.D2ID = 'a';
    const b = g.addNode(new Node(2n, 12, 12));
    b.D2ID = 'b';
    const c = g.addNode(new Node(3n, 13, 13));
    c.D2ID = 'c';
    g.connect(a, b);
    const bc = g.connect(b, c);
    bc.SourceArrowhead = 'triangle';
    bc.TargetArrowhead = 'triangle';
    const ca = g.connect(c, a);
    ca.SourceArrowhead = 'none';
    ca.TargetArrowhead = 'triangle';
    g.connect(a, a);
    const dag = makeSimpleDAG(bg, g);
    expect(dag.Nodes.length).toBe(3);
    expect(dag.Edges.length).toBe(3);
    g.Nodes.forEach((n, i) => {
      expect(dag.Nodes[i].ID).toBe(n.ID);
      expect(dag.Nodes[i].D2ID).toBe(n.D2ID);
      expect(dag.Nodes[i].Width).toBe(n.Width);
      expect(dag.Nodes[i].Edges.length).toBe(2);
    });
    expect(dag.Nodes.some(isSource)).toBe(true);
    expect(dag.Nodes.some(isSink)).toBe(true);
    for (const e of dag.Edges) {
      expect(e.ID).not.toBe(0n);
      expect(e.isDirected()).toBe(true);
    }
  });

  it('removes duplicate edges and sums their weights', () => {
    const g = new Graph();
    const a = g.addNode(new Node(1n, 10, 10));
    const b = g.addNode(new Node(2n, 10, 10));
    const c = g.addNode(new Node(3n, 10, 10));
    g.connect(a, c);
    g.connect(a, b);
    g.connect(a, b);
    removeDuplicateEdges(bg, g);
    expect(g.Edges.length).toBe(2);
    expect([a.Edges.length, b.Edges.length, c.Edges.length]).toEqual([2, 1, 1]);
    expect(hierarchyRankWeight(g.Edges[1])).toBe(2);
  });

  it('cancellation preserves the graph and weights', () => {
    const g = new Graph();
    const a = g.addNode(new Node(1n, 10, 10));
    const b = g.addNode(new Node(2n, 10, 10));
    const first = g.connect(a, b);
    const second = g.connect(a, b);
    const wantEdges = g.Edges.slice();
    const wantIncident = a.Edges.slice();
    const { err } = capture(() => removeDuplicateEdges(countingContext(2), g));
    expect(err).not.toBeNull();
    expect(g.Edges).toEqual(wantEdges);
    expect(a.Edges).toEqual(wantIncident);
    expect(hierarchyRankWeight(first)).toBe(1);
    expect(hierarchyRankWeight(second)).toBe(1);
  });

  it('keeps one rank-weight unit per authored edge', () => {
    const g = new Graph();
    const a = g.addNode(new Node(1n, 10, 10));
    const b = g.addNode(new Node(2n, 10, 10));
    for (const [src, dst] of [['none', 'triangle'], ['none', 'triangle'], ['triangle', 'none'], ['none', 'none'], ['triangle', 'triangle']]) {
      const e = g.connect(a, b);
      e.SourceArrowhead = src;
      e.TargetArrowhead = dst;
    }
    g.connect(a, a);
    const dag = makeSimpleDAG(bg, g);
    expect(dag.Edges.length).toBe(1);
    expect(hierarchyRankWeight(dag.Edges[0])).toBe(5);
    for (const [src, dst] of [['none', 'none'], ['triangle', 'triangle']]) {
      for (const reverse of [false, true]) {
        const g2 = new Graph();
        const x = g2.addNode(new Node(1n, 10, 10));
        const y = g2.addNode(new Node(2n, 10, 10));
        const e = reverse ? g2.connect(y, x) : g2.connect(x, y);
        e.SourceArrowhead = src;
        e.TargetArrowhead = dst;
        const d = makeSimpleDAG(bg, g2);
        expect(d.Edges.length).toBe(1);
        expect(hierarchyRankWeight(d.Edges[0])).toBe(1);
      }
    }
  });

  it('respects source arrow direction', () => {
    const g = new Graph();
    const a = g.addNode(new Node(1n, 10, 10));
    const b = g.addNode(new Node(2n, 10, 10));
    const e = g.connect(a, b);
    e.SourceArrowhead = 'triangle';
    e.TargetArrowhead = 'none';
    expect(countEdgeDirection(hierarchyWithLevels([[b, 0], [a, 1]]), g)).toEqual([1, 0]);
    const dag = makeSimpleDAG(bg, g);
    expect(dag.Edges.length).toBe(1);
    expect([dag.Edges[0].From.ID, dag.Edges[0].To.ID]).toEqual([2n, 1n]);
  });

  it('finds the two cycle edges', () => {
    const g = new Graph();
    for (let i = 0; i < 12; i++) g.addNode(new Node(BigInt(i), 10, 10));
    const connect = (i, j) => {
      const e = g.connect(g.Nodes[i], g.Nodes[j]);
      e.SourceArrowhead = 'none';
      e.TargetArrowhead = 'triangle';
      return e;
    };
    for (const [i, j] of [[11, 8], [11, 9], [11, 10], [8, 7], [9, 7], [10, 5], [7, 6], [7, 3], [7, 4], [6, 3], [6, 4], [3, 8], [3, 2], [4, 9], [4, 2], [5, 0], [1, 0], [2, 0]]) {
      connect(i, j);
    }
    const e87 = g.Edges[3];
    const e97 = g.Edges[4];
    const cycles = findCycleEdges(bg, g);
    expect(cycles.size).toBe(2);
    expect(cycles.has(e87)).toBe(true);
    expect(cycles.has(e97)).toBe(true);
  });

  it('MakeSimpleDAG observes mid-loop cancellation', () => {
    const g = new Graph();
    for (let i = 0; i < 130; i++) {
      const n = new Node(BigInt(i + 1), 10, 10);
      n.TopLeft = new Point(i * 20, 0);
      g.addNodeUnchecked(n);
    }
    const { err } = capture(() => makeSimpleDAG(countingContext(2), g));
    expect(err.message).toBe('MakeSimpleDAG: context canceled');
  });
});
