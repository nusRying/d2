// Slice 46 — ports of internal/hierarchy crossing_test.go, sifting_test.go,
// flow_test.go, brandes_kopf_test.go, placement_test.go, compound_test.go,
// atomicity_test.go and orientation behavior.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { newHierarchy } from '../../src/graph/hierarchy.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { assign, candidates, isHorizontal, place, placeCompound } from '../../src/hierarchy/index.js';
import {
  addLengths,
  allDescendants,
  bestIndexBySwappingNeighbors,
  computeLevelRanks,
  countCrossings,
  crossLevelSegments,
  initializeRanks,
  minimizeHierarchyCrossings,
  sortLevelNodesByAdjacencyPosition,
} from '../../src/hierarchy/crossing.js';
import { buildNodeToSiblings, nodesInDescendingDegreeOrder, sifting } from '../../src/hierarchy/sifting.js';
import {
  createAlignmentNodes,
  markConflicts,
  median,
  placeBlock,
  verticalAlignment,
} from '../../src/hierarchy/brandes-kopf.js';
import {
  breakLongConnections,
  connectPlacementNodes,
  createPlacementNodes,
  groupPlacementNodesByLevel,
  newPlacementNode,
  removeTableColumnNodes,
} from '../../src/hierarchy/placement.js';
import { compoundInterfaceScore, orderCompoundInterfaces } from '../../src/hierarchy/compound.js';
import { SIBLING_SPACING } from '../../src/hierarchy/constants.js';
import { bg, capture, chainHas, countingContext } from './hierarchy-fixtures.js';

function withHierarchy(g, entries) {
  const h = newHierarchy();
  for (const [n, level] of entries) {
    h.Levels().set(n, level);
    n.Hierarchy = h;
  }
  return h;
}

function byLevelFor(g) {
  const pns = createPlacementNodes(g, g.Nodes, null);
  connectPlacementNodes(g, pns);
  const byLevel = groupPlacementNodesByLevel(pns);
  initializeRanks(byLevel);
  return [pns, byLevel];
}

function abcdef() {
  const g = new Graph();
  const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map((id) => g.addNode(new Node(BigInt(id), 100, 100)));
  g.connect(a, d);
  g.connect(a, e);
  g.connect(a, f);
  g.connect(b, d);
  g.connect(c, d);
  withHierarchy(g, [[a, 0], [b, 0], [c, 0], [d, 1], [e, 1], [f, 1]]);
  return g;
}

