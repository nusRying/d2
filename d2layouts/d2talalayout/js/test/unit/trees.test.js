// Slice 46 — key assertions ported from internal/trees/*_test.go
// (direction_test, cancellation_test, invariants_test, placement_test,
// placement_correctness_test, domain_test, atomicity_test).
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Edge } from '../../src/graph/edge.js';
import { Label } from '../../src/graph/label.js';
import { Tree } from '../../src/graph/tree.js';
import { Point } from '../../src/geometry/point.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { newGraphStateSnapshot } from '../../src/graph/graph-state.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import * as treesApi from '../../src/trees/index.js';
import {
  Bidirectional,
  Inwards,
  Outwards,
  Undirected,
  newWorkGuard,
  treeEdgeDirection,
} from '../../src/trees/types.js';
import {
  addTreeChild,
  rootsByTreeDirection,
  treeSize,
} from '../../src/trees/preprocess-helpers.js';
import { validateBottomOrientation } from '../../src/trees/geometry.js';
import {
  buildPlacementTrees,
  extractTrees,
  placeAtOrientationGuarded,
  placeTrees,
  placeTreesWithWorkLimit,
  positionTreeEdgeLabels,
  preprocessTreesWithWorkLimit,
} from '../../src/trees/layout.js';
import { Validate } from '../../src/graph/topology-preflight.js';
import { bg, build, captureRefs, chainHas, refsMismatch, stateOf } from './trees-oracle-support.js';

const TRI = 'triangle';

function guard() {
  return newWorkGuard(bg, 'TreeTest');
}

function mustExtractTrees(g) {
  Validate(bg, 'ExtractTrees', g);
  const gd = newWorkGuard(bg, 'ExtractTrees');
  const trees = extractTrees(g, gd);
  gd.Finish();
  return trees;
}

function spec(nodes, edges) {
  return {
    nodes: nodes.map(([id, x, y]) => ({ id, w: 100, h: 100, placed: true, x, y })),
    edges: edges.map(([from, to, src, dst]) => ({ from, to, src, dst })),
  };
}

const directedTree = () => build(spec(
  [[0, 200, 0], [1, 0, 200], [2, 200, 200], [3, 100, 400], [4, 300, 400], [5, 100, 600], [6, 300, 600]],
  [[0, 2, '', TRI], [2, 0, '', TRI], [2, 1, '', TRI], [3, 2, '', TRI], [5, 3, '', TRI], [4, 2, '', TRI], [4, 6, '', TRI]],
));

function cancelOnce() {
  const canceled = new Error('context canceled');
  return canceled;
}

function canceledAt(err, canceled, location) {
  expect(err).not.toBeNull();
  expect(chainHas(err, canceled)).toBe(true);
  expect(err.message).toContain(location);
}

// ── addTreePreprocessNode / manyBranchingPlacementTreesGraph ────────────────

function addNode(g, id) {
  const node = new Node(BigInt(id), 10, 10);
  node.TopLeft = new Point(id * 20, 0);
  g.AddNewNodeToContainer(null, node);
  return node;
}

function addEdge(g, from, to) {
  const edge = g.Connect(from, to);
  edge.Points = [new Point(from.TopLeft.X, from.TopLeft.Y), new Point(to.TopLeft.X, to.TopLeft.Y)];
  return edge;
}

function tracked(g) {
  return { g, nodes: [...g.Nodes], edges: [...g.Edges] };
}

function manyBranching(treeCount) {
  const g = new Graph();
  const core = [addNode(g, 1), addNode(g, 2), addNode(g, 3)];
  addEdge(g, core[0], core[1]);
  addEdge(g, core[1], core[2]);
  addEdge(g, core[2], core[0]);
  let firstLeaf = null;
  for (let i = 0; i < treeCount; i++) {
    const rootID = 1000 + 3 * i;
    const root = addNode(g, rootID);
    const first = addNode(g, rootID + 1);
    const second = addNode(g, rootID + 2);
    addEdge(g, core[0], root);
    addEdge(g, root, first);
    addEdge(g, root, second);
    if (firstLeaf == null) firstLeaf = first;
  }
  const b = tracked(g);
  treesApi.preprocess(bg, g);
  expect(g.Nodes.length).toBe(core.length);
  expect(g.Trees.get(core[0]).length).toBe(treeCount);
  return { b, g, firstLeaf, core };
}

