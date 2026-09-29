import { describe, it, expect } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Graph } from "../../src/graph/graph.js";
import { cloneGraph } from "../../src/graph/clone.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Tree } from "../../src/graph/tree.js";
import { EdgeAbduction } from "../../src/graph/edge-abduction.js";
import { Orientation } from "../../src/geometry/orientation.js";
import { Label } from "../../src/graph/label.js";

function findNode(graph, id) {
  for (const n of graph.Nodes) {
    if (n.ID === id) return n;
  }
  for (const v of graph.Clusters.keys()) {
    if (v.ID === id) return v;
  }
  for (const c of graph.Clusters.values()) {
    for (const m of (c.Nodes || [])) {
      if (m && m.ID === id) return m;
    }
  }
  for (const v of graph.Sequences.keys()) {
    if (v.ID === id) return v;
  }
  for (const s of graph.Sequences.values()) {
    for (const m of (s.Nodes || [])) {
      if (m && m.ID === id) return m;
    }
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
    expect(clonedStep1).not.toBeNull();
    expect(clonedStep2).not.toBeNull();
    expect(clonedSeq.Nodes.length).toBe(2);
    expect(clonedSeq.Nodes[0]).toBe(clonedStep1);
    expect(clonedSeq.Nodes[1]).toBe(clonedStep2);
    expect(clonedStep1.Sequence).toBe(clonedSeq);
    expect(clonedStep2.Sequence).toBe(clonedSeq);

    // Active members are filtered from cloned.Nodes, vessel remains
    expect(cloned.Nodes.includes(clonedVessel)).toBe(true);
    expect(cloned.Nodes.includes(clonedStep1)).toBe(false);
    expect(cloned.Nodes.includes(clonedStep2)).toBe(false);

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
    expect(clonedInactSeq.Graph).toBe(cloned);
    expect(clonedInactSeq.isActive()).toBe(false);

    // Inactive members remain in cloned.Nodes
    const clonedS1 = findNode(cloned, 11n);
    const clonedS2 = findNode(cloned, 12n);
    expect(cloned.Nodes.includes(clonedS1)).toBe(true);
    expect(cloned.Nodes.includes(clonedS2)).toBe(true);
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
    expect(clonedM1).not.toBeNull();
    expect(clonedM2).not.toBeNull();
    expect(clonedM1.Cluster).toBe(clonedCluster);
    expect(clonedM2.Cluster).toBe(clonedCluster);

    // Active members are filtered from cloned.Nodes, vessel remains
    expect(cloned.Nodes.includes(clonedVessel)).toBe(true);
    expect(cloned.Nodes.includes(clonedM1)).toBe(false);
    expect(cloned.Nodes.includes(clonedM2)).toBe(false);
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

  it("should successfully clone hierarchy with cluster-member container", () => {
    const g = new Graph();
    const rootCont = new Node(1n, 200, 200);
    g.addNewNodeToContainer(null, rootCont);
    const normCont = new Node(2n, 150, 150);
    g.addNewNodeToContainer(rootCont, normCont);
    const cVessel = new Node(3n, 100, 100);
    cVessel.setClusterVessel(true);
    g.addNewNodeToContainer(normCont, cVessel);
    const cMemCont = new Node(4n, 80, 80);
    g.addNodeUnchecked(cMemCont);
    const leafNode = new Node(5n, 30, 30);
    g.addNewNodeToContainer(cMemCont, leafNode);
    const cl = new Cluster({
      Vessel: cVessel,
      Nodes: [cMemCont],
      Graph: g,
      Container: normCont,
    });
    g.Clusters.set(cVessel, cl);
    cMemCont.Cluster = cl;

    const cloned = cloneGraph(g);
    expect(cloned).toBeDefined();
    expect(cloned.Containers.size).toBe(4);

    const clonedCMemCont = findNode(cloned, 4n);
    expect(clonedCMemCont.isContainer).toBe(true);
    expect(cloned.Containers.has(clonedCMemCont)).toBe(true);
    const clonedChildren = cloned.Containers.get(clonedCMemCont);
    expect(clonedChildren.length).toBe(1);
    expect(clonedChildren[0].ID).toBe(5n);
  });

  it("should clone Tree whose SentinelEdge is absent from Graph.Edges", () => {
    const g = new Graph();
    const tNode = new Node(1n, 40, 40);
    const sNode = new Node(2n, 40, 40);
    g.addNodeUnchecked(tNode);
    g.addNodeUnchecked(sNode);
    const detachedEdge = new Edge(sNode, tNode);
    const tRecord = new Tree(tNode);
    tRecord.SentinelEdge = detachedEdge;
    tRecord.Orientation = Orientation.Right;
    g.Trees.set(sNode, [tRecord]);

    const cloned = cloneGraph(g);
    expect(cloned.Edges.length).toBe(0);

    const clonedSentinel = findNode(cloned, 2n);
    const clonedTrees = cloned.Trees.get(clonedSentinel);
    expect(clonedTrees.length).toBe(1);
    const clonedTree = clonedTrees[0];
    expect(clonedTree.SentinelEdge).not.toBe(detachedEdge);
    expect(clonedTree.SentinelEdge.From).toBe(clonedSentinel);
    expect(clonedTree.SentinelEdge.To).toBe(findNode(cloned, 1n));
    expect(clonedTree.Orientation).toBe(Orientation.Right);
  });

  it("should reject auxiliary node ID collision when distinct Node record reuses an ID", () => {
    const g = new Graph();
    const declaredNode = new Node(10n, 50, 50);
    g.addNodeUnchecked(declaredNode);

    // Another distinct Node object with the same ID 10n used as a cluster vessel
    const distinctNodeSameID = new Node(10n, 100, 100);
    g.Clusters.set(distinctNodeSameID, new Cluster({ Vessel: distinctNodeSameID }));

    expect(() => cloneGraph(g)).toThrow("distinct node record reuses ID 10");
  });

  it("should enforce Cluster clone validations", () => {
    // 1. Vessel mismatch
    const g1 = new Graph();
    const v1 = new Node(1n);
    const v2 = new Node(2n);
    g1.addNodeUnchecked(v1);
    g1.addNodeUnchecked(v2);
    g1.Clusters.set(v1, new Cluster({ Vessel: v2 }));
    expect(() => cloneGraph(g1)).toThrow("because its record vessel differs");

    // 2. Container cannot be vessel itself
    const g2 = new Graph();
    const vSelf = new Node(3n);
    g2.addNodeUnchecked(vSelf);
    g2.Clusters.set(vSelf, new Cluster({ Vessel: vSelf, Container: vSelf }));
    expect(() => cloneGraph(g2)).toThrow("because it cannot contain itself");
  });

  it("should enforce Sequence clone validations", () => {
    // 1. Vessel mismatch
    const g1 = new Graph();
    const v1 = new Node(1n);
    const v2 = new Node(2n);
    g1.addNodeUnchecked(v1);
    g1.addNodeUnchecked(v2);
    g1.Sequences.set(v1, new Sequence({ Vessel: v2, Nodes: [new Node(3n), new Node(4n)] }));
    expect(() => cloneGraph(g1)).toThrow("because its record vessel differs");

    // 2. Container cannot be vessel itself
    const g2 = new Graph();
    const vSelf = new Node(5n);
    g2.addNodeUnchecked(vSelf);
    g2.Sequences.set(vSelf, new Sequence({ Vessel: vSelf, Container: vSelf, Nodes: [new Node(6n), new Node(7n)] }));
    expect(() => cloneGraph(g2)).toThrow("because it cannot contain itself");

    // 3. Fewer than 2 steps
    const g3 = new Graph();
    const vSeq = new Node(8n);
    const step = new Node(9n);
    g3.addNodeUnchecked(vSeq);
    g3.addNodeUnchecked(step);
    g3.Sequences.set(vSeq, new Sequence({ Vessel: vSeq, Nodes: [step] }));
    expect(() => cloneGraph(g3)).toThrow("want at least 2");
  });

  it("should fail when EdgeAbduction references unincluded foreign node", () => {
    const g = new Graph();
    const vessel = new Node(1n);
    const s1 = new Node(2n);
    const s2 = new Node(3n);
    g.addNodeUnchecked(vessel);
    g.addNodeUnchecked(s1);
    g.addNodeUnchecked(s2);
    const edge = g.connect(s1, s2);

    const foreignNode = new Node(999n);
    const badAbduction = new EdgeAbduction({
      Edge: edge,
      OriginallyFrom: foreignNode, // unincluded!
      OriginallyTo: s2,
      CurrentFrom: vessel,
      CurrentTo: s2,
    });

    const seq = new Sequence({
      Vessel: vessel,
      Nodes: [s1, s2],
      EdgeAbductions: [badAbduction],
    });
    g.Sequences.set(vessel, seq);

    expect(() => cloneGraph(g)).toThrow("node 999 is not included in the graph");
  });

  it("should clone Node.Label preserving Label instance, public fields, and resetting positionFixed", () => {
    const g = new Graph();
    const node = new Node(1n, 100, 50);
    const label = new Label("test-label", 60, 20);
    label.Position = "Top";
    label.FixPosition();
    expect(label.PositionFixed()).toBe(true);
    node.Label = label;
    g.addNodeUnchecked(node);

    const clonedGraph = cloneGraph(g);
    const clonedNode = clonedGraph.Nodes[0];

    expect(node.Label instanceof Label).toBe(true);
    expect(clonedNode.Label instanceof Label).toBe(true);
    expect(clonedNode.Label).not.toBe(node.Label);
    expect(clonedNode.Label.Text).toBe("test-label");
    expect(clonedNode.Label.Position).toBe("Top");
    expect(clonedNode.Label.Width).toBe(60);
    expect(clonedNode.Label.Height).toBe(20);
    expect(typeof clonedNode.Label.PositionFixed).toBe("function");
    expect(typeof clonedNode.Label.FixPosition).toBe("function");

    // Position was copied, but positionFixed is reset to false matching Go copyLabelRecord
    expect(clonedNode.Label.PositionFixed()).toBe(false);
  });

  it("should clone Edge labels preserving Label instances, public fields, and resetting positionFixed", () => {
    const g = new Graph();
    const n1 = new Node(1n, 80, 80);
    const n2 = new Node(2n, 80, 80);
    g.addNodeUnchecked(n1);
    g.addNodeUnchecked(n2);
    const edge = g.connect(n1, n2);

    const mainLabel = new Label("edge-label", 40, 15);
    mainLabel.Position = "Center";
    mainLabel.FixPosition();

    const srcLabel = new Label("src-label", 25, 10);
    srcLabel.Position = "Start";
    srcLabel.FixPosition();

    const tgtLabel = new Label("tgt-label", 30, 12);
    tgtLabel.Position = "End";
    tgtLabel.FixPosition();

    edge.Label = mainLabel;
    edge.SourceArrowheadLabel = srcLabel;
    edge.TargetArrowheadLabel = tgtLabel;

    const clonedGraph = cloneGraph(g);
    const clonedEdge = clonedGraph.Edges[0];

    expect(clonedEdge.Label instanceof Label).toBe(true);
    expect(clonedEdge.Label).not.toBe(edge.Label);
    expect(clonedEdge.Label.Text).toBe("edge-label");
    expect(clonedEdge.Label.Position).toBe("Center");
    expect(clonedEdge.Label.Width).toBe(40);
    expect(clonedEdge.Label.Height).toBe(15);
    expect(clonedEdge.Label.PositionFixed()).toBe(false);

    expect(clonedEdge.SourceArrowheadLabel instanceof Label).toBe(true);
    expect(clonedEdge.SourceArrowheadLabel).not.toBe(edge.SourceArrowheadLabel);
    expect(clonedEdge.SourceArrowheadLabel.Text).toBe("src-label");
    expect(clonedEdge.SourceArrowheadLabel.Position).toBe("Start");
    expect(clonedEdge.SourceArrowheadLabel.Width).toBe(25);
    expect(clonedEdge.SourceArrowheadLabel.Height).toBe(10);
    expect(clonedEdge.SourceArrowheadLabel.PositionFixed()).toBe(false);

    expect(clonedEdge.TargetArrowheadLabel instanceof Label).toBe(true);
    expect(clonedEdge.TargetArrowheadLabel).not.toBe(edge.TargetArrowheadLabel);
    expect(clonedEdge.TargetArrowheadLabel.Text).toBe("tgt-label");
    expect(clonedEdge.TargetArrowheadLabel.Position).toBe("End");
    expect(clonedEdge.TargetArrowheadLabel.Width).toBe(30);
    expect(clonedEdge.TargetArrowheadLabel.Height).toBe(12);
    expect(clonedEdge.TargetArrowheadLabel.PositionFixed()).toBe(false);
  });
});
