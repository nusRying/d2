import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Node } from "../../src/graph/node.js";
import { Graph } from "../../src/graph/graph.js";
import { Point } from "../../src/geometry/point.js";
import { Cluster } from "../../src/graph/cluster.js";
import { resetClusters } from "../../src/grouping/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/go-reset-clusters-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("ResetClusters Oracle Reference Suite", () => {
  describe("Metadata verification", () => {
    test("pinned D2 SHA", () => {
      expect(reference.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    });
  });

  function buildGraphForScenario(name) {
    const g = new Graph();
    const trackedMap = new Map();

    const track = (n) => {
      if (n != null) {
        trackedMap.set(n.ID.toString(), n);
      }
      return n;
    };

    switch (name) {
      case "empty_clusters": {
        const n1 = track(g.addNode(new Node(1, 10, 10)));
        const n2 = track(g.addNode(new Node(2, 10, 10)));
        g.addNewNodeToContainer(null, n1);
        g.addNewNodeToContainer(null, n2);
        g.Clusters = new Map();
        return { g, tracked: [n1, n2] };
      }
      case "single_nil_value": {
        const stale = track(g.addNode(new Node(1, 10, 10)));
        stale.setClusterVessel(true);
        g.addNewNodeToContainer(null, stale);
        g.Clusters = new Map([[stale, null]]);
        return { g, tracked: [stale] };
      }
      case "single_nil_key": {
        const ordinary = track(g.addNode(new Node(1, 10, 10)));
        const member = track(g.addNode(new Node(2, 10, 10)));
        const keep = track(g.addNode(new Node(3, 10, 10)));
        g.addNewNodeToContainer(null, ordinary);
        g.addNewNodeToContainer(null, member);
        g.addNewNodeToContainer(null, keep);
        const cluster = new Cluster({ Graph: g, Nodes: [member] });
        member.Cluster = cluster;
        member.Nears = new Set([null]);
        const edge = g.connect(ordinary, keep);
        edge.ID = 101;
        cluster.EdgeAbductions = [{ Edge: edge, OriginallyTo: member }];
        g.Clusters = new Map([[null, cluster]]);
        return { g, tracked: [ordinary, member, keep] };
      }
      case "bulk_one_retired_among_multiple_entries": {
        const ordinary = track(g.addNode(new Node(1, 10, 10)));
        const vessel = track(g.addNode(new Node(2, 10, 10)));
        const stale = track(g.addNode(new Node(3, 10, 10)));
        const root = track(g.addNode(new Node(4, 10, 10)));
        vessel.setClusterVessel(true);
        vessel.Container = root;
        const cluster = new Cluster({ Vessel: vessel, Graph: g });
        g.Clusters = new Map([
          [vessel, cluster],
          [stale, null],
        ]);
        g.Nodes = [ordinary, vessel, stale, vessel];
        g.Containers = new Map([[root, [vessel, ordinary, stale, vessel]]]);
        return { g, tracked: [ordinary, vessel, stale, root] };
      }
      case "bulk_zero_retired": {
        const ordinary = track(g.addNode(new Node(1, 10, 10)));
        const member = track(g.addNode(new Node(2, 10, 10)));
        const keep = track(g.addNode(new Node(3, 10, 10)));
        const stale = track(g.addNode(new Node(4, 10, 10)));
        const root = track(g.addNode(new Node(5, 10, 10)));
        const cluster = new Cluster({ Graph: g, Nodes: [member] });
        member.Cluster = cluster;
        member.Nears = new Set([null]);
        const edge = g.connect(ordinary, keep);
        edge.ID = 101;
        cluster.EdgeAbductions = [{ Edge: edge, OriginallyFrom: member }];
        g.Clusters = new Map([
          [stale, null],
          [null, cluster],
        ]);
        g.Nodes = [ordinary, null, stale, member, keep];
        g.Containers = new Map([[root, [null, stale, ordinary, member, keep]]]);
        return { g, tracked: [ordinary, member, keep, stale, root] };
      }
      case "legacy_edge_cases": {
        const ordinary = track(g.addNode(new Node(1, 10, 10)));
        const keepNilCluster = track(g.addNode(new Node(2, 10, 10)));
        const survivor = track(g.addNode(new Node(3, 10, 10)));
        const member = track(g.addNode(new Node(4, 10, 10)));
        const mismatchedMember = track(g.addNode(new Node(5, 10, 10)));
        const vesselA = track(g.addNode(new Node(6, 10, 10)));
        const vesselB = track(g.addNode(new Node(7, 10, 10)));
        const root = track(g.addNode(new Node(8, 10, 10)));
        const nested = track(g.addNode(new Node(9, 10, 10)));
        const nilChildren = track(g.addNode(new Node(10, 10, 10)));
        const emptyChildren = track(g.addNode(new Node(11, 10, 10)));

        const clusterA = new Cluster({ Vessel: vesselA, Graph: g });
        const clusterB = new Cluster({ Vessel: vesselB, Graph: g });
        const otherCluster = new Cluster({ Graph: g });
        member.Cluster = clusterA;
        mismatchedMember.Cluster = otherCluster;
        clusterA.Nodes = [member, mismatchedMember, null];
        clusterB.Nodes = [null];
        vesselA.setClusterVessel(true);
        vesselB.setClusterVessel(true);
        keepNilCluster.setClusterVessel(true);
        vesselA.Container = root;
        vesselB.Container = nested;
        member.addNear(vesselA);
        ordinary.addNear(vesselA);
        vesselB.Nears = null;

        const fromEdge = g.connect(vesselA, ordinary);
        fromEdge.ID = 201;
        const toEdge = g.connect(ordinary, vesselA);
        toEdge.ID = 202;
        clusterA.EdgeAbductions = [
          { Edge: fromEdge, OriginallyFrom: member },
          { Edge: toEdge, OriginallyTo: member },
          null,
          {},
        ];
        g.Clusters = new Map([
          [vesselA, clusterA],
          [vesselB, clusterB],
          [keepNilCluster, null],
          [null, {}],
        ]);

        g.Nodes = [ordinary, vesselA, null, keepNilCluster, vesselB, vesselA, survivor];
        g.Containers = new Map([
          [root, [ordinary, vesselB, null, keepNilCluster, vesselA, survivor, vesselB]],
          [nested, [vesselA, ordinary]],
          [nilChildren, null],
          [emptyChildren, []],
        ]);

        return {
          g,
          tracked: [
            ordinary,
            keepNilCluster,
            survivor,
            member,
            mismatchedMember,
            vesselA,
            vesselB,
            root,
            nested,
            nilChildren,
            emptyChildren,
          ],
        };
      }
      case "bulk_matrix_1": {
        const vessel = track(g.addNode(new Node(1, 10, 10)));
        const member = track(g.addNode(new Node(2, 10, 10)));
        const ordinary = track(g.addNode(new Node(3, 10, 10)));
        const root = track(g.addNode(new Node(4, 10, 10)));
        vessel.setClusterVessel(true);
        vessel.Container = root;
        const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
        member.Cluster = cluster;
        member.addNear(vessel);
        vessel.addNear(ordinary);
        g.Clusters = new Map([[vessel, cluster]]);
        g.Nodes = [ordinary, vessel, member, vessel];
        g.Containers = new Map([[root, [vessel, ordinary, member, vessel]]]);
        return { g, tracked: [vessel, member, ordinary, root] };
      }
      case "bulk_matrix_2": {
        const vessel1 = track(g.addNode(new Node(1, 10, 10)));
        const vessel2 = track(g.addNode(new Node(2, 10, 10)));
        const member1 = track(g.addNode(new Node(3, 10, 10)));
        const member2 = track(g.addNode(new Node(4, 10, 10)));
        const ordinary = track(g.addNode(new Node(5, 10, 10)));
        const root = track(g.addNode(new Node(6, 10, 10)));
        vessel1.setClusterVessel(true);
        vessel1.Container = root;
        vessel2.setClusterVessel(true);
        vessel2.Container = root;
        const c1 = new Cluster({ Vessel: vessel1, Graph: g, Nodes: [member1] });
        const c2 = new Cluster({ Vessel: vessel2, Graph: g, Nodes: [member2] });
        member1.Cluster = c1;
        member2.Cluster = c2;
        member1.addNear(vessel1);
        member2.addNear(vessel2);
        g.Clusters = new Map([
          [vessel1, c1],
          [vessel2, c2],
        ]);
        g.Nodes = [ordinary, vessel1, member1, vessel2, vessel1];
        g.Containers = new Map([[root, [vessel2, ordinary, member2, vessel1, vessel2]]]);
        return { g, tracked: [vessel1, vessel2, member1, member2, ordinary, root] };
      }
      case "bulk_matrix_10": {
        const root = track(g.addNode(new Node(1000, 10, 10)));
        const tracked = [root];
        g.Clusters = new Map();
        const nodes = [];
        const rootChildren = [];

        for (let i = 1; i <= 10; i++) {
          const vessel = track(g.addNode(new Node(i, 10, 10)));
          const member = track(g.addNode(new Node(100 + i, 10, 10)));
          const ordinary = track(g.addNode(new Node(200 + i, 10, 10)));
          vessel.setClusterVessel(true);
          vessel.Container = root;
          const cl = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
          member.Cluster = cl;
          member.addNear(vessel);
          g.Clusters.set(vessel, cl);

          nodes.push(ordinary, vessel, member, vessel);
          rootChildren.push(vessel, ordinary, member, vessel);
          tracked.push(vessel, member, ordinary);
        }
        g.Nodes = nodes;
        g.Containers = new Map([[root, rootChildren]]);
        return { g, tracked };
      }
      case "bulk_matrix_100": {
        const root = track(g.addNode(new Node(10000, 10, 10)));
        const tracked = [root];
        g.Clusters = new Map();
        const nodes = [];
        const rootChildren = [];

        for (let i = 1; i <= 100; i++) {
          const vessel = track(g.addNode(new Node(i, 10, 10)));
          const member = track(g.addNode(new Node(1000 + i, 10, 10)));
          vessel.setClusterVessel(true);
          vessel.Container = root;
          const cl = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
          member.Cluster = cl;
          member.addNear(vessel);
          g.Clusters.set(vessel, cl);

          nodes.push(vessel, member, vessel);
          rootChildren.push(member, vessel, vessel);
          if (i <= 5 || i >= 96) {
            tracked.push(vessel, member);
          }
        }
        g.Nodes = nodes;
        g.Containers = new Map([[root, rootChildren]]);
        return { g, tracked };
      }
      case "reconnect_ordering_regression": {
        const member = track(g.addNode(new Node(1, 10, 10)));
        const targetA = track(g.addNode(new Node(2, 10, 10)));
        const targetB = track(g.addNode(new Node(3, 10, 10)));
        const vessel = track(g.addNode(new Node(4, 10, 10)));
        vessel.setClusterVessel(true);

        const e1 = g.connect(member, targetA);
        e1.ID = 101;
        e1.Points = [new Point(10, 20), new Point(30, 40)];

        const e2 = g.connect(member, targetB);
        e2.ID = 102;

        const cluster = new Cluster({ Vessel: vessel, Graph: g, Nodes: [member] });
        cluster.EdgeAbductions = [{ Edge: e1, OriginallyFrom: member, OriginallyTo: targetA }];
        g.Clusters = new Map([[vessel, cluster]]);
        g.addNewNodeToContainer(null, member);
        g.addNewNodeToContainer(null, targetA);
        g.addNewNodeToContainer(null, targetB);
        g.addNewNodeToContainer(null, vessel);

        return { g, tracked: [member, targetA, targetB, vessel] };
      }
      default:
        throw new Error(`Unknown scenario ${name}`);
    }
  }

  describe("Replay Scenarios Against Real-Go Reference", () => {
    for (const [name, expected] of Object.entries(reference.scenarios)) {
      test(`Scenario: ${name}`, () => {
        const { g, tracked } = buildGraphForScenario(name);
        const originalClustersRef = g.Clusters;
        const originalContainersRef = g.Containers;

        resetClusters(g);

        // 1. Clusters Map identity preserved and cleared
        expect(g.Clusters).toBe(originalClustersRef);
        expect(g.Clusters.size).toBe(0);
        expect(g.Containers).toBe(originalContainersRef);

        // 2. graph.Nodes order and elements
        const actualNodeIDs = g.Nodes.map((n) => (n == null ? null : n.ID.toString()));
        expect(actualNodeIDs).toEqual(expected.nodes);

        // 3. graph.Containers order and elements
        const actualContainerKeys = new Set();
        for (const [c] of g.Containers.entries()) {
          actualContainerKeys.add(c == null ? "null" : c.ID.toString());
        }
        expect(actualContainerKeys).toEqual(new Set(Object.keys(expected.containers)));

        for (const [key, expChildIDs] of Object.entries(expected.containers)) {
          let actualChildren = null;
          if (key === "null") {
            actualChildren = g.Containers.get(null);
          } else {
            let containerNode = null;
            for (const c of g.Containers.keys()) {
              if (c != null && c.ID.toString() === key) {
                containerNode = c;
                break;
              }
            }
            expect(containerNode).not.toBeNull();
            actualChildren = g.Containers.get(containerNode);
          }

          if (expChildIDs === null) {
            expect(actualChildren).toBeNull();
          } else {
            expect(Array.isArray(actualChildren)).toBe(true);
            const actualChildIDs = actualChildren.map((c) => (c == null ? null : c.ID.toString()));
            expect(actualChildIDs).toEqual(expChildIDs);
          }
        }

        // 4. Edges
        if (expected.edges != null) {
          for (const expEdge of expected.edges) {
            let foundEdge = null;
            for (const e of g.Edges) {
              if (e.ID.toString() === expEdge.id) {
                foundEdge = e;
                break;
              }
            }
            expect(foundEdge).not.toBeNull();
            const fromID = foundEdge.From == null ? "null" : foundEdge.From.ID.toString();
            const toID = foundEdge.To == null ? "null" : foundEdge.To.ID.toString();
            expect(fromID).toBe(expEdge.from);
            expect(toID).toBe(expEdge.to);

            if (expEdge.points != null) {
              expect(foundEdge.Points.length).toBe(expEdge.points.length);
              for (let i = 0; i < expEdge.points.length; i++) {
                expect(foundEdge.Points[i].X).toBe(expEdge.points[i].x);
                expect(foundEdge.Points[i].Y).toBe(expEdge.points[i].y);
              }
            }
          }
        }

        // 5. Tracked nodes state
        for (const node of tracked) {
          if (node == null) continue;
          const nodeIDStr = node.ID.toString();
          const expNode = expected.trackedNodes[nodeIDStr];
          if (!expNode) continue;

          expect(node.Graph != null).toBe(expNode.inGraph);
          if (expNode.container == null) {
            expect(node.Container).toBeNull();
          } else {
            expect(node.Container).not.toBeNull();
            expect(node.Container.ID.toString()).toBe(expNode.container);
          }
          expect(node.isClusterVessel).toBe(expNode.isClusterVessel);
          expect(node.Cluster != null).toBe(expNode.hasCluster);
          if (expNode.clusterVesselID != null) {
            expect(node.Cluster).not.toBeNull();
            expect(node.Cluster.Vessel).not.toBeNull();
            expect(node.Cluster.Vessel.ID.toString()).toBe(expNode.clusterVesselID);
          }

          if (expNode.nearsNull) {
            expect(node.Nears).toBeNull();
          } else {
            expect(node.Nears).not.toBeNull();
            const actualNearIDs = [];
            for (const nr of node.Nears) {
              actualNearIDs.push(nr == null ? "null" : nr.ID.toString());
            }
            actualNearIDs.sort((a, b) => {
              if (a === "null") return -1;
              if (b === "null") return 1;
              return BigInt(a) < BigInt(b) ? -1 : 1;
            });
            expect(actualNearIDs).toEqual(expNode.nears);
          }

          if (expNode.edges != null) {
            const actualEdges = (node.Edges || []).map((e) => (e == null ? "null" : e.ID.toString()));
            expect(actualEdges).toEqual(expNode.edges);
          }
        }
      });
    }
  });
});
