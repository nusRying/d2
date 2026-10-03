// Slice 44 — replay of internal/placement/go_slice44_oracle_test.go.
// Every expected value (positions, outcomes, errors, and exact work counts)
// comes from pinned Go; graphs are rebuilt from the Go-exported specs.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { addCluster } from '../../src/grouping/clusters-mutation.js';
import { backgroundWorkContext, WorkContext } from '../../src/limits/work-context.js';
import { WorkGuard } from '../../src/limits/work-guard.js';
import { OptimizationWorkGuard } from '../../src/limits/optimization.js';
import { contextWithTransactionWorkGuard } from '../../src/limits/transaction-guard.js';
import { MAX_TRANSACTION_WORK_UNITS } from '../../src/limits/constants.js';
import { rotateAround, transpose } from '../../src/placement/transpose.js';
import { optimizeClusters } from '../../src/placement/cluster-optimization.js';
import {
  gapNormalization,
  isBetween,
  nearestBetween,
  nearestConnectedAhead,
} from '../../src/placement/gap-reduction.js';
import { LayoutAxis, TraversalDirection } from '../../src/placement/axis.js';
import { Transaction } from '../../src/graph/transaction.js';
import {
  OptimizerSpatialIndex,
  indexedCanMove,
  indexedDoesOverlap,
  indexedIsOccupied,
} from '../../src/placement/optimizer-spatial-index.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'go-slice44-reference.json'), 'utf8'),
);

const bg = backgroundWorkContext();
const CANCELED = new Error('context canceled');
const LOCATION = 'Slice44PlacementOracle';

// ── Helpers mirroring the Go oracle ──────────────────────────────────────────

function buildSpec(spec) {
  const g = new Graph();
  g.CellSize = spec.cellSize;
  const nodes = new Map();
  for (const ns of spec.nodes) {
    const n = new Node(BigInt(ns.id), ns.w, ns.h);
    if (ns.placed) n.TopLeft = new Point(ns.x, ns.y);
    if (ns.fixed) n.FixedTopLeft = new Point(ns.fx ?? 0, ns.fy ?? 0);
    const container = ns.container ? nodes.get(ns.container) : null;
    g.addNewNodeToContainer(container, n);
    nodes.set(ns.id, n);
  }
  for (const es of spec.edges ?? []) {
    g.connect(nodes.get(es.from), nodes.get(es.to));
  }
  return { g, nodes };
}

function boxes(nodes) {
  return nodes.map((n) => ({
    id: Number(n.ID),
    placed: n.TopLeft != null,
    x: n.TopLeft != null ? n.TopLeft.X : 0,
    y: n.TopLeft != null ? n.TopLeft.Y : 0,
    w: n.Width,
    h: n.Height,
  }));
}

function guardContext(limit = MAX_TRANSACTION_WORK_UNITS) {
  const guard = new WorkGuard(bg, LOCATION, limit);
  return { guard, ctx: contextWithTransactionWorkGuard(bg, guard) };
}

function used(guard) {
  return Number(guard.Used());
}

function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
}

function errorString(err) {
  return err == null ? '' : err.message;
}

function chainHas(err, target) {
  for (let current = err; current != null; current = current.cause) {
    if (current === target) return true;
  }
  return false;
}

const SOURCE_DIR = join(import.meta.dir, '..', '..', 'src', 'placement');

function refreshSiteLabels(file) {
  const labels = new Map();
  readFileSync(join(SOURCE_DIR, file), 'utf8').split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/refresh-site: ([\w-]+)/);
    if (match) labels.set(index + 1, match[1]);
  });
  return labels;
}

const REFRESH_SITES = {
  'gap-reduction': refreshSiteLabels('gap-reduction.js'),
  'cluster-optimization': refreshSiteLabels('cluster-optimization.js'),
};

