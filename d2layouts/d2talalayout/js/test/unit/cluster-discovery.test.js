/**
 * Slice 13 Unit Tests – Cluster Discovery Index and Classification
 *
 * Pinned Go reference: internal/grouping/cluster_discovery.go
 * Parity test reference: internal/grouping/cluster_discovery_parity_test.go
 *
 * Tests cover:
 * 1. ClusterEdgeSignature.add / arrowTypeCount / matches
 * 2. clusterIsDescendantOfGuarded (ancestry traversal, cycle detection, limit)
 * 3. clusterHasLeakyEdgeGuarded (container leak detection)
 * 4. buildClusterDiscoveryIndex (neighbor order, signature, toTableColumn, noClustering)
 * 5. Node.adjacent parity correction (returns edge.From fallback)
 * 6. Edge direction helper parity (isBidirectional / isUndirected / isDirected)
 */

import { describe, expect, test } from "bun:test";

import {
  Graph,
  Node,
  Edge,
  WorkGuard,
  backgroundWorkContext,
  MAX_ENGINE_WORK_UNITS,
} from "../../src/index.js";

import {
  ClusterEdgeSignature,
  buildClusterDiscoveryIndex,
  clusterIsDescendantOfGuarded,
  clusterHasLeakyEdgeGuarded,
  clusterIncidentEdges,
} from "../../src/grouping/index.js";

import { NO_ARROWHEAD } from "../../src/graph/edge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGuard(limit = MAX_ENGINE_WORK_UNITS) {
  return new WorkGuard(backgroundWorkContext(), "TestGuard", limit);
}

function newNode(id, width = 10, height = 10) {
  const n = new Node(BigInt(id), width, height);
  return n;
}

function connectNodes(g, from, to) {
  return g.connect(from, to);
}