function reconnectGraph(lineLength) {
  const g = new Graph();
  const core = [addNode(g, 1), addNode(g, 2), addNode(g, 3)];
  addEdge(g, core[0], core[1]);
  addEdge(g, core[1], core[2]);
  addEdge(g, core[2], core[0]);
  let previous = core[0];
  let leaf = null;
  for (let i = 0; i < lineLength; i++) {
    leaf = addNode(g, 10 + i);
    addEdge(g, previous, leaf);
    previous = leaf;
  }
  return { b: tracked(g), g, leaf };
}

function placementObserver(g, firstLeaf, mode) {
  const canceled = new Error('context canceled');
  const targetTree = g.NodeToTree.get(firstLeaf);
  const ctx = {
    initialNodeCount: g.Nodes.length,
    originalOrientation: targetTree.Orientation,
    observedReconnect: false,
    observedPlacement: false,
    Err() {
      if (g.Nodes.length > this.initialNodeCount && g.Nodes.includes(firstLeaf)) {
        this.observedReconnect = true;
        if (targetTree.Orientation !== this.originalOrientation && firstLeaf.TopLeft != null && firstLeaf.TopLeft.Y > 0) {
          this.observedPlacement = true;
          if (mode === 'panic') throw new Error('deterministic tree placement probe');
          if (mode === 'cancel') return canceled;
        }
      }
      return null;
    },
  };
  return { ctx, canceled };
}

function measurePlaceTreesWork(treeCount) {
  const { g } = manyBranching(treeCount);
  const gd = newWorkGuard(bg, 'PlaceTreesMeasurement');
  gd.SetLimit(MAX_TRANSACTION_WORK_UNITS);
  const state = newGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true });
  state.updateWithWorkGuard(g, gd);
  placeTrees(bg, g, null, gd);
  expect(gd.Used() > 0n).toBe(true);
  return gd.Used();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('trees public API', () => {
  it('exports lowerCamel and PascalCase entry points', () => {
    expect(treesApi.preprocess).toBeFunction();
    expect(treesApi.place).toBeFunction();
    expect(treesApi.descendants).toBeFunction();
    expect(treesApi.Preprocess).toBeFunction();
    expect(treesApi.Place).toBeFunction();
    expect(treesApi.Descendants).toBeFunction();
  });

  it('Descendants is breadth-first and null-safe', () => {
    expect(treesApi.descendants(null)).toBeNull();
    const t = (id) => new Tree(new Node(BigInt(id), 1, 1));
    const root = t(1);
    const a = t(2);
    const b = t(3);
    const c = t(4);
    const d = t(5);
    root.Children = [a, b];
    a.Children = [c];
    b.Children = [d];
    expect(treesApi.descendants(root).map((x) => Number(x.Node.ID))).toEqual([2, 3, 4, 5]);
    expect(treesApi.descendants(c)).toEqual([]);
  });
});

describe('direction_test', () => {
  it('treeEdgeDirection owns policy', () => {
    const from = new Node(1n, 10, 10);
    const to = new Node(2n, 10, 10);
    const edge = new Edge(from, to);
    expect(treeEdgeDirection(from, edge)).toBe(Undirected);
    edge.TargetArrowhead = TRI;
    expect(treeEdgeDirection(from, edge)).toBe(Outwards);
    expect(treeEdgeDirection(to, edge)).toBe(Inwards);
    edge.SourceArrowhead = TRI;
    expect(treeEdgeDirection(from, edge)).toBe(Bidirectional);
  });
});

describe('cancellation_test', () => {
  it('placeAtOrientationGuarded canceled before work', () => {
    let cancelled = false;
    const canceled = new Error('context canceled');
    const ctx = { Err: () => (cancelled ? canceled : null) };
    const gd = newWorkGuard(ctx, 'PlaceAtOrientation');
    const g = new Graph();
    const node = g.AddNode(new Node(1n, 10, 10));
    node.TopLeft = new Point(0, 0);
    const tree = new Tree(node);
    cancelled = true;
    let err = null;
    try {
      placeAtOrientationGuarded(ctx, g, tree, Orientation.Left, gd);
    } catch (e) {
      err = e;
    }
    expect(chainHas(err, canceled)).toBe(true);
  });
});