// Records which labelled UpdateState call site returned a failure. The
// failure itself is real (WorkGuard exhaustion inside the GraphState refresh).
function refreshSiteRecorder() {
  const original = Transaction.prototype.updateState;
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const recorder = {
    seen: new Set(),
    last: null,
    lastError: null,
    reset() {
      this.last = null;
      this.lastError = null;
    },
    restore() {
      Transaction.prototype.updateState = original;
      Error.stackTraceLimit = previousLimit;
    },
  };
  Transaction.prototype.updateState = function updateStateRecorded() {
    const err = original.call(this);
    if (err != null) {
      const stack = new Error().stack;
      let label = 'unknown';
      for (const match of stack.matchAll(/(gap-reduction|cluster-optimization)\.js:(\d+):\d+/g)) {
        const found = REFRESH_SITES[match[1]].get(Number(match[2]));
        if (found) {
          label = found;
          break;
        }
      }
      if ((stack.match(/at reduceGapToNeighbors /g) || []).length > 1) label = `nested:${label}`;
      recorder.seen.add(label);
      recorder.last = label;
      recorder.lastError = err;
    }
    return err;
  };
  return recorder;
}

function countingContext(cancelAt = 0) {
  return {
    calls: 0,
    cancelAt,
    Err() {
      this.calls++;
      return this.cancelAt > 0 && this.calls >= this.cancelAt ? CANCELED : null;
    },
  };
}

function pointers(nodes) {
  return nodes.map((n) => n.TopLeft);
}

function expectSamePointers(nodes, saved) {
  nodes.forEach((n, i) => expect(n.TopLeft).toBe(saved[i]));
}

// cluster_optimization_test.go abductClusterEdgesForOptimizationFixture
function abductClusterEdges(cluster) {
  const abductions = [];
  for (const edge of cluster.Graph.Edges) {
    if (edge.From.Cluster === cluster) {
      abductions.push(new EdgeAbduction({
        Edge: edge, OriginallyFrom: edge.From, CurrentFrom: cluster.Vessel, CurrentTo: edge.To,
      }));
      edge.reconnect(cluster.Vessel, false);
    }
    if (edge.To.Cluster === cluster) {
      abductions.push(new EdgeAbduction({
        Edge: edge, OriginallyTo: edge.To, CurrentTo: cluster.Vessel, CurrentFrom: edge.From,
      }));
      edge.reconnect(cluster.Vessel, true);
    }
  }
  cluster.EdgeAbductions = abductions;
}

function placedNode(id, w, h, x, y) {
  const n = new Node(BigInt(id), w, h);
  n.TopLeft = new Point(x, y);
  return n;
}

// cluster_optimization_atomicity_test.go addOptimizeClustersFixture
function addOptimizeClustersFixture(graph, id, x) {
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
  return { graph, cluster, nodes: [a, b, c1, c2, vessel] };
}

const CLUSTER_CACHE_SENTINEL = 0xc1a57en;

