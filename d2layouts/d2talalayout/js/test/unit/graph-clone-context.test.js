// Slice 50: context-aware layoutgraph.Clone parity.
// Pinned Go: internal/layoutgraph/clone.go, clone_internal_test.go,
// clone_parity_test.go. Oracle: internal/layoutgraph/go_slice50_clone_oracle_test.go
// (fixture go-slice50-clone-reference.json).
import { describe, it, expect } from "bun:test";
import { Clone, cloneGraph, cloneGraphWithContext } from "../../src/graph/clone.js";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Tree } from "../../src/graph/tree.js";
import { EdgeAbduction } from "../../src/graph/edge-abduction.js";
import { Label } from "../../src/graph/label.js";
import { Icon } from "../../src/graph/icon.js";
import { Hierarchy } from "../../src/graph/hierarchy.js";
import { HerdAssignment } from "../../src/graph/herd-assignment.js";
import { LabelPosition } from "../../src/graph/label-position.js";
import { Point } from "../../src/geometry/point.js";
import { Orientation } from "../../src/geometry/orientation.js";
import { backgroundWorkContext } from "../../src/limits/work-context.js";
import { WorkCanceledError } from "../../src/limits/work-guard.js";
import { validateEngineGraph } from "../../src/graph/topology-preflight.js";
import { loadFixture } from "./slice46-fixtures.js";

const oracle = loadFixture("go-slice50-clone-reference.json");

class CountContext {
  constructor(cancelAt = 0) {
    this.calls = 0;
    this.cancelAt = cancelAt;
    this.canceled = new Error("context canceled");
  }

  Err() {
    this.calls++;
    if (this.cancelAt > 0 && this.calls >= this.cancelAt) {
      return this.canceled;
    }
    return null;
  }
}

function n(id, w, h) {
  return new Node(BigInt(id), w, h);
}

// ---- Builders mirroring clone_parity_test.go ---------------------------------