describe('invariants_test', () => {
  it('validateBottomOrientation', () => {
    const parent = new Tree(new Node(1n, 10, 10));
    parent.Node.TopLeft = new Point(0, 0);
    const child = new Tree(new Node(2n, 10, 10));
    child.Parent = parent;
    child.Node.TopLeft = new Point(0, 20);
    parent.Children = [child];
    validateBottomOrientation(parent, guard());
    child.Node.TopLeft.Y = 5;
    expect(() => validateBottomOrientation(parent, guard()))
      .toThrow('layout invariant violated: tree node 2 is not in Bottom orientation');
  });

  it('positionTreeEdgeLabels validates before mutation', () => {
    const placementTree = new Tree(new Node(1n, 10, 10));
    placementTree.Orientation = Orientation.Bottom;
    placementTree.Node.TopLeft = new Point(0, 0);
    const valid = new Tree(new Node(2n, 10, 10));
    valid.Parent = placementTree;
    valid.Node.TopLeft = new Point(0, 20);
    valid.SentinelEdge = new Edge(valid.Node, placementTree.Node);
    valid.SentinelEdge.Label = new Label();
    valid.SentinelEdge.MinHeight = 10;
    const invalid = new Tree(new Node(3n, 10, 10));
    invalid.Parent = placementTree;
    invalid.Node.TopLeft = new Point(20, 5);
    placementTree.Children = [valid, invalid];
    expect(() => positionTreeEdgeLabels(placementTree, true, guard())).toThrow('layout invariant violated');
    expect(valid.SentinelEdge.Label.Position ?? 0).toBe(0);
    expect(valid.SentinelEdge.LabelPercentage).toBe(0);
  });

  it('positionTreeEdgeLabels restores orientation on error', () => {
    const g = new Graph();
    const placementTree = new Tree(new Node(1n, 10, 20));
    placementTree.Orientation = Orientation.Right;
    placementTree.Node.TopLeft = new Point(10, 20);
    const invalid = new Tree(new Node(2n, 6, 8));
    invalid.Parent = placementTree;
    invalid.Node.TopLeft = new Point(10, 20);
    placementTree.Children = [invalid];
    g.AddNodeUnchecked(placementTree.Node);
    g.AddNodeUnchecked(invalid.Node);
    expect(() => positionTreeEdgeLabels(placementTree, true, guard())).toThrow();
    expect([placementTree.Node.TopLeft.X, placementTree.Node.TopLeft.Y, placementTree.Node.Width, placementTree.Node.Height])
      .toEqual([10, 20, 10, 20]);
    expect([invalid.Node.TopLeft.X, invalid.Node.TopLeft.Y, invalid.Node.Width, invalid.Node.Height])
      .toEqual([10, 20, 6, 8]);
  });
});

describe('placement_correctness_test / placement_test', () => {
  it('placement trees do not merge disconnected sentinels', () => {
    const g = new Graph();
    const directedCenter = new Node(101n, 10, 10);
    g.AddNewNodeToContainer(null, directedCenter);
    for (let i = 0; i < 3; i++) {
      const leaf = new Node(BigInt(102 + i), 10, 10);
      g.AddNewNodeToContainer(null, leaf);
      g.Connect(directedCenter, leaf).TargetArrowhead = TRI;
    }
    const undirectedCenter = new Node(201n, 10, 10);
    g.AddNewNodeToContainer(null, undirectedCenter);
    for (let i = 0; i < 3; i++) {
      const leaf = new Node(BigInt(202 + i), 10, 10);
      g.AddNewNodeToContainer(null, leaf);
      g.Connect(undirectedCenter, leaf);
    }
    treesApi.preprocess(bg, g);
    expect(g.Trees.size).toBe(2);
    const placementTrees = buildPlacementTrees(g, guard());
    expect(placementTrees.length).toBe(2);
    for (const placementTree of placementTrees) {
      for (const child of placementTree.Children) {
        const edge = child.SentinelEdge;
        expect(edge.From === placementTree.Node || edge.To === placementTree.Node).toBe(true);
      }
    }
  });

  it('builds placement trees for an isolated tree', () => {
    const g = new Graph();
    const nodes = [];
    for (let i = 0; i < 13; i++) {
      nodes.push(new Node(BigInt(i + 1), 10, 10));
      g.AddNewNodeToContainer(null, nodes[i]);
    }
    const connect = (i, j, source, target) => {
      const e = g.Connect(nodes[i], nodes[j]);
      if (source) e.SourceArrowhead = TRI;
      if (target) e.TargetArrowhead = TRI;
    };
    connect(0, 1, false, true);
    connect(2, 1, false, true);
    connect(3, 1, false, true);
    connect(4, 0, false, true);
    connect(4, 5, false, true);
    connect(4, 6, false, true);
    connect(0, 8, false, true);
    connect(8, 9, false, true);
    connect(8, 10, false, true);
    connect(0, 7, false, false);
    connect(7, 11, false, true);
    connect(7, 12, false, true);
    g.Trees = mustExtractTrees(g);
    const trees = buildPlacementTrees(g, guard());
    expect(trees.length).toBe(3);
    for (const tree of trees) {
      if (tree.Children.length === 2) {
        const set = new Set(tree.Children.map((c) => c.Node));
        set.delete(nodes[7]);
        set.delete(nodes[8]);
        expect(set.size).toBe(0);
      } else {
        expect(tree.Children.length).toBe(1);
        const c = tree.Children[0].Node;
        expect(c === nodes[4] || c === nodes[1]).toBe(true);
      }
    }
  });
});

