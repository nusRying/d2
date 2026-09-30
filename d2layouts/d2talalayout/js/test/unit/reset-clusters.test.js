import { describe, expect, test } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Cluster } from "../../src/graph/cluster.js";
import { Point } from "../../src/geometry/point.js";
import { resetClusters, ResetClusters } from "../../src/grouping/index.js";
import * as groupingExports from "../../src/grouping/index.js";
import * as rootExports from "../../src/index.js";

describe("Slice 16 Direct Unit Tests - ResetClusters Lifecycle Retirement", () => {
  describe("API and Export Boundaries", () => {
    test("grouping exports resetClusters and ResetClusters alias", () => {
      expect(typeof resetClusters).toBe("function");
      expect(typeof ResetClusters).toBe("function");
      expect(resetClusters).toBe(ResetClusters);
      expect(groupingExports.resetClusters).toBe(resetClusters);
      expect(groupingExports.ResetClusters).toBe(ResetClusters);
    });

    test("root index.js does NOT export grouping primitives", () => {
      expect(rootExports.resetClusters).toBeUndefined();
      expect(rootExports.ResetClusters).toBeUndefined();
      expect(rootExports.addClusters).toBeUndefined();
      expect(rootExports.cleanup).toBeUndefined();
      expect(rootExports.Cleanup).toBeUndefined();
    });

    test("grouping index does NOT export forbidden Slice 17 functions", () => {
      expect(groupingExports.cleanup).toBeUndefined();
      expect(groupingExports.Cleanup).toBeUndefined();
      expect(groupingExports.join).toBeUndefined();
      expect(groupingExports.Join).toBeUndefined();
      expect(groupingExports.joinDistancedClusters).toBeUndefined();
      expect(groupingExports.JoinDistancedClusters).toBeUndefined();
      expect(groupingExports.addHubs).toBeUndefined();
      expect(groupingExports.AddHubs).toBeUndefined();
    });
  });

  describe("Entry and Nil Handling", () => {
    test("handles null or undefined graph safely without throwing", () => {
      expect(() => resetClusters(null)).not.toThrow();
      expect(() => resetClusters(undefined)).not.toThrow();
      expect(() => resetClusters({})).not.toThrow();
    });

    test("empty Clusters map is a no-op and preserves Map identity", () => {
      const g = new Graph();
      const n1 = new Node(1, 10, 10);
      g.addNewNodeToContainer(null, n1);
      const originalClusters = g.Clusters;
      const originalNodes = g.Nodes;

      resetClusters(g);

      expect(g.Clusters).toBe(originalClusters);
      expect(g.Clusters.size).toBe(0);
      expect(g.Nodes).toBe(originalNodes);
      expect(g.Nodes.length).toBe(1);
    });

    test("null Clusters property is a no-op without mutation", () => {
      const g = new Graph();
      g.Clusters = null;
      expect(() => resetClusters(g)).not.toThrow();
      expect(g.Clusters).toBeNull();
    });
  });

  describe("In-Place Array Compaction & Backing-Storage Reuse", () => {
    test("non-bulk single vessel filters in-place preserving Array instance and survivor order", () => {
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      const ordinary = g.addNode(new Node(2, 10, 10));
      const vessel = g.addNode(new Node(3, 10, 10));
      const member = g.addNode(new Node(4, 10, 10));
      vessel.setClusterVessel(true);
      vessel.Container = root;

      const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
      g.Clusters.set(vessel, cluster);

      // Construct graph.Nodes and container array with duplicates of vessel
      g.Nodes = [ordinary, vessel, member, vessel];
      const rootChildren = [vessel, ordinary, member, vessel];
      g.Containers.set(root, rootChildren);

      const originalNodesRef = g.Nodes;
      const originalChildrenRef = rootChildren;

      resetClusters(g);

      // Verify exact Array object identity retained (Go slice[:0] analogue)
      expect(g.Nodes).toBe(originalNodesRef);
      expect(g.Nodes.length).toBe(2);
      expect(g.Nodes).toEqual([ordinary, member]);

      expect(g.Containers.get(root)).toBe(originalChildrenRef);
      expect(g.Containers.get(root).length).toBe(2);
      expect(g.Containers.get(root)).toEqual([ordinary, member]);
    });

    test("bulk multiple vessels filter in-place preserving Array instance and survivor order", () => {
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      const ordinary1 = g.addNode(new Node(2, 10, 10));
      const ordinary2 = g.addNode(new Node(3, 10, 10));
      const vesselA = g.addNode(new Node(4, 10, 10));
      const vesselB = g.addNode(new Node(5, 10, 10));

      vesselA.setClusterVessel(true);
      vesselA.Container = root;
      vesselB.setClusterVessel(true);
      vesselB.Container = root;

      const clusterA = new Cluster({ Vessel: vesselA, Graph: g });
      const clusterB = new Cluster({ Vessel: vesselB, Graph: g });
      g.Clusters.set(vesselA, clusterA);
      g.Clusters.set(vesselB, clusterB);

      g.Nodes = [ordinary1, vesselA, null, vesselB, ordinary2, vesselA];
      const rootChildren = [vesselB, ordinary1, vesselA, null, ordinary2, vesselB];
      g.Containers.set(root, rootChildren);

      const originalNodesRef = g.Nodes;
      const originalChildrenRef = rootChildren;

      resetClusters(g);

      expect(g.Nodes).toBe(originalNodesRef);
      expect(g.Nodes.length).toBe(3);
      expect(g.Nodes).toEqual([ordinary1, null, ordinary2]);

      expect(g.Containers.get(root)).toBe(originalChildrenRef);
      expect(g.Containers.get(root).length).toBe(3);
      expect(g.Containers.get(root)).toEqual([ordinary1, null, ordinary2]);
    });

    test("preserves null and non-null-empty container child arrays without conversion", () => {
      const g = new Graph();
      const cNil = g.addNode(new Node(1, 10, 10));
      const cEmpty = g.addNode(new Node(2, 10, 10));
      const vessel = g.addNode(new Node(3, 10, 10));
      vessel.setClusterVessel(true);

      const emptyArrayRef = [];
      g.Containers.set(cNil, null);
      g.Containers.set(cEmpty, emptyArrayRef);

      const cluster = new Cluster({ Vessel: vessel, Graph: g });
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      expect(g.Containers.get(cNil)).toBeNull();
      expect(g.Containers.get(cEmpty)).toBe(emptyArrayRef);
      expect(g.Containers.get(cEmpty).length).toBe(0);
    });
  });

  describe("Pointer-Matched Member Cluster Ownership", () => {
    test("clears member Cluster only when pointer matches cluster being reset", () => {
      const g = new Graph();
      const vessel = g.addNode(new Node(1, 10, 10));
      const memberOwned = g.addNode(new Node(2, 10, 10));
      const memberUnowned = g.addNode(new Node(3, 10, 10));
      vessel.setClusterVessel(true);

      const clusterBeingReset = new Cluster({ Vessel: vessel, Graph: g, Nodes: [memberOwned, memberUnowned] });
      const foreignCluster = new Cluster({ Graph: g });

      memberOwned.Cluster = clusterBeingReset;
      memberUnowned.Cluster = foreignCluster;

      g.Clusters.set(vessel, clusterBeingReset);

      resetClusters(g);

      // memberOwned was pointing to clusterBeingReset -> cleared
      expect(memberOwned.Cluster).toBeNull();
      // memberUnowned was pointing to foreignCluster -> preserved untouched!
      expect(memberUnowned.Cluster).toBe(foreignCluster);
    });
  });

  describe("Near Relationship Semantics", () => {
    test("cleans up Near sets preserving Set identities and creates fresh empty Set for vessel", () => {
      const g = new Graph();
      const ordinary = g.addNode(new Node(1, 10, 10));
      const member = g.addNode(new Node(2, 10, 10));
      const vessel = g.addNode(new Node(3, 10, 10));
      vessel.setClusterVessel(true);

      const memberNearsRef = new Set([vessel]);
      const ordinaryNearsRef = new Set([vessel]);
      const originalVesselNearsRef = new Set([ordinary, member]);

      member.Nears = memberNearsRef;
      ordinary.Nears = ordinaryNearsRef;
      vessel.Nears = originalVesselNearsRef;

      const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      // Member Near Set identity retained, vessel removed
      expect(member.Nears).toBe(memberNearsRef);
      expect(member.Nears.has(vessel)).toBe(false);
      expect(member.Nears.size).toBe(0);

      // External node Near Set identity retained, vessel removed
      expect(ordinary.Nears).toBe(ordinaryNearsRef);
      expect(ordinary.Nears.has(vessel)).toBe(false);
      expect(ordinary.Nears.size).toBe(0);

      // Retired vessel Near map replaced with fresh non-null empty Set
      expect(vessel.Nears).not.toBe(originalVesselNearsRef);
      expect(vessel.Nears instanceof Set).toBe(true);
      expect(vessel.Nears.size).toBe(0);
    });

    test("vessel with null Nears gets fresh empty Set; member with null Nears remains null", () => {
      const g = new Graph();
      const member = g.addNode(new Node(1, 10, 10));
      const vessel = g.addNode(new Node(2, 10, 10));
      vessel.setClusterVessel(true);

      member.Nears = null;
      vessel.Nears = null;

      const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      expect(member.Nears).toBeNull();
      expect(vessel.Nears instanceof Set).toBe(true);
      expect(vessel.Nears.size).toBe(0);
    });

    test("member Near containing null is cleaned up when vessel is null", () => {
      const g = new Graph();
      const member = g.addNode(new Node(1, 10, 10));
      const memberNears = new Set([null]);
      member.Nears = memberNears;

      const cluster = new Cluster({ Graph: g, Nodes: [member] });
      g.Clusters.set(null, cluster);

      resetClusters(g);

      expect(member.Nears).toBe(memberNears);
      expect(member.Nears.has(null)).toBe(false);
      expect(member.Nears.size).toBe(0);
    });
  });

  describe("Edge Abduction Reconnect and Ordering Regression", () => {
    test("reconnects edge even if already connected, reordering within node.Edges", () => {
      const g = new Graph();
      const member = g.addNode(new Node(1, 10, 10));
      const targetA = g.addNode(new Node(2, 10, 10));
      const targetB = g.addNode(new Node(3, 10, 10));
      const vessel = g.addNode(new Node(4, 10, 10));
      vessel.setClusterVessel(true);

      const e1 = g.connect(member, targetA);
      const e2 = g.connect(member, targetB);

      // Initially member.Edges is [e1, e2]
      expect(member.Edges).toEqual([e1, e2]);

      // Abduction has OriginallyFrom = member, OriginallyTo = targetA
      // Even though e1.From is already member and e1.To is targetA!
      const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
      cluster.EdgeAbductions = [{ Edge: e1, OriginallyFrom: member, OriginallyTo: targetA }];
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      // Unconditional reconnect removed e1 and appended it -> member.Edges is now [e2, e1]!
      expect(member.Edges).toEqual([e2, e1]);
      expect(e1.From).toBe(member);
      expect(e1.To).toBe(targetA);
    });

    test("preserves edge route Points array, Point object identities, and coordinates", () => {
      const g = new Graph();
      const member = g.addNode(new Node(1, 10, 10));
      const target = g.addNode(new Node(2, 10, 10));
      const vessel = g.addNode(new Node(3, 10, 10));
      vessel.setClusterVessel(true);

      const edge = g.connect(member, target);
      const p0 = new Point(10, 20);
      const p1 = new Point(30, 40);
      const pointsArray = [p0, p1];
      edge.Points = pointsArray;

      const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
      cluster.EdgeAbductions = [{ Edge: edge, OriginallyFrom: member, OriginallyTo: target }];
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      expect(edge.Points).toBe(pointsArray);
      expect(edge.Points[0]).toBe(p0);
      expect(edge.Points[1]).toBe(p1);
      expect(edge.Points[0].X).toBe(10);
      expect(edge.Points[0].Y).toBe(20);
      expect(edge.Points[1].X).toBe(30);
      expect(edge.Points[1].Y).toBe(40);
    });
  });

  describe("Retired Vessel Metadata & Preserved Domains", () => {
    test("retires vessel metadata while leaving non-vessel fields intact", () => {
      const g = new Graph();
      const root = g.addNode(new Node(10, 100, 100));
      const vessel = g.addNode(new Node(1, 50, 50));
      vessel.setClusterVessel(true);
      vessel.Container = root;
      vessel.Label = { Width: 20, Height: 10 };
      vessel.TopLeft = new Point(5, 5);

      const cluster = new Cluster({ Vessel: vessel, Graph: g });
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      expect(vessel.Graph).toBeNull();
      expect(vessel.Container).toBeNull();
      expect(vessel.isClusterVessel).toBe(false);
      expect(vessel.ID).toBe(1);
      expect(vessel.Width).toBe(50);
      expect(vessel.Height).toBe(50);
      expect(vessel.TopLeft.X).toBe(5);
      expect(vessel.TopLeft.Y).toBe(5);
      expect(vessel.Label.Width).toBe(20);
    });

    test("cluster record aliases are preserved even after Clusters map is cleared", () => {
      const g = new Graph();
      const vessel = g.addNode(new Node(1, 10, 10));
      const member = g.addNode(new Node(2, 10, 10));
      vessel.setClusterVessel(true);

      const nodesArray = [member];
      const abductionsArray = [];
      const cluster = new Cluster({
        Vessel: vessel,
        Graph: g,
        Nodes: nodesArray,
        EdgeAbductions: abductionsArray,
        Arrangement: "Row",
        Padding: 25,
        FixedSize: true,
      });
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      expect(g.Clusters.size).toBe(0);
      expect(cluster.Vessel).toBe(vessel);
      expect(cluster.Nodes).toBe(nodesArray);
      expect(cluster.EdgeAbductions).toBe(abductionsArray);
      expect(cluster.Arrangement).toBe("Row");
      expect(cluster.Padding).toBe(25);
      expect(cluster.FixedSize).toBe(true);
      expect(cluster.Graph).toBe(g);
    });

    test("does NOT execute hidden cleanup behavior", () => {
      const g = new Graph();
      const member = new Node(2, 10, 10);
      member.TopLeft = new Point(100, 200);
      member.HerdAssignment = { id: 1 };
      const vessel = g.addNode(new Node(1, 10, 10));
      vessel.setClusterVessel(true);

      const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
      g.Clusters.set(vessel, cluster);

      resetClusters(g);

      // Members are NOT added to graph or positioned by ResetClusters
      expect(g.Nodes.includes(member)).toBe(false);
      expect(member.TopLeft.X).toBe(100);
      expect(member.TopLeft.Y).toBe(200);
      expect(member.HerdAssignment).toEqual({ id: 1 });
    });
  });

  describe("Bulk Count Matrix (1, 2, 10, 100)", () => {
    for (const count of [1, 2, 10, 100]) {
      test(`correctly resets and cleans up ${count} vessels`, () => {
        const g = new Graph();
        const root = g.addNode(new Node(100000, 10, 10));
        const vessels = [];
        const members = [];
        const ordinaries = [];

        for (let i = 1; i <= count; i++) {
          const v = g.addNode(new Node(i, 10, 10));
          const m = g.addNode(new Node(10000 + i, 10, 10));
          const o = g.addNode(new Node(20000 + i, 10, 10));
          v.setClusterVessel(true);
          v.Container = root;
          const cl = new Cluster({ Vessel: v, Graph: g, Nodes: [m] });
          m.Cluster = cl;
          m.addNear(v);
          v.addNear(o);

          g.Clusters.set(v, cl);
          vessels.push(v);
          members.push(m);
          ordinaries.push(o);
        }

        // Add nodes with duplicate occurrences of vessels
        const nodesList = [];
        const childrenList = [];
        for (let i = 0; i < count; i++) {
          nodesList.push(ordinaries[i], vessels[i], members[i], vessels[i]);
          childrenList.push(vessels[i], ordinaries[i], members[i], vessels[i]);
        }
        g.Nodes = nodesList;
        g.Containers.set(root, childrenList);

        const nodesRef = g.Nodes;
        const childrenRef = childrenList;

        resetClusters(g);

        // All vessels removed from graph.Nodes and children
        expect(g.Nodes).toBe(nodesRef);
        expect(g.Containers.get(root)).toBe(childrenRef);

        for (const v of vessels) {
          expect(g.Nodes.includes(v)).toBe(false);
          expect(childrenRef.includes(v)).toBe(false);
          expect(v.Graph).toBeNull();
          expect(v.Container).toBeNull();
          expect(v.isClusterVessel).toBe(false);
          expect(v.Nears.size).toBe(0);
        }

        for (const m of members) {
          expect(m.Cluster).toBeNull();
          expect(m.Nears.size).toBe(0);
        }

        expect(g.Clusters.size).toBe(0);
        expect(g.Nodes.length).toBe(count * 2);
        expect(childrenRef.length).toBe(count * 2);
      });
    }
  });
});