function newCloneParityGraph() {
  const graph = new Graph();
  graph.CellSize = 40;
  graph.IsRootHierarchy = true;

  const container = n(1, 300, 200);
  container.TopLeft = new Point(0, 0);
  container.Label = new Label("container", 80, 20);
  container.Label.Position = LabelPosition.InsideTopCenter;
  container.Label.FixPosition();
  container.Icon = new Icon(LabelPosition.InsideTopLeft);
  container.Icon.FixPosition();
  container.HerdAssignment = new HerdAssignment();
  container.LoopOffsets = new Map([[Orientation.Top, 10]]);
  graph.addNodeUnchecked(container);
  graph.addNodeToContainer(null, container);

  const external = n(6, 40, 30);
  external.TopLeft = new Point(400, 100);
  graph.addNodeUnchecked(external);
  graph.addNodeToContainer(null, external);

  const clusterVessel = n(9, 100, 40);
  clusterVessel.TopLeft = new Point(50, 50);
  graph.addNodeUnchecked(clusterVessel);
  graph.addNodeToContainer(container, clusterVessel);
  const clusterFirst = n(2, 40, 40);
  clusterFirst.TopLeft = new Point(50, 50);
  clusterFirst.Graph = graph;
  const clusterSecond = n(3, 40, 40);
  clusterSecond.TopLeft = new Point(110, 50);
  clusterSecond.Graph = graph;
  const cluster = new Cluster({
    Vessel: clusterVessel,
    Nodes: [clusterFirst, clusterSecond],
    Arrangement: ClusterArrangement.Row,
    DesiredArrangement: ClusterArrangement.Column,
    Graph: graph,
    Padding: 20,
    FixedSize: true,
    Container: container,
  });
  clusterFirst.Cluster = cluster;
  clusterSecond.Cluster = cluster;
  graph.Clusters.set(clusterVessel, cluster);

  const sequenceVessel = n(10, 100, 40);
  sequenceVessel.TopLeft = new Point(50, 120);
  graph.addNodeUnchecked(sequenceVessel);
  graph.addNodeToContainer(container, sequenceVessel);
  const sequenceFirst = n(4, 40, 40);
  sequenceFirst.TopLeft = new Point(50, 120);
  sequenceFirst.Graph = graph;
  const sequenceSecond = n(5, 40, 40);
  sequenceSecond.TopLeft = new Point(90, 120);
  sequenceSecond.Graph = graph;
  const sequence = new Sequence({
    Vessel: sequenceVessel,
    Nodes: [sequenceFirst, sequenceSecond],
    Graph: graph,
    Container: container,
  });
  sequenceFirst.Sequence = sequence;
  sequenceSecond.Sequence = sequence;
  graph.Sequences.set(sequenceVessel, sequence);

  const clusterEdge = graph.connect(clusterFirst, external);
  clusterEdge.Points = [new Point(90, 70), new Point(400, 115)];
  clusterEdge.Style = { Stroke: { Value: "blue" } };
  clusterEdge.Label = new Label("cluster edge", 70, 18);
  clusterEdge.Label.Position = LabelPosition.UnlockedMiddle;
  clusterEdge.Label.FixPosition();
  clusterEdge.IsCurve = true;
  cluster.EdgeAbductions = [new EdgeAbduction({
    Edge: clusterEdge,
    OriginallyFrom: clusterFirst,
    OriginallyTo: external,
    CurrentFrom: clusterVessel,
    CurrentTo: external,
  })];

  const sequenceEdge = graph.connect(sequenceFirst, external);
  sequenceEdge.Points = [new Point(90, 140), new Point(400, 115)];
  sequence.EdgeAbductions = [new EdgeAbduction({
    Edge: sequenceEdge,
    OriginallyFrom: sequenceFirst,
    OriginallyTo: external,
    CurrentFrom: sequenceVessel,
    CurrentTo: external,
  })];

  const treeNode = n(7, 30, 30);
  treeNode.TopLeft = new Point(460, 100);
  graph.addNodeUnchecked(treeNode);
  graph.addNodeToContainer(null, treeNode);
  const treeEdge = graph.connect(external, treeNode);
  treeEdge.Points = [new Point(440, 115), new Point(460, 115)];
  const tree = new Tree(treeNode);
  tree.SentinelEdge = treeEdge;
  tree.Orientation = Orientation.Right;
  graph.Trees.set(external, [tree]);

  clusterFirst.addNear(sequenceFirst);
  container.LongDistanceNeighborRequirements = new Map([[external, { EdgeCount: 1, MaxWidth: 10, MaxHeight: 20 }]]);
  const hierarchy = new Hierarchy();
  hierarchy.ReplaceLevels(new Map([[container, 0], [external, 1], [treeNode, 2]]));
  container.Hierarchy = hierarchy;
  external.Hierarchy = hierarchy;
  treeNode.Hierarchy = hierarchy;
  graph.Hubs.set(external, [clusterVessel, sequenceVessel]);
  graph.Directions.set(null, Orientation.Bottom);
  graph.Directions.set(container, Orientation.Right);
  graph.CommonUncleSiblings = new Map([[external, [treeNode]]]);
  return graph;
}

function newDetachedTreeGraph() {
  const graph = new Graph();
  const sentinel = n(1, 20, 20);
  sentinel.TopLeft = new Point(0, 0);
  graph.addNodeUnchecked(sentinel);
  const treeNode = n(2, 20, 20);
  treeNode.TopLeft = new Point(40, 0);
  treeNode.Graph = graph;
  const sentinelEdge = new Edge(sentinel, treeNode);
  sentinelEdge.Points = [new Point(20, 10), new Point(40, 10)];
  const root = new Tree(treeNode);
  root.SentinelEdge = sentinelEdge;
  graph.Trees.set(sentinel, [root]);
  return graph;
}