describe('crossing minimization', () => {
  it('counts level crossings both ways', () => {
    const byLevel = new Map([
      [0, [newPlacementNode(0, null), newPlacementNode(0, null), newPlacementNode(0, null)]],
      [1, [newPlacementNode(1, null), newPlacementNode(1, null)]],
    ]);
    for (const nodes of byLevel.values()) nodes.forEach((pn, i) => { pn.rank = i; });
    const l0 = byLevel.get(0);
    const l1 = byLevel.get(1);
    l1[0].connect(l0[0]);
    l1[0].connect(l0[2]);
    l1[1].connect(l0[0]);
    l1[1].connect(l0[1]);
    expect(countCrossings(crossLevelSegments(l1, true, false))).toBe(2n);
    expect(countCrossings(crossLevelSegments(l0, false, true))).toBe(2n);
  });

  it('finds the best neighbor swap', () => {
    const [, byLevel] = byLevelFor(abcdef());
    const segments = crossLevelSegments(byLevel.get(0), true, true);
    const crossings = countCrossings(segments);
    const length = addLengths(segments);
    const [bestCrossings, bestLength, bestIndex] = bestIndexBySwappingNeighbors(byLevel.get(0), 0, byLevel);
    expect(bestCrossings < crossings).toBe(true);
    expect(bestLength).toBeLessThan(length);
    expect(bestIndex).toBe(2);
  });

  it('minimizes crossings to zero', () => {
    const [, byLevel] = byLevelFor(abcdef());
    minimizeHierarchyCrossings(byLevel);
    expect(countCrossings(crossLevelSegments(byLevel.get(0), true, true))).toBe(0n);
    expect(countCrossings(crossLevelSegments(byLevel.get(1), true, true))).toBe(0n);
  });

  it('collects descendants for optimization', () => {
    const pn1 = newPlacementNode(0, new Node(1n, 100, 100));
    const pn1C = newPlacementNode(0, new Node(2n, 100, 100));
    pn1.children.push(pn1C);
    pn1.optimizeChildrenCrossings = true;
    const pn2 = newPlacementNode(0, new Node(2n, 100, 100));
    const pn2C = newPlacementNode(0, new Node(2n, 100, 100));
    pn2.children.push(pn2C);
    pn2.optimizeChildrenCrossings = false;
    expect(allDescendants([pn1, pn2], false)).toEqual([pn1, pn2, pn1C, pn2C]);
    const optimized = allDescendants([pn1, pn2], true);
    expect(optimized.length).toBe(3);
    expect(optimized[2]).toBe(pn1C);
  });

  it('adjacency sort preserves ties', () => {
    const left = newPlacementNode(0, null);
    left.rank = 0;
    const middle = newPlacementNode(0, null);
    middle.rank = 1;
    const right = newPlacementNode(0, null);
    right.rank = 2;
    const firstEqual = newPlacementNode(1, null);
    firstEqual.connect(left);
    firstEqual.connect(right);
    const secondEqual = newPlacementNode(1, null);
    secondEqual.connect(middle);
    const noConnections = newPlacementNode(1, null);
    const nodes = [firstEqual, noConnections, secondEqual];
    sortLevelNodesByAdjacencyPosition(nodes, true);
    expect(nodes[0]).toBe(noConnections);
    expect(nodes[1]).toBe(firstEqual);
    expect(nodes[2]).toBe(secondEqual);
  });

  it('sifting never increases crossings', () => {
    for (const improveIfEqual of [false, true]) {
      const g = new Graph();
      const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map((id) => g.addNode(new Node(BigInt(id), 10, 10)));
      g.connect(a, f);
      g.connect(b, e);
      g.connect(c, d);
      withHierarchy(g, [[a, 0], [b, 0], [c, 0], [d, 1], [e, 1], [f, 1]]);
      const [, byLevel] = byLevelFor(g);
      const queue = nodesInDescendingDegreeOrder(byLevel);
      const siblingsOf = buildNodeToSiblings(queue, byLevel);
      let sawCrossing = false;
      for (const node of queue) {
        const siblings = siblingsOf.get(node);
        const before = countCrossings(crossLevelSegments(siblings, true, true));
        sawCrossing = sawCrossing || before > 0n;
        sifting(node, siblings, byLevel, improveIfEqual);
        expect(countCrossings(crossLevelSegments(siblings, true, true)) <= before).toBe(true);
      }
      expect(sawCrossing).toBe(true);
    }
  });

  it('computes ranks with an explicit stack (deep container nesting)', () => {
    let root = newPlacementNode(0, null);
    const top = root;
    for (let i = 0; i < 20_000; i++) {
      const child = newPlacementNode(0, null);
      root.children.push(child);
      root = child;
    }
    computeLevelRanks([top]);
    expect(root.rank).toBe(20_000);
  });
});

describe('four-pass median', () => {
  it('is centered and reflection invariant', () => {
    for (const [values, want] of [
      [[], 0], [[7], 7], [[4, -2], 1], [[5, 1, 3], 3], [[200, -100, 100, 0], 50],
      [[Number.MAX_VALUE, Number.MAX_VALUE], Number.MAX_VALUE],
    ]) {
      const before = values.slice();
      expect(median(values)).toBe(want);
      expect(median(values.map((x) => -x))).toBe(want === 0 ? 0 : -want);
      expect(values).toEqual(before);
    }
  });
});

