import { describe, it, expect } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Graph } from "../../src/graph/graph.js";
import { cloneGraph } from "../../src/graph/clone.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Tree } from "../../src/graph/tree.js";
import { EdgeAbduction } from "../../src/graph/edge-abduction.js";
import { Orientation } from "../../src/geometry/orientation.js";

function findNode(graph, id) {
  for (const n of graph.Nodes) {
    if (n.ID === id) return n;
  }
  for (const v of graph.Clusters.keys()) {
    if (v.ID === id) return v;
  }
  for (const v of graph.Sequences.keys()) {
    if (v.ID === id) return v;
  }
  for (const s of graph.Trees.keys()) {
    if (s.ID === id) return s;
  }
  for (const node of graph.NodeToTree.keys()) {
    if (node.ID === id) return node;
  }
  return null;
}

describe("Group Clone Unit Tests", () => {
  it("should clone active Sequence and rebind all members and abductions", () => {
    const g = new Graph();
    const container = new Node(1n);
    g.addNewNodeToContainer(null, container);

    const vessel = new Node(2n);
    g.addNewNodeToContainer(container, vessel);

    const step1 = new Node(3n);
    const step2 = new Node(4n);
    g.addNodeUnchecked(step1);
    g.addNodeUnchecked(step2);

    const edge = g.connect(step1, step2);
    const abduction = new EdgeAbduction({
      Edge: edge,
      OriginallyFrom: step1,
      OriginallyTo: step2,
      CurrentFrom: vessel,
      CurrentTo: step2,
    });

    const seq = new Sequence({
      Vessel: vessel,
      Nodes: [step1, step2],
      Graph: g,
      Container: container,
      EdgeAbductions: [abduction],
    });
    g.Sequences.set(vessel, seq);
    step1.Sequence = seq;
    step2.Sequence = seq;

    const cloned = cloneGraph(g);

    const clonedVessel = findNode(cloned, 2n);
    expect(clonedVessel).not.toBeNull();
    expect(clonedVessel).not.toBe(vessel);
    expect(clonedVessel.Graph).toBe(cloned);

    const clonedSeq = cloned.Sequences.get(clonedVessel);
    expect(clonedSeq).toBeDefined();
    expect(clonedSeq).not.toBe(seq);
    expect(clonedSeq.isActive()).toBe(true);
    expect(clonedSeq.Vessel).toBe(clonedVessel);
    expect(clonedSeq.Container).toBe(findNode(cloned, 1n));

    const clonedStep1 = findNode(cloned, 3n);
    const clonedStep2 = findNode(cloned, 4n);
    expect(clonedSeq.Nodes).toEqual([clonedStep1, clonedStep2]);
    expect(clonedStep1.Sequence).toBe(clonedSeq);
    expect(clonedStep2.Sequence).toBe(clonedSeq);

    // Abduction rebinding
    expect(clonedSeq.EdgeAbductions.length).toBe(1);
    const clonedAbduction = clonedSeq.EdgeAbductions[0];
    expect(clonedAbduction).not.toBe(abduction);
    expect(clonedAbduction.Edge).not.toBe(edge);
    expect(clonedAbduction.Edge.From).toBe(clonedStep1);
    expect(clonedAbduction.Edge.To).toBe(clonedStep2);
    expect(clonedAbduction.OriginallyFrom).toBe(clonedStep1);
    expect(clonedAbduction.OriginallyTo).toBe(clonedStep2);
    expect(clonedAbduction.CurrentFrom).toBe(clonedVessel);
    expect(clonedAbduction.CurrentTo).toBe(clonedStep2);
  });

  it("should preserve inactive state of remembered Sequence", () => {
    const g = new Graph();
    const inactiveVessel = new Node(10n);
    inactiveVessel.Graph = null;

    const step1 = new Node(11n);
    const step2 = new Node(12n);
    g.addNodeUnchecked(step1);
    g.addNodeUnchecked(step2);

    const inactSeq = new Sequence({
      Vessel: inactiveVessel,
      Nodes: [step1, step2],
      Graph: null,
    });
    g.Sequences.set(inactiveVessel, inactSeq);
    step1.Sequence = inactSeq;
    step2.Sequence = inactSeq;

    const cloned = cloneGraph(g);

    let clonedInactVessel = null;
    for (const v of cloned.Sequences.keys()) {
      if (v.ID === 10n) clonedInactVessel = v;
    }
    expect(clonedInactVessel).not.toBeNull();
    expect(clonedInactVessel.Graph).toBeNull();

    const clonedInactSeq = cloned.Sequences.get(clonedInactVessel);
    expect(clonedInactSeq.isActive()).toBe(false);
  });

  it("should clone active Cluster, rebind members and preserve isClusterVessel", () => {
    const g = new Graph();
    const vessel = new Node(20n);
    vessel.setClusterVessel(true);
    g.addNodeUnchecked(vessel);

    const m1 = new Node(21n);
    const m2 = new Node(22n);
    g.addNodeUnchecked(m1);
    g.addNodeUnchecked(m2);

    const cluster = new Cluster({
      Vessel: vessel,
      Nodes: [m1, m2],
      Arrangement: ClusterArrangement.Column,
      DesiredArrangement: ClusterArrangement.Row,
      Graph: g,
      FixedSize: true,
    });
    g.Clusters.set(vessel, cluster);
    m1.Cluster = cluster;
    m2.Cluster = cluster;

    const cloned = cloneGraph(g);

    const clonedVessel = findNode(cloned, 20n);
    expect(clonedVessel).not.toBeNull();
    expect(clonedVessel.isClusterVessel).toBe(true);

    const clonedCluster = cloned.Clusters.get(clonedVessel);
    expect(clonedCluster).toBeDefined();
    expect(clonedCluster.isActive()).toBe(true);
    expect(clonedCluster.Arrangement).toBe(ClusterArrangement.Column);
    expect(clonedCluster.DesiredArrangement).toBe(ClusterArrangement.Row);
    expect(clonedCluster.FixedSize).toBe(true);

    const clonedM1 = findNode(cloned, 21n);
    const clonedM2 = findNode(cloned, 22n);
    expect(clonedM1.Cluster).toBe(clonedCluster);
    expect(clonedM2.Cluster).toBe(clonedCluster);
  });

  it("should clone Tree topology and rebind NodeToTree completely", () => {
    const g = new Graph();
    const sentinel = new Node(100n);
    const rootNode = new Node(101n);
    const childNode = new Node(102n);

    g.addNodeUnchecked(sentinel);
    g.addNodeUnchecked(rootNode);
    g.addNodeUnchecked(childNode);

    const sEdge = g.connect(sentinel, rootNode);
    const cEdge = g.connect(rootNode, childNode);

    const rootTree = new Tree(rootNode);
    rootTree.SentinelEdge = sEdge;
    rootTree.Orientation = Orientation.Top;

    const childTree = new Tree(childNode);
    childTree.SentinelEdge = cEdge;
    childTree.Parent = rootTree;
    rootTree.Children.push(childTree);

    g.Trees.set(sentinel, [rootTree]);
    g.NodeToTree.set(rootNode, rootTree);
    g.NodeToTree.set(childNode, childTree);

    const cloned = cloneGraph(g);

    const clonedSentinel = findNode(cloned, 100n);
    const clonedRootNode = findNode(cloned, 101n);
    const clonedChildNode = findNode(cloned, 102n);

    const clonedRoots = cloned.Trees.get(clonedSentinel);
    expect(clonedRoots).toBeDefined();
    expect(clonedRoots.length).toBe(1);
    const clonedRootTree = clonedRoots[0];

    expect(clonedRootTree).not.toBe(rootTree);
    expect(clonedRootTree.Node).toBe(clonedRootNode);
    expect(clonedRootTree.Orientation).toBe(Orientation.Top);
    expect(clonedRootTree.SentinelEdge).toBe(cloned.Edges[0]);

    expect(clonedRootTree.Children.length).toBe(1);
    const clonedChildTree = clonedRootTree.Children[0];
    expect(clonedChildTree.Node).toBe(clonedChildNode);
    expect(clonedChildTree.Parent).toBe(clonedRootTree);

    // NodeToTree
    expect(cloned.NodeToTree.get(clonedRootNode)).toBe(clonedRootTree);
    expect(cloned.NodeToTree.get(clonedChildNode)).toBe(clonedChildTree);
  });
});