function newInactiveGroupingGraph() {
  const graph = new Graph();
  const clusterFirst = n(1, 20, 20);
  const clusterSecond = n(2, 20, 20);
  const sequenceFirst = n(3, 20, 20);
  const sequenceSecond = n(4, 20, 20);
  const external = n(5, 20, 20);
  [clusterFirst, clusterSecond, sequenceFirst, sequenceSecond, external].forEach((node, index) => {
    node.TopLeft = new Point(index * 30, 0);
    graph.addNodeUnchecked(node);
  });
  const clusterVessel = n(9, 60, 20);
  const cluster = new Cluster({
    Vessel: clusterVessel,
    Nodes: [clusterFirst, clusterSecond],
    Arrangement: ClusterArrangement.Row,
    Graph: graph,
  });
  clusterFirst.Cluster = cluster;
  clusterSecond.Cluster = cluster;
  graph.Clusters.set(clusterVessel, cluster);
  const sequenceVessel = n(10, 60, 20);
  const sequence = new Sequence({ Vessel: sequenceVessel, Nodes: [sequenceFirst, sequenceSecond], Graph: graph });
  sequenceFirst.Sequence = sequence;
  sequenceSecond.Sequence = sequence;
  graph.Sequences.set(sequenceVessel, sequence);
  const clusterEdge = graph.connect(clusterFirst, external);
  const sequenceEdge = graph.connect(sequenceFirst, external);
  cluster.EdgeAbductions = [new EdgeAbduction({
    Edge: clusterEdge, OriginallyFrom: clusterFirst, OriginallyTo: external, CurrentFrom: clusterVessel, CurrentTo: external,
  })];
  sequence.EdgeAbductions = [new EdgeAbduction({
    Edge: sequenceEdge, OriginallyFrom: sequenceFirst, OriginallyTo: external, CurrentFrom: sequenceVessel, CurrentTo: external,
  })];
  graph.Hubs.set(external, [clusterVessel, sequenceVessel]);
  return graph;
}

function newSharedGroupingVesselGraph() {
  const graph = new Graph();
  const clusterFirst = graph.addNode(n(1, 20, 20));
  const clusterSecond = graph.addNode(n(2, 20, 20));
  const sequenceFirst = graph.addNode(n(3, 20, 20));
  const sequenceSecond = graph.addNode(n(4, 20, 20));
  const sharedVessel = n(9, 60, 20);
  const cluster = new Cluster({ Vessel: sharedVessel, Nodes: [clusterFirst, clusterSecond], Graph: graph });
  clusterFirst.Cluster = cluster;
  clusterSecond.Cluster = cluster;
  graph.Clusters.set(sharedVessel, cluster);
  const sequence = new Sequence({ Vessel: sharedVessel, Nodes: [sequenceFirst, sequenceSecond], Graph: graph });
  sequenceFirst.Sequence = sequence;
  sequenceSecond.Sequence = sequence;
  graph.Sequences.set(sharedVessel, sequence);
  return graph;
}

function newSlice50RouteGraph() {
  const graph = new Graph();
  graph.CellSize = 20;
  const container = n(1, 400, 400);
  container.TopLeft = new Point(0, 0);
  graph.addNewNodeToContainer(null, container);
  const a = n(2, 20, 20);
  a.TopLeft = new Point(10, 10);
  graph.addNewNodeToContainer(container, a);
  const b = n(3, 20, 20);
  b.TopLeft = new Point(500, 10);
  graph.addNewNodeToContainer(null, b);
  const edge = graph.connect(a, b);
  edge.ID = 7n;
  for (let i = 0; i < 300; i++) {
    edge.Points.push(new Point(i, i % 7));
  }
  const loop = graph.connect(b, b);
  loop.ID = 8n;
  loop.Points = [new Point(500, 0), new Point(520, 0)];
  a.addNear(b);
  graph.Directions.set(null, Orientation.Bottom);
  graph.Directions.set(container, Orientation.TopLeft);
  return graph;
}

function newClusterVesselIDCollisionGraph() {
  const graph = new Graph();
  graph.addNodeUnchecked(n(1, 10, 10));
  const collidingVessel = n(1, 20, 10);
  graph.Clusters.set(collidingVessel, new Cluster({ Vessel: collidingVessel, Graph: graph }));
  return graph;
}

function newSequenceVesselIDCollisionGraph() {
  const graph = new Graph();
  graph.addNodeUnchecked(n(1, 10, 10));
  const first = graph.addNode(n(2, 10, 10));
  const second = graph.addNode(n(3, 10, 10));
  const collidingVessel = n(1, 20, 10);
  const sequence = new Sequence({ Vessel: collidingVessel, Nodes: [first, second], Graph: graph });
  first.Sequence = sequence;
  second.Sequence = sequence;
  graph.Sequences.set(collidingVessel, sequence);
  return graph;
}

function newSelfContainingClusterGraph() {
  const graph = new Graph();
  const vessel = n(1, 10, 10);
  graph.Clusters.set(vessel, new Cluster({ Vessel: vessel, Container: vessel, Graph: graph }));
  return graph;
}

