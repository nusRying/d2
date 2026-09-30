import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Graph, Spacing } from "../../src/graph/graph.js";
import { Point } from "../../src/geometry/point.js";
import { GoRand } from "../../src/random/go-math-rand.js";
import {
  WorkContext,
  WorkGuard,
  contextWithTransactionWorkGuard,
} from "../../src/limits/index.js";
import { Cluster } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Hierarchy } from "../../src/graph/hierarchy.js";
import {
  averageClusterDimensions,
  assignArrangement,
  paddingBetween,
  addClusters,
} from "../../src/grouping/index.js";
import { ClusterDiscoveryIndex } from "../../src/grouping/cluster-discovery.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/go-add-clusters-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("AddClusters Oracle Reference Suite", () => {
  describe("Metadata verification", () => {
    test("pinned D2 SHA and build tag", () => {
      expect(reference.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
      expect(reference.metadata.buildTag).toBe("tala_add_clusters_oracle");
    });
  });

  describe("Helper Parity", () => {
    test("SameShape cases match Go", () => {
      for (const tc of reference.helpers.sameShapeCases) {
        const nA = new Node(1, 100, 100);
        nA.setShape(tc.shapeA);
        const nB = new Node(2, 100, 100);
        nB.setShape(tc.shapeB);
        expect(nA.sameShape(nB)).toBe(tc.result);
      }
    });

    test("DistanceTo cases match Go", () => {
      for (const tc of reference.helpers.distanceToCases) {
        const nA = new Node(1, tc.widthA, tc.heightA);
        nA.TopLeft = new Point(tc.tlAX, tc.tlAY);
        const nB = new Node(2, tc.widthB, tc.heightB);
        nB.TopLeft = new Point(tc.tlBX, tc.tlBY);

        const d = nA.distanceTo(nB, tc.includeSizes);
        expect(d).toBeCloseTo(tc.distance, 6);
      }
    });

    test("averageClusterDimensions cases match Go", () => {
      for (const tc of reference.helpers.averageClusterDimensionsCases) {
        const cluster = new Cluster({});
        for (let i = 0; i < tc.widths.length; i++) {
          const n = new Node(i + 1, tc.widths[i], tc.heights[i]);
          cluster.Nodes.push(n);
        }

        const res = averageClusterDimensions(cluster);
        expect(Array.isArray(res)).toBe(true);
        expect(res.length).toBe(2);
        expect(res.width).toBeUndefined();
        expect(res.height).toBeUndefined();
        const [w, h] = res;
        if (tc.isNaNW) {
          expect(Number.isNaN(w)).toBe(true);
        } else {
          expect(w).toBe(tc.outW);
        }

        if (tc.isNaNH) {
          expect(Number.isNaN(h)).toBe(true);
        } else {
          expect(h).toBe(tc.outH);
        }
      }
    });

    test("AssignArrangement cases match Go with exact RNG consumption", () => {
      for (const tc of reference.helpers.assignArrangementCases) {
        const cluster = new Cluster({});
        for (let i = 0; i < tc.widths.length; i++) {
          const n = new Node(i + 1, tc.widths[i], tc.heights[i]);
          cluster.Nodes.push(n);
        }

        const rng = new GoRand(tc.seed);
        const arr = assignArrangement(cluster, tc.isConnectedToSequence, rng);
        expect(arr).toBe(tc.arrangement);
        expect(rng.Float64()).toBeCloseTo(tc.nextFloat64, 12);
      }
    });

    test("PaddingBetween cases match Go", () => {
      for (const tc of reference.helpers.paddingBetweenCases) {
        const cluster = new Cluster({ Arrangement: tc.arrangement });
        for (let i = 0; i < tc.widths.length; i++) {
          const n = new Node(i + 1, tc.widths[i], tc.heights[i]);
          if (tc.topleftsX && tc.topleftsX.length > i) {
            n.TopLeft = new Point(tc.topleftsX[i], tc.topleftsY[i]);
          }
          if (tc.hasIcon) {
            n.initIcon();
          }
          if (tc.labelWidth > 0 || tc.labelHeight > 0) {
            n.Label = { Width: tc.labelWidth, Height: tc.labelHeight };
          }
          cluster.Nodes.push(n);
        }

        const p = paddingBetween(cluster, tc.considerPositions);
        if (tc.isNaN) {
          expect(Number.isNaN(p)).toBe(true);
        } else {
          expect(p).toBe(tc.padding);
        }
      }
    });

    test("ContainerPadding cases match Go", () => {
      for (const tc of reference.helpers.containerPaddingCases) {
        const g = new Graph();
        let c = null;
        if (tc.hasContainer) {
          c = new Node(1, tc.width, tc.height);
          c.setShape(tc.shape);
          c.isContainer = true;
          if (tc.containerPadTop > 0 || tc.containerPadBottom > 0 || tc.containerPadLeft > 0 || tc.containerPadRight > 0) {
            c.padding = new Spacing(tc.containerPadTop, tc.containerPadBottom, tc.containerPadLeft, tc.containerPadRight);
          }
          if (tc.hasIcon) {
            c.initIcon();
          }
          if (tc.labelPosition) {
            c.Label = {
              Width: tc.labelWidth,
              Height: tc.labelHeight,
              Position: tc.labelPosition,
            };
          }
          if (tc.considerChildren && (tc.childHasIcon || tc.childMarginTop > 0 || tc.childMarginBottom > 0 || tc.childMarginLeft > 0 || tc.childMarginRight > 0)) {
            const child = new Node(2, 50, 50);
            if (tc.childHasIcon) {
              child.initIcon();
              if (tc.childIconFixed) {
                child.Icon._positionFixed = true;
              }
            }
            if (tc.childMarginTop > 0 || tc.childMarginBottom > 0 || tc.childMarginLeft > 0 || tc.childMarginRight > 0) {
              child.margin = new Spacing(tc.childMarginTop, tc.childMarginBottom, tc.childMarginLeft, tc.childMarginRight);
            }
            g.addNodeToContainer(c, child);
          }
        }

        const sp = g.containerPadding(c, tc.considerChildren);
        expect(sp.top).toBe(tc.top);
        expect(sp.left).toBe(tc.left);
        expect(sp.bottom).toBe(tc.bottom);
        expect(sp.right).toBe(tc.right);
      }
    });
  });

  describe("AddClusters Scenarios Parity", () => {
    function buildGraphForScenario(name) {
      const g = new Graph();

      switch (name) {
        case "basic_shared_adjacent_cluster": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "already_clustered_ineligible_node": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          const vesselExisting = new Node(99, 100, 100);
          vesselExisting.isClusterVessel = true;

          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.addNewNodeToContainer(null, vesselExisting);

          const existingCluster = new Cluster({ Vessel: vesselExisting, Nodes: [n1] });
          n1.Cluster = existingCluster;
          g.Clusters.set(vesselExisting, existingCluster);

          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "hierarchy_ineligible_nodes": {
          const c = new Node(10, 300, 300);
          c.isContainer = true;
          g.addNewNodeToContainer(null, c);

          const n1 = new Node(11, 80, 80);
          const n2 = new Node(12, 80, 80);
          const target = new Node(13, 60, 60);
          g.addNewNodeToContainer(c, n1);
          g.addNewNodeToContainer(c, n2);
          g.addNewNodeToContainer(c, target);

          g.connect(n1, target);
          g.connect(n2, target);

          n1.Hierarchy = new Hierarchy();
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "real_square_members_fixed_size": {
          const c = new Node(10, 300, 300);
          c.isContainer = true;
          g.addNewNodeToContainer(null, c);

          const n1 = new Node(11, 80, 80);
          n1.setShape("RealSquare");
          const n2 = new Node(12, 80, 80);
          n2.setShape("RealSquare");
          const target = new Node(13, 60, 60);
          g.addNewNodeToContainer(c, n1);
          g.addNewNodeToContainer(c, n2);
          g.addNewNodeToContainer(c, target);

          g.connect(n1, target);
          g.connect(n2, target);

          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "inconsistent_multiple_shared_adjacency": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const targetA = new Node(3, 80, 80);
          const targetB = new Node(4, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, targetA);
          g.addNewNodeToContainer(null, targetB);
          g.connect(n1, targetA);
          g.connect(n2, targetB);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "consistent_multiple_shared_adjacency": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const targetA = new Node(3, 80, 80);
          const targetB = new Node(4, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, targetA);
          g.addNewNodeToContainer(null, targetB);
          g.connect(n1, targetA);
          g.connect(n2, targetA);
          g.connect(n1, targetB);
          g.connect(n2, targetB);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "zero_neighbor_sibling_pair": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "shape_mismatch_circle_vs_square": {
          const n1 = new Node(1, 100, 100);
          n1.setShape("Circle");
          const n2 = new Node(2, 100, 100);
          n2.setShape("Square");
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "size_ratio_exactly_4x": {
          const n1 = new Node(1, 25, 100);
          const n2 = new Node(2, 100, 100);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "size_ratio_beyond_4x": {
          const n1 = new Node(1, 24, 100);
          const n2 = new Node(2, 100, 100);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "circle_cluster_fixed_size": {
          const n1 = new Node(1, 80, 80);
          n1.setShape("Circle");
          const n2 = new Node(2, 80, 80);
          n2.setShape("Circle");
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "connected_to_sequence_forced_row": {
          const n1 = new Node(1, 200, 50);
          const n2 = new Node(2, 200, 50);
          const target = new Node(3, 80, 80);
          const seqVessel = new Node(99, 100, 100);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.addNewNodeToContainer(null, seqVessel);
          const seq = new Sequence({ Vessel: seqVessel, Nodes: [target] });
          target.Sequence = seq;
          g.Sequences.set(seqVessel, seq);
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "table_column_edge_metadata": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          const e1 = g.connect(n1, target);
          const e2 = g.connect(n2, target);
          e1.ToTableColumnIndex = 0;
          e2.ToTableColumnIndex = 0;
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "ordinary_node_vessel_id_collision": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(1n);
          const predictedID = rndTest.Int63();
          const obs = new Node(predictedID, 50, 50);
          g.addNewNodeToContainer(null, obs);
          return { g, seed: 1n, containerSeed: 42n };
        }
        case "sequence_vessel_id_collision": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(2n);
          const predictedID = rndTest.Int63();
          const seqV = new Node(predictedID, 50, 50);
          g.addNewNodeToContainer(null, seqV);
          g.Sequences.set(seqV, new Sequence({ Vessel: seqV, Nodes: [] }));
          return { g, seed: 2n, containerSeed: 42n };
        }
        case "sequence_member_id_collision": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(3n);
          const predictedID = rndTest.Int63();
          const seqV = new Node(999, 50, 50);
          const seqM = new Node(predictedID, 50, 50);
          g.addNewNodeToContainer(null, seqV);
          g.addNewNodeToContainer(null, seqM);
          const seq = new Sequence({ Vessel: seqV, Nodes: [seqM] });
          seqM.Sequence = seq;
          g.Sequences.set(seqV, seq);
          return { g, seed: 3n, containerSeed: 42n };
        }
        case "tree_sentinel_id_collision": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(4n);
          const predictedID = rndTest.Int63();
          const sentinel = new Node(predictedID, 50, 50);
          g.addNewNodeToContainer(null, sentinel);
          g.Trees.set(sentinel, []);
          return { g, seed: 4n, containerSeed: 42n };
        }
        case "tree_node_id_collision": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(5n);
          const predictedID = rndTest.Int63();
          const sentinel = new Node(998, 50, 50);
          const treeNode = new Node(predictedID, 50, 50);
          g.addNewNodeToContainer(null, sentinel);
          g.addNewNodeToContainer(null, treeNode);
          g.Trees.set(sentinel, [{ Node: treeNode, Children: [] }]);
          return { g, seed: 5n, containerSeed: 42n };
        }
        case "nested_containers": {
          const cRoot = new Node(10, 500, 500);
          cRoot.isContainer = true;
          g.addNewNodeToContainer(null, cRoot);

          const cInner = new Node(20, 300, 300);
          cInner.isContainer = true;
          g.addNewNodeToContainer(cRoot, cInner);

          const n1 = new Node(21, 80, 40);
          const n2 = new Node(22, 80, 40);
          const target = new Node(23, 60, 60);
          g.addNewNodeToContainer(cInner, n1);
          g.addNewNodeToContainer(cInner, n2);
          g.addNewNodeToContainer(cInner, target);

          g.connect(n1, target);
          g.connect(n2, target);

          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "two_containers_equal_square_clusters": {
          const cA = new Node(10, 300, 300);
          cA.isContainer = true;
          g.addNewNodeToContainer(null, cA);

          const cB = new Node(20, 300, 300);
          cB.isContainer = true;
          g.addNewNodeToContainer(null, cB);

          const nA1 = new Node(11, 80, 80);
          const nA2 = new Node(12, 80, 80);
          const targetA = new Node(13, 60, 60);
          g.addNewNodeToContainer(cA, nA1);
          g.addNewNodeToContainer(cA, nA2);
          g.addNewNodeToContainer(cA, targetA);
          g.connect(nA1, targetA);
          g.connect(nA2, targetA);

          const nB1 = new Node(21, 80, 80);
          const nB2 = new Node(22, 80, 80);
          const targetB = new Node(23, 60, 60);
          g.addNewNodeToContainer(cB, nB1);
          g.addNewNodeToContainer(cB, nB2);
          g.addNewNodeToContainer(cB, targetB);
          g.connect(nB1, targetB);
          g.connect(nB2, targetB);

          return { g, seed: 54321n, containerSeed: 100n };
        }
        case "multiple_accepted_clusters": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target1 = new Node(3, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target1);
          g.connect(n1, target1);
          g.connect(n2, target1);

          const n4 = new Node(4, 120, 60);
          const n5 = new Node(5, 120, 60);
          const target2 = new Node(6, 70, 70);
          g.addNewNodeToContainer(null, n4);
          g.addNewNodeToContainer(null, n5);
          g.addNewNodeToContainer(null, target2);
          g.connect(n4, target2);
          g.connect(n5, target2);

          return { g, seed: 99999n, containerSeed: 77n };
        }
        case "candidate_rejected_before_vessel_draw": {
          const c = new Node(10, 300, 300);
          c.isContainer = true;
          g.addNewNodeToContainer(null, c);

          const n1 = new Node(11, 80, 80);
          const n2 = new Node(12, 80, 80);
          g.addNewNodeToContainer(c, n1);
          g.addNewNodeToContainer(c, n2);

          g.connect(n1, c);
          g.connect(n2, c);

          return { g, seed: 11111n, containerSeed: 42n };
        }
        case "discovery_refresh_interaction": {
          const n1 = new Node(1, 100, 50);
          const n2 = new Node(2, 100, 50);
          const target = new Node(3, 80, 80);
          const n4 = new Node(4, 100, 50);
          const n5 = new Node(5, 80, 80);
          g.addNewNodeToContainer(null, n1);
          g.addNewNodeToContainer(null, n2);
          g.addNewNodeToContainer(null, target);
          g.addNewNodeToContainer(null, n4);
          g.addNewNodeToContainer(null, n5);

          g.connect(n1, target);
          g.connect(n1, n4);
          g.connect(n2, target);
          g.connect(n2, n4);
          g.connect(n4, n5);

          return { g, seed: 12345n, containerSeed: 42n };
        }
        default:
          throw new Error(`Unknown scenario ${name}`);
      }
    }

    describe("Explicit Fixture-Contract Assertions", () => {
      test("basic_shared_adjacent_cluster contract: success == true, clusters == 1", () => {
        const sc = reference.scenarios.basic_shared_adjacent_cluster;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(1);
        const cluster = Object.values(sc.clusters)[0];
        expect(cluster.memberIDs).toEqual(["1", "2"]);
      });

      test("consistent_multiple_shared_adjacency contract: clusters == 1", () => {
        const sc = reference.scenarios.consistent_multiple_shared_adjacency;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(1);
      });

      test("inconsistent_multiple_shared_adjacency contract: clusters == 0, root container is populated", () => {
        const sc = reference.scenarios.inconsistent_multiple_shared_adjacency;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(0);
        expect(sc.containers["null"].length).toBe(4);
      });

      test("zero_neighbor_sibling_pair contract: clusters == 0, root container contains both siblings", () => {
        const sc = reference.scenarios.zero_neighbor_sibling_pair;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(0);
        expect(sc.containers["null"]).toEqual(["1", "2"]);
      });

      test("size_ratio_exactly_4x contract: clusters == 1", () => {
        const sc = reference.scenarios.size_ratio_exactly_4x;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(1);
      });

      test("size_ratio_beyond_4x contract: clusters == 0", () => {
        const sc = reference.scenarios.size_ratio_beyond_4x;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(0);
      });

      test("circle_cluster_fixed_size contract: clusters == 1, cluster.FixedSize == true", () => {
        const sc = reference.scenarios.circle_cluster_fixed_size;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(1);
        const cluster = Object.values(sc.clusters)[0];
        expect(cluster.fixedSize).toBe(true);
      });

      test("table_column_edge_metadata contract: clusters == 0", () => {
        const sc = reference.scenarios.table_column_edge_metadata;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(0);
      });

      test("nested_containers contract: clusters == 1", () => {
        const sc = reference.scenarios.nested_containers;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(1);
        const cluster = Object.values(sc.clusters)[0];
        expect(cluster.container).toBe("20");
      });

      test("multiple_accepted_clusters contract: exactly 2 clusters, checking member IDs", () => {
        const sc = reference.scenarios.multiple_accepted_clusters;
        expect(sc.success).toBe(true);
        const clusters = Object.values(sc.clusters);
        expect(clusters.length).toBe(2);
        const memberSets = clusters.map((c) => c.memberIDs.slice().sort());
        memberSets.sort((a, b) => a[0].localeCompare(b[0]));
        expect(memberSets).toEqual([["1", "2"], ["4", "5"]]);
      });

      test("two_containers_equal_square_clusters contract: clusters == 2", () => {
        const sc = reference.scenarios.two_containers_equal_square_clusters;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(2);
      });

      test("connected_to_sequence_forced_row contract: success == true, clusters == 1, arrangement == Row, geometry alone chooses Column", () => {
        const sc = reference.scenarios.connected_to_sequence_forced_row;
        expect(sc.success).toBe(true);
        expect(Object.keys(sc.clusters).length).toBe(1);
        const cluster = Object.values(sc.clusters)[0];
        expect(cluster.arrangement).toBe("Row");

        // Prove the same geometry (200x50 nodes) would otherwise select the opposite arrangement ("Column") absent sequence connection
        const unattachedCluster = new Cluster({});
        unattachedCluster.Nodes.push(new Node(1, 200, 50));
        unattachedCluster.Nodes.push(new Node(2, 200, 50));
        const oppositeArrangement = assignArrangement(unattachedCluster, false, new GoRand(12345n));
        expect(oppositeArrangement).toBe("Column");
      });

      test("already_clustered_ineligible_node contract: passes preflight, returns success, no new cluster formed", () => {
        const sc = reference.scenarios.already_clustered_ineligible_node;
        expect(sc.success).toBe(true);
        expect(sc.errorText).toBeNull();
        expect(Object.keys(sc.clusters).length).toBe(0);
      });

      test("ID-collision scenarios contract: allocate a vessel with single linear increment and single Int63 draw", () => {
        const collisionScenarios = [
          { name: "ordinary_node_vessel_id_collision", seed: 1n },
          { name: "sequence_vessel_id_collision", seed: 2n },
          { name: "sequence_member_id_collision", seed: 3n },
          { name: "tree_sentinel_id_collision", seed: 4n },
          { name: "tree_node_id_collision", seed: 5n },
        ];

        for (const { name, seed } of collisionScenarios) {
          const sc = reference.scenarios[name];
          expect(sc.success).toBe(true);
          const clusters = Object.values(sc.clusters);
          expect(clusters.length).toBe(1);

          const rTest = new GoRand(seed);
          const collidingCandidateID = rTest.Int63();
          const expectedVesselID = (collidingCandidateID + 1n).toString();
          const expectedNextRnd = rTest.Int63().toString();

          expect(clusters[0].vesselID).not.toBe(collidingCandidateID.toString());
          expect(clusters[0].vesselID).toBe(expectedVesselID);

          // External RNG consumed only ONE Int63 draw during execution (next draw is expectedNextRnd)
          expect(sc.randomNextInt63).toBe(expectedNextRnd);
        }
      });

      test("discovery_refresh_interaction contract: exact final clusters, endpoints, and 4 edge abductions", () => {
        const sc = reference.scenarios.discovery_refresh_interaction;
        expect(sc.success).toBe(true);
        expect(sc.workGuardUsed).toBe(214);
        expect(Object.keys(sc.clusters).length).toBe(1);
        const cluster = Object.values(sc.clusters)[0];
        expect(cluster.memberIDs).toEqual(["1", "2"]);
        expect(cluster.edgeAbductions.length).toBe(4);

        const abductions = cluster.edgeAbductions;
        expect(abductions.map((a) => ({ from: a.currentFrom, to: a.currentTo }))).toEqual([
          { from: cluster.vesselID, to: "3" },
          { from: cluster.vesselID, to: "4" },
          { from: cluster.vesselID, to: "3" },
          { from: cluster.vesselID, to: "4" },
        ]);
      });

      test("removal of refreshAfterClusterAbduction changes work count and is detected", () => {
        const orig = ClusterDiscoveryIndex.prototype.refreshAfterClusterAbduction;
        try {
          ClusterDiscoveryIndex.prototype.refreshAfterClusterAbduction = function () {};
          const { g, seed, containerSeed } = buildGraphForScenario("discovery_refresh_interaction");
          const rnd = new GoRand(seed);
          const parentCtx = new WorkContext();
          const guard = new WorkGuard(parentCtx, "AddClustersTransactions", 1_000_000_000n);
          const ctx = contextWithTransactionWorkGuard(parentCtx, guard);
          addClusters(ctx, g, containerSeed, rnd);
          // Without refreshAfterClusterAbduction, guard.used is 200n, NOT the expected 214n
          expect(guard.used).not.toBe(BigInt(reference.scenarios.discovery_refresh_interaction.workGuardUsed));
          expect(guard.used).toBe(200n);
        } finally {
          ClusterDiscoveryIndex.prototype.refreshAfterClusterAbduction = orig;
        }
      });
    });

    for (const [name, expected] of Object.entries(reference.scenarios)) {
      test(`Scenario: ${name}`, () => {
        const { g, seed, containerSeed } = buildGraphForScenario(name);
        const rnd = new GoRand(seed);
        const parentCtx = new WorkContext();
        const guard = new WorkGuard(parentCtx, "AddClustersTransactions", 1_000_000_000);
        const ctx = contextWithTransactionWorkGuard(parentCtx, guard);

        if (!expected.success) {
          expect(() => {
            addClusters(ctx, g, containerSeed, rnd);
          }).toThrow(expected.errorText);
          expect(guard.used).toBe(BigInt(expected.workGuardUsed));
          expect(rnd.Int63()).toBe(BigInt(expected.randomNextInt63));
          return;
        }

        addClusters(ctx, g, containerSeed, rnd);

        // Verify exact transaction WorkGuard used
        expect(guard.used).toBe(BigInt(expected.workGuardUsed));

        // Verify external RNG next draw matches Go
        expect(rnd.Int63()).toBe(BigInt(expected.randomNextInt63));

        // Verify clusters
        expect(g.Clusters.size).toBe(Object.keys(expected.clusters).length);
        for (const [vIDStr, expCluster] of Object.entries(expected.clusters)) {
          let found = null;
          for (const [v, cl] of g.Clusters.entries()) {
            if (v.ID.toString() === vIDStr) {
              found = cl;
              break;
            }
          }
          expect(found).not.toBeNull();
          expect(found.Arrangement).toBe(expCluster.arrangement);
          expect(found.DesiredArrangement).toBe(expCluster.desiredArrangement);
          expect(found.Padding).toBe(expCluster.padding);
          expect(found.FixedSize).toBe(expCluster.fixedSize);

          const actualMemberIDs = found.Nodes.map((n) => n.ID.toString());
          expect(actualMemberIDs).toEqual(expCluster.memberIDs);

          // Vessel geometry
          expect(found.Vessel.Width).toBe(expCluster.vesselWidth);
          expect(found.Vessel.Height).toBe(expCluster.vesselHeight);
          if (expCluster.vesselTopLeft === null) {
            expect(found.Vessel.TopLeft).toBeNull();
          } else {
            expect(found.Vessel.TopLeft).not.toBeNull();
            expect(found.Vessel.TopLeft.X).toBe(expCluster.vesselTopLeft.x);
            expect(found.Vessel.TopLeft.Y).toBe(expCluster.vesselTopLeft.y);
          }

          // Container
          if (expCluster.container === null) {
            expect(found.Container).toBeNull();
          } else {
            expect(found.Container).not.toBeNull();
            expect(found.Container.ID.toString()).toBe(expCluster.container);
          }

          // Edge Abductions
          if (expCluster.edgeAbductions === null) {
            expect((found.EdgeAbductions || []).length).toBe(0);
          } else {
            expect(found.EdgeAbductions.length).toBe(expCluster.edgeAbductions.length);
            for (let i = 0; i < expCluster.edgeAbductions.length; i++) {
              const expAbd = expCluster.edgeAbductions[i];
              const actAbd = found.EdgeAbductions[i];
              expect(actAbd.Edge.ID.toString()).toBe(expAbd.edgeID);

              if (expAbd.originallyFrom === null) {
                expect(actAbd.OriginallyFrom).toBeNull();
              } else {
                expect(actAbd.OriginallyFrom).not.toBeNull();
                expect(actAbd.OriginallyFrom.ID.toString()).toBe(expAbd.originallyFrom);
              }

              if (expAbd.originallyTo === null) {
                expect(actAbd.OriginallyTo).toBeNull();
              } else {
                expect(actAbd.OriginallyTo).not.toBeNull();
                expect(actAbd.OriginallyTo.ID.toString()).toBe(expAbd.originallyTo);
              }

              if (expAbd.currentFrom === null) {
                expect(actAbd.CurrentFrom).toBeNull();
              } else {
                expect(actAbd.CurrentFrom).not.toBeNull();
                expect(actAbd.CurrentFrom.ID.toString()).toBe(expAbd.currentFrom);
              }

              if (expAbd.currentTo === null) {
                expect(actAbd.CurrentTo).toBeNull();
              } else {
                expect(actAbd.CurrentTo).not.toBeNull();
                expect(actAbd.CurrentTo.ID.toString()).toBe(expAbd.currentTo);
              }
            }
          }
        }

        // Verify graph.Nodes
        const actualNodeIDs = g.Nodes.map((n) => n.ID.toString());
        expect(actualNodeIDs).toEqual(expected.nodes);

        // Verify graph.Containers: every serialized container key and exact child ID order
        const actualContainerKeys = new Set();
        for (const [containerNode] of g.Containers.entries()) {
          const key = containerNode ? containerNode.ID.toString() : "null";
          actualContainerKeys.add(key);
        }
        expect(actualContainerKeys).toEqual(new Set(Object.keys(expected.containers)));

        for (const [key, expChildIDs] of Object.entries(expected.containers)) {
          let actualChildren = null;
          if (key === "null") {
            actualChildren = g.Containers.get(null) || [];
          } else {
            let cNode = null;
            for (const containerNode of g.Containers.keys()) {
              if (containerNode && containerNode.ID.toString() === key) {
                cNode = containerNode;
                break;
              }
            }
            expect(cNode).not.toBeNull();
            actualChildren = g.Containers.get(cNode) || [];
          }
          const actualChildIDs = actualChildren.map((c) => c.ID.toString());
          expect(actualChildIDs).toEqual(expChildIDs);
        }

        // Verify graph.Edges: count, ID, From, To
        if (expected.edges === null) {
          expect(g.Edges.length).toBe(0);
        } else {
          expect(g.Edges.length).toBe(expected.edges.length);
          for (let i = 0; i < expected.edges.length; i++) {
            const expEdge = expected.edges[i];
            const actualEdge = g.Edges[i];
            expect(actualEdge.ID.toString()).toBe(expEdge.id);
            expect(actualEdge.From.ID.toString()).toBe(expEdge.from);
            expect(actualEdge.To.ID.toString()).toBe(expEdge.to);
          }
        }
      });
    }
  });
});
