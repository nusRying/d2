import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Point } from "../../src/geometry/point.js";
import {
  clusterExternalConnectedNodes,
  ClusterExternalConnectedNodes,
} from "../../src/placement/cluster-connections.js";
import * as placementBarrel from "../../src/placement/index.js";
import * as rootBarrel from "../../src/internal.js";

describe("clusterExternalConnectedNodes Direct Tests", () => {
  it("discovers external nodes via edge abductions", () => {
    const rootGraph = new Graph();
    const clusterGraph = new Graph();

    const clusterNode1 = new Node(10n);
    clusterNode1.Graph = clusterGraph;

    const cluster = new Node(100n);
    cluster.Graph = rootGraph;
    cluster.Nodes = [clusterNode1];

    const extA = new Node(1n);
    extA.Graph = clusterGraph;
    extA.TopLeft = new Point(0, 0);

    const extB = new Node(2n);
    extB.Graph = clusterGraph;
    extB.TopLeft = new Point(10, 10);

    // Case A: OriginallyFrom is null, OriginallyTo is non-null => CurrentFrom is candidate
    const abdA = {
      OriginallyFrom: null,
      OriginallyTo: new Node(99n),
      CurrentFrom: extA,
      CurrentTo: clusterNode1,
    };

    // Case B: OriginallyTo is null, OriginallyFrom is non-null => CurrentTo is candidate
    const abdB = {
      OriginallyFrom: new Node(98n),
      OriginallyTo: null,
      CurrentFrom: clusterNode1,
      CurrentTo: extB,
    };

    cluster.EdgeAbductions = [abdA, abdB];

    const result = clusterExternalConnectedNodes(cluster);
    expect(result).toEqual([extA, extB]);
  });

  it("ignores edge abductions where both endpoints are null or both non-null", () => {
    const g = new Graph();
    const clusterNode = new Node(10n);
    clusterNode.Graph = g;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];

    const extA = new Node(1n);
    extA.Graph = g;
    extA.TopLeft = new Point(0, 0);

    const dummy = new Node(99n);

    // Both non-null
    const abdBothNonNull = {
      OriginallyFrom: dummy,
      OriginallyTo: dummy,
      CurrentFrom: extA,
      CurrentTo: clusterNode,
    };

    // Both null
    const abdBothNull = {
      OriginallyFrom: null,
      OriginallyTo: null,
      CurrentFrom: extA,
      CurrentTo: clusterNode,
    };

    cluster.EdgeAbductions = [abdBothNonNull, abdBothNull];
    const result = clusterExternalConnectedNodes(cluster);
    expect(result).toEqual([]);
  });

  it("filters out candidates without TopLeft or from a different graph", () => {
    const clusterGraph = new Graph();
    const otherGraph = new Graph();

    const clusterNode = new Node(10n);
    clusterNode.Graph = clusterGraph;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];

    // Unpositioned candidate (TopLeft == null)
    const unpositioned = new Node(1n);
    unpositioned.Graph = clusterGraph;
    unpositioned.TopLeft = null;

    // Wrong graph candidate
    const wrongGraph = new Node(2n);
    wrongGraph.Graph = otherGraph;
    wrongGraph.TopLeft = new Point(0, 0);

    // Valid candidate
    const valid = new Node(3n);
    valid.Graph = clusterGraph;
    valid.TopLeft = new Point(10, 10);

    cluster.EdgeAbductions = [
      {
        OriginallyFrom: null,
        OriginallyTo: clusterNode,
        CurrentFrom: unpositioned,
        CurrentTo: clusterNode,
      },
      {
        OriginallyFrom: null,
        OriginallyTo: clusterNode,
        CurrentFrom: wrongGraph,
        CurrentTo: clusterNode,
      },
      {
        OriginallyFrom: null,
        OriginallyTo: clusterNode,
        CurrentFrom: valid,
        CurrentTo: clusterNode,
      },
    ];

    const result = clusterExternalConnectedNodes(cluster);
    expect(result).toEqual([valid]);
  });

  it("deduplicates candidates preserving first-seen order", () => {
    const g = new Graph();
    const clusterNode = new Node(10n);
    clusterNode.Graph = g;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];

    const n1 = new Node(1n);
    n1.Graph = g;
    n1.TopLeft = new Point(1, 1);

    const n2 = new Node(2n);
    n2.Graph = g;
    n2.TopLeft = new Point(2, 2);

    // Order: n2, n1, n2, n1
    cluster.EdgeAbductions = [
      { OriginallyFrom: null, OriginallyTo: clusterNode, CurrentFrom: n2, CurrentTo: clusterNode },
      { OriginallyFrom: null, OriginallyTo: clusterNode, CurrentFrom: n1, CurrentTo: clusterNode },
      { OriginallyFrom: null, OriginallyTo: clusterNode, CurrentFrom: n2, CurrentTo: clusterNode },
      { OriginallyFrom: null, OriginallyTo: clusterNode, CurrentFrom: n1, CurrentTo: clusterNode },
    ];

    const result = clusterExternalConnectedNodes(cluster);
    expect(result).toEqual([n2, n1]);
  });

  it("keeps distinct nodes with the same ID distinct", () => {
    const g = new Graph();
    const clusterNode = new Node(10n);
    clusterNode.Graph = g;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];

    const n1a = new Node(5n);
    n1a.Graph = g;
    n1a.TopLeft = new Point(1, 1);

    const n1b = new Node(5n); // same ID, distinct object
    n1b.Graph = g;
    n1b.TopLeft = new Point(2, 2);

    cluster.EdgeAbductions = [
      { OriginallyFrom: null, OriginallyTo: clusterNode, CurrentFrom: n1a, CurrentTo: clusterNode },
      { OriginallyFrom: null, OriginallyTo: clusterNode, CurrentFrom: n1b, CurrentTo: clusterNode },
    ];

    const result = clusterExternalConnectedNodes(cluster);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(n1a);
    expect(result[1]).toBe(n1b);
  });

  it("returns empty array for empty edge abductions", () => {
    const g = new Graph();
    const clusterNode = new Node(10n);
    clusterNode.Graph = g;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];
    cluster.EdgeAbductions = [];
    expect(clusterExternalConnectedNodes(cluster)).toEqual([]);
  });

  it("throws TypeError on null cluster or empty cluster.Nodes matching Go panic", () => {
    expect(() => clusterExternalConnectedNodes(null)).toThrow(TypeError);

    const emptyCluster = new Node(100n);
    emptyCluster.Nodes = [];
    expect(() => clusterExternalConnectedNodes(emptyCluster)).toThrow(TypeError);
  });

  it("throws TypeError when Case A edge abduction has null CurrentFrom", () => {
    const g = new Graph();
    const clusterNode = new Node(10n);
    clusterNode.Graph = g;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];
    const dummy = new Node(999n);
    cluster.EdgeAbductions = [
      { OriginallyFrom: null, OriginallyTo: dummy, CurrentFrom: null, CurrentTo: clusterNode },
    ];
    expect(() => clusterExternalConnectedNodes(cluster)).toThrow(TypeError);
  });

  it("throws TypeError when Case B edge abduction has null CurrentTo", () => {
    const g = new Graph();
    const clusterNode = new Node(10n);
    clusterNode.Graph = g;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];
    const dummy = new Node(999n);
    cluster.EdgeAbductions = [
      { OriginallyFrom: dummy, OriginallyTo: null, CurrentFrom: clusterNode, CurrentTo: null },
    ];
    expect(() => clusterExternalConnectedNodes(cluster)).toThrow(TypeError);
  });

  it("throws TypeError when an edgeAbduction element is null", () => {
    const g = new Graph();
    const clusterNode = new Node(10n);
    clusterNode.Graph = g;

    const cluster = new Node(100n);
    cluster.Nodes = [clusterNode];
    cluster.EdgeAbductions = [null];
    expect(() => clusterExternalConnectedNodes(cluster)).toThrow(TypeError);
  });

  it("exposes ClusterExternalConnectedNodes as identical alias", () => {
    expect(ClusterExternalConnectedNodes).toBe(clusterExternalConnectedNodes);
  });

  it("is not exposed in placement or root barrels", () => {
    expect(placementBarrel.clusterExternalConnectedNodes).toBeUndefined();
    expect(placementBarrel.ClusterExternalConnectedNodes).toBeUndefined();
    expect(rootBarrel.clusterExternalConnectedNodes).toBeUndefined();
    expect(rootBarrel.ClusterExternalConnectedNodes).toBeUndefined();
  });
});