// ---------------------------------------------------------------------------
// 1. Edge direction helpers parity
// ---------------------------------------------------------------------------
describe("Edge direction helpers (Slice 13 prerequisite parity)", () => {
  test("isUndirected: both arrowheads empty string", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    // Default: SourceArrowhead="" TargetArrowhead="" -> undirected
    expect(edge.isUndirected()).toBe(true);
    expect(edge.isBidirectional()).toBe(false);
    expect(edge.isDirected()).toBe(false);
  });

  test("isUndirected: both arrowheads are NoArrowhead sentinel", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.SourceArrowhead = NO_ARROWHEAD;
    edge.TargetArrowhead = NO_ARROWHEAD;
    expect(edge.isUndirected()).toBe(true);
  });

  test("isBidirectional: both ends have visible arrowheads", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.SourceArrowhead = "triangle";
    edge.TargetArrowhead = "triangle";
    expect(edge.isBidirectional()).toBe(true);
    expect(edge.isDirected()).toBe(false);
    expect(edge.isUndirected()).toBe(false);
  });

  test("isDirected: only target arrowhead set", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.TargetArrowhead = "triangle";
    expect(edge.isDirected()).toBe(true);
    expect(edge.isBidirectional()).toBe(false);
    expect(edge.isUndirected()).toBe(false);
  });

  test("isDirected: only source arrowhead set", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.SourceArrowhead = "triangle";
    expect(edge.isDirected()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Node.adjacent parity correction
// ---------------------------------------------------------------------------
describe("Node.adjacent parity (returns edge.From as fallback)", () => {
  test("returns edge.To when node is edge.From", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    expect(a.adjacent(edge)).toBe(b);
  });

  test("returns edge.From when node is edge.To", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    expect(b.adjacent(edge)).toBe(a);
  });

  test("returns edge.From when node is unrelated (Go parity: fallback to edge.From)", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const c = newNode(3);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, c);
    const edge = connectNodes(g, a, b);
    // c is not a or b — Go returns edge.From as the fallback
    expect(c.adjacent(edge)).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// 3. ClusterEdgeSignature unit tests
// ---------------------------------------------------------------------------
describe("ClusterEdgeSignature", () => {
  test("empty signature: zero counts and empty arrowhead sets", () => {
    const sig = new ClusterEdgeSignature();
    expect(sig.from).toBe(0);
    expect(sig.to).toBe(0);
    expect(sig.directed).toBe(0);
    expect(sig.bidirectional).toBe(0);
    expect(sig.undirected).toBe(0);
    expect(sig.fromArrowheads.size).toBe(0);
    expect(sig.toArrowheads.size).toBe(0);
  });

  test("arrowTypeCount is 0 for empty signature", () => {
    const sig = new ClusterEdgeSignature();
    expect(sig.arrowTypeCount()).toBe(0);
  });

  test("arrowTypeCount counts distinct direction types", () => {
    const sig = new ClusterEdgeSignature();
    sig.directed = 1;
    expect(sig.arrowTypeCount()).toBe(1);
    sig.undirected = 1;
    expect(sig.arrowTypeCount()).toBe(2);
    sig.bidirectional = 1;
    expect(sig.arrowTypeCount()).toBe(3);
  });

  test("add: undirected edge increments undirected and from/to arrowhead sets", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    // undirected by default (no arrowheads)
    const sig = new ClusterEdgeSignature();
    sig.add(a, edge);
    expect(sig.from).toBe(1);
    expect(sig.to).toBe(0);
    expect(sig.undirected).toBe(1);
    expect(sig.directed).toBe(0);
    expect(sig.bidirectional).toBe(0);
  });

  test("add: directed edge increments directed", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.TargetArrowhead = "triangle";
    const sig = new ClusterEdgeSignature();
    sig.add(a, edge);
    expect(sig.directed).toBe(1);
    expect(sig.undirected).toBe(0);
  });

  test("add: bidirectional edge increments bidirectional", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.SourceArrowhead = "triangle";
    edge.TargetArrowhead = "triangle";
    const sig = new ClusterEdgeSignature();
    sig.add(a, edge);
    expect(sig.bidirectional).toBe(1);
  });

  test("add: arrowhead swap for non-From node perspective", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.SourceArrowhead = "diamond";
    edge.TargetArrowhead = "triangle";
    const sigA = new ClusterEdgeSignature();
    sigA.add(a, edge); // a is From
    const sigB = new ClusterEdgeSignature();
    sigB.add(b, edge); // b is To
    // From a's perspective: fromArrowheads={"diamond"}, toArrowheads={"triangle"}
    expect(sigA.fromArrowheads.has("diamond")).toBe(true);
    expect(sigA.toArrowheads.has("triangle")).toBe(true);
    // From b's perspective: fromArrowheads={"triangle"}, toArrowheads={"diamond"}
    expect(sigB.fromArrowheads.has("triangle")).toBe(true);
    expect(sigB.toArrowheads.has("diamond")).toBe(true);
  });

  test("matches: identical undirected signatures match", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const c = newNode(3);
    const d = newNode(4);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, c);
    g.addNewNodeToContainer(null, d);
    const e1 = connectNodes(g, a, b);
    const e2 = connectNodes(g, c, d);
    const s1 = new ClusterEdgeSignature();
    s1.add(a, e1);
    const s2 = new ClusterEdgeSignature();
    s2.add(c, e2);
    expect(s1.matches(s2)).toBe(true);
  });

  test("matches: different direction type (directed vs undirected) does not match", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const c = newNode(3);
    const d = newNode(4);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, c);
    g.addNewNodeToContainer(null, d);
    const e1 = connectNodes(g, a, b);
    const e2 = connectNodes(g, c, d);
    e2.TargetArrowhead = "triangle";
    const s1 = new ClusterEdgeSignature();
    s1.add(a, e1);
    const s2 = new ClusterEdgeSignature();
    s2.add(c, e2);
    // from counts differ: a has 1 from, c has 1 from — same
    // but undirected=1 vs directed=1 → arrowTypeCount differs
    expect(s1.matches(s2)).toBe(false);
  });

  test("matches: mixed arrowTypes (>1) never matches", () => {
    const sig = new ClusterEdgeSignature();
    sig.from = 1;
    sig.directed = 1;
    sig.undirected = 1;
    const other = new ClusterEdgeSignature();
    other.from = 1;
    other.directed = 1;
    other.undirected = 1;
    expect(sig.matches(other)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. clusterIsDescendantOfGuarded
// ---------------------------------------------------------------------------
describe("clusterIsDescendantOfGuarded", () => {
  test("node is its own ancestor", () => {
    const guard = createGuard();
    const a = newNode(1);
    expect(clusterIsDescendantOfGuarded(a, a, guard)).toBe(true);
  });

  test("null descendant against null ancestor returns true", () => {
    const guard = createGuard();
    expect(clusterIsDescendantOfGuarded(null, null, guard)).toBe(true);
  });

  test("null descendant against non-null ancestor returns false", () => {
    const guard = createGuard();
    const a = newNode(1);
    expect(clusterIsDescendantOfGuarded(null, a, guard)).toBe(false);
  });

  test("node with Container traverses up to ancestor", () => {
    const guard = createGuard();
    const parent = newNode(1);
    const child = newNode(2);
    child.Container = parent;
    expect(clusterIsDescendantOfGuarded(child, parent, guard)).toBe(true);
  });

  test("node not related to ancestor returns false", () => {
    const guard = createGuard();
    const a = newNode(1);
    const b = newNode(2);
    expect(clusterIsDescendantOfGuarded(a, b, guard)).toBe(false);
  });

  test("traverses through Cluster.Vessel", () => {
    const guard = createGuard();
    const vessel = newNode(100);
    vessel.isClusterVessel = true;
    const member = newNode(2);
    member.Cluster = { Vessel: vessel };
    expect(clusterIsDescendantOfGuarded(member, vessel, guard)).toBe(true);
  });

  test("traverses through Sequence.Vessel", () => {
    const guard = createGuard();
    const vessel = newNode(100);
    const step = newNode(2);
    step.Sequence = { Vessel: vessel };
    expect(clusterIsDescendantOfGuarded(step, vessel, guard)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. clusterHasLeakyEdgeGuarded
// ---------------------------------------------------------------------------
describe("clusterHasLeakyEdgeGuarded", () => {
  test("non-container node always returns false", () => {
    const g = new Graph();
    const a = newNode(1);
    g.addNewNodeToContainer(null, a);
    const guard = createGuard();
    expect(clusterHasLeakyEdgeGuarded(g, a, guard)).toBe(false);
  });

  test("container with edge entirely inside returns false", () => {
    const g = new Graph();
    const container = newNode(1, 100, 100);
    const child = newNode(2);
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(container, child);
    // internal edge: container → child
    connectNodes(g, container, child);
    const guard = createGuard();
    expect(clusterHasLeakyEdgeGuarded(g, container, guard)).toBe(false);
  });

  test("container with child edge going outside returns true", () => {
    const g = new Graph();
    const container = newNode(1, 100, 100);
    const child = newNode(2);
    const external = newNode(3);
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(container, child);
    g.addNewNodeToContainer(null, external);
    connectNodes(g, child, external);
    const guard = createGuard();
    expect(clusterHasLeakyEdgeGuarded(g, container, guard)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. buildClusterDiscoveryIndex — basic structure
// ---------------------------------------------------------------------------
describe("buildClusterDiscoveryIndex basic structure", () => {
  test("empty graph with no nodes produces empty index", () => {
    const g = new Graph();
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, [], guard);
    expect(index.infos.size).toBe(0);
    expect(index.edgeOrder.size).toBe(0);
  });

  test("single root node is indexed", () => {
    const g = new Graph();
    const a = newNode(1, 20, 30);
    g.addNewNodeToContainer(null, a);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    expect(index.infos.has(a)).toBe(true);
    const info = index.infos.get(a);
    expect(info.estimatedWidth).toBe(20);
    expect(info.estimatedHeight).toBe(30);
  });

  test("noClustering set for loop node", () => {
    const g = new Graph();
    const a = newNode(1);
    g.addNewNodeToContainer(null, a);
    // self-loop
    const edge = connectNodes(g, a, a);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    expect(index.infos.get(a).noClustering).toBe(true);
  });

  test("noClustering set for sequence vessel", () => {
    const g = new Graph();
    const vessel = newNode(1);
    g.addNewNodeToContainer(null, vessel);
    g.Sequences.set(vessel, { Vessel: vessel, Nodes: [], EdgeAbductions: [] });
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    expect(index.infos.get(vessel).noClustering).toBe(true);
  });

  test("toTableColumn flag set when edge has FromTableColumnIndex", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    edge.FromTableColumnIndex = 0;
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    // Go sets toTableColumn on every node whose Edges list contains a table-column
    // edge, regardless of From/To role. So both a and b get it.
    expect(index.infos.get(a).toTableColumn).toBe(true);
    expect(index.infos.get(b).toTableColumn).toBe(true);
  });

  test("edgeOrder follows graph.Edges insertion order", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const c = newNode(3);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, c);
    const e0 = connectNodes(g, a, b);
    const e1 = connectNodes(g, b, c);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    expect(index.edgeOrder.get(e0)).toBe(0);
    expect(index.edgeOrder.get(e1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. buildClusterDiscoveryIndex — neighbor order parity
// ---------------------------------------------------------------------------
describe("buildClusterDiscoveryIndex neighbor order parity", () => {
  test("neighbors match unique adjacency traversal via node.Edges", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const c = newNode(3);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, c);
    connectNodes(g, a, b);
    connectNodes(g, a, c);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    const info = index.infos.get(a);
    // a's edges are [a→b, a→c]; adjacent(a→b)=b, adjacent(a→c)=c
    expect(info.neighbors).toEqual([b, c]);
    expect(info.neighborSet.has(b)).toBe(true);
    expect(info.neighborSet.has(c)).toBe(true);
  });

  test("duplicate edges produce unique neighbor only once", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    connectNodes(g, a, b);
    connectNodes(g, a, b); // second edge to same node
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    const info = index.infos.get(a);
    expect(info.neighbors).toHaveLength(1);
    expect(info.neighbors[0]).toBe(b);
  });

  test("malformed adjacency (node in Edges but not an endpoint) uses Go fallback", () => {
    // Go's adjacent returns edge.From when node is neither endpoint.
    // This mirrors the TestClusterDiscoveryIndexMatchesLegacyEdgeScan setup
    // where a subset of edges is surgically removed from one endpoint's list
    // without removing from graph.Edges.
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const observer = newNode(5); // malformed observer
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, observer);
    const edge = connectNodes(g, a, b);
    // Manually inject the edge into observer's list (malformed)
    observer.addEdge(edge);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    const info = index.infos.get(observer);
    // Go: observer.Adjacent(edge) returns edge.From = a (the fallback)
    expect(info.neighbors).toContain(a);
  });
});

// ---------------------------------------------------------------------------
// 8. buildClusterDiscoveryIndex — edge signature parity
// ---------------------------------------------------------------------------
describe("buildClusterDiscoveryIndex edge signature parity", () => {
  test("signature from/to counts match from/to role of node for each edge", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    connectNodes(g, a, b); // a is From, b is To
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    const sigA = index.infos.get(a).edgeSignature;
    const sigB = index.infos.get(b).edgeSignature;
    expect(sigA.from).toBe(1);
    expect(sigA.to).toBe(0);
    expect(sigB.from).toBe(0);
    expect(sigB.to).toBe(1);
  });

  test("two nodes with identical undirected edges to same neighbor: signatures match", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const hub = newNode(3);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, hub);
    connectNodes(g, a, hub);
    connectNodes(g, b, hub);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    const sA = index.infos.get(a).edgeSignature;
    const sB = index.infos.get(b).edgeSignature;
    // Both have: from=1, to=0, undirected=1, same (empty-string) arrowhead sets
    expect(sA.matches(sB)).toBe(true);
  });

  test("mixed direction types: arrowTypeCount > 1 prevents match", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const hub = newNode(3);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, hub);
    const e1 = connectNodes(g, a, hub);
    const e2 = connectNodes(g, a, hub);
    e1.TargetArrowhead = "triangle"; // directed
    // e2: undirected (default)
    // Now a has both directed and undirected edges → arrowTypeCount=2
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    const sig = index.infos.get(a).edgeSignature;
    expect(sig.arrowTypeCount()).toBeGreaterThan(1);
    // Self comparison also fails since arrowTypeCount > 1
    expect(sig.matches(sig)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. buildClusterDiscoveryIndex — sequence neighbor recovery
// ---------------------------------------------------------------------------
describe("buildClusterDiscoveryIndex sequence neighbor recovery", () => {
  test("sequence vessel is resolved back to original node", () => {
    const g = new Graph();
    const first = newNode(1);
    const step = newNode(2);
    const vessel = newNode(3);
    g.addNewNodeToContainer(null, first);
    // vessel is in the graph as a root node
    g.addNewNodeToContainer(null, vessel);

    const edge = connectNodes(g, first, vessel);
    const sequence = {
      Vessel: vessel,
      Nodes: [step],
      Graph: g,
      EdgeAbductions: [
        {
          Edge: edge,
          OriginallyTo: step,
          CurrentFrom: first,
          CurrentTo: vessel,
        },
      ],
    };
    g.Sequences.set(vessel, sequence);

    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);
    // first's neighbor should resolve to step (not vessel)
    const info = index.infos.get(first);
    expect(info.neighbors).toContain(step);
    expect(info.neighbors).not.toContain(vessel);
  });
});

// ---------------------------------------------------------------------------
// 10. clusterIncidentEdges — order and deduplication
// ---------------------------------------------------------------------------
describe("clusterIncidentEdges", () => {
  test("returns edges incident to cluster nodes sorted by graph-edge order", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    const external = newNode(3);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    g.addNewNodeToContainer(null, external);
    const e0 = connectNodes(g, a, external);
    const e1 = connectNodes(g, b, external);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);

    const fakeCluster = { Nodes: [a, b], Vessel: null };
    const guard2 = createGuard();
    const edges = clusterIncidentEdges(
      fakeCluster,
      index.infos,
      index.edgeOrder,
      guard2
    );
    expect(edges).toHaveLength(2);
    expect(edges[0]).toBe(e0);
    expect(edges[1]).toBe(e1);
  });

  test("shared edge is returned only once", () => {
    const g = new Graph();
    const a = newNode(1);
    const b = newNode(2);
    g.addNewNodeToContainer(null, a);
    g.addNewNodeToContainer(null, b);
    const edge = connectNodes(g, a, b);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);

    const fakeCluster = { Nodes: [a, b], Vessel: null };
    const guard2 = createGuard();
    const edges = clusterIncidentEdges(
      fakeCluster,
      index.infos,
      index.edgeOrder,
      guard2
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toBe(edge);
  });

  test("throws if cluster node has no info entry", () => {
    const g = new Graph();
    const a = newNode(1);
    const orphan = newNode(99); // not added to graph, not indexed
    g.addNewNodeToContainer(null, a);
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, null, guard);

    const fakeCluster = { Nodes: [orphan], Vessel: null };
    const guard2 = createGuard();
    expect(() =>
      clusterIncidentEdges(fakeCluster, index.infos, index.edgeOrder, guard2)
    ).toThrow(/TALA AddClusters cannot find cluster member index/);
  });
});

// ---------------------------------------------------------------------------
// 11. buildClusterDiscoveryIndex — leaky container noClustering classification
// ---------------------------------------------------------------------------
describe("buildClusterDiscoveryIndex noClustering leaky classification parity", () => {
  test("non-leaky container is not excluded from clustering", () => {
    const g = new Graph();
    const container = newNode(1, 100, 100);
    const child = newNode(2);
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(container, child);
    connectNodes(g, container, child); // purely internal
    const containerOrder = g.ContainerRDFSOrder(null, createGuard());
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, containerOrder, guard);
    expect(index.infos.get(container).noClustering).toBe(false);
  });

  test("leaky container is excluded from clustering", () => {
    const g = new Graph();
    const container = newNode(1, 100, 100);
    const child = newNode(2);
    const external = newNode(3);
    g.addNewNodeToContainer(null, container);
    g.addNewNodeToContainer(container, child);
    g.addNewNodeToContainer(null, external);
    connectNodes(g, child, external);
    const containerOrder = g.ContainerRDFSOrder(null, createGuard());
    const guard = createGuard();
    const index = buildClusterDiscoveryIndex(g, containerOrder, guard);
    expect(index.infos.get(container).noClustering).toBe(true);
  });
});