function newSelfContainingSequenceGraph() {
  const graph = new Graph();
  const first = graph.addNode(n(2, 10, 10));
  const second = graph.addNode(n(3, 10, 10));
  const vessel = n(1, 10, 10);
  const sequence = new Sequence({ Vessel: vessel, Container: vessel, Nodes: [first, second], Graph: graph });
  first.Sequence = sequence;
  second.Sequence = sequence;
  graph.Sequences.set(vessel, sequence);
  return graph;
}

function treeOf(node, sentinelEdge) {
  const tree = new Tree(node);
  tree.SentinelEdge = sentinelEdge;
  return tree;
}

function newTreeNodeIDCollisionGraph() {
  const graph = new Graph();
  const sentinel = graph.addNode(n(1, 10, 10));
  const declaredNode = graph.addNode(n(2, 10, 10));
  const sentinelEdge = graph.connect(sentinel, declaredNode);
  sentinelEdge.ID = 3n;
  const collidingNode = n(2, 20, 10);
  graph.Trees.set(sentinel, [treeOf(collidingNode, sentinelEdge)]);
  return graph;
}

function newTreeSentinelEdgeIDCollisionGraph() {
  const graph = new Graph();
  const sentinel = graph.addNode(n(1, 10, 10));
  const treeNode = graph.addNode(n(2, 10, 10));
  const declaredEdge = graph.connect(sentinel, treeNode);
  declaredEdge.ID = 3n;
  const collidingEdge = new Edge(sentinel, treeNode);
  collidingEdge.ID = 3n;
  collidingEdge.MinWidth = 1;
  graph.Trees.set(sentinel, [treeOf(treeNode, collidingEdge)]);
  return graph;
}

function newTreeNodeAuxiliaryReuseGraph() {
  const graph = new Graph();
  const sentinel = graph.addNode(n(1, 10, 10));
  const sharedNode = n(2, 10, 10);
  graph.Clusters.set(sharedNode, new Cluster({ Vessel: sharedNode, Graph: graph }));
  const sentinelEdge = new Edge(sentinel, sharedNode);
  sentinelEdge.ID = 3n;
  graph.Trees.set(sentinel, [treeOf(sharedNode, sentinelEdge)]);
  return graph;
}

function newDuplicateTreeNodeOwnershipGraph() {
  const graph = new Graph();
  const firstSentinel = graph.addNode(n(1, 10, 10));
  const secondSentinel = graph.addNode(n(2, 10, 10));
  const firstTreeNode = n(3, 10, 10);
  const secondTreeNode = n(3, 10, 10);
  const firstEdge = new Edge(firstSentinel, firstTreeNode);
  firstEdge.ID = 4n;
  const secondEdge = new Edge(secondSentinel, secondTreeNode);
  secondEdge.ID = 5n;
  graph.Trees.set(firstSentinel, [treeOf(firstTreeNode, firstEdge)]);
  graph.Trees.set(secondSentinel, [treeOf(secondTreeNode, secondEdge)]);
  return graph;
}

function newContainerChildAliasGraph() {
  const graph = new Graph();
  graph.addNode(n(1, 10, 10));
  graph.Containers.set(null, [n(1, 10, 10)]);
  return graph;
}

function newInactiveVesselContainerChildGraph() {
  const graph = new Graph();
  const vessel = n(1, 10, 10);
  graph.Clusters.set(vessel, new Cluster({ Vessel: vessel, Graph: graph }));
  graph.Containers.set(null, [vessel]);
  return graph;
}

function newHubSpokeAliasGraph() {
  const graph = new Graph();
  const hub = graph.addNode(n(1, 10, 10));
  graph.addNode(n(2, 10, 10));
  graph.Hubs.set(hub, [n(2, 10, 10)]);
  return graph;
}

const SWEEP_BUILDERS = {
  "empty": () => new Graph(),
  "layout state": newCloneParityGraph,
  "detached tree records": newDetachedTreeGraph,
  "inactive grouping vessels": newInactiveGroupingGraph,
  "shared inactive grouping vessel": newSharedGroupingVesselGraph,
  "long route": newSlice50RouteGraph,
};