describe('domain_test', () => {
  it('extracts directed trees', () => {
    const { g, byID } = directedTree();
    const roots = mustExtractTrees(g);
    expect(g.Nodes.map((n) => Number(n.ID)).sort()).toEqual([0, 2]);
    expect(g.Edges.length).toBe(2);
    expect(roots.size).toBe(1);
    expect(roots.get(byID.get(2)).map((r) => Number(r.Node.ID)).sort()).toEqual([1, 3, 4]);
  });

  it('extracts mixed trees', () => {
    const pos = [[300, 0], [500, 0], [700, 0], [900, 0], [300, 200], [800, 200], [200, 400], [400, 400],
      [600, 400], [800, 400], [1000, 400], [0, 600], [200, 600], [400, 600], [900, 600], [1100, 600]];
    const edges = [
      [0, 1, TRI, TRI], [1, 2, TRI, TRI], [2, 3, TRI, TRI], [0, 4, TRI, TRI], [4, 5, TRI, TRI], [5, 4, TRI, TRI],
      [6, 4, '', TRI], [4, 7, '', TRI], [5, 9, '', ''], [9, 10, '', ''], [7, 8, '', TRI], [11, 6, '', TRI],
      [12, 6, '', TRI], [7, 13, '', TRI], [10, 14, '', ''], [10, 15, '', ''],
    ];
    const { g, byID } = build(spec(pos.map(([x, y], i) => [i, x, y]), edges));
    const roots = mustExtractTrees(g);
    expect(g.Nodes.map((n) => Number(n.ID)).sort()).toEqual([4, 5]);
    expect(g.Edges.length).toBe(2);
    expect(roots.size).toBe(2);
    expect(roots.get(byID.get(4)).map((r) => Number(r.Node.ID)).sort()).toEqual([0, 6, 7]);
    expect(roots.get(byID.get(5)).map((r) => r.Node)).toEqual([byID.get(9)]);
  });

  it('extracts a merged tree from a directed subgraph (reversal)', () => {
    const { g } = build(spec(
      [[0, 600, 0], [1, 600, 200], [2, 0, 400], [3, 200, 400], [4, 400, 400], [5, 600, 400], [6, 800, 400]],
      [[0, 1, '', TRI], [1, 4, '', TRI], [6, 5, '', TRI], [5, 4, '', TRI], [4, 3, '', TRI], [3, 2, '', TRI]],
    ));
    const roots = mustExtractTrees(g);
    expect(roots.size).toBe(1);
    const [only] = [...roots.values()];
    expect(only.length).toBe(1);
    expect(Number(only[0].Node.ID)).toBe(3);
    expect(treeSize(only[0], guard())).toBe(6);
  });

  it('rootsByTreeDirection uses the first directed descendant', () => {
    const connect = (a, b2, s, t) => {
      const e = new Edge(a, b2);
      if (s) e.SourceArrowhead = TRI;
      if (t) e.TargetArrowhead = TRI;
      a.addEdge(e);
      b2.addEdge(e);
      return e;
    };
    const n5 = new Node(5n, 10, 10);
    const root = new Tree(new Node(1n, 10, 10));
    const c1 = new Tree(new Node(2n, 10, 10));
    const c2 = new Tree(new Node(3n, 10, 10));
    const c3 = new Tree(new Node(4n, 10, 10));
    const gd = guard();
    addTreeChild(root, c1, gd);
    addTreeChild(root, c2, gd);
    addTreeChild(root, c3, gd);
    root.SentinelEdge = connect(n5, root.Node, true, true);
    c1.SentinelEdge = connect(root.Node, c1.Node, false, false);
    c2.SentinelEdge = connect(root.Node, c2.Node, false, true);
    c3.SentinelEdge = connect(c2.Node, c3.Node, false, true);
    const byDirection = rootsByTreeDirection([root], gd);
    expect(byDirection.has(Inwards)).toBe(true);
    expect(byDirection.size).toBe(1);
  });

  it('sql_table container is not extracted', () => {
    const { g } = build(spec(
      [[0, 600, 0], [1, 600, 200], [2, 0, 400], [3, 200, 400], [4, 400, 400], [5, 600, 400], [6, 800, 400]],
      [[0, 1, '', TRI], [1, 4, '', TRI], [6, 5, '', TRI], [5, 4, '', TRI], [4, 3, '', TRI], [3, 2, '', TRI]],
    ));
    g.Nodes[3].SetShape('Table');
    expect(mustExtractTrees(g).size).toBe(0);
  });
});

