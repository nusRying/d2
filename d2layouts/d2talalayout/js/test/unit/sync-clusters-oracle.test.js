import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Point } from "../../src/geometry/point.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, "../fixtures/go-sync-clusters-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf8"));

function parseNumberClass(s) {
  if (s == null) return null;
  if (s === "NaN") return NaN;
  if (s === "+Inf" || s === "+Infinity" || s === "Infinity") return Infinity;
  if (s === "-Inf" || s === "-Infinity") return -Infinity;
  return parseFloat(s);
}

function expectNumMatch(actual, expectedStr) {
  const expected = parseNumberClass(expectedStr);
  if (Number.isNaN(expected)) {
    expect(Number.isNaN(actual)).toBe(true);
  } else {
    expect(actual).toBe(expected);
  }
}

describe("Slice 25 — RDFS Traversal Parity Oracle Replay", () => {
  it("replays ordinary_leaf", () => {
    const sc = reference.rdfsScenarios.ordinary_leaf;
    const g = new Graph();
    const n = new Node(1, 50, 50);
    n.Graph = g;

    const visited = [];
    let panicked = false;
    try {
      n.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays ordinary_nil_graph_panics_before_callback", () => {
    const sc = reference.rdfsScenarios.ordinary_nil_graph_panics_before_callback;
    const n = new Node(1, 50, 50);
    n.Graph = null;

    const visited = [];
    let panicked = false;
    try {
      n.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays container_missing_children_key_succeeds", () => {
    const sc = reference.rdfsScenarios.container_missing_children_key_succeeds;
    const g = new Graph();
    const n = new Node(1, 50, 50);
    n.Graph = g;
    n.isContainer = true;

    const visited = [];
    let panicked = false;
    try {
      n.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays container_postorder", () => {
    const sc = reference.rdfsScenarios.container_postorder;
    const g = new Graph();
    const root = new Node(1, 50, 50);
    root.Graph = g;
    root.isContainer = true;
    const childA = new Node(2, 20, 20);
    childA.Graph = g;
    const childB = new Node(3, 20, 20);
    childB.Graph = g;
    g.Containers.set(root, [childA, childB]);

    const visited = [];
    let panicked = false;
    try {
      root.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays nested_container_postorder", () => {
    const sc = reference.rdfsScenarios.nested_container_postorder;
    const g = new Graph();
    const A = new Node(1, 100, 100);
    A.Graph = g;
    A.isContainer = true;
    const B = new Node(2, 60, 60);
    B.Graph = g;
    B.isContainer = true;
    const C = new Node(3, 30, 30);
    C.Graph = g;
    g.Containers.set(A, [B]);
    g.Containers.set(B, [C]);

    const visited = [];
    let panicked = false;
    try {
      A.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays cluster_member_postorder", () => {
    const sc = reference.rdfsScenarios.cluster_member_postorder;
    const g = new Graph();
    const vessel = new Node(1, 100, 100);
    vessel.Graph = g;
    vessel.setClusterVessel(true);
    const m1 = new Node(2, 30, 30);
    m1.Graph = g;
    const m2 = new Node(3, 30, 30);
    m2.Graph = g;
    g.Clusters.set(vessel, new Cluster({ Vessel: vessel, Nodes: [m1, m2], Graph: g }));

    const visited = [];
    let panicked = false;
    try {
      vessel.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays sequence_step_postorder", () => {
    const sc = reference.rdfsScenarios.sequence_step_postorder;
    const g = new Graph();
    const sVessel = new Node(1, 100, 100);
    sVessel.Graph = g;
    const s1 = new Node(2, 30, 30);
    s1.Graph = g;
    const s2 = new Node(3, 30, 30);
    s2.Graph = g;
    g.Sequences.set(sVessel, new Sequence({ Vessel: sVessel, Nodes: [s1, s2], Graph: g }));

    const visited = [];
    let panicked = false;
    try {
      sVessel.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays cluster_overrides_sequence", () => {
    const sc = reference.rdfsScenarios.cluster_overrides_sequence;
    const g = new Graph();
    const root = new Node(1, 100, 100);
    root.Graph = g;
    root.setClusterVessel(true);
    const cMember = new Node(2, 30, 30);
    cMember.Graph = g;
    g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [cMember], Graph: g }));
    const sStep = new Node(3, 30, 30);
    sStep.Graph = g;
    g.Sequences.set(root, new Sequence({ Vessel: root, Nodes: [sStep], Graph: g }));

    const visited = [];
    let panicked = false;
    try {
      root.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays container_then_cluster_then_self", () => {
    const sc = reference.rdfsScenarios.container_then_cluster_then_self;
    const g = new Graph();
    const root = new Node(1, 100, 100);
    root.Graph = g;
    root.isContainer = true;
    root.setClusterVessel(true);
    const childA = new Node(2, 20, 20);
    childA.Graph = g;
    g.Containers.set(root, [childA]);
    const cm1 = new Node(3, 20, 20);
    cm1.Graph = g;
    g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [cm1], Graph: g }));

    const visited = [];
    let panicked = false;
    try {
      root.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays container_then_sequence_then_self", () => {
    const sc = reference.rdfsScenarios.container_then_sequence_then_self;
    const g = new Graph();
    const root = new Node(1, 100, 100);
    root.Graph = g;
    root.isContainer = true;
    root.setClusterVessel(false);
    const childA = new Node(2, 20, 20);
    childA.Graph = g;
    g.Containers.set(root, [childA]);
    const s1 = new Node(3, 20, 20);
    s1.Graph = g;
    g.Sequences.set(root, new Sequence({ Vessel: root, Nodes: [s1], Graph: g }));

    const visited = [];
    let panicked = false;
    try {
      root.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays duplicate_container_child_occurrence", () => {
    const sc = reference.rdfsScenarios.duplicate_container_child_occurrence;
    const g = new Graph();
    const root = new Node(1, 100, 100);
    root.Graph = g;
    root.isContainer = true;
    const childA = new Node(2, 20, 20);
    childA.Graph = g;
    g.Containers.set(root, [childA, childA]);

    const visited = [];
    let panicked = false;
    try {
      root.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays nil_container_child_panics_before_parent_callback", () => {
    const sc = reference.rdfsScenarios.nil_container_child_panics_before_parent_callback;
    const g = new Graph();
    const root = new Node(1, 100, 100);
    root.Graph = g;
    root.isContainer = true;
    g.Containers.set(root, [null]);

    const visited = [];
    let panicked = false;
    try {
      root.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays nil_cluster_member_panics_before_vessel_callback", () => {
    const sc = reference.rdfsScenarios.nil_cluster_member_panics_before_vessel_callback;
    const g = new Graph();
    const vessel = new Node(1, 100, 100);
    vessel.Graph = g;
    vessel.setClusterVessel(true);
    g.Clusters.set(vessel, new Cluster({ Vessel: vessel, Nodes: [null], Graph: g }));

    const visited = [];
    let panicked = false;
    try {
      vessel.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays nil_sequence_step_panics_before_owner_callback", () => {
    const sc = reference.rdfsScenarios.nil_sequence_step_panics_before_owner_callback;
    const g = new Graph();
    const sVessel = new Node(1, 100, 100);
    sVessel.Graph = g;
    g.Sequences.set(sVessel, new Sequence({ Vessel: sVessel, Nodes: [null], Graph: g }));

    const visited = [];
    let panicked = false;
    try {
      sVessel.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays cluster_vessel_missing_cluster_entry_panics", () => {
    const sc = reference.rdfsScenarios.cluster_vessel_missing_cluster_entry_panics;
    const g = new Graph();
    const vessel = new Node(1, 100, 100);
    vessel.Graph = g;
    vessel.setClusterVessel(true);

    const visited = [];
    let panicked = false;
    try {
      vessel.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays null_sequence_entry_panics", () => {
    const sc = reference.rdfsScenarios.null_sequence_entry_panics;
    const g = new Graph();
    const sVessel = new Node(1, 100, 100);
    sVessel.Graph = g;
    g.Sequences.set(sVessel, null);

    const visited = [];
    let panicked = false;
    try {
      sVessel.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });

  it("replays shared_node_alias_visited_twice", () => {
    const sc = reference.rdfsScenarios.shared_node_alias_visited_twice;
    const g = new Graph();
    const root = new Node(1, 100, 100);
    root.Graph = g;
    root.isContainer = true;
    const c1 = new Node(2, 50, 50);
    c1.Graph = g;
    c1.isContainer = true;
    const c2 = new Node(3, 50, 50);
    c2.Graph = g;
    c2.isContainer = true;
    const sharedLeaf = new Node(4, 20, 20);
    sharedLeaf.Graph = g;

    g.Containers.set(root, [c1, c2]);
    g.Containers.set(c1, [sharedLeaf]);
    g.Containers.set(c2, [sharedLeaf]);

    const visited = [];
    let panicked = false;
    try {
      root.WalkRDFS((curr) => {
        visited.push(String(curr.ID));
      });
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expect(visited).toEqual(sc.visited);
  });
});

describe("Slice 25 — Graph SyncClusters Oracle Replay", () => {
  it("replays empty_clusters_map_noop", () => {
    const sc = reference.syncClusterScenarios.empty_clusters_map_noop;
    const g = new Graph();
    const n = new Node(1, 50, 50);
    n.TopLeft = new Point(10, 10);
    n.Graph = g;
    g.Nodes = [n];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expectNumMatch(n.TopLeft.X, sc.nodesAfter["1"].topLeft.x);
    expectNumMatch(n.TopLeft.Y, sc.nodesAfter["1"].topLeft.y);
    expectNumMatch(n.Width, sc.nodesAfter["1"].width);
    expectNumMatch(n.Height, sc.nodesAfter["1"].height);
  });

  it("replays empty_clusters_map_skips_malformed_nodes", () => {
    const sc = reference.syncClusterScenarios.empty_clusters_map_skips_malformed_nodes;
    const g = new Graph();
    g.Nodes = [null];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
  });

  it("replays simple_cluster_sync", () => {
    const sc = reference.syncClusterScenarios.simple_cluster_sync;
    const g = new Graph();
    const vessel = new Node(1, 10, 10);
    vessel.TopLeft = new Point(0, 0);
    vessel.Graph = g;
    vessel.setClusterVessel(true);

    const m1 = new Node(2, 40, 40);
    m1.TopLeft = new Point(0, 0);
    m1.Graph = g;

    const m2 = new Node(3, 40, 40);
    m2.TopLeft = new Point(0, 0);
    m2.Graph = g;

    const c = new Cluster({
      Vessel: vessel,
      Nodes: [m1, m2],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    });
    g.Clusters.set(vessel, c);
    g.Nodes = [vessel];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    for (const [idStr, node] of [["1", vessel], ["2", m1], ["3", m2]]) {
      const exp = sc.nodesAfter[idStr];
      expectNumMatch(node.TopLeft.X, exp.topLeft.x);
      expectNumMatch(node.TopLeft.Y, exp.topLeft.y);
      expectNumMatch(node.Width, exp.width);
      expectNumMatch(node.Height, exp.height);
    }
  });

  it("replays graph_nodes_source_order", () => {
    const sc = reference.syncClusterScenarios.graph_nodes_source_order;
    const g = new Graph();
    const vesselA = new Node(10, 10, 10);
    vesselA.TopLeft = new Point(0, 0);
    vesselA.Graph = g;
    vesselA.setClusterVessel(true);
    const mA = new Node(11, 30, 30);
    mA.TopLeft = new Point(0, 0);
    mA.Graph = g;
    g.Clusters.set(vesselA, new Cluster({
      Vessel: vesselA,
      Nodes: [mA],
      Arrangement: ClusterArrangement.Row,
      Padding: 5,
      Graph: g,
    }));

    const vesselB = new Node(5, 10, 10);
    vesselB.TopLeft = new Point(0, 0);
    vesselB.Graph = g;
    vesselB.setClusterVessel(true);
    const mB = new Node(6, 40, 40);
    mB.TopLeft = new Point(0, 0);
    mB.Graph = g;
    g.Clusters.set(vesselB, new Cluster({
      Vessel: vesselB,
      Nodes: [mB],
      Arrangement: ClusterArrangement.Row,
      Padding: 8,
      Graph: g,
    }));

    // Scrambled order: vesselB (ID 5) before vesselA (ID 10)
    g.Nodes = [vesselB, vesselA];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    for (const [idStr, node] of [["10", vesselA], ["11", mA], ["5", vesselB], ["6", mB]]) {
      const exp = sc.nodesAfter[idStr];
      expectNumMatch(node.TopLeft.X, exp.topLeft.x);
      expectNumMatch(node.TopLeft.Y, exp.topLeft.y);
      expectNumMatch(node.Width, exp.width);
      expectNumMatch(node.Height, exp.height);
    }
  });

  it("replays map_entry_without_vessel_flag_not_synced", () => {
    const sc = reference.syncClusterScenarios.map_entry_without_vessel_flag_not_synced;
    const g = new Graph();
    const n = new Node(1, 20, 20);
    n.TopLeft = new Point(5, 5);
    n.Graph = g;
    n.setClusterVessel(false);

    const m = new Node(2, 40, 40);
    m.TopLeft = new Point(0, 0);
    m.Graph = g;

    const c = new Cluster({
      Vessel: n,
      Nodes: [m],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    });
    g.Clusters.set(n, c);
    g.Nodes = [n];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    expectNumMatch(n.TopLeft.X, sc.nodesAfter["1"].topLeft.x);
    expectNumMatch(n.TopLeft.Y, sc.nodesAfter["1"].topLeft.y);
    expectNumMatch(n.Width, sc.nodesAfter["1"].width);
    expectNumMatch(n.Height, sc.nodesAfter["1"].height);
  });

  it("replays marked_vessel_missing_outer_cluster_entry_panics", () => {
    const sc = reference.syncClusterScenarios.marked_vessel_missing_outer_cluster_entry_panics;
    const g = new Graph();
    const vessel = new Node(1, 10, 10);
    vessel.Graph = g;
    vessel.setClusterVessel(true);

    const otherVessel = new Node(2, 10, 10);
    otherVessel.Graph = g;
    otherVessel.setClusterVessel(true);
    const m = new Node(3, 20, 20);
    m.Graph = g;

    g.Clusters.set(otherVessel, new Cluster({
      Vessel: otherVessel,
      Nodes: [m],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    }));
    g.Nodes = [vessel];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
  });

  it("replays nested_cluster_inner_before_outer", () => {
    const sc = reference.syncClusterScenarios.nested_cluster_inner_before_outer;
    const g = new Graph();
    const outerVessel = new Node(1, 10, 10);
    outerVessel.TopLeft = new Point(0, 0);
    outerVessel.Graph = g;
    outerVessel.setClusterVessel(true);

    const innerVessel = new Node(2, 10, 10);
    innerVessel.TopLeft = new Point(0, 0);
    innerVessel.Graph = g;
    innerVessel.setClusterVessel(true);

    const innerMember = new Node(3, 50, 50);
    innerMember.TopLeft = new Point(0, 0);
    innerMember.Graph = g;

    const innerCluster = new Cluster({
      Vessel: innerVessel,
      Nodes: [innerMember],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    });
    const outerCluster = new Cluster({
      Vessel: outerVessel,
      Nodes: [innerVessel],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    });
    g.Clusters.set(innerVessel, innerCluster);
    g.Clusters.set(outerVessel, outerCluster);
    g.Nodes = [outerVessel];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    for (const [idStr, node] of [["1", outerVessel], ["2", innerVessel], ["3", innerMember]]) {
      const exp = sc.nodesAfter[idStr];
      expectNumMatch(node.TopLeft.X, exp.topLeft.x);
      expectNumMatch(node.TopLeft.Y, exp.topLeft.y);
      expectNumMatch(node.Width, exp.width);
      expectNumMatch(node.Height, exp.height);
    }
  });

  it("replays nested_container_cluster_order", () => {
    const sc = reference.syncClusterScenarios.nested_container_cluster_order;
    const g = new Graph();
    const container = new Node(1, 100, 100);
    container.TopLeft = new Point(0, 0);
    container.Graph = g;
    container.isContainer = true;

    const cVessel = new Node(2, 10, 10);
    cVessel.TopLeft = new Point(0, 0);
    cVessel.Graph = g;
    cVessel.setClusterVessel(true);

    const cMember = new Node(3, 40, 40);
    cMember.TopLeft = new Point(0, 0);
    cMember.Graph = g;

    const cluster = new Cluster({
      Vessel: cVessel,
      Nodes: [cMember],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    });
    g.Clusters.set(cVessel, cluster);
    g.Containers.set(container, [cVessel]);
    g.Nodes = [container];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    for (const [idStr, node] of [["1", container], ["2", cVessel], ["3", cMember]]) {
      const exp = sc.nodesAfter[idStr];
      expectNumMatch(node.TopLeft.X, exp.topLeft.x);
      expectNumMatch(node.TopLeft.Y, exp.topLeft.y);
      expectNumMatch(node.Width, exp.width);
      expectNumMatch(node.Height, exp.height);
    }
  });

  it("replays cluster_reached_through_sequence_step", () => {
    const sc = reference.syncClusterScenarios.cluster_reached_through_sequence_step;
    const g = new Graph();
    const sVessel = new Node(1, 100, 100);
    sVessel.TopLeft = new Point(0, 0);
    sVessel.Graph = g;
    sVessel.setClusterVessel(false);

    const step1 = new Node(2, 10, 10);
    step1.TopLeft = new Point(0, 0);
    step1.Graph = g;
    step1.setClusterVessel(true);

    const m = new Node(3, 40, 40);
    m.TopLeft = new Point(0, 0);
    m.Graph = g;

    const seq = new Sequence({
      Vessel: sVessel,
      Nodes: [step1],
      Graph: g,
    });
    g.Sequences.set(sVessel, seq);

    const cluster = new Cluster({
      Vessel: step1,
      Nodes: [m],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    });
    g.Clusters.set(step1, cluster);
    g.Nodes = [sVessel];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    for (const [idStr, node] of [["1", sVessel], ["2", step1], ["3", m]]) {
      const exp = sc.nodesAfter[idStr];
      expectNumMatch(node.TopLeft.X, exp.topLeft.x);
      expectNumMatch(node.TopLeft.Y, exp.topLeft.y);
      expectNumMatch(node.Width, exp.width);
      expectNumMatch(node.Height, exp.height);
    }
  });

  it("replays nil_root_panics_when_clusters_nonempty", () => {
    const sc = reference.syncClusterScenarios.nil_root_panics_when_clusters_nonempty;
    const g = new Graph();
    const v = new Node(1, 10, 10);
    g.Clusters.set(v, new Cluster({ Vessel: v }));
    g.Nodes = [null];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
  });

  it("replays later_root_failure_preserves_earlier_cluster_sync", () => {
    const sc = reference.syncClusterScenarios.later_root_failure_preserves_earlier_cluster_sync;
    const g = new Graph();
    const vessel = new Node(1, 10, 10);
    vessel.TopLeft = new Point(0, 0);
    vessel.Graph = g;
    vessel.setClusterVessel(true);

    const m = new Node(2, 40, 40);
    m.TopLeft = new Point(0, 0);
    m.Graph = g;

    const c = new Cluster({
      Vessel: vessel,
      Nodes: [m],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: g,
    });
    g.Clusters.set(vessel, c);
    g.Nodes = [vessel, null];

    let panicked = false;
    try {
      g.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    for (const [idStr, node] of [["1", vessel], ["2", m]]) {
      const exp = sc.nodesAfter[idStr];
      expectNumMatch(node.TopLeft.X, exp.topLeft.x);
      expectNumMatch(node.TopLeft.Y, exp.topLeft.y);
      expectNumMatch(node.Width, exp.width);
      expectNumMatch(node.Height, exp.height);
    }
  });

  it("replays outer_graph_cluster_lookup_vs_node_graph_traversal", () => {
    const sc = reference.syncClusterScenarios.outer_graph_cluster_lookup_vs_node_graph_traversal;
    const outerGraph = new Graph();
    const traversalGraph = new Graph();

    const root = new Node(1, 10, 10);
    root.TopLeft = new Point(0, 0);
    root.Graph = traversalGraph;
    root.isContainer = true;

    const vessel = new Node(2, 10, 10);
    vessel.TopLeft = new Point(0, 0);
    vessel.Graph = traversalGraph;
    vessel.setClusterVessel(true);

    const m = new Node(3, 40, 40);
    m.TopLeft = new Point(0, 0);
    m.Graph = traversalGraph;

    traversalGraph.Containers.set(root, [vessel]);

    const traversalCluster = new Cluster({
      Vessel: vessel,
      Nodes: [m],
      Arrangement: ClusterArrangement.Row,
      Padding: 10,
      Graph: traversalGraph,
    });
    traversalGraph.Clusters.set(vessel, traversalCluster);

    const outerCluster = new Cluster({
      Vessel: vessel,
      Nodes: [m],
      Arrangement: ClusterArrangement.Row,
      Padding: 25,
      Graph: outerGraph,
    });
    outerGraph.Clusters.set(vessel, outerCluster);
    outerGraph.Nodes = [root];

    let panicked = false;
    try {
      outerGraph.SyncClusters();
    } catch {
      panicked = true;
    }

    expect(panicked).toBe(sc.panicked);
    for (const [idStr, node] of [["1", root], ["2", vessel], ["3", m]]) {
      const exp = sc.nodesAfter[idStr];
      expectNumMatch(node.TopLeft.X, exp.topLeft.x);
      expectNumMatch(node.TopLeft.Y, exp.topLeft.y);
      expectNumMatch(node.Width, exp.width);
      expectNumMatch(node.Height, exp.height);
    }
  });
});