const FAILURE_BUILDERS = {
  "cluster vessel id collision": newClusterVesselIDCollisionGraph,
  "sequence vessel id collision": newSequenceVesselIDCollisionGraph,
  "cluster contains itself": newSelfContainingClusterGraph,
  "sequence contains itself": newSelfContainingSequenceGraph,
  "tree node id collision": newTreeNodeIDCollisionGraph,
  "tree sentinel edge id collision": newTreeSentinelEdgeIDCollisionGraph,
  "tree node repeats grouping vessel": newTreeNodeAuxiliaryReuseGraph,
  "duplicate tree ownership": newDuplicateTreeNodeOwnershipGraph,
  "container child alias": newContainerChildAliasGraph,
  "container child inactive vessel": newInactiveVesselContainerChildGraph,
  "hub spoke alias": newHubSpokeAliasGraph,
};

// ---- Summaries mirroring the Go oracle ---------------------------------------

const id = (node) => (node == null ? -1 : Number(node.ID));
const ids = (nodes) => nodes.map(id);
const byKey = (a, b) => a.key - b.key;

function summarize(graph) {
  const containers = [...graph.Containers.entries()].map(([k, v]) => ({ key: id(k), values: ids(v) })).sort(byKey);
  const group = (g) => ({
    vessel: id(g.Vessel),
    members: ids(g.Nodes),
    container: id(g.Container),
    abductions: g.EdgeAbductions.length,
    attached: g.Vessel.Graph != null,
  });
  const nears = [];
  for (const node of graph.Nodes) {
    if (node.Nears.size === 0) continue;
    nears.push({ key: id(node), values: ids([...node.Nears]).sort((a, b) => a - b) });
  }
  return {
    nodeIds: ids(graph.Nodes),
    edges: graph.Edges.map((e) => ({ id: Number(e.ID), from: id(e.From), to: id(e.To), points: e.Points.length })),
    containers,
    clusters: [...graph.Clusters.values()].map(group).sort((a, b) => a.vessel - b.vessel),
    sequences: [...graph.Sequences.values()].map(group).sort((a, b) => a.vessel - b.vessel),
    hubs: [...graph.Hubs.entries()].map(([k, v]) => ({ key: id(k), values: ids(v) })).sort(byKey),
    trees: [...graph.Trees.entries()].map(([k, v]) => ({ key: id(k), values: v.map((t) => id(t.Node)) })).sort(byKey),
    directions: [...graph.Directions.entries()].map(([k, v]) => ({ key: id(k), direction: v })).sort(byKey),
    nears,
    cellSize: graph.CellSize,
    rootHierarchy: graph.IsRootHierarchy,
  };
}

// deepSnapshot captures every source-owned value Clone could plausibly touch.
function deepSnapshot(graph) {
  const nodeState = (node) => node == null ? null : ({
    id: id(node),
    w: node.Width,
    h: node.Height,
    tl: node.TopLeft ? [node.TopLeft.X, node.TopLeft.Y] : null,
    graph: node.Graph === graph ? "self" : node.Graph == null ? null : "other",
    container: id(node.Container),
    isContainer: Boolean(node.isContainer),
    isClusterVessel: Boolean(node.isClusterVessel),
    edges: (node.Edges ?? []).length,
    nears: ids([...node.Nears]).sort((a, b) => a - b),
    labelFixed: node.Label ? node.Label.PositionFixed() : null,
    iconFixed: node.Icon ? node.Icon.PositionFixed() : null,
    herd: node.HerdAssignment != null,
    loop: node.LoopOffsets != null,
    hierarchy: node.Hierarchy != null,
    cluster: node.Cluster != null,
    sequence: node.Sequence != null,
  });
  const allNodes = new Set(graph.Nodes);
  for (const c of graph.Clusters.values()) { allNodes.add(c.Vessel); c.Nodes.forEach((x) => allNodes.add(x)); }
  for (const s of graph.Sequences.values()) { allNodes.add(s.Vessel); s.Nodes.forEach((x) => allNodes.add(x)); }
  for (const roots of graph.Trees.values()) roots.forEach((t) => allNodes.add(t.Node));
  return JSON.stringify({
    summary: summarize(graph),
    nodes: [...allNodes].map(nodeState),
    edges: graph.Edges.map((e) => ({ points: e.Points.map((p) => [p.X, p.Y]), curve: Boolean(e.IsCurve), style: e.Style })),
    costs: [graph.crossingCost, graph.turnCost, graph.nonCenterPortCost, graph.edgeLengthCache.size],
    commonUncle: graph.CommonUncleSiblings == null ? null : graph.CommonUncleSiblings.size,
  });
}