describe('atomicity_test', () => {
  it('preprocess cancellation after fringe removal restores exact topology', () => {
    const { b, g } = reconnectGraph(8);
    const initial = stateOf(b);
    const refs = captureRefs(b);
    const canceled = cancelOnce();
    const nodeCount = g.Nodes.length;
    let observed = false;
    const ctx = { Err: () => (g.Nodes.length < nodeCount ? ((observed = true), canceled) : null) };
    let err = null;
    try { treesApi.preprocess(ctx, g); } catch (e) { err = e; }
    canceledAt(err, canceled, 'PreprocessTrees');
    expect(observed).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('preprocess cancellation after tree map install restores exact topology', () => {
    const { b, g } = reconnectGraph(8);
    const initial = stateOf(b);
    const refs = captureRefs(b);
    const canceled = cancelOnce();
    let observed = false;
    const ctx = { Err: () => (g.Trees.size > 0 ? ((observed = true), canceled) : null) };
    let err = null;
    try { treesApi.preprocess(ctx, g); } catch (e) { err = e; }
    canceledAt(err, canceled, 'PreprocessTrees');
    expect(observed).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('preprocess cancellation after reconnect restores exact topology', () => {
    const { b, g, leaf } = reconnectGraph(8);
    const initial = stateOf(b);
    const canceled = cancelOnce();
    let wasRemoved = false;
    let reconnected = false;
    const ctx = {
      Err() {
        const present = g.Nodes.includes(leaf);
        if (!present) wasRemoved = true;
        if (wasRemoved && present) {
          reconnected = true;
          return canceled;
        }
        return null;
      },
    };
    let err = null;
    try { treesApi.preprocess(ctx, g); } catch (e) { err = e; }
    canceledAt(err, canceled, 'PreprocessTrees');
    expect(wasRemoved && reconnected).toBe(true);
    expect(stateOf(b)).toEqual(initial);
  });

  it('preprocess throw (Go panic) after mutation restores exact topology', () => {
    const { b, g } = reconnectGraph(8);
    const initial = stateOf(b);
    const refs = captureRefs(b);
    const nodeCount = g.Nodes.length;
    let observed = false;
    const ctx = {
      Err() {
        if (g.Nodes.length < nodeCount) {
          observed = true;
          throw new Error('deterministic tree preprocessing probe');
        }
        return null;
      },
    };
    expect(() => treesApi.preprocess(ctx, g)).toThrow('deterministic tree preprocessing probe');
    expect(observed).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('preprocess injected work limit after mutation is atomic', () => {
    const { b, g } = reconnectGraph(80);
    const gd = newWorkGuard(bg, 'TreeSnapshotMeasurement');
    gd.SetLimit(MAX_TRANSACTION_WORK_UNITS);
    newGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true }).updateWithWorkGuard(g, gd);
    const snapshotWork = gd.Used();
    const initial = stateOf(b);
    const nodeCount = g.Nodes.length;
    let observed = false;
    const ctx = { Err: () => { if (g.Nodes.length < nodeCount) observed = true; return null; } };
    expect(() => preprocessTreesWithWorkLimit(ctx, g, snapshotWork + 900n)).toThrow('work exceeds limit');
    expect(observed).toBe(true);
    expect(stateOf(b)).toEqual(initial);
  });

  it('a failure halfway through multiple trees rolls back earlier placements (aggregate work limit)', () => {
    const { b, g, firstLeaf } = manyBranching(12);
    const initial = stateOf(b);
    const refs = captureRefs(b);
    const { ctx } = placementObserver(g, firstLeaf, null);
    expect(() => placeTreesWithWorkLimit(ctx, g, null, 5000n)).toThrow('work exceeds limit');
    expect(ctx.observedReconnect).toBe(true);
    expect(ctx.observedPlacement).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('PlaceTrees succeeds at its exact measured work and fails atomically one unit below', () => {
    const required = measurePlaceTreesWork(4);
    const ok = manyBranching(4);
    placeTreesWithWorkLimit(bg, ok.g, null, required);
    const { b, g } = manyBranching(4);
    const initial = stateOf(b);
    const refs = captureRefs(b);
    expect(() => placeTreesWithWorkLimit(bg, g, null, required - 1n))
      .toThrow(`TALA PlaceTrees work exceeds limit ${required - 1n}`);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('PlaceTrees cancellation inside the layout kernel restores the whole call', () => {
    const { b, g, firstLeaf } = manyBranching(4);
    const initial = stateOf(b);
    const refs = captureRefs(b);
    const { ctx, canceled } = placementObserver(g, firstLeaf, 'cancel');
    let err = null;
    try { treesApi.place(ctx, g, null); } catch (e) { err = e; }
    canceledAt(err, canceled, 'PlaceTrees');
    expect(ctx.observedReconnect && ctx.observedPlacement).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('PlaceTrees throw (Go panic) inside the layout kernel restores the whole call', () => {
    const { b, g, firstLeaf } = manyBranching(4);
    const initial = stateOf(b);
    const refs = captureRefs(b);
    const { ctx } = placementObserver(g, firstLeaf, 'panic');
    expect(() => treesApi.place(ctx, g, null)).toThrow('deterministic tree placement probe');
    expect(ctx.observedReconnect && ctx.observedPlacement).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('PlaceTrees cancellation inside the label kernel restores the whole call', () => {
    const { b, g, firstLeaf } = manyBranching(1);
    const targetEdge = g.NodeToTree.get(firstLeaf).SentinelEdge;
    targetEdge.Label = new Label();
    targetEdge.MinHeight = 12;
    b.edges = [...b.edges];
    const initial = stateOf(b);
    const original = targetEdge.LabelPercentage;
    const canceled = cancelOnce();
    let observed = false;
    const ctx = { Err: () => (targetEdge.LabelPercentage !== original ? ((observed = true), canceled) : null) };
    let err = null;
    try { treesApi.place(ctx, g, null); } catch (e) { err = e; }
    canceledAt(err, canceled, 'PlaceTrees');
    expect(observed).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(targetEdge.LabelPercentage).toBe(original);
  });

  it('PlaceTrees error after partial reconnect restores exact topology', () => {
    const { b, g, firstLeaf } = manyBranching(12);
    let laterRoot = null;
    for (const roots of g.Trees.values()) {
      if (roots.length > 1) {
        laterRoot = roots[roots.length - 1];
        break;
      }
    }
    expect(laterRoot != null && laterRoot.Children.length >= 2).toBe(true);
    laterRoot.Children[laterRoot.Children.length - 1].SentinelEdge = null;
    const initial = stateOf(b);
    const refs = captureRefs(b);
    const { ctx } = placementObserver(g, firstLeaf, null);
    expect(() => treesApi.place(ctx, g, null)).toThrow('no complete sentinel edge');
    expect(ctx.observedReconnect).toBe(true);
    expect(stateOf(b)).toEqual(initial);
    expect(refsMismatch(b, refs)).toBeNull();
  });

  it('PlaceTrees accepts representative stress within its calibrated budget', () => {
    treesApi.place(bg, manyBranching(48).g, null);
    const g = new Graph();
    const core = [addNode(g, 1), addNode(g, 2), addNode(g, 3)];
    addEdge(g, core[0], core[1]);
    addEdge(g, core[1], core[2]);
    addEdge(g, core[2], core[0]);
    let previous = core[0];
    for (let i = 0; i < 240; i++) {
      const node = addNode(g, 10_000 + i);
      addEdge(g, previous, node);
      previous = node;
    }
    for (let i = 0; i < 2; i++) addEdge(g, previous, addNode(g, 20_000 + i));
    treesApi.preprocess(bg, g);
    treesApi.place(bg, g, null);
  });
});
