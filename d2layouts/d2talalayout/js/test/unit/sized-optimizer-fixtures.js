// Shared Slice 45 scenario builders. Mirrors s45Spec.build and the pinned
// cluster fixture in internal/placement (Go test code). Not a test file.
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import { Box } from '../../src/geometry/box.js';
import { Orientation } from '../../src/geometry/orientation.js';
import { Cluster, ClusterArrangement } from '../../src/graph/cluster.js';
import { EdgeAbduction } from '../../src/graph/edge-abduction.js';
import { HerdAssignment } from '../../src/graph/herd-assignment.js';
import { addCluster } from '../../src/grouping/clusters-mutation.js';
import { GoRand } from '../../src/random/go-math-rand.js';
import { backgroundWorkContext } from '../../src/limits/work-context.js';
import { newSizedOptimizer } from '../../src/placement/sized-optimizer.js';

export const bg = backgroundWorkContext();
export const CLUSTER_CACHE_SENTINEL = 0xc1a57en;

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

// newOptimizeClustersFixtures(1) from cluster_optimization_atomicity_test.go
export function clusterFixture() {
  const graph = new Graph();
  const id = 1;
  const x = 1000;
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
  graph.CellSize = 200;
  graph.storeEdgeLengthCost(CLUSTER_CACHE_SENTINEL, 17);
  graph.restoreRoutingCosts({ Crossing: 3, Turn: 5, NonCenterPort: 7 });
  return { graph, cluster, nodes: [a, b, c1, c2, vessel] };
}

/** Mirrors s45Spec.build. */
export function buildSpec(spec) {
  const built = { nodes: new Map(), abductions: null, obstacles: null, root: null, tracked: [] };
  if (spec.cluster) {
    const fixture = clusterFixture();
    built.g = fixture.graph;
    built.abductions = fixture.cluster.EdgeAbductions;
    built.tracked = fixture.nodes;
    for (const n of fixture.nodes) built.nodes.set(Number(n.ID), n);
    return built;
  }
  const g = new Graph();
  g.CellSize = spec.cellSize ?? 0;
  for (const ns of spec.nodes ?? []) {
    const n = new Node(BigInt(ns.id), ns.w, ns.h);
    if (ns.placed) n.TopLeft = new Point(ns.x, ns.y);
    if (ns.fixed) n.FixedTopLeft = new Point(ns.fx ?? 0, ns.fy ?? 0);
    const container = ns.container ? built.nodes.get(ns.container) : null;
    g.addNewNodeToContainer(container, n);
    built.nodes.set(ns.id, n);
    built.tracked.push(n);
  }
  for (const es of spec.edges ?? []) {
    const e = g.connect(built.nodes.get(es.from), built.nodes.get(es.to));
    e.MinWidth = es.minWidth ?? 0;
    e.MinHeight = es.minHeight ?? 0;
  }
  for (const [owner, near] of spec.nears ?? []) {
    built.nodes.get(owner).Nears.add(built.nodes.get(near));
  }
  for (const h of spec.herds ?? []) {
    const herd = new HerdAssignment();
    herd.Orientation = Orientation[h.orientation];
    herd.Val = h.val ?? 0;
    built.nodes.get(h.node).HerdAssignment = herd;
  }
  for (const hub of spec.hubs ?? []) {
    g.Hubs.set(built.nodes.get(hub.hub), hub.spokes.map((id) => built.nodes.get(id)));
  }
  if (spec.obstacles) {
    built.obstacles = spec.obstacles.map((o) => new Box(new Point(o.x, o.y), o.w, o.h));
  }
  if (spec.root) built.root = built.nodes.get(spec.root);
  if (spec.compute) g.computeCellSize();
  built.g = g;
  return built;
}

export function newOptimizer(built, seed, ctx = bg) {
  const rand = new GoRand(seed);
  const optim = newSizedOptimizer(ctx, built.g, built.root, built.abductions, rand, built.obstacles);
  return { optim, rand };
}

/** Mirrors s45Built.state. */
export function stateOf(built) {
  const st = {
    boxes: built.tracked.map((n) => ({
      id: Number(n.ID),
      placed: n.TopLeft != null,
      x: n.TopLeft != null ? n.TopLeft.X : 0,
      y: n.TopLeft != null ? n.TopLeft.Y : 0,
      w: n.Width,
      h: n.Height,
    })),
    costs: [built.g.crossingCost, built.g.turnCost, built.g.nonCenterPortCost],
    cache: built.g.edgeLengthCacheEntries(),
  };
  const herds = built.tracked.filter((n) => n.HerdAssignment != null).map((n) => n.HerdAssignment.Val);
  if (herds.length > 0) st.herds = herds;
  return st;
}

/** Fixture states omit empty herd lists (Go omitempty). */
export function fixtureState(st) {
  const out = { boxes: st.boxes, costs: st.costs, cache: st.cache };
  if (st.herds) out.herds = st.herds;
  return out;
}

export function geomOf(built) {
  return built.tracked.flatMap((n) => [n.TopLeft.X, n.TopLeft.Y, n.Width, n.Height]);
}

export function pointers(built) {
  return built.tracked.map((n) => n.TopLeft);
}

export function countingContext(cancelAt = 0, canceled = new Error('context canceled')) {
  return {
    calls: 0,
    cancelAt,
    canceled,
    Err() {
      this.calls++;
      return this.cancelAt > 0 && this.calls >= this.cancelAt ? this.canceled : null;
    },
  };
}

export function capture(fn) {
  try {
    return { value: fn(), err: null };
  } catch (err) {
    return { value: undefined, err };
  }
}

export function errorString(err) {
  return err == null ? '' : err.message;
}

export function chainHas(err, target) {
  for (let current = err; current != null; current = current.cause) {
    if (current === target) return true;
  }
  return false;
}