function buildHierarchicalGraph() {
  const graph = new Graph();
  const specs = [[1, 50, 0, 0, 0], [2, 45, 100, 0, 0], [3, 50, 200, 0, 0], [4, 50, 0, 100, 1], [5, 30, 100, 100, 1], [6, 75, 0, 200, 2], [7, 50, 100, 200, 2]];
  const n = specs.map(([id, w, x, y]) => {
    const node = graph.addNode(new Node(BigInt(id), w, 50));
    node.TopLeft = new Point(x, y);
    return node;
  });
  withHierarchy(graph, specs.map((s, i) => [n[i], s[4]]));
  const [a, b, c, d, e, f, g] = n;
  graph.connect(a, d);
  graph.connect(b, d);
  graph.connect(c, e);
  graph.connect(c, g);
  graph.connect(d, f);
  graph.connect(d, g);
  const pns = createPlacementNodes(graph, graph.Nodes, null);
  connectPlacementNodes(graph, pns);
  const byLevel = groupPlacementNodesByLevel(pns);
  for (let l = 0; l < byLevel.size; l++) {
    byLevel.get(l).sort((x, y) => x.graphNode.TopLeft.X - y.graphNode.TopLeft.X);
  }
  initializeRanks(byLevel);
  return byLevel;
}

describe('Brandes–Köpf', () => {
  it('aligns vertically top-left', () => {
    const byLevel = buildHierarchicalGraph();
    const nodes = createAlignmentNodes(bg, byLevel, Orientation.Top, Orientation.Left);
    const [a, b, c, d, e, f, g] = nodes;
    verticalAlignment(bg, nodes, markConflicts(bg, byLevel), Orientation.Left);
    expect([a.root, b.root, c.root, d.root, e.root, f.root, g.root]).toEqual([a, b, c, a, c, a, g]);
    expect([a.alignedWith, b.alignedWith, c.alignedWith, d.alignedWith, e.alignedWith, f.alignedWith, g.alignedWith])
      .toEqual([d, b, e, f, c, a, g]);
    expect(a.blockSize).toBe(75);
  });

  it('places a top-left block', () => {
    const byLevel = buildHierarchicalGraph();
    const nodes = createAlignmentNodes(bg, byLevel, Orientation.Top, Orientation.Left);
    const [a, b, c, d, e, f, g] = nodes;
    verticalAlignment(bg, nodes, markConflicts(bg, byLevel), Orientation.Left);
    placeBlock(c, Orientation.Left, new WorkGuard(bg, 'test', 1_000_000n));
    expect(a.x).toBe(0);
    expect(b.x).toBe(a.x + a.blockSize + SIBLING_SPACING);
    expect(c.x).toBe(b.x + b.blockSize + SIBLING_SPACING);
    for (const n of [d, e, f, g]) expect(n.x).toBe(-Infinity);
    expect([a.sink, b.sink, c.sink, d.sink]).toEqual([a, a, a, d]);
    for (const n of nodes) expect(n.shift).toBe(Infinity);
  });

  it('marks type 0 and type 1 conflicts', () => {
    {
      const g = new Graph();
      const [a, b, c, d] = [1, 2, 3, 4].map((id) => g.addNode(new Node(BigInt(id), 10, 10)));
      withHierarchy(g, [[a, 0], [b, 0], [c, 1], [d, 1]]);
      g.connect(a, d);
      g.connect(b, c);
      const [pns, byLevel] = byLevelFor(g);
      breakLongConnections(pns, byLevel);
      expect(markConflicts(bg, byLevel).size).toBe(0);
    }
    {
      const g = new Graph();
      const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map((id) => g.addNode(new Node(BigInt(id), 10, 10)));
      withHierarchy(g, [[a, 0], [b, 1], [c, 1], [d, 2], [e, 2], [f, 3]]);
      for (const [x, y] of [[a, b], [a, c], [a, f], [b, d], [c, e], [d, f], [e, f]]) g.connect(x, y);
      const [pns, byLevel0] = byLevelFor(g);
      const dummies = breakLongConnections(pns, byLevel0);
      expect(dummies.length).toBe(2);
      const byLevel = new Map([[0, [pns[0]]], [1, [pns[1], dummies[0], pns[2]]], [2, [pns[4], dummies[1], pns[3]]], [3, [pns[5]]]]);
      [pns[1], dummies[0], pns[2]].forEach((pn, i) => { pn.rank = i; });
      [pns[4], dummies[1], pns[3]].forEach((pn, i) => { pn.rank = i; });
      const conflicts = markConflicts(bg, byLevel);
      expect(conflicts.size).toBe(4);
      expect(conflicts.get(pns[1]).has(pns[3])).toBe(true);
      expect(conflicts.get(pns[3]).has(pns[1])).toBe(true);
      expect(conflicts.get(pns[2]).has(pns[4])).toBe(true);
      expect(conflicts.get(pns[4]).has(pns[2])).toBe(true);
    }
  });

  it('observes mid-loop cancellation in CreateAlignmentNodes', () => {
    const g = new Graph();
    const level = [];
    for (let i = 0; i < 130; i++) {
      const node = new Node(BigInt(i + 1), 10, 10);
      node.TopLeft = new Point(i * 20, 0);
      g.addNodeUnchecked(node);
      level.push(newPlacementNode(0, node));
    }
    const { err } = capture(() => createAlignmentNodes(countingContext(2), new Map([[0, level]]), Orientation.Top, Orientation.Left));
    expect(err.message).toBe('CreateAlignmentNodes: context canceled');
  });
});