describe("Clone(ctx, source) Go oracle parity", () => {
  for (const sweep of oracle.sweeps) {
    describe(sweep.name, () => {
      it("matches the Go clone structure and ctx.Err() call count", () => {
        const source = SWEEP_BUILDERS[sweep.name]();
        const before = deepSnapshot(source);
        const ctx = new CountContext();
        const cloned = Clone(ctx, source);
        expect(ctx.calls).toBe(sweep.errCalls);
        expect(summarize(cloned)).toEqual(sweep.summary);
        expect(deepSnapshot(source)).toBe(before);
      });

      it("cancels at every ctx.Err() index with Go's error and never mutates the source", () => {
        expect(sweep.cancelErrors.length).toBe(sweep.errCalls);
        for (let cancelAt = 1; cancelAt <= sweep.errCalls; cancelAt++) {
          const source = SWEEP_BUILDERS[sweep.name]();
          const before = deepSnapshot(source);
          const ctx = new CountContext(cancelAt);
          let result;
          let thrown = null;
          try {
            result = Clone(ctx, source);
          } catch (err) {
            thrown = err;
          }
          expect(result).toBeUndefined();
          expect(thrown).toBeInstanceOf(WorkCanceledError);
          expect(thrown.message).toBe(sweep.cancelErrors[cancelAt - 1]);
          expect(thrown.cause).toBe(ctx.canceled);
          expect(deepSnapshot(source)).toBe(before);
        }
      });

      it("legacy cloneGraph produces the same structure", () => {
        expect(summarize(cloneGraph(SWEEP_BUILDERS[sweep.name]()))).toEqual(sweep.summary);
      });
    });
  }

  for (const failure of oracle.failures) {
    it(`rejects ${failure.name} with Go's exact error and an unchanged source`, () => {
      const source = FAILURE_BUILDERS[failure.name]();
      const before = deepSnapshot(source);
      let thrown = null;
      let result;
      try {
        result = Clone(backgroundWorkContext(), source);
      } catch (err) {
        thrown = err;
      }
      expect(result).toBeUndefined();
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).toBe(failure.error);
      expect(deepSnapshot(source)).toBe(before);
    });
  }
});

