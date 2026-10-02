import { describe, it, expect, spyOn } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";

describe("Slice 26 — SyncNestedGeometry Unit Tests", () => {
  it("executes operations in strict Graph.Nodes source array order", () => {
    const g = new Graph();
    const callLog = [];

    const n1 = new Node(1, 10, 10);
    n1.Graph = g;
    n1.positionContainerChildren = () => callLog.push("n1");
    n1.isContainer = true;

    const n2 = new Node(2, 10, 10);
    n2.Graph = g;
    n2.positionContainerChildren = () => callLog.push("n2");
    n2.isContainer = true;

    // Put n2 before n1 in the array
    g.Nodes = [n2, n1];
    g.SyncNestedGeometry();

    expect(callLog).toEqual(["n2", "n1"]);
  });

  it("executes operations on a multi-role node in exact order (Container -> Cluster -> Sequence)", () => {
    const g = new Graph();
    const n = new Node(1, 10, 10);
    n.Graph = g;
    g.Nodes = [n];

    const callLog = [];

    n.isContainer = true;
    n.positionContainerChildren = () => callLog.push("Container");

    n.isClusterVessel = true;
    const cluster = new Cluster();
    cluster.Graph = g;
    cluster.SyncGeometry = () => callLog.push("Cluster");
    cluster.Nodes = [];
    g.Clusters.set(n, cluster);

    const sequence = new Sequence();
    sequence.Graph = g;
    sequence.SyncGeometry = () => callLog.push("Sequence");
    g.Sequences.set(n, sequence);

    g.SyncNestedGeometry();

    expect(callLog).toEqual(["Container", "Cluster", "Sequence"]);
  });

  it("executes Cluster.SyncGeometry before applying padding correction to cluster-member containers", () => {
    const g = new Graph();
    const vessel = new Node(1, 10, 10);
    vessel.Graph = g;
    g.Nodes = [vessel];

    vessel.isClusterVessel = true;
    const memberContainer = new Node(2, 10, 10);
    memberContainer.Graph = g;
    memberContainer.isContainer = true;
    
    // Add child to member container so padding correction does something
    const child = new Node(3, 10, 10);
    child.Graph = g;
    g.Containers.set(memberContainer, [child]);

    const cluster = new Cluster();
    cluster.Graph = g;
    cluster.Nodes = [memberContainer];
    g.Clusters.set(vessel, cluster);

    const callLog = [];

    // Spy on Cluster SyncGeometry
    cluster.SyncGeometry = () => callLog.push("ClusterSyncGeometry");

    // Spy on moveNodeWithChildren
    child.moveNodeWithChildren = () => callLog.push("PaddingCorrection");

    g.SyncNestedGeometry();

    expect(callLog).toEqual(["ClusterSyncGeometry", "PaddingCorrection"]);
  });

  it("preserves undefined sequence key without erroring", () => {
    const g = new Graph();
    const n = new Node(1, 10, 10);
    n.Graph = g;
    g.Nodes = [n];
    // No sequence in g.Sequences
    expect(() => g.SyncNestedGeometry()).not.toThrow();
  });
});
