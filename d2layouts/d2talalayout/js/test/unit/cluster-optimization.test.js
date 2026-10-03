// Slice 44 — cluster optimization atomicity. Ports the pinned Go tests in
// internal/placement/cluster_optimization_atomicity_test.go and
// cluster_optimization_test.go.
import { describe, it, expect } from 'bun:test';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { addCluster } from '../../src/grouping/clusters-mutation.js';
import { backgroundWorkContext, WorkContext } from '../../src/limits/work-context.js';
import { WorkGuard, WorkLimitError } from '../../src/limits/work-guard.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import {
  alignConnectedNodes,
  alignVessel,
  optimizeCluster,
  optimizeClusters,
} from '../../src/placement/cluster-optimization.js';

const bg = backgroundWorkContext();
const CACHE_SENTINEL = 0xc1a57en;
const CANCELED = new Error('context canceled');

function placedNode(id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  return n;
}

function abductClusterEdges(cluster) {
  const abductions = [];
  for (const edge of cluster.Graph.Edges) {
    if (edge.From.Cluster === cluster) {
      abductions.push(new EdgeAbduction({ Edge: edge, OriginallyFrom: edge.From, CurrentFrom: cluster.Vessel, CurrentTo: edge.To }));
      edge.reconnect(cluster.Vessel, false);
    }
    if (edge.To.Cluster === cluster) {
      abductions.push(new EdgeAbduction({ Edge: edge, OriginallyTo: edge.To, CurrentTo: cluster.Vessel, CurrentFrom: edge.From }));
      edge.reconnect(cluster.Vessel, true);
    }
  }
  cluster.EdgeAbductions = abductions;
}

function addFixture(graph, id, x) {
  const a = placedNode(id, 200, 100, x, 1000);
  const c1 = placedNode(id + 2, 200, 100, x, 1220);
  const c2 = placedNode(id + 3, 200, 100, x, 1440);
  const b = placedNode(id + 1, 200, 100, x, 1660);
  for (const node of [a, b, c1, c2]) graph.addNewNodeToContainer(null, node);
  graph.connect(a, c1);
  graph.connect(a, c2);
  graph.connect(c1, b);
  graph.connect(c2, b);
  const vessel = placedNode(id + 4, 200, 320, x, 1220);
  const cluster = new Cluster({
    Nodes: [c1, c2],
    Graph: graph,
    Arrangement: ClusterArrangement.Column,
    DesiredArrangement: ClusterArrangement.Column,
    Vessel: vessel,
  });
  vessel.setClusterVessel(true);
  addCluster(graph, cluster);
  abductClusterEdges(cluster);
  return { cluster, nodes: [a, b, c1, c2, vessel] };
}

