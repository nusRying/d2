import { describe, it, expect } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Graph } from "../../src/graph/graph.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Cluster, ClusterArrangement, flipArrangement } from "../../src/graph/cluster.js";
import { Tree } from "../../src/graph/tree.js";
import { EdgeAbduction } from "../../src/graph/edge-abduction.js";
import { cloneGraph } from "../../src/graph/clone.js";
import { Orientation } from "../../src/geometry/orientation.js";
import referenceFixture from "../fixtures/go-topology-foundation-reference.json";

function idStr(n) {
  if (n === null || n === undefined) return "null";
  return n.ID.toString();
}

describe("Topology Oracle Verification Tests", () => {
  const cases = referenceFixture.cases;

  it("should match Go oracle SequenceSemantics", () => {
    const expected = cases.SequenceSemantics;
    const g = new Graph();
    const vesselAct = new Node(1n, 100, 100);
    const s1 = new Node(2n, 50, 50);
    const s2 = new Node(3n, 50, 50);
    g.addNodeUnchecked(vesselAct);
    g.addNodeUnchecked(s1);
    g.addNodeUnchecked(s2);
    const seqAct = new Sequence({
      Vessel: vesselAct,
      Nodes: [s1, s2],
      Graph: g,
    });
    g.Sequences.set(vesselAct, seqAct);
    s1.Sequence = seqAct;
    s2.Sequence = seqAct;

    const vesselInact = new Node(4n, 100, 100);
    vesselInact.Graph = null;
    const seqInact = new Sequence({
      Vessel: vesselInact,
      Nodes: [s1, s2],
      Graph: null,
    });

    const emptySeq = new Sequence();

    expect(seqAct.isActive()).toBe(expected.activeIsActive);
    expect(idStr(seqAct.first())).toBe(expected.activeFirstID);
    expect(idStr(seqAct.last())).toBe(expected.activeLastID);
    expect(seqInact.isActive()).toBe(expected.inactiveIsActive);
    expect(g.isSequenceVessel(vesselAct)).toBe(expected.isSequenceVesselAct);
    expect(g.isSequenceVessel(s1)).toBe(expected.isSequenceVesselMem);

    expect(expected.emptyFirstPanics).toBe(true);
    expect(() => emptySeq.first()).toThrow("cannot get first node of empty sequence");
    expect(expected.emptyLastPanics).toBe(true);
    expect(() => emptySeq.last()).toThrow("cannot get last node of empty sequence");
  });

  it("should match Go oracle ClusterSemantics", () => {
    const expected = cases.ClusterSemantics;
    const clusterZero = new Cluster();

    const g = new Graph();
    const vesselAct = new Node(10n, 100, 100);
    g.addNodeUnchecked(vesselAct);
    vesselAct.setClusterVessel(true);
    const m1 = new Node(11n, 40, 40);
    const m2 = new Node(12n, 40, 40);
    g.addNodeUnchecked(m1);
    g.addNodeUnchecked(m2);
    const clusterAct = new Cluster({
      Vessel: vesselAct,
      Nodes: [m1, m2],
      Arrangement: ClusterArrangement.Row,
      DesiredArrangement: ClusterArrangement.Row,
      Graph: g,
    });
    g.Clusters.set(vesselAct, clusterAct);
    m1.Cluster = clusterAct;
    m2.Cluster = clusterAct;

    const arr1 = clusterAct.Arrangement;
    clusterAct.flip();
    const arr2 = clusterAct.Arrangement;
    clusterAct.flip();
    const arr3 = clusterAct.Arrangement;

    const vesselInact = new Node(13n, 100, 100);
    vesselInact.Graph = null;
    const clusterInact = new Cluster({
      Vessel: vesselInact,
      Nodes: [m1, m2],
      Arrangement: ClusterArrangement.Row,
      Graph: null,
    });

    expect(clusterAct.isActive()).toBe(expected.activeIsActive);
    expect(arr1).toBe(expected.flip1);
    expect(arr2).toBe(expected.flip2);
    expect(arr3).toBe(expected.flip3);
    expect(clusterInact.isActive()).toBe(expected.inactiveIsActive);
    expect(vesselAct.isClusterVessel).toBe(expected.isClusterVessel);

    expect(clusterZero.Arrangement).toBe(expected.zeroArrangement);
    expect(clusterZero.DesiredArrangement).toBe(expected.zeroDesiredArrangement);
    expect(clusterZero.Padding).toBe(expected.zeroPadding);
    expect(clusterZero.FixedSize).toBe(expected.zeroFixedSize);
    expect(flipArrangement(clusterZero.Arrangement)).toBe(expected.zeroFlip);
  });

  it("should match Go oracle StableGroupOrder", () => {
    const expected = cases.StableGroupOrder;
    const g = new Graph();
    const ids = [30n, -2n, 5n, 100n];
    for (const id of ids) {
      const n = new Node(id, 10, 10);
      g.addNodeUnchecked(n);
      g.Clusters.set(n, new Cluster({ Vessel: n }));
      g.Sequences.set(n, new Sequence({ Vessel: n }));
      g.Trees.set(n, [new Tree(n)]);
    }

    const cOrder = g.clusterOrder().map((n) => idStr(n));
    const sOrder = g.sequenceOrder().map((n) => idStr(n));
    const tOrder = g.treeOrder().map((n) => idStr(n));

    expect(cOrder).toEqual(expected.clusterOrder);
    expect(sOrder).toEqual(expected.sequenceOrder);
    expect(tOrder).toEqual(expected.treeOrder);
    expect(g.isTreeSentinel(g.Nodes[0])).toBe(expected.isTreeSentinel);
  });

  it("should match Go oracle OwningContainerAndLevel", () => {
    const expected = cases.OwningContainerAndLevel;
    const g = new Graph();
    const rootContainer = new Node(1n, 200, 200);
    g.addNewNodeToContainer(null, rootContainer);

    const childContainer = new Node(2n, 150, 150);
    g.addNewNodeToContainer(rootContainer, childContainer);

    const directNode = new Node(3n, 50, 50);
    g.addNewNodeToContainer(childContainer, directNode);

    // Active cluster inside childContainer
    const clusterVessel = new Node(4n, 80, 80);
    clusterVessel.setClusterVessel(true);
    g.addNewNodeToContainer(childContainer, clusterVessel);
    const clusterMember = new Node(5n, 30, 30);
    g.addNodeUnchecked(clusterMember);
    const clAct = new Cluster({
      Vessel: clusterVessel,
      Nodes: [clusterMember],
      Graph: g,
      Container: childContainer,
    });
    g.Clusters.set(clusterVessel, clAct);
    clusterMember.Cluster = clAct;

    // Inactive cluster member
    const clusterMemberInact = new Node(6n, 30, 30);
    g.addNewNodeToContainer(childContainer, clusterMemberInact);
    const clInactVessel = new Node(7n, 80, 80);
    clInactVessel.Graph = null;
    const clInact = new Cluster({
      Vessel: clInactVessel,
      Nodes: [clusterMemberInact],
      Graph: null,
    });
    clusterMemberInact.Cluster = clInact;

    // Active sequence inside childContainer
    const seqVessel = new Node(8n, 80, 80);
    g.addNewNodeToContainer(childContainer, seqVessel);
    const seqStep = new Node(9n, 30, 30);
    g.addNodeUnchecked(seqStep);
    const sqAct = new Sequence({
      Vessel: seqVessel,
      Nodes: [seqStep],
      Graph: g,
      Container: childContainer,
    });
    g.Sequences.set(seqVessel, sqAct);
    seqStep.Sequence = sqAct;

    // Inactive sequence member
    const seqStepInact = new Node(10n, 30, 30);
    g.addNewNodeToContainer(childContainer, seqStepInact);
    const sqInactVessel = new Node(11n, 80, 80);
    sqInactVessel.Graph = null;
    const sqInact = new Sequence({
      Vessel: sqInactVessel,
      Nodes: [seqStepInact],
      Graph: null,
    });
    seqStepInact.Sequence = sqInact;

    expect(idStr(directNode.owningContainer())).toBe(expected.directOwning);
    expect(directNode.level()).toBe(expected.directLevel);
    expect(idStr(clusterMember.owningContainer())).toBe(expected.clusterMemberOwning);
    expect(clusterMember.level()).toBe(expected.clusterMemberLevel);
    expect(idStr(clusterMemberInact.owningContainer())).toBe(expected.inactClusterOwning);
    expect(clusterMemberInact.level()).toBe(expected.inactClusterLevel);
    expect(idStr(seqStep.owningContainer())).toBe(expected.seqStepOwning);
    expect(seqStep.level()).toBe(expected.seqStepLevel);
    expect(idStr(seqStepInact.owningContainer())).toBe(expected.inactSeqOwning);
    expect(seqStepInact.level()).toBe(expected.inactSeqLevel);
    expect(rootContainer.level()).toBe(expected.rootLevel);
    expect(childContainer.level()).toBe(expected.childContainerLevel);
  });

  it("should match Go oracle IsDescendantOf", () => {
    const expected = cases.IsDescendantOf;
    const g = new Graph();
    const root = new Node(100n, 200, 200);
    g.addNewNodeToContainer(null, root);
    const child = new Node(101n, 100, 100);
    g.addNewNodeToContainer(root, child);
    const other = new Node(102n, 50, 50);
    g.addNewNodeToContainer(null, other);

    // Cluster member
    const cVessel = new Node(103n, 80, 80);
    cVessel.Graph = null;
    const cMember = new Node(104n, 30, 30);
    cVessel.Container = child;
    const cl = new Cluster({ Vessel: cVessel, Nodes: [cMember] });
    cMember.Cluster = cl;

    // Sequence member
    const sVessel = new Node(105n, 80, 80);
    sVessel.Graph = null;
    const sMember = new Node(106n, 30, 30);
    sVessel.Container = child;
    const seq = new Sequence({ Vessel: sVessel, Nodes: [sMember] });
    sMember.Sequence = seq;

    expect(child.isDescendantOf(root)).toBe(expected.childDescOfRoot);
    expect(child.isDescendantOf(null)).toBe(expected.childDescOfNull);
    expect(child.isDescendantOf(other)).toBe(expected.childDescOfOther);
    expect(child.isDescendantOf(child)).toBe(expected.selfDesc);
    expect(cMember.isDescendantOf(child)).toBe(expected.cMemberDescOfChild);
    expect(cMember.isDescendantOf(root)).toBe(expected.cMemberDescOfRoot);
    expect(sMember.isDescendantOf(child)).toBe(expected.sMemberDescOfChild);
    expect(sMember.isDescendantOf(root)).toBe(expected.sMemberDescOfRoot);
    expect(sMember.isDescendantOf(other)).toBe(expected.sMemberDescOfOther);
  });

  it("should match Go oracle RDFSOrders", () => {
    const expected = cases.RDFSOrders;
    const g = new Graph();
    const A = new Node(1n, 100, 100);
    const B = new Node(2n, 50, 50);
    const leaf1 = new Node(3n, 20, 20);
    const C = new Node(4n, 80, 80);
    const leaf2 = new Node(5n, 20, 20);

    g.addNewNodeToContainer(null, A);
    g.addNewNodeToContainer(A, B);
    g.addNewNodeToContainer(A, leaf1);
    g.addNewNodeToContainer(null, C);
    g.addNewNodeToContainer(C, leaf2);

    const normalOrder = g.containerRDFSOrder(null).map((n) => idStr(n));

    const cVessel = new Node(6n, 60, 60);
    cVessel.setClusterVessel(true);
    g.addNewNodeToContainer(C, cVessel);

    const cMemberContainer = new Node(7n, 40, 40);
    g.addNodeUnchecked(cMemberContainer);
    g.addNewNodeToContainer(cMemberContainer, new Node(8n, 10, 10));
    const cluster = new Cluster({
      Vessel: cVessel,
      Nodes: [cMemberContainer],
      Graph: g,
    });
    g.Clusters.set(cVessel, cluster);

    const orderWithCluster = g.containerRDFSOrder(null).map((n) => idStr(n));
    const clusterRDFS = g.clusterRDFSOrder().map((n) => idStr(n));

    expect(normalOrder).toEqual(expected.normalContainerOrder);
    expect(orderWithCluster).toEqual(expected.clusterMemberOrder);
    expect(clusterRDFS).toEqual(expected.clusterRDFSOrder);
  });

  it("should match Go oracle TreeSentinelNode", () => {
    const expected = cases.TreeSentinelNode;
    const n1 = new Node(1n, 50, 50);
    const n2 = new Node(2n, 50, 50);
    const edgeFwd = new Edge(n1, n2);
    const tFwd = new Tree(n1);
    tFwd.SentinelEdge = edgeFwd;

    const edgeRev = new Edge(n2, n1);
    const tRev = new Tree(n1);
    tRev.SentinelEdge = edgeRev;

    const tDefault = new Tree(n1);

    expect(idStr(tFwd.sentinelNode())).toBe(expected.fwdSentinel);
    expect(idStr(tRev.sentinelNode())).toBe(expected.revSentinel);
    expect(tDefault.Orientation).toBe(Orientation.TopLeft);
    expect(expected.defaultOrientation).toBe("TopLeft");
    expect(expected.nilSentinelNodePanics).toBe(true);
    expect(() => tDefault.sentinelNode()).toThrow("tree has nil SentinelEdge");
  });

  it("should match Go oracle WalkRDFSPrecedence", () => {
    const expected = cases.WalkRDFSPrecedence;
    const g = new Graph();
    const root = new Node(1n, 100, 100);
    const child = new Node(2n, 30, 30);
    g.addNewNodeToContainer(null, root);
    g.addNewNodeToContainer(root, child);

    root.setClusterVessel(true);
    const cNode = new Node(3n, 20, 20);
    g.addNodeUnchecked(cNode);
    g.Clusters.set(root, new Cluster({
      Vessel: root,
      Nodes: [cNode],
      Graph: g,
    }));

    const sNode = new Node(4n, 20, 20);
    g.addNodeUnchecked(sNode);
    g.Sequences.set(root, new Sequence({
      Vessel: root,
      Nodes: [sNode],
      Graph: g,
    }));

    const walkOrder = [];
    root.rdfsWalk((n) => {
      walkOrder.push(idStr(n));
    });

    expect(walkOrder).toEqual(expected.walkOrder);
  });

  it("should match Go oracle CloneParity", () => {
    const expected = cases.CloneParity;
    const g = new Graph();
    const vesselAct = new Node(1n, 100, 100);
    vesselAct.setClusterVessel(true);
    const m1 = new Node(2n, 40, 40);
    const m2 = new Node(3n, 40, 40);
    g.addNodeUnchecked(vesselAct);
    g.addNodeUnchecked(m1);
    g.addNodeUnchecked(m2);

    const edge = g.connect(m1, m2);
    const abduction = new EdgeAbduction({
      Edge: edge,
      OriginallyFrom: m1,
      OriginallyTo: m2,
      CurrentFrom: vesselAct,
      CurrentTo: m2,
    });

    const clAct = new Cluster({
      Vessel: vesselAct,
      Nodes: [m1, m2],
      Arrangement: ClusterArrangement.Column,
      DesiredArrangement: ClusterArrangement.Row,
      Graph: g,
      EdgeAbductions: [abduction],
    });
    g.Clusters.set(vesselAct, clAct);
    m1.Cluster = clAct;
    m2.Cluster = clAct;

    // Inactive cluster
    const vesselInactC = new Node(40n, 100, 100);
    vesselInactC.Graph = null;
    const cMem1 = new Node(41n, 30, 30);
    const cMem2 = new Node(42n, 30, 30);
    g.addNodeUnchecked(cMem1);
    g.addNodeUnchecked(cMem2);
    const clInact = new Cluster({
      Vessel: vesselInactC,
      Nodes: [cMem1, cMem2],
      Graph: null,
    });
    g.Clusters.set(vesselInactC, clInact);
    cMem1.Cluster = clInact;
    cMem2.Cluster = clInact;

    // Inactive sequence
    const vesselInact = new Node(4n, 100, 100);
    vesselInact.Graph = null;
    const sStep1 = new Node(5n, 30, 30);
    const sStep2 = new Node(6n, 30, 30);
    g.addNodeUnchecked(sStep1);
    g.addNodeUnchecked(sStep2);
    const seqInact = new Sequence({
      Vessel: vesselInact,
      Nodes: [sStep1, sStep2],
      Graph: null,
    });
    g.Sequences.set(vesselInact, seqInact);
    sStep1.Sequence = seqInact;
    sStep2.Sequence = seqInact;

    // Active sequence
    const vesselActS = new Node(50n, 100, 100);
    g.addNodeUnchecked(vesselActS);
    const sStepAct1 = new Node(51n, 30, 30);
    const sStepAct2 = new Node(52n, 30, 30);
    g.addNodeUnchecked(sStepAct1);
    g.addNodeUnchecked(sStepAct2);
    const seqAct = new Sequence({
      Vessel: vesselActS,
      Nodes: [sStepAct1, sStepAct2],
      Graph: g,
    });
    g.Sequences.set(vesselActS, seqAct);
    sStepAct1.Sequence = seqAct;
    sStepAct2.Sequence = seqAct;

    // Tree
    const treeNode = new Node(7n, 40, 40);
    g.addNodeUnchecked(treeNode);
    const treeSentinel = new Node(8n, 40, 40);
    g.addNodeUnchecked(treeSentinel);
    const tEdge = g.connect(treeSentinel, treeNode);
    const treeRoot = new Tree(treeNode);
    treeRoot.SentinelEdge = tEdge;
    treeRoot.Orientation = Orientation.Top;
    g.Trees.set(treeSentinel, [treeRoot]);
    g.NodeToTree.set(treeNode, treeRoot);

    const cloned = cloneGraph(g);

    let clonedCVessel = null;
    for (const v of cloned.Clusters.keys()) {
      if (v.ID === 1n) clonedCVessel = v;
    }
    const clonedCluster = cloned.Clusters.get(clonedCVessel);
    const clonedAbduction = clonedCluster.EdgeAbductions[0];

    let clonedInactCVessel = null;
    for (const v of cloned.Clusters.keys()) {
      if (v.ID === 40n) clonedInactCVessel = v;
    }
    const clonedClusterInact = cloned.Clusters.get(clonedInactCVessel);

    let clonedInactVessel = null;
    for (const v of cloned.Sequences.keys()) {
      if (v.ID === 4n) clonedInactVessel = v;
    }
    const clonedSeqInact = cloned.Sequences.get(clonedInactVessel);

    let clonedActSVessel = null;
    for (const v of cloned.Sequences.keys()) {
      if (v.ID === 50n) clonedActSVessel = v;
    }
    const clonedSeqAct = cloned.Sequences.get(clonedActSVessel);

    let clonedTreeSentinel = null;
    for (const s of cloned.Trees.keys()) {
      if (s.ID === 8n) clonedTreeSentinel = s;
    }
    const clonedTreeRoot = cloned.Trees.get(clonedTreeSentinel)[0];

    expect(clonedCluster.isActive()).toBe(expected.clonedClusterActive);
    expect(clonedCluster.Arrangement).toBe(expected.clonedClusterArrangement);
    expect(clonedCVessel.isClusterVessel).toBe(expected.clonedClusterVesselFlag);
    expect(clonedAbduction.Edge.ID.toString()).toBe(expected.clonedAbductionEdgeID);
    expect(idStr(clonedAbduction.OriginallyFrom)).toBe(expected.clonedAbductionOrigFrom);
    expect(idStr(clonedAbduction.CurrentFrom)).toBe(expected.clonedAbductionCurrFrom);

    expect(clonedClusterInact.isActive()).toBe(expected.clonedInactClusterActive);
    expect(clonedClusterInact.Graph === cloned).toBe(expected.clonedInactClusterGraphIsG);
    expect(clonedInactCVessel.Graph === null).toBe(expected.clonedInactCVesselGraphNil);

    expect(clonedSeqInact.isActive()).toBe(expected.clonedSeqActive);
    expect(clonedSeqInact.Graph === cloned).toBe(expected.clonedSeqGraphIsG);
    expect(clonedInactVessel.Graph === null).toBe(expected.clonedSeqVesselGraphNil);

    expect(clonedSeqAct.isActive()).toBe(expected.clonedActSeqActive);
    expect(idStr(clonedTreeRoot.Node)).toBe(expected.clonedTreeRootNodeID);
    expect(clonedTreeRoot.Orientation).toBe(Orientation.Top);
    expect(cloned.NodeToTree.get(clonedTreeRoot.Node)).toBe(clonedTreeRoot);

    expect(cloned.Nodes.map(n => idStr(n))).toEqual(expected.clonedNodesIDs);
  });

  it("should match Go oracle ClusterMemberContainerClone", () => {
    const expected = cases.ClusterMemberContainerClone;
    const gCMC = new Graph();
    const rootCont = new Node(1n, 200, 200);
    gCMC.addNewNodeToContainer(null, rootCont);
    const normCont = new Node(2n, 150, 150);
    gCMC.addNewNodeToContainer(rootCont, normCont);
    const cVessel = new Node(3n, 100, 100);
    cVessel.setClusterVessel(true);
    gCMC.addNewNodeToContainer(normCont, cVessel);
    const cMemCont = new Node(4n, 80, 80);
    gCMC.addNodeUnchecked(cMemCont);
    const leafNode = new Node(5n, 30, 30);
    gCMC.addNewNodeToContainer(cMemCont, leafNode);
    const cl = new Cluster({
      Vessel: cVessel,
      Nodes: [cMemCont],
      Graph: gCMC,
      Container: normCont,
    });
    gCMC.Clusters.set(cVessel, cl);
    cMemCont.Cluster = cl;

    const clonedCMC = cloneGraph(gCMC);
    expect(clonedCMC !== null).toBe(expected.cloneSucceeded);
    expect(clonedCMC.Containers.size).toBe(expected.containersCount);
    expect(clonedCMC.containerRDFSOrder(null).map(n => idStr(n))).toEqual(expected.containerRDFSOrder);
  });

  it("should match Go oracle DetachedTreeSentinelClone", () => {
    const expected = cases.DetachedTreeSentinelClone;
    const gDT = new Graph();
    const tNode = new Node(1n, 40, 40);
    const sNode = new Node(2n, 40, 40);
    gDT.addNodeUnchecked(tNode);
    gDT.addNodeUnchecked(sNode);
    const detachedEdge = new Edge(sNode, tNode);
    const tRecord = new Tree(tNode);
    tRecord.SentinelEdge = detachedEdge;
    tRecord.Orientation = Orientation.Right;
    gDT.Trees.set(sNode, [tRecord]);

    const clonedDT = cloneGraph(gDT);
    expect(clonedDT !== null).toBe(expected.cloneSucceeded);
    expect(clonedDT.Edges.length).toBe(expected.graphEdgesCount);

    let clonedSentinel = null;
    for (const s of clonedDT.Trees.keys()) {
      clonedSentinel = s;
    }
    const clonedTree = clonedDT.Trees.get(clonedSentinel)[0];
    expect(idStr(clonedTree.SentinelEdge.From)).toBe(expected.sentinelFromID);
    expect(idStr(clonedTree.SentinelEdge.To)).toBe(expected.sentinelToID);
    expect(clonedTree.Orientation).toBe(Orientation.Right);
    expect(clonedTree.SentinelEdge !== detachedEdge).toBe(expected.distinctSentinelEdge);
  });

  it("should match Go oracle CloneValidationRejections", () => {
    const expected = cases.CloneValidationRejections;

    // Short sequence (< 2 steps)
    const gShort = new Graph();
    const vShort = new Node(1n, 10, 10);
    const sShort = new Node(2n, 10, 10);
    gShort.addNodeUnchecked(vShort);
    gShort.addNodeUnchecked(sShort);
    gShort.Sequences.set(vShort, new Sequence({ Vessel: vShort, Nodes: [sShort] }));
    expect(expected.shortSequenceRejected).toBe(true);
    expect(() => cloneGraph(gShort)).toThrow("steps; want at least 2");

    // Vessel mismatch
    const gMis = new Graph();
    const v1 = new Node(10n, 10, 10);
    const v2 = new Node(20n, 10, 10);
    gMis.addNodeUnchecked(v1);
    gMis.addNodeUnchecked(v2);
    gMis.Clusters.set(v1, new Cluster({ Vessel: v2 }));
    expect(expected.vesselMismatchRejected).toBe(true);
    expect(() => cloneGraph(gMis)).toThrow("because its record vessel differs");

    // Unknown/unincluded referenced node
    const gUnk = new Graph();
    const vUnk = new Node(100n, 10, 10);
    gUnk.addNodeUnchecked(vUnk);
    const foreignNode = new Node(999n, 10, 10);
    gUnk.Clusters.set(vUnk, new Cluster({ Vessel: vUnk, Container: foreignNode }));
    expect(expected.unincludedNodeRejected).toBe(true);
    expect(() => cloneGraph(gUnk)).toThrow("node 999 is not included in the graph");
  });
});