function newOptimizeClustersFixtures(count) {
  const graph = new Graph();
  const fixtures = [];
  for (let i = 0; i < count; i++) {
    fixtures.push(addOptimizeClustersFixture(graph, 10 * i + 1, 1000 + 5000 * i));
  }
  graph.CellSize = 200;
  graph.storeEdgeLengthCost(CLUSTER_CACHE_SENTINEL, 17);
  graph.restoreRoutingCosts({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
  return { graph, fixtures };
}

function fixtureNodes(fixtures) {
  return fixtures.flatMap((f) => f.nodes);
}

function clusterRecord(fixtures, graph) {
  return {
    arrangements: fixtures.map((f) => f.cluster.Arrangement),
    desired: fixtures.map((f) => f.cluster.DesiredArrangement),
    paddings: fixtures.map((f) => f.cluster.Padding),
    cellSize: graph.CellSize,
    boxes: boxes(fixtureNodes(fixtures)),
  };
}

const GAP_MODES = {
  'horizontal/forward': [LayoutAxis.Horizontal, TraversalDirection.Forward],
  'horizontal/backward': [LayoutAxis.Horizontal, TraversalDirection.Backward],
  'vertical/forward': [LayoutAxis.Vertical, TraversalDirection.Forward],
  'vertical/backward': [LayoutAxis.Vertical, TraversalDirection.Backward],
};

function runGap(spec, axis, direction, limit = MAX_TRANSACTION_WORK_UNITS) {
  const { g } = buildSpec(spec);
  const initial = boxes(g.Nodes);
  const saved = pointers(g.Nodes);
  const { guard, ctx } = guardContext(limit);
  const result = capture(() => {
    const [txn, err] = g.newRequestTransaction(ctx, { AffectContainers: true });
    if (err != null) throw err;
    return gapNormalization(ctx, g.Nodes, txn, g, { axis, direction });
  });
  return { g, initial, saved, guard, ...result };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Slice 44 — transpose Go oracle replay', () => {
  it('replays rotateAround for 1/2/3 rotations and cell rounding', () => {
    const spec = {
      cellSize: 10,
      nodes: [
        { id: 1, w: 20, h: 20, placed: true, x: 50, y: 50 },
        { id: 2, w: 20, h: 30, placed: true, x: 50, y: 103 },
      ],
    };
    const want = fixture.rotateAround;
    const expected = [[want.x1, want.y1], [want.x2, want.y2], [want.x3, want.y3]];
    for (let k = 1; k <= 3; k++) {
      const { g, nodes } = buildSpec(spec);
      const pointer = nodes.get(2).TopLeft;
      rotateAround(nodes.get(2), g, nodes.get(1), k, false);
      expect([nodes.get(2).TopLeft.X, nodes.get(2).TopLeft.Y]).toEqual(expected[k - 1]);
      expect(nodes.get(2).TopLeft).toBe(pointer);
    }
    const { g, nodes } = buildSpec(spec);
    g.CellSize = 7;
    rotateAround(nodes.get(2), g, nodes.get(1), 1, true);
    expect([nodes.get(2).TopLeft.X, nodes.get(2).TopLeft.Y]).toEqual([want.rx, want.ry]);
  });

  it('replays every node of every seeded graph through both scoring paths', () => {
    const rotations = new Set();
    let changed = 0;
    for (const c of [...fixture.transpose, ...fixture.transposeGuards]) {
      for (const run of c.runs) {
        const { g, nodes } = buildSpec(c.spec);
        const { guard, ctx } = guardContext();
        const result = capture(() => transpose(ctx, g, nodes.get(run.target), c.abductions ? [] : null));
        expect(errorString(result.err)).toBe(run.error);
        expect(result.value ?? false).toBe(run.changed);
        expect(used(guard)).toBe(run.used);
        expect(boxes(g.Nodes)).toEqual(run.boxes);
        if (run.changed) {
          changed++;
          rotations.add(`${c.abductions}/${run.rotations}`);
        }
      }
    }
    // Coverage of the pinned search: wins after 1, 2 and 3 trial rotations on
    // the graph-wide path and on the edge-abduction (NodeEdgeLength) path.
    expect(changed).toBeGreaterThan(10);
    for (const key of ['false/1', 'false/2', 'false/3', 'true/1', 'true/3']) {
      expect(rotations.has(key)).toBe(true);
    }
  });

  it('proves the transpose W / W-1 boundary on the shared transaction guard', () => {
    const want = fixture.transposeBoundary;
    const target = (() => {
      for (const c of fixture.transpose) {
        if (c.abductions) continue;
        for (const run of c.runs) if (run.changed) return { spec: c.spec, id: run.target };
      }
      return null;
    })();
    const measure = (limit) => {
      const { g, nodes } = buildSpec(target.spec);
      const saved = pointers(g.Nodes);
      const { guard, ctx } = guardContext(limit);
      return { g, saved, guard, ...capture(() => transpose(ctx, g, nodes.get(target.id), null)) };
    };
    const full = measure(MAX_TRANSACTION_WORK_UNITS);
    expect(full.err).toBeNull();
    expect(used(full.guard)).toBe(want.w);
    const atW = measure(want.w);
    expect(atW.err).toBeNull();
    expect(atW.value).toBe(true);
    const below = measure(want.w - 1);
    expect(errorString(below.err)).toBe(want.error);
    expect(used(below.guard)).toBe(want.used);
    expect(want.restored).toBe(true);
    expect(boxes(below.g.Nodes)).toEqual(want.boxes);
    expectSamePointers(below.g.Nodes, below.saved);
  });

  it('cancels at every context checkpoint of a successful transpose and restores the graph', () => {
    const target = (() => {
      for (const c of fixture.transpose) {
        if (c.abductions) continue;
        for (const run of c.runs) if (run.changed) return { spec: c.spec, id: run.target };
      }
      return null;
    })();
    {
      const { g, nodes } = buildSpec(target.spec);
      const ctx = countingContext();
      expect(transpose(ctx, g, nodes.get(target.id), null)).toBe(true);
      expect(ctx.calls).toBe(fixture.transposeProbes.length);
    }
    for (const probe of fixture.transposeProbes) {
      const { g, nodes } = buildSpec(target.spec);
      const initial = boxes(g.Nodes);
      const saved = pointers(g.Nodes);
      const ctx = countingContext(probe.cancelAt);
      const result = capture(() => transpose(ctx, g, nodes.get(target.id), null));
      expect(errorString(result.err)).toBe(probe.error);
      expect(chainHas(result.err, CANCELED)).toBe(probe.canceled);
      expect(result.value ?? false).toBe(probe.changed);
      expect(boxes(g.Nodes)).toEqual(initial);
      expect(probe.restored).toBe(true);
      expectSamePointers(g.Nodes, saved);
    }
  });

  it('runs nested optimizeCluster for a transposed vessel on the same guard', () => {
    const want = fixture.transposeVessel;
    const graph = new Graph();
    const a = placedNode(1, 200, 100, 1000, 1000);
    const c1 = placedNode(3, 200, 100, 1400, 1000);
    const c2 = placedNode(4, 200, 100, 1400, 1220);
    const tail = placedNode(2, 200, 100, 1000, 1440);
    for (const n of [a, c1, c2, tail]) graph.addNewNodeToContainer(null, n);
    graph.connect(a, c1);
    graph.connect(a, tail);
    const vessel = placedNode(5, 200, 320, 1400, 1000);
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
    graph.CellSize = 100;
    const { guard, ctx } = guardContext();

    // Every transaction opened while transposing — including those created by
    // the nested optimizeCluster — must charge the one request guard.
    const seen = new Set();
    const original = graph.newRequestTransaction.bind(graph);
    graph.newRequestTransaction = (txCtx, options) => {
      const result = original(txCtx, options);
      seen.add(result[0].guard);
      return result;
    };
    const result = capture(() => transpose(ctx, graph, vessel, null));
    expect(errorString(result.err)).toBe(want.error);
    expect(result.value).toBe(want.changed);
    expect(used(guard)).toBe(want.used);
    expect(cluster.Arrangement).toBe(want.arrangement);
    expect(boxes([a, tail, vessel, c1, c2])).toEqual(want.boxes);
    expect([...seen]).toEqual([guard]);
  });
});

describe('Slice 44 — cluster optimization Go oracle replay', () => {
  const builders = {
    one: () => newOptimizeClustersFixtures(1),
    two: () => newOptimizeClustersFixtures(2),
    'vessel-move-gap': () => {
      const built = newOptimizeClustersFixtures(1);
      built.fixtures[0].nodes[0].TopLeft.X += 200;
      built.fixtures[0].nodes[1].TopLeft.X += 200;
      built.graph.CellSize = 0;
      return built;
    },
    'rejected-flip': () => {
      const built = newOptimizeClustersFixtures(1);
      built.graph.addNewNodeToContainer(null, placedNode(100, 90, 100, 900, 1220));
      built.graph.addNewNodeToContainer(null, placedNode(101, 200, 100, 1210, 1220));
      return built;
    },
    'limit-1': () => newOptimizeClustersFixtures(1),
    'flip-gap-reduce': () => {
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
      return { graph, fixtures: [{ graph, cluster, nodes: [a, b, c1, c2, vessel] }] };
    },
  };

  it('replays OptimizeClusters outcomes, geometry, policy, and exact work', () => {
    for (const want of fixture.cluster) {
      if (want.name === 'empty-canceled') continue;
      const { graph, fixtures } = builders[want.name]();
      const { guard, ctx } = guardContext();
      if (want.name === 'limit-1') guard.SetLimit(1);
      const result = capture(() => optimizeClusters(want.used < 0 ? bg : ctx, graph));
      expect(errorString(result.err)).toBe(want.error);
      expect(result.value ?? false).toBe(want.changed);
      if (want.used >= 0) expect(used(guard)).toBe(want.used);
      expect(clusterRecord(fixtures, graph)).toEqual({
        arrangements: want.arrangements,
        desired: want.desired,
        paddings: want.paddings,
        cellSize: want.cellSize,
        boxes: want.boxes,
      });
    }
  });

  it('preserves the empty-graph context preflight', () => {
    const want = fixture.cluster.find((c) => c.name === 'empty-canceled');
    const ctx = new WorkContext({ isCancelled: () => true });
    const result = capture(() => optimizeClusters(ctx, new Graph()));
    expect(errorString(result.err)).toBe(want.error);
    expect(result.err.cause).toBe(ctx.Err());
    expect(optimizeClusters(bg, new Graph())).toBe(false);
  });

  it('charges the placement-cost snapshot once per stage', () => {
    const measure = (extra) => {
      const { graph } = newOptimizeClustersFixtures(2);
      for (let i = 0; i < extra; i++) graph.storeEdgeLengthCost(CLUSTER_CACHE_SENTINEL + BigInt(i) + 1n, i);
      const { guard, ctx } = guardContext();
      optimizeClusters(ctx, graph);
      return used(guard);
    };
    expect(measure(8) - measure(0)).toBe(fixture.clusterCacheChargeDelta);
  });

  it('proves W / W-1 and restores the whole stage at every limit below W', () => {
    const want = fixture.clusterBoundary;
    const run = (limit) => {
      const { graph, fixtures } = newOptimizeClustersFixtures(2);
      const initial = clusterRecord(fixtures, graph);
      const saved = pointers(fixtureNodes(fixtures));
      const cacheValue = graph.lookupEdgeLengthCost(CLUSTER_CACHE_SENTINEL);
      const cacheCount = graph.edgeLengthCacheEntries();
      const { guard, ctx } = guardContext(limit);
      const result = capture(() => optimizeClusters(ctx, graph));
      return { graph, fixtures, initial, saved, guard, cacheValue, cacheCount, ...result };
    };
    const full = run(MAX_TRANSACTION_WORK_UNITS);
    expect(full.err).toBeNull();
    expect(used(full.guard)).toBe(want.w);
    const atW = run(want.w);
    expect(atW.err).toBeNull();
    expect(atW.value).toBe(true);

    expect(fixture.clusterLimitSweep.length).toBe(want.w - 1);
    const sites = refreshSiteRecorder();
    try {
      for (const point of fixture.clusterLimitSweep) {
        sites.reset();
        const r = run(point.limit);
        expect(errorString(r.err)).toBe(point.error);
        expect(r.value ?? false).toBe(false);
        expect(used(r.guard)).toBe(point.used);
        expect(point.restored).toBe(true);
        expect(clusterRecord(r.fixtures, r.graph)).toEqual(r.initial);
        expectSamePointers(fixtureNodes(r.fixtures), r.saved);
        expect(r.graph.lookupEdgeLengthCost(CLUSTER_CACHE_SENTINEL)).toEqual([17, true]);
        expect(r.graph.edgeLengthCacheEntries()).toBe(1);
        expect(r.graph.routingCosts()).toEqual({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
        if (sites.last != null) expect(r.err).toBe(sites.lastError);
      }
    } finally {
      sites.restore();
    }
    // Some limits fail inside UpdateState right after Commit accepted a
    // candidate (the flip, and the alignment before gap reduction); the whole
    // stage is still restored, including the earlier cluster's accepted flip.
    expect(sites.seen.has('after-flip')).toBe(true);

    const below = run(want.w - 1);
    expect(errorString(below.err)).toBe(want.error);
    expect(used(below.guard)).toBe(want.used);
    expect(boxes(fixtureNodes(below.fixtures))).toEqual(want.boxes);
    expect(want.restored).toBe(true);
  });
});

describe('Slice 44 — cluster optimization refresh-failure sweep', () => {
  it('restores the stage, CellSize, and costs when any refresh fails', () => {
    const sites = refreshSiteRecorder();
    try {
      for (const point of fixture.clusterMoveSweep) {
        sites.reset();
        const { graph, fixtures } = newOptimizeClustersFixtures(1);
        fixtures[0].nodes[0].TopLeft.X += 200;
        fixtures[0].nodes[1].TopLeft.X += 200;
        graph.CellSize = 0;
        const initial = clusterRecord(fixtures, graph);
        const saved = pointers(fixtureNodes(fixtures));
        const { guard, ctx } = guardContext(point.limit);
        const result = capture(() => optimizeClusters(ctx, graph));
        expect(errorString(result.err)).toBe(point.error);
        expect(result.value ?? false).toBe(false);
        expect(used(guard)).toBe(point.used);
        expect(point.restored).toBe(true);
        expect(clusterRecord(fixtures, graph)).toEqual(initial);
        expectSamePointers(fixtureNodes(fixtures), saved);
        expect(graph.lookupEdgeLengthCost(CLUSTER_CACHE_SENTINEL)).toEqual([17, true]);
        expect(graph.edgeLengthCacheEntries()).toBe(1);
        expect(graph.routingCosts()).toEqual({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
        if (sites.last != null) expect(result.err).toBe(sites.lastError);
      }
    } finally {
      sites.restore();
    }
    expect(sites.seen.has('after-flip')).toBe(true);
    expect(sites.seen.has('before-gap-reduction')).toBe(true);
    // Nested gap reduction inside optimizeCluster also refreshes.
    expect([...sites.seen].some((site) => site === 'accepted' || site === 'candidate')).toBe(true);
  });
});

describe('Slice 44 — gap reduction Go oracle replay', () => {
  it('replays gapNormalization on seeded and pinned graphs in all four modes', () => {
    for (const c of fixture.gap) {
      for (const run of c.runs) {
        const [axis, direction] = GAP_MODES[`${run.axis}/${run.direction}`];
        const r = runGap(c.spec, axis, direction);
        expect(errorString(r.err)).toBe(run.error);
        expect(r.value ?? false).toBe(run.changed);
        expect(used(r.guard)).toBe(run.used);
        expect(boxes(r.g.Nodes)).toEqual(run.boxes);
      }
    }
  });

  it('replays isBetween, nearestConnectedAhead, and nearestBetween exhaustively', () => {
    const flags = [[true, true], [true, false], [false, true], [false, false]];
    for (const q of fixture.gapQueries) {
      const { g } = buildSpec(q.spec);
      const isBetweenRows = [];
      const aheadRows = [];
      for (const n of g.Nodes) {
        for (const behind of g.Nodes) {
          for (const ahead of g.Nodes) {
            isBetweenRows.push(flags.map(([h, f]) => (isBetween(n, behind, ahead, h, f) ? '1' : '0')).join(''));
          }
        }
        aheadRows.push(flags.map(([h, f]) => {
          const found = nearestConnectedAhead(n, h, f);
          return found == null ? 0 : Number(found.ID);
        }));
      }
      const betweenRows = [];
      for (const behind of g.Nodes) {
        for (const ahead of g.Nodes) {
          betweenRows.push(flags.map(([h, f]) => {
            const found = nearestBetween(g.Nodes, behind, ahead, null, h, f);
            return found == null ? 0 : Number(found.ID);
          }));
        }
      }
      expect(isBetweenRows).toEqual(q.isBetween);
      expect(aheadRows).toEqual(q.nearestAhead);
      expect(betweenRows).toEqual(q.nearestBetween);
    }
  });

  it('proves gapNormalization W / W-1 on the shared guard', () => {
    const spec = fixture.gap.find((c) => c.name === 'symmetry').spec;
    const want = fixture.gapBoundary;
    const full = runGap(spec, LayoutAxis.Horizontal, TraversalDirection.Forward);
    expect(full.err).toBeNull();
    expect(used(full.guard)).toBe(want.w);
    const atW = runGap(spec, LayoutAxis.Horizontal, TraversalDirection.Forward, want.w);
    expect(atW.err).toBeNull();

    const below = runGap(spec, LayoutAxis.Horizontal, TraversalDirection.Forward, want.w - 1);
    expect(errorString(below.err)).toBe(want.error);
    expect(used(below.guard)).toBe(want.used);
    expect(boxes(below.g.Nodes)).toEqual(want.boxes);
    expectSamePointers(below.g.Nodes, below.saved);
  });

  it('fails at every limit below W exactly like Go, covering every refresh site', () => {
    const sites = refreshSiteRecorder();
    try {
      for (const sweep of fixture.gapRefreshSweep) {
        const spec = fixture.gap.find((c) => c.name === sweep.name).spec;
        const [axis, direction] = GAP_MODES[`${sweep.axis}/${sweep.direction}`];
        expect(used(runGap(spec, axis, direction).guard)).toBe(sweep.w);
        expect(sweep.points.length).toBe(sweep.w - 1);
        for (const point of sweep.points) {
          sites.reset();
          const r = runGap(spec, axis, direction, point.limit);
          expect(errorString(r.err)).toBe(point.error);
          expect(used(r.guard)).toBe(point.used);
          // A failed refresh rolls back to the previous valid rollback point:
          // the geometry is exactly pinned Go's, never the rejected candidate.
          expect(r.g.Nodes.flatMap((n) => [n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height])).toEqual(point.geom);
          expectSamePointers(r.g.Nodes, r.saved);
          if (sites.last != null) {
            expect(r.err).toBe(sites.lastError);
          }
        }
      }
    } finally {
      sites.restore();
    }
    for (const site of ['candidate', 'backward', 'accepted', 'container-side', 'container-side-accepted', 'gap-normalization']) {
      expect(sites.seen.has(site)).toBe(true);
    }
    expect([...sites.seen].some((site) => site.startsWith('nested:'))).toBe(true);
  });
});

describe('Slice 44 — optimizer spatial index Go oracle replay', () => {
  function applyMutation(g, nodes, mutation, afterRebuild) {
    switch (mutation) {
      case 'nan':
        if (!afterRebuild) nodes.get(2).TopLeft.X = NaN;
        break;
      case 'inf':
        if (!afterRebuild) nodes.get(2).Width = Infinity;
        break;
      case 'negative':
        if (!afterRebuild) nodes.get(2).Width = -5;
        break;
      case 'duplicate':
        if (!afterRebuild) {
          nodes.get(3).TopLeft.X = nodes.get(2).TopLeft.X;
          nodes.get(3).TopLeft.Y = nodes.get(2).TopLeft.Y;
          nodes.get(5).TopLeft.X = nodes.get(2).TopLeft.X;
          nodes.get(5).TopLeft.Y = nodes.get(2).TopLeft.Y;
        }
        break;
      case 'staleCount':
        if (afterRebuild) g.addNewNodeToContainer(null, placedNode(9999, 10, 10, 15, 15));
        break;
      default:
        break;
    }
  }

  it('matches indexed and legacy results and exact optimization work', () => {
    for (const c of fixture.spatial) {
      const { g, nodes } = buildSpec(c.spec);
      applyMutation(g, nodes, c.mutation, false);
      const optim = { g, spatialIndex: new OptimizerSpatialIndex() };
      const guard = new OptimizationWorkGuard(bg, 'Slice44SpatialOracle', 1n << 40n);
      if (c.mutation === 'staleGraph') {
        optim.spatialIndex.rebuild(buildSpec(c.spec).g, guard);
      } else {
        optim.spatialIndex.rebuild(g, guard);
      }
      expect(Number(guard.Used())).toBe(c.rebuildUsed);
      applyMutation(g, nodes, c.mutation, true);
      const measure = (fn) => {
        const before = guard.Used();
        const value = fn();
        return [value, Number(guard.Used() - before)];
      };
      for (const q of c.queries) {
        const mover = nodes.get(q.mover);
        const point = new Point(q.x, q.y);
        const [overlaps, overlapUsed] = measure(() => indexedDoesOverlap(optim, mover, point, null, guard));
        expect([overlaps, overlapUsed]).toEqual([q.overlaps, q.overlapUsed]);
        const [[occupant, occupied], occupyUsed] = measure(() => indexedIsOccupied(optim, point, guard));
        expect([occupant == null ? 0 : Number(occupant.ID), occupied, occupyUsed]).toEqual([q.occupant, q.occupied, q.occupyUsed]);
        const [canMove, canMoveUsed] = measure(() => indexedCanMove(optim, mover, point, guard));
        expect([canMove, canMoveUsed]).toEqual([q.canMove, q.canMoveUsed]);
        const exceptions = [g.Nodes[0], g.Nodes[Math.floor(g.Nodes.length / 2)]];
        const [excepted, exceptUsed] = measure(() => indexedDoesOverlap(optim, mover, point, exceptions, guard));
        expect([excepted, exceptUsed]).toEqual([q.excepted, q.exceptUsed]);
      }
    }
  });

  it('keeps first-graph-index occupancy for duplicate positions', () => {
    const c = fixture.spatial.find((s) => s.name === 'duplicate-occupancy');
    const { g, nodes } = buildSpec(c.spec);
    applyMutation(g, nodes, 'duplicate', false);
    const optim = { g, spatialIndex: new OptimizerSpatialIndex() };
    const guard = new OptimizationWorkGuard(bg, 'Slice44SpatialOracle', 1n << 40n);
    optim.spatialIndex.rebuild(g, guard);
    const [occupant, occupied] = indexedIsOccupied(optim, new Point(nodes.get(2).TopLeft.X, nodes.get(2).TopLeft.Y), guard);
    expect(occupied).toBe(true);
    expect(occupant).toBe(nodes.get(2));
  });
});