describe('placement structures', () => {
  it('creates table column children and removes them afterwards', () => {
    const g = new Graph();
    const a = g.addNode(new Node(1n, 100, 100));
    a.setShape('Table');
    a.setNumColumns(3);
    const b = g.addNode(new Node(2n, 100, 100));
    b.setShape('Table');
    b.setNumColumns(2);
    const e = g.connect(a, b);
    e.FromTableColumnIndex = 2;
    e.ToTableColumnIndex = 1;
    withHierarchy(g, [[a, 0], [b, 1]]);
    const [pns] = byLevelFor(g);
    expect(pns[0].children.length).toBe(3);
    expect(pns[0].optimizeChildrenCrossings).toBe(false);
    expect(pns[0].isContainer).toBe(false);
    expect(pns[1].children[1].aboves.has(pns[0].children[2])).toBe(true);
    const kept = removeTableColumnNodes(pns);
    expect(kept.length).toBe(2);
    expect(kept[0].children.length).toBe(0);
  });

  it('breaks long connections with per-call dummy IDs', () => {
    const g = new Graph();
    const [a, b, c] = [1, 2, 3].map((id) => g.addNode(new Node(BigInt(id), 10, 10)));
    withHierarchy(g, [[a, 0], [b, 1], [c, 3]]);
    g.connect(a, b);
    g.connect(a, c);
    const [pns, byLevel] = byLevelFor(g);
    const dummies = breakLongConnections(pns, byLevel);
    expect(dummies.map((d) => d.graphNode.ID)).toEqual([-1n, -2n]);
    expect(byLevel.get(2)).toEqual([dummies[1]]);
    expect(pns[2].aboves.has(dummies[1])).toBe(true);
  });

  it('reports orientation from direction and tables', () => {
    const g = new Graph();
    const n = new Node(1n, 10, 10);
    g.addNewNodeToContainer(null, n);
    expect(isHorizontal([])).toBe(false);
    expect(isHorizontal([n])).toBe(false);
    g.Directions.set(null, Orientation.Right);
    expect(isHorizontal([n])).toBe(true);
    g.Directions.set(null, Orientation.Left);
    expect(isHorizontal([n])).toBe(true);
    g.Directions.set(null, Orientation.Top);
    const table = new Node(2n, 10, 10);
    table.setShape('Table');
    g.addNewNodeToContainer(null, table);
    expect(isHorizontal([n, table])).toBe(true);
  });
});