describe("Clone(ctx, source) contract", () => {
  it("rejects a nil context before a nil graph", () => {
    expect(() => Clone(null, null)).toThrow("TALA CloneGraph requires a context");
    expect(() => Clone(undefined, new Graph())).toThrow("TALA CloneGraph requires a context");
  });

  it("rejects a nil graph", () => {
    expect(() => Clone(backgroundWorkContext(), null)).toThrow("cannot clone a nil graph");
  });

  it("cloneGraphWithContext is the same function", () => {
    expect(cloneGraphWithContext).toBe(Clone);
  });

  it("observes a pre-canceled context without publishing a clone", () => {
    const source = newCloneParityGraph();
    const before = deepSnapshot(source);
    const ctx = new CountContext(1);
    expect(() => Clone(ctx, source)).toThrow("CloneGraph: context canceled");
    expect(ctx.calls).toBe(1);
    expect(deepSnapshot(source)).toBe(before);
  });

  it("observes cancellation during the route copy (Go TestCloneObservesCancellationDuringCopy)", () => {
    const graph = new Graph();
    const from = n(1, 10, 10);
    const to = n(2, 10, 10);
    graph.addNodeUnchecked(from);
    graph.addNodeUnchecked(to);
    const edge = graph.connect(from, to);
    for (let i = 0; i < 256; i++) edge.Points.push(new Point(i, i));
    // Cancel two Err() calls after the topology preflight: the copy guard's
    // opening Check is the first, its first stride poll (inside the 256-point
    // route copy) is the second.
    const preflight = new CountContext();
    validateEngineGraph(preflight, "CloneGraph", graph);
    const ctx = new CountContext(preflight.calls + 2);
    const before = deepSnapshot(graph);
    expect(() => Clone(ctx, graph)).toThrow("CloneGraph: context canceled");
    expect(ctx.calls).toBe(preflight.calls + 2);
    expect(deepSnapshot(graph)).toBe(before);
  });

  it("preserves costs and resets derived state (Go TestClonePreservesCostsAndResetsDerivedState)", () => {
    const source = new Graph();
    const node = n(1, 10, 10);
    source.addNodeUnchecked(node);
    source.crossingCost = 11;
    source.turnCost = 12;
    source.nonCenterPortCost = 13;
    source.edgeLengthCache.set(99, 14);
    const cloned = Clone(backgroundWorkContext(), source);
    expect([cloned.crossingCost, cloned.turnCost, cloned.nonCenterPortCost]).toEqual([11, 12, 13]);
    expect(cloned.edgeLengthCache.size).toBe(0);
    cloned.edgeLengthCache.set(1, 2);
    expect(source.edgeLengthCache.has(1)).toBe(false);
  });

  it("does not compute lazy costs on the source", () => {
    const source = newCloneParityGraph();
    Clone(backgroundWorkContext(), source);
    expect([source.crossingCost, source.turnCost, source.nonCenterPortCost]).toEqual([0, 0, 0]);
  });

  it("rejects a duplicate zero-ID edge record (Go TestCloneRejectsDuplicateZeroIDEdgeRecord)", () => {
    const source = new Graph();
    const from = source.addNode(n(1, 10, 10));
    const to = source.addNode(n(2, 10, 10));
    const edge = source.connect(from, to);
    source.Edges.push(edge);
    expect(() => Clone(backgroundWorkContext(), source)).toThrow("duplicate edge record");
  });

  it("rejects grouping vessel key mismatches (Go TestCloneRejectsGroupingVesselKeyMismatch)", () => {
    const clusterSource = new Graph();
    const key = clusterSource.addNode(n(1, 10, 10));
    const vessel = clusterSource.addNode(n(2, 10, 10));
    clusterSource.Clusters.set(key, new Cluster({ Vessel: vessel, Graph: clusterSource }));
    expect(() => Clone(backgroundWorkContext(), clusterSource)).toThrow("record vessel differs");

    const sequenceSource = new Graph();
    const sKey = sequenceSource.addNode(n(1, 10, 10));
    const sVessel = sequenceSource.addNode(n(2, 10, 10));
    const first = sequenceSource.addNode(n(3, 10, 10));
    const second = sequenceSource.addNode(n(4, 10, 10));
    sequenceSource.Sequences.set(sKey, new Sequence({ Vessel: sVessel, Nodes: [first, second], Graph: sequenceSource }));
    expect(() => Clone(backgroundWorkContext(), sequenceSource)).toThrow("record vessel differs");
  });

  it("owns independent graph state (Go TestCloneOwnsIndependentGraphState)", () => {
    const source = newCloneParityGraph();
    const cloned = Clone(backgroundWorkContext(), source);
    const sourceEdge = source.Edges[0];
    const clonedEdge = cloned.Edges[0];
    expect(clonedEdge).not.toBe(sourceEdge);
    expect(clonedEdge.From).not.toBe(sourceEdge.From);
    expect(clonedEdge.Points[0]).not.toBe(sourceEdge.Points[0]);
    expect(clonedEdge.Style.Stroke).not.toBe(sourceEdge.Style.Stroke);
    clonedEdge.Points[0].X++;
    clonedEdge.Style.Stroke.Value = "changed";
    expect(sourceEdge.Points[0].X).toBe(90);
    expect(sourceEdge.Style.Stroke.Value).toBe("blue");

    const cluster = [...cloned.Clusters.values()][0];
    expect(cluster.Graph).toBe(cloned);
    expect(cluster.Vessel.Graph).toBe(cloned);
    expect(cluster.Vessel.isClusterVessel).toBe(true);
    expect(cluster.Nodes[0].Cluster).toBe(cluster);
    expect(cluster.EdgeAbductions[0].Edge).toBe(cloned.Edges[0]);
    const sequence = [...cloned.Sequences.values()][0];
    expect(sequence.Nodes[0].Sequence).toBe(sequence);
    expect(sequence.EdgeAbductions[0].Edge).toBe(cloned.Edges[1]);

    const clonedTree = [...cloned.Trees.values()][0][0];
    expect(cloned.NodeToTree.get(clonedTree.Node)).toBe(clonedTree);
    expect(clonedTree.SentinelEdge).toBe(cloned.Edges[2]);
    expect(clonedTree.Orientation).toBe(Orientation.Right);

    const clonedContainer = cloned.Nodes.find((node) => node.ID === 1n);
    expect(clonedContainer.Label.PositionFixed()).toBe(false);
    expect(clonedContainer.Icon.PositionFixed()).toBe(false);
    expect(clonedContainer.Label.Position).toBe(LabelPosition.InsideTopCenter);
    expect(clonedContainer.Icon.Position).toBe(LabelPosition.InsideTopLeft);
    expect(clonedContainer.HerdAssignment).toBeNull();
    expect(clonedContainer.LoopOffsets).toBeNull();
    expect(clonedContainer.LongDistanceNeighborRequirements).toBeNull();
    expect(clonedEdge.IsCurve).toBeFalsy();
    expect(cloned.CommonUncleSiblings).toBeNull();

    const hierarchy = clonedContainer.Hierarchy;
    expect(hierarchy).not.toBe(source.Nodes[0].Hierarchy);
    expect(hierarchy.Levels().get(clonedContainer)).toBe(0);
    expect(hierarchy.LevelCount).toBe(0);

    const [hubSpokes] = [...cloned.Hubs.values()];
    expect(hubSpokes[0]).toBe(cluster.Vessel);
    expect(hubSpokes[1]).toBe(sequence.Vessel);
  });

  it("keeps inactive grouping vessels detached (Go TestCloneKeepsInactiveVesselsDetached)", () => {
    const cloned = Clone(backgroundWorkContext(), newInactiveGroupingGraph());
    const cluster = [...cloned.Clusters.values()][0];
    const sequence = [...cloned.Sequences.values()][0];
    expect(cluster.Vessel.Graph).toBeNull();
    expect(sequence.Vessel.Graph).toBeNull();
    expect(cluster.Graph).toBe(cloned);
    expect(sequence.Graph).toBe(cloned);
  });

  it("preserves JS-only ELK metadata without charging work", () => {
    const source = newSlice50RouteGraph();
    source.ID = "root";
    source.elkData = { id: "root" };
    const a = source.Nodes[1];
    a.D2ID = "a";
    a.elkData = { id: "a" };
    source.nodesByExternalId.set("a", a);
    source.nodesByEntityId.set(a.ID, a);
    source.edgesByExternalId.set("e7", source.Edges[0]);
    source.edgesByEntityId.set(7n, source.Edges[0]);
    source.endpoints.set("a", { kind: "node", node: a });
    source.endpoints.set("a.p", { kind: "port", node: a, port: { side: "EAST" } });
    source.Edges[0].sourceEndpointId = "a.p";
    source.Edges[0].elkData = { id: "e7" };

    const plain = new CountContext();
    Clone(plain, newSlice50RouteGraph());
    const ctx = new CountContext();
    const cloned = Clone(ctx, source);
    expect(ctx.calls).toBe(plain.calls);

    const clonedA = cloned.nodesByExternalId.get("a");
    expect(clonedA).toBe(cloned.Nodes[1]);
    expect(clonedA.D2ID).toBe("a");
    expect(clonedA.elkData).toEqual({ id: "a" });
    expect(clonedA.elkData).not.toBe(a.elkData);
    expect(cloned.nodesByEntityId.get(2n)).toBe(clonedA);
    expect(cloned.edgesByExternalId.get("e7")).toBe(cloned.Edges[0]);
    expect(cloned.edgesByEntityId.get(7n)).toBe(cloned.Edges[0]);
    expect(cloned.endpoints.get("a").node).toBe(clonedA);
    expect(cloned.endpoints.get("a.p").port).toEqual({ side: "EAST" });
    expect(cloned.Edges[0].sourceEndpointId).toBe("a.p");
    expect(cloned.ID).toBe("root");
    expect(cloned.elkData).toEqual({ id: "root" });
  });

  it("canonicalizes non-axis directions to NONE", () => {
    const cloned = Clone(backgroundWorkContext(), newSlice50RouteGraph());
    const container = cloned.Nodes.find((node) => node.ID === 1n);
    expect(cloned.Directions.get(null)).toBe(Orientation.Bottom);
    expect(cloned.Directions.get(container)).toBe(Orientation.NONE);
  });
});
