import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Point } from "../../src/geometry/point.js";

describe("Slice 25 — RDFS Traversal & Graph SyncClusters Unit Tests", () => {
  describe("API and Scope Boundaries", () => {
    it("exposes rdfsWalk and WalkRDFS on Node", () => {
      const n = new Node(1, 10, 10);
      expect(typeof n.rdfsWalk).toBe("function");
      expect(typeof n.WalkRDFS).toBe("function");
    });

    it("exposes syncClusters and SyncClusters on Graph", () => {
      const g = new Graph();
      expect(typeof g.syncClusters).toBe("function");
      expect(typeof g.SyncClusters).toBe("function");
    });

    it("forbidden future and out-of-scope methods remain absent", () => {
      const g = new Graph();
      const n = new Node(1, 10, 10);

      // Graph future orchestration methods

      expect(g.syncNested).toBeUndefined();
      expect(g.binPackSyncClusters).toBeUndefined();
      expect(g.Cleanup).toBeUndefined();
      expect(g.cleanup).toBeUndefined();

      // Node future methods
      expect(n.setContainer).toBeUndefined();
      expect(n.SetContainer).toBeUndefined();
      expect(n.Join).toBeUndefined();
      expect(n.JoinDistancedClusters).toBeUndefined();
      expect(n.AddHubs).toBeUndefined();
      expect(n.addHubs).toBeUndefined();
      expect(n.binPackWrapChildren).toBeUndefined();
    });
  });

  describe("Section 1: Node.rdfsWalk Natural Failure & Topology Parity", () => {
    it("ordinary nil Graph throws TypeError before callback", () => {
      const n = new Node(1, 50, 50);
      n.Graph = null;
      n.isContainer = false;
      n.isClusterVessel = false;

      let called = false;
      expect(() => {
        n.rdfsWalk(() => {
          called = true;
        });
      }).toThrow();
      expect(called).toBe(false);
    });

    it("missing cluster mapping for marked cluster vessel throws before callback", () => {
      const g = new Graph();
      const n = new Node(1, 50, 50);
      n.Graph = g;
      n.setClusterVessel(true);
      // g.Clusters has no key for n

      let called = false;
      expect(() => {
        n.rdfsWalk(() => {
          called = true;
        });
      }).toThrow();
      expect(called).toBe(false);
    });

    it("explicitly null cluster mapping for marked cluster vessel throws before callback", () => {
      const g = new Graph();
      const n = new Node(1, 50, 50);
      n.Graph = g;
      n.setClusterVessel(true);
      g.Clusters.set(n, null);

      let called = false;
      expect(() => {
        n.rdfsWalk(() => {
          called = true;
        });
      }).toThrow();
      expect(called).toBe(false);
    });

    it("missing sequence key skips sequence branch without throw", () => {
      const g = new Graph();
      const n = new Node(1, 50, 50);
      n.Graph = g;
      n.isContainer = false;
      n.setClusterVessel(false);
      // g.Sequences has no key for n

      const visited = [];
      n.rdfsWalk((curr) => {
        visited.push(curr.ID);
      });
      expect(visited).toEqual([1]);
    });

    it("explicitly null sequence mapping throws before callback", () => {
      const g = new Graph();
      const n = new Node(1, 50, 50);
      n.Graph = g;
      n.isContainer = false;
      n.setClusterVessel(false);
      g.Sequences.set(n, null);

      let called = false;
      expect(() => {
        n.rdfsWalk(() => {
          called = true;
        });
      }).toThrow();
      expect(called).toBe(false);
    });

    it("duplicate container child references are invoked multiple times without deduplication", () => {
      const g = new Graph();
      const root = new Node(1, 50, 50);
      root.Graph = g;
      root.isContainer = true;
      const child = new Node(2, 20, 20);
      child.Graph = g;
      g.Containers.set(root, [child, child]);

      const visited = [];
      root.rdfsWalk((curr) => {
        visited.push(curr.ID);
      });
      expect(visited).toEqual([2, 2, 1]);
    });

    it("cluster vessel branch overrides sequence branch", () => {
      const g = new Graph();
      const root = new Node(1, 50, 50);
      root.Graph = g;
      root.setClusterVessel(true);

      const cMember = new Node(2, 20, 20);
      cMember.Graph = g;
      g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [cMember], Graph: g }));

      const sStep = new Node(3, 20, 20);
      sStep.Graph = g;
      g.Sequences.set(root, new Sequence({ Vessel: root, Nodes: [sStep], Graph: g }));

      const visited = [];
      root.rdfsWalk((curr) => {
        visited.push(curr.ID);
      });
      expect(visited).toEqual([2, 1]);
      expect(visited.includes(3)).toBe(false);
    });

    it("callback throws after descendants have already executed with no rollback", () => {
      const g = new Graph();
      const root = new Node(1, 50, 50);
      root.Graph = g;
      root.isContainer = true;
      const child = new Node(2, 20, 20);
      child.Graph = g;
      g.Containers.set(root, [child]);

      const visited = [];
      expect(() => {
        root.rdfsWalk((curr) => {
          visited.push(curr.ID);
          if (curr === root) {
            throw new Error("fail on root callback");
          }
        });
      }).toThrow("fail on root callback");

      expect(visited).toEqual([2, 1]);
    });
  });

  describe("Section 2: Graph.SyncClusters Execution & Invariants", () => {
    it("empty Clusters map returns early without touching malformed Nodes", () => {
      const g = new Graph();
      g.Clusters = new Map();
      g.Nodes = [null, undefined, { rdfsWalk: () => { throw new Error("should not run"); } }];

      expect(() => {
        g.SyncClusters();
      }).not.toThrow();
    });

    it("traverses Graph.Nodes in exact array source order without sorting or clusterRDFSOrder", () => {
      const g = new Graph();

      const v1 = new Node(99, 10, 10);
      v1.Graph = g;
      v1.setClusterVessel(true);
      const m1 = new Node(100, 20, 20);
      m1.Graph = g;
      const c1 = new Cluster({ Vessel: v1, Nodes: [m1], Graph: g });
      g.Clusters.set(v1, c1);

      const v2 = new Node(3, 10, 10);
      v2.Graph = g;
      v2.setClusterVessel(true);
      const m2 = new Node(4, 20, 20);
      m2.Graph = g;
      const c2 = new Cluster({ Vessel: v2, Nodes: [m2], Graph: g });
      g.Clusters.set(v2, c2);

      const syncOrder = [];
      c1.SyncGeometry = () => { syncOrder.push(v1.ID); };
      c2.SyncGeometry = () => { syncOrder.push(v2.ID); };

      // Intentionally scrambled IDs: 99 before 3
      g.Nodes = [v1, v2];
      g.SyncClusters();
      expect(syncOrder).toEqual([99, 3]);

      // Reversed: 3 before 99
      syncOrder.length = 0;
      g.Nodes = [v2, v1];
      g.SyncClusters();
      expect(syncOrder).toEqual([3, 99]);
    });

    it("callback checks isClusterVessel flag, not map membership", () => {
      const g = new Graph();
      const n = new Node(1, 10, 10);
      n.Graph = g;
      n.setClusterVessel(false);

      const m = new Node(2, 20, 20);
      m.Graph = g;
      const c = new Cluster({ Vessel: n, Nodes: [m], Graph: g });
      let synced = false;
      c.SyncGeometry = () => { synced = true; };

      g.Clusters.set(n, c);
      g.Nodes = [n];

      g.SyncClusters();
      expect(synced).toBe(false);
    });

    it("duplicate root in Graph.Nodes synchronizes cluster multiple times (no root dedupe)", () => {
      const g = new Graph();
      const v = new Node(1, 10, 10);
      v.Graph = g;
      v.setClusterVessel(true);
      const m = new Node(2, 20, 20);
      m.Graph = g;

      const c = new Cluster({ Vessel: v, Nodes: [m], Graph: g });
      let syncCalls = 0;
      c.SyncGeometry = () => { syncCalls++; };

      g.Clusters.set(v, c);
      g.Nodes = [v, v, v];

      g.SyncClusters();
      expect(syncCalls).toBe(3);
    });

    it("uses outer graph Clusters lookup rather than node.Graph.Clusters", () => {
      const outerGraph = new Graph();
      const innerGraph = new Graph();

      const root = new Node(1, 10, 10);
      root.Graph = innerGraph;
      root.isContainer = true;

      const vessel = new Node(2, 10, 10);
      vessel.Graph = innerGraph;
      vessel.setClusterVessel(true);
      innerGraph.Containers.set(root, [vessel]);

      const innerCluster = new Cluster({ Vessel: vessel, Nodes: [], Graph: innerGraph });
      let innerSynced = false;
      innerCluster.SyncGeometry = () => { innerSynced = true; };
      innerGraph.Clusters.set(vessel, innerCluster);

      const outerCluster = new Cluster({ Vessel: vessel, Nodes: [], Graph: outerGraph });
      let outerSynced = false;
      outerCluster.SyncGeometry = () => { outerSynced = true; };
      outerGraph.Clusters.set(vessel, outerCluster);

      outerGraph.Nodes = [root];
      outerGraph.SyncClusters();

      expect(outerSynced).toBe(true);
      expect(innerSynced).toBe(false);
    });

    it("cluster vessel inside sequence step is synchronized when sequence node is traversed", () => {
      const g = new Graph();
      const sVessel = new Node(1, 10, 10);
      sVessel.Graph = g;
      sVessel.setClusterVessel(false);

      const step1 = new Node(2, 10, 10);
      step1.Graph = g;
      step1.setClusterVessel(true);

      const m = new Node(3, 20, 20);
      m.Graph = g;

      const seq = new Sequence({ Vessel: sVessel, Nodes: [step1], Graph: g });
      g.Sequences.set(sVessel, seq);

      const c = new Cluster({ Vessel: step1, Nodes: [m], Graph: g });
      let clusterSynced = false;
      c.SyncGeometry = () => { clusterSynced = true; };
      g.Clusters.set(step1, c);

      g.Nodes = [sVessel];
      g.SyncClusters();

      expect(clusterSynced).toBe(true);
    });
  });
});