describe('atomic rollback', () => {
  function component(g, base) {
    const nodes = [0, 1, 2].map((i) => {
      const node = new Node(BigInt(base + i), 20, 20);
      node.TopLeft = new Point(base * 10 + i * 30, base);
      g.addNewNodeToContainer(null, node);
      return node;
    });
    for (let i = 1; i < 3; i++) g.connect(nodes[i - 1], nodes[i]).TargetArrowhead = 'triangle';
    return nodes;
  }

  it('late cancellation restores geometry, routes and graph references', () => {
    const g = new Graph();
    g.IsRootHierarchy = true;
    component(g, 10);
    component(g, 20);
    assign(bg, g, null, candidates(g));
    const positions = new Map(g.Nodes.map((n) => [n, [n.TopLeft, n.TopLeft.X, n.TopLeft.Y, n.Graph]]));
    const routes = new Map(g.Edges.map((e) => {
      e.Points = [e.From.TopLeft.copy(), e.To.TopLeft.copy()];
      return [e, [e.Points, e.Points.slice()]];
    }));
    const canceled = new Error('context canceled');
    const ctx = {
      Err() {
        for (const [n, [, x, y]] of positions) {
          if (n.TopLeft != null && (n.TopLeft.X !== x || n.TopLeft.Y !== y)) return canceled;
        }
        return null;
      },
    };
    const { err } = capture(() => place(ctx, g, null, new GoRand(1)));
    expect(chainHas(err, canceled)).toBe(true);
    for (const [n, [pointer, x, y, graph]] of positions) {
      expect(n.TopLeft).toBe(pointer);
      expect([n.TopLeft.X, n.TopLeft.Y]).toEqual([x, y]);
      expect(n.Graph).toBe(graph);
    }
    for (const [e, [points, copy]] of routes) {
      expect(e.Points).toBe(points);
      expect(e.Points).toEqual(copy);
    }
  });

  it('restores an external near owner on success', () => {
    const graph = new Graph();
    const local = new Node(1n, 10, 10);
    graph.addNewNodeToContainer(null, local);
    const externalOwner = new Graph();
    const external = new Node(2n, 10, 10);
    externalOwner.addNewNodeToContainer(null, external);
    local.addNear(external);
    place(bg, graph, null, new GoRand(1));
    expect(local.Graph).toBe(graph);
    expect(external.Graph).toBe(externalOwner);
  });
});