function newFixtures(count) {
  const graph = new Graph();
  const fixtures = [];
  for (let i = 0; i < count; i++) fixtures.push(addFixture(graph, 10 * i + 1, 1000 + 5000 * i));
  graph.CellSize = 200;
  graph.storeEdgeLengthCost(CACHE_SENTINEL, 17);
  graph.restoreRoutingCosts({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
  return { graph, fixtures };
}

// optimizeClustersStateSnapshot
function captureState(graph, fixtures) {
  const nodes = fixtures.flatMap((f) => f.nodes).map((node) => ({
    node, pointer: node.TopLeft, x: node.TopLeft.X, y: node.TopLeft.Y, w: node.Width, h: node.Height,
  }));
  const clusters = fixtures.map((f) => ({
    cluster: f.cluster, arrangement: f.cluster.Arrangement, desired: f.cluster.DesiredArrangement, padding: f.cluster.Padding,
  }));
  return {
    nodes,
    clusters,
    cellSize: graph.CellSize,
    routeCosts: graph.routingCosts(),
    cache: graph.lookupEdgeLengthCost(CACHE_SENTINEL),
    cacheCount: graph.edgeLengthCacheEntries(),
    assertRestored() {
      for (const want of nodes) {
        expect(want.node.TopLeft).toBe(want.pointer);
        expect([want.node.TopLeft.X, want.node.TopLeft.Y, want.node.Width, want.node.Height]).toEqual([want.x, want.y, want.w, want.h]);
      }
      for (const want of clusters) {
        expect([want.cluster.Arrangement, want.cluster.DesiredArrangement, want.cluster.Padding])
          .toEqual([want.arrangement, want.desired, want.padding]);
      }
      expect(graph.CellSize).toBe(this.cellSize);
      expect(graph.routingCosts()).toEqual(this.routeCosts);
      expect(graph.lookupEdgeLengthCost(CACHE_SENTINEL)).toEqual(this.cache);
      expect(graph.edgeLengthCacheEntries()).toBe(this.cacheCount);
    },
  };
}

function stackContains(name) {
  return new Error().stack.includes(`at ${name} `);
}

function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
}

function chainHas(err, target) {
  for (let current = err; current != null; current = current.cause) {
    if (current === target) return true;
  }
  return false;
}

describe('Slice 44 — OptimizeClusters whole-stage atomicity', () => {
  it('restores the desired arrangement on a work-limit failure (TestOptimizeClustersWorkLimitRestoresDesiredArrangement)', () => {
    const { graph, fixtures } = newFixtures(1);
    const snapshot = captureState(graph, fixtures);
    const guard = new WorkGuard(bg, 'OptimizeClustersAtomicity', MAX_TRANSACTION_WORK_UNITS);
    guard.SetLimit(1);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    const result = capture(() => optimizeClusters(ctx, graph));
    expect(result.value).toBeUndefined();
    expect(result.err).toBeInstanceOf(WorkLimitError);
    expect(result.err.message).toContain('work exceeds limit 1');
    expect(Number(guard.Used())).toBe(2);
    snapshot.assertRestored();
  });

  it('restores an accepted flip when scoring is canceled (TestOptimizeClustersCancellationRestoresAcceptedFlip)', () => {
    const { graph, fixtures } = newFixtures(1);
    const snapshot = captureState(graph, fixtures);
    let observed = false;
    const ctx = {
      Err() {
        if (fixtures[0].cluster.Arrangement === ClusterArrangement.Row && stackContains('edgeLength')) {
          observed = true;
          return CANCELED;
        }
        return null;
      },
    };
    const result = capture(() => optimizeClusters(ctx, graph));
    expect(result.value).toBeUndefined();
    expect(chainHas(result.err, CANCELED)).toBe(true);
    expect(observed).toBe(true);
    snapshot.assertRestored();
  });

  it('restores an accepted flip before rethrowing a panic (TestOptimizeClustersPanicRestoresAcceptedFlip)', () => {
    const { graph, fixtures } = newFixtures(1);
    const snapshot = captureState(graph, fixtures);
    const sentinel = { name: 'OptimizeClusters panic' };
    let observed = false;
    const ctx = {
      Err() {
        if (fixtures[0].cluster.Arrangement === ClusterArrangement.Row && stackContains('edgeLength')) {
          observed = true;
          throw sentinel;
        }
        return null;
      },
    };
    const result = capture(() => optimizeClusters(ctx, graph));
    expect(result.err).toBe(sentinel);
    expect(observed).toBe(true);
    snapshot.assertRestored();
  });

  it('restores an earlier cluster when a later cluster fails (TestOptimizeClustersLaterClusterFailureRestoresEarlierCluster)', () => {
    const { graph, fixtures } = newFixtures(2);
    const snapshot = captureState(graph, fixtures);
    const order = graph.clusterRDFSOrder();
    expect(order.length).toBe(2);
    expect(order[0]).toBe(fixtures[0].cluster.Vessel);
    let observed = false;
    const ctx = {
      Err() {
        if (fixtures[0].cluster.Arrangement === ClusterArrangement.Row &&
            fixtures[1].cluster.DesiredArrangement === ClusterArrangement.Row) {
          observed = true;
          return CANCELED;
        }
        return null;
      },
    };
    const result = capture(() => optimizeClusters(ctx, graph));
    expect(result.value).toBeUndefined();
    expect(chainHas(result.err, CANCELED)).toBe(true);
    expect(observed).toBe(true);
    snapshot.assertRestored();
  });

  it('restores placement costs written before cancellation (TestOptimizeClustersCancellationRestoresPlacementCosts)', () => {
    const { graph, fixtures } = newFixtures(1);
    const snapshot = captureState(graph, fixtures);
    const entrySize = graph.edgeLengthCacheEntries();
    let observed = false;
    const ctx = {
      Err() {
        if (graph.edgeLengthCacheEntries() > entrySize) {
          observed = true;
          return CANCELED;
        }
        return null;
      },
    };
    const result = capture(() => optimizeClusters(ctx, graph));
    expect(chainHas(result.err, CANCELED)).toBe(true);
    expect(observed).toBe(true);
    snapshot.assertRestored();
  });

  it('restores a computed CellSize (TestOptimizeClustersCancellationRestoresComputedCellSize)', () => {
    const { graph, fixtures } = newFixtures(1);
    fixtures[0].nodes[0].TopLeft.X += 200;
    fixtures[0].nodes[1].TopLeft.X += 200;
    graph.CellSize = 0;
    const snapshot = captureState(graph, fixtures);
    let observed = false;
    const ctx = {
      Err() {
        if (graph.CellSize !== 0) {
          observed = true;
          return CANCELED;
        }
        return null;
      },
    };
    const result = capture(() => optimizeClusters(ctx, graph));
    expect(chainHas(result.err, CANCELED)).toBe(true);
    expect(observed).toBe(true);
    snapshot.assertRestored();
  });

  it('keeps the desired arrangement when every flip candidate is rejected (TestOptimizeClustersRejectedFlipRetainsDesiredArrangement)', () => {
    const { graph, fixtures } = newFixtures(1);
    graph.addNewNodeToContainer(null, placedNode(100, 90, 100, 900, 1220));
    graph.addNewNodeToContainer(null, placedNode(101, 200, 100, 1210, 1220));
    expect(optimizeClusters(bg, graph)).toBe(false);
    expect(fixtures[0].cluster.Arrangement).toBe(ClusterArrangement.Column);
    expect(fixtures[0].cluster.DesiredArrangement).toBe(ClusterArrangement.Row);
  });

  it('commits a successful stage without replacing TopLeft pointers (TestOptimizeClustersSuccessCommitsStage)', () => {
    const { graph, fixtures } = newFixtures(1);
    const pointers = fixtures[0].nodes.map((n) => n.TopLeft);
    expect(optimizeClusters(bg, graph)).toBe(true);
    expect(fixtures[0].cluster.Arrangement).toBe(ClusterArrangement.Row);
    expect(fixtures[0].cluster.DesiredArrangement).toBe(ClusterArrangement.Row);
    fixtures[0].nodes.forEach((n, i) => expect(n.TopLeft).toBe(pointers[i]));
  });

  it('preserves the empty-graph context preflight (TestOptimizeClustersEmptyGraphPreservesContextPreflight)', () => {
    expect(optimizeClusters(bg, new Graph())).toBe(false);
    const canceled = new WorkContext({ isCancelled: () => true });
    const result = capture(() => optimizeClusters(canceled, new Graph()));
    expect(result.err.cause).toBe(canceled.Err());
  });

  it('charges the placement-cost snapshot once (TestOptimizeClustersChargesPlacementCostSnapshotOnce)', () => {
    const measure = (extra) => {
      const { graph } = newFixtures(2);
      for (let i = 0; i < extra; i++) graph.storeEdgeLengthCost(CACHE_SENTINEL + BigInt(i) + 1n, i);
      const guard = new WorkGuard(bg, 'OptimizeClustersCacheCharge', MAX_TRANSACTION_WORK_UNITS);
      optimizeClusters(contextWithTransactionWorkGuard(bg, guard), graph);
      return Number(guard.Used());
    };
    expect(measure(8) - measure(0)).toBe(8);
  });

  it('flips and gap-reduces a misoriented cluster (TestFlipClustersGapReduce)', () => {
    const a = placedNode(1, 200, 100, 1000, 1000);
    const c1 = placedNode(3, 200, 100, 1000, 1220);
    const c2 = placedNode(4, 200, 100, 1000, 1440);
    const b = placedNode(2, 200, 100, 1000, 1660);
    const graph = new Graph();
    for (const node of [a, b, c1, c2]) graph.addNewNodeToContainer(null, node);
    graph.computeCellSize();
    graph.connect(a, c1);
    graph.connect(a, c2);
    graph.connect(c1, b);
    graph.connect(c2, b);
    const vessel = placedNode(5, 200, 320, 1000, 1220);
    const cluster = new Cluster({
      Nodes: [c1, c2],
      Graph: graph,
      Arrangement: ClusterArrangement.Column,
      DesiredArrangement: ClusterArrangement.Row,
      Vessel: vessel,
    });
    vessel.setClusterVessel(true);
    addCluster(graph, cluster);
    abductClusterEdges(cluster);
    optimizeClusters(bg, graph);
    expect(a.TopLeft.Y).toBe(1000);
    expect(c1.TopLeft.Y).toBe(c2.TopLeft.Y);
    expect(b.TopLeft.Y).toBeLessThan(1750);
  });
});

describe('Slice 44 — optimizeCluster shared transaction budget', () => {
  it('reuses the caller guard for every transaction it opens', () => {
    const { graph, fixtures } = newFixtures(1);
    const guard = new WorkGuard(bg, 'SharedClusterGuard', MAX_TRANSACTION_WORK_UNITS);
    const ctx = contextWithTransactionWorkGuard(bg, guard);
    const guards = new Set();
    const original = graph.newRequestTransaction.bind(graph);
    graph.newRequestTransaction = (txCtx, options) => {
      const created = original(txCtx, options);
      guards.add(created[0].guard);
      return created;
    };
    expect(optimizeCluster(ctx, fixtures[0].cluster, false)).toBe(true);
    expect([...guards]).toEqual([guard]);
    expect(Number(guard.Used())).toBeGreaterThan(0);
  });

  it('aligns connected nodes and the vessel along the arrangement axis', () => {
    const { graph, fixtures } = newFixtures(1);
    const { cluster, nodes } = fixtures[0];
    nodes[0].TopLeft.X += 30;
    alignConnectedNodes(cluster, true);
    expect(nodes[0].TopLeft.X).toBe(cluster.Vessel.TopLeft.X + cluster.Vessel.Width / 2 - nodes[0].Width / 2);
    nodes[0].TopLeft.X += 40;
    nodes[1].TopLeft.X += 40;
    const before = cluster.Vessel.TopLeft.X;
    alignVessel(cluster, true);
    expect(cluster.Vessel.TopLeft.X).toBe(before + 40);
    expect(graph.CellSize).toBe(200);
  });
});
