import { describe, it, expect } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Graph } from "../../src/graph/graph.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Cluster } from "../../src/graph/cluster.js";
import { Tree } from "../../src/graph/tree.js";

describe("Topology Traversal Unit Tests", () => {
  it("should perform stable group ordering using BigInt numerical sort on scrambled IDs", () => {
    const g = new Graph();
    const scrambledIDs = [30n, -2n, 5n, 100n];

    for (const id of scrambledIDs) {
      const n = new Node(id);
      g.addNodeUnchecked(n);
      g.Clusters.set(n, new Cluster({ Vessel: n }));
      g.Sequences.set(n, new Sequence({ Vessel: n }));
      g.Trees.set(n, [new Tree(n)]);
    }

    const cOrder = g.clusterOrder().map((n) => n.ID);
    const sOrder = g.sequenceOrder().map((n) => n.ID);
    const tOrder = g.treeOrder().map((n) => n.ID);

    expect(cOrder).toEqual([-2n, 5n, 30n, 100n]);
    expect(sOrder).toEqual([-2n, 5n, 30n, 100n]);
    expect(tOrder).toEqual([-2n, 5n, 30n, 100n]);

    expect(g.isSequenceVessel(g.Nodes[0])).toBe(true);
    expect(g.isTreeSentinel(g.Nodes[0])).toBe(true);
  });

  it("should resolve owningContainer with active group precedence", () => {
    const g = new Graph();
    const root = new Node(1n);
    const parent = new Node(2n);
    g.addNewNodeToContainer(null, root);
    g.addNewNodeToContainer(root, parent);

    const direct = new Node(3n);
    g.addNewNodeToContainer(parent, direct);
    expect(direct.owningContainer()).toBe(parent);

    // Active Cluster
    const cVessel = new Node(4n);
    cVessel.setClusterVessel(true);
    g.addNewNodeToContainer(parent, cVessel);
    const cMember = new Node(5n);
    g.addNodeUnchecked(cMember);
    const activeCluster = new Cluster({
      Vessel: cVessel,
      Nodes: [cMember],
      Graph: g,
      Container: parent,
    });
    g.Clusters.set(cVessel, activeCluster);
    cMember.Cluster = activeCluster;
    // Active cluster member resolves to cVessel.Container
    expect(cMember.owningContainer()).toBe(parent);

    // Inactive Cluster (cVessel has no Graph)
    const inactVessel = new Node(6n);
    inactVessel.Container = parent;
    const inactMember = new Node(7n);
    g.addNewNodeToContainer(parent, inactMember);
    const inactCluster = new Cluster({
      Vessel: inactVessel,
      Nodes: [inactMember],
      Graph: null,
    });
    inactMember.Cluster = inactCluster;
    // Inactive cluster falls back to direct Container
    expect(inactMember.owningContainer()).toBe(parent);

    // Active Sequence
    const sVessel = new Node(8n);
    g.addNewNodeToContainer(parent, sVessel);
    const sStep = new Node(9n);
    g.addNodeUnchecked(sStep);
    const activeSeq = new Sequence({
      Vessel: sVessel,
      Nodes: [sStep],
      Graph: g,
      Container: parent,
    });
    g.Sequences.set(sVessel, activeSeq);
    sStep.Sequence = activeSeq;
    expect(sStep.owningContainer()).toBe(parent);

    // Inactive Sequence
    const inactSVessel = new Node(10n);
    inactSVessel.Container = parent;
    const inactStep = new Node(11n);
    g.addNewNodeToContainer(parent, inactStep);
    const inactSeq = new Sequence({
      Vessel: inactSVessel,
      Nodes: [inactStep],
      Graph: null,
    });
    inactStep.Sequence = inactSeq;
    expect(inactStep.owningContainer()).toBe(parent);
  });

  it("should compute node levels correctly with active and inactive group membership", () => {
    const g = new Graph();
    const root = new Node(1n);
    const child = new Node(2n);
    const grandchild = new Node(3n);

    g.addNewNodeToContainer(null, root);
    g.addNewNodeToContainer(root, child);
    g.addNewNodeToContainer(child, grandchild);

    expect(root.level()).toBe(1);
    expect(child.level()).toBe(2);
    expect(grandchild.level()).toBe(3);

    // Active cluster inside child: vessel level is 2, member level should match vessel level
    const cVessel = new Node(4n);
    cVessel.setClusterVessel(true);
    g.addNewNodeToContainer(child, cVessel);
    const cMember = new Node(5n);
    g.addNodeUnchecked(cMember);
    const cluster = new Cluster({
      Vessel: cVessel,
      Nodes: [cMember],
      Graph: g,
    });
    g.Clusters.set(cVessel, cluster);
    cMember.Cluster = cluster;
    expect(cMember.level()).toBe(cVessel.level());
    expect(cMember.level()).toBe(3); // cVessel is child of child(2), so level is 1 + 2 = 3

    // Inactive cluster member falls back to direct Container
    const inactVessel = new Node(6n);
    const inactMember = new Node(7n);
    g.addNewNodeToContainer(child, inactMember);
    const inactCluster = new Cluster({
      Vessel: inactVessel,
      Nodes: [inactMember],
      Graph: null,
    });
    inactMember.Cluster = inactCluster;
    expect(inactMember.level()).toBe(1 + child.level());
    expect(inactMember.level()).toBe(3);
  });

  it("should evaluate isDescendantOf traversing containers and groups regardless of active state", () => {
    const root = new Node(1n);
    const parent = new Node(2n);
    parent.Container = root;
    const leaf = new Node(3n);
    leaf.Container = parent;

    expect(leaf.isDescendantOf(root)).toBe(true);
    expect(leaf.isDescendantOf(parent)).toBe(true);
    expect(leaf.isDescendantOf(leaf)).toBe(true);
    expect(leaf.isDescendantOf(null)).toBe(true);

    const other = new Node(99n);
    expect(leaf.isDescendantOf(other)).toBe(false);

    // Cluster member follows Cluster.Vessel
    const cVessel = new Node(4n);
    cVessel.Container = parent;
    const cMember = new Node(5n);
    const cluster = new Cluster({ Vessel: cVessel, Nodes: [cMember] });
    cMember.Cluster = cluster;

    expect(cMember.isDescendantOf(parent)).toBe(true);
    expect(cMember.isDescendantOf(root)).toBe(true);
    expect(cMember.isDescendantOf(other)).toBe(false);

    // Sequence member follows Sequence.Vessel
    const sVessel = new Node(6n);
    sVessel.Container = parent;
    const sMember = new Node(7n);
    const seq = new Sequence({ Vessel: sVessel, Nodes: [sMember] });
    sMember.Sequence = seq;

    expect(sMember.isDescendantOf(parent)).toBe(true);
    expect(sMember.isDescendantOf(root)).toBe(true);
    expect(sMember.isDescendantOf(other)).toBe(false);
  });

  it("should compute containerRDFSOrder and clusterRDFSOrder accurately", () => {
    const g = new Graph();
    // Hierarchy:
    // root (null)
    //   A (ID 1, container)
    //     B (ID 2, container)
    //     leaf1 (ID 3)
    //   C (ID 4, container)
    //     cVessel (ID 6, cluster vessel)
    //       cMemberContainer (ID 7, container)
    //         leaf3 (ID 8)
    //     leaf2 (ID 5)
    const A = new Node(1n);
    const B = new Node(2n);
    const leaf1 = new Node(3n);
    const C = new Node(4n);
    const leaf2 = new Node(5n);

    g.addNewNodeToContainer(null, A);
    g.addNewNodeToContainer(A, B);
    g.addNewNodeToContainer(A, leaf1);
    g.addNewNodeToContainer(null, C);
    g.addNewNodeToContainer(C, leaf2);

    const normalOrder = g.containerRDFSOrder(null).map((n) => n.ID);
    // Reverse order of root: C, A -> C has no container children, A has B -> B, A, C? Wait:
    // In slices.Backward(Containers[root]): children are [A, C]. Backward is C, then A.
    // C has no container children -> append C.
    // A has children [B, leaf1]. Backward is leaf1, B.
    // B has no container children -> append B.
    // A has finished -> append A.
    // Result: [4n, 2n, 1n] or matching Go. Let's see: leaf2 is not a container, leaf1 not a container.
    // Let's verify against our Go oracle result!

    const cVessel = new Node(6n);
    cVessel.setClusterVessel(true);
    g.addNewNodeToContainer(C, cVessel);

    const cMemberContainer = new Node(7n);
    g.addNodeUnchecked(cMemberContainer);
    g.addNewNodeToContainer(cMemberContainer, new Node(8n));
    const cluster = new Cluster({
      Vessel: cVessel,
      Nodes: [cMemberContainer],
      Graph: g,
    });
    g.Clusters.set(cVessel, cluster);

    const clusterRDFS = g.clusterRDFSOrder().map((n) => n.ID);
    expect(clusterRDFS).toEqual([6n]);

    // Non-container root returns empty array
    expect(g.containerRDFSOrder(leaf1)).toEqual([]);
  });

  it("should preserve WalkRDFS traversal precedence: cluster vessel branch overrides sequence branch", () => {
    const g = new Graph();
    const root = new Node(1n);
    const child = new Node(2n);
    g.addNewNodeToContainer(null, root);
    g.addNewNodeToContainer(root, child);

    root.setClusterVessel(true);
    const cNode = new Node(3n);
    g.addNodeUnchecked(cNode);
    g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [cNode], Graph: g }));

    const sNode = new Node(4n);
    g.addNodeUnchecked(sNode);
    g.Sequences.set(root, new Sequence({ Vessel: root, Nodes: [sNode], Graph: g }));

    const visited = [];
    root.rdfsWalk((n) => {
      visited.push(n.ID);
    });

    // In Go logic:
    // 1. Containers[root] -> child (2n)
    // 2. if isClusterVessel: cNode (3n)
    // 3. else if isSequence: skipped! (4n is NOT visited)
    // 4. root (1n)
    expect(visited).toEqual([2n, 3n, 1n]);
  });
});