describe('compound placement', () => {
  function compoundGraph() {
    const g = new Graph();
    const outer = [];
    for (let i = 0; i < 6; i++) {
      const n = new Node(BigInt(i + 1), 120, 90);
      n.TopLeft = new Point(i * 400, 300);
      g.addNewNodeToContainer(null, n);
      outer.push(n);
    }
    for (const [a, b] of [[0, 2], [0, 3], [1, 3], [2, 4], [3, 5]]) g.connect(outer[a], outer[b]).TargetArrowhead = 'triangle';
    const container = outer[3];
    container.Width = 300;
    container.Height = 220;
    const children = [new Node(7n, 80, 50), new Node(8n, 80, 50)];
    children.forEach((n, i) => {
      n.TopLeft = new Point(container.TopLeft.X + 40 + i * 120, container.TopLeft.Y + 60 + i * 60);
      g.addNewNodeToContainer(container, n);
    });
    g.connect(children[0], children[1]).TargetArrowhead = 'triangle';
    g.connect(children[1], outer[5]).TargetArrowhead = 'triangle';
    g.Directions.set(container, Orientation.Right);
    return [g, outer, children];
  }

  it('preserves detailed interiors and honors the outer direction', () => {
    for (const direction of [Orientation.Bottom, Orientation.Top, Orientation.Left, Orientation.Right]) {
      const [g, outer, children] = compoundGraph();
      g.Directions.set(null, direction);
      const inner = withHierarchy(g, [[children[0], 0], [children[1], 1]]);
      const offsets = children.map((n) => [n.TopLeft.X - outer[3].TopLeft.X, n.TopLeft.Y - outer[3].TopLeft.Y]);
      const endpoints = g.Edges.map((e) => [e.From, e.To]);
      expect(placeCompound(bg, g, new GoRand(1))).toBe(true);
      children.forEach((n, i) => {
        expect([n.TopLeft.X - outer[3].TopLeft.X, n.TopLeft.Y - outer[3].TopLeft.Y]).toEqual(offsets[i]);
        expect(n.Hierarchy).toBe(inner);
        expect(outer[3].surrounds(n, 0)).toBe(true);
      });
      expect(g.direction(outer[3])).toBe(Orientation.Right);
      g.Edges.forEach((e, i) => expect([e.From, e.To]).toEqual(endpoints[i]));
      for (const [ai, bi] of [[0, 2], [0, 3], [1, 3], [2, 4], [3, 5]]) {
        const a = outer[ai];
        const b = outer[bi];
        const valid = {
          [Orientation.Bottom]: a.TopLeft.Y + a.Height < b.TopLeft.Y,
          [Orientation.Top]: b.TopLeft.Y + b.Height < a.TopLeft.Y,
          [Orientation.Left]: b.TopLeft.X + b.Width < a.TopLeft.X,
          [Orientation.Right]: a.TopLeft.X + a.Width < b.TopLeft.X,
        }[direction];
        expect(valid).toBe(true);
      }
    }
  });

  it('keeps fixed, disconnected and interior-free graphs unchanged', () => {
    for (const kind of ['fixed descendant', 'disconnected', 'no internal edges']) {
      const [g, , children] = compoundGraph();
      if (kind === 'fixed descendant') children[0].FixedTopLeft = children[0].TopLeft.copy();
      if (kind === 'disconnected') {
        const n = new Node(9n, 50, 50);
        n.TopLeft = new Point(3000, 0);
        g.addNewNodeToContainer(null, n);
      }
      if (kind === 'no internal edges') g.disconnect(g.Edges[5]);
      const before = g.Nodes.map((n) => [n.TopLeft.X, n.TopLeft.Y]);
      expect(placeCompound(bg, g, new GoRand(1))).toBe(false);
      expect(g.Nodes.map((n) => [n.TopLeft.X, n.TopLeft.Y])).toEqual(before);
    }
  });

  it('cancellation after a block move rolls back geometry and membership', () => {
    const [g, outer] = compoundGraph();
    const pointers = g.Nodes.map((n) => [n.TopLeft, n.TopLeft.X, n.TopLeft.Y, n.Hierarchy]);
    const watched = outer[3];
    const start = [watched.TopLeft.X, watched.TopLeft.Y];
    const canceled = new Error('context canceled');
    const ctx = { Err: () => (watched.TopLeft.X !== start[0] || watched.TopLeft.Y !== start[1] ? canceled : null) };
    const { value, err } = capture(() => placeCompound(ctx, g, null));
    expect(value).toBeUndefined();
    expect(chainHas(err, canceled)).toBe(true);
    g.Nodes.forEach((n, i) => {
      expect(n.TopLeft).toBe(pointers[i][0]);
      expect([n.TopLeft.X, n.TopLeft.Y, n.Hierarchy]).toEqual(pointers[i].slice(1));
    });
  });

  it('ordering uses boundary offsets', () => {
    const g = new Graph();
    const h = newHierarchy();
    h.LevelCount = 2;
    const add = (id, x, y, w, level) => {
      const n = new Node(BigInt(id), w, 60);
      n.TopLeft = new Point(x, y);
      g.addNewNodeToContainer(null, n);
      n.Hierarchy = h;
      h.Levels().set(n, level);
      return { proxy: n };
    };
    const source = add(1, 0, 0, 200, 0);
    const left = add(2, 0, 200, 40, 1);
    const right = add(3, 160, 200, 40, 1);
    const edges = [
      { from: source, to: left, fromOffset: new Point(180, 0), toOffset: new Point(20, 0) },
      { from: source, to: right, fromOffset: new Point(20, 0), toOffset: new Point(20, 0) },
    ];
    const guard = new WorkGuard(bg, 'compound ordering test', 10_000n);
    expect(compoundInterfaceScore(edges, false, guard).crossings).toBe(1);
    orderCompoundInterfaces([source, left, right], edges, false, guard);
    expect(compoundInterfaceScore(edges, false, guard).crossings).toBe(0);
    expect(left.proxy.TopLeft.X > right.proxy.TopLeft.X).toBe(true);
  });
});

describe('deep hierarchy placement', () => {
  it('places a long forced chain without recursion overflow', () => {
    const g = new Graph();
    g.IsRootHierarchy = true;
    const nodes = [];
    for (let i = 0; i < 300; i++) {
      const n = new Node(BigInt(i + 1), 20, 20);
      n.TopLeft = new Point(i, 0);
      g.addNewNodeToContainer(null, n);
      nodes.push(n);
      if (i > 0) g.connect(nodes[i - 1], n).TargetArrowhead = 'triangle';
    }
    assign(bg, g, null, candidates(g));
    expect(nodes[0].Hierarchy.LevelCount).toBe(300);
    place(bg, g, null, new GoRand(1));
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i].TopLeft.Y).toBeGreaterThan(nodes[i - 1].TopLeft.Y);
    }
  });
});
