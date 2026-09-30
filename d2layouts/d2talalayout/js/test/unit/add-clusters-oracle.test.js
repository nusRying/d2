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
import {
  averageClusterDimensions,
  assignArrangement,
  paddingBetween,
  addClusters,
} from "../../src/grouping/index.js";

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

        const [w, h] = averageClusterDimensions(cluster);
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
          if (tc.childHasIcon) {
            const child = new Node(2, 50, 50);
            child.initIcon();
            if (tc.childIconFixed) {
              child.Icon._positionFixed = true;
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
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "hierarchy_ineligible_nodes": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          n1.Cluster = new Cluster({});
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "inconsistent_multiple_shared_adjacency": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const targetA = g.addNode(new Node(3, 80, 80));
          const targetB = g.addNode(new Node(4, 80, 80));
          g.connect(n1, targetA);
          g.connect(n2, targetB);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "consistent_multiple_shared_adjacency": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const targetA = g.addNode(new Node(3, 80, 80));
          const targetB = g.addNode(new Node(4, 80, 80));
          g.connect(n1, targetA);
          g.connect(n2, targetA);
          g.connect(n1, targetB);
          g.connect(n2, targetB);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "zero_neighbor_sibling_pair": {
          g.addNode(new Node(1, 100, 50));
          g.addNode(new Node(2, 100, 50));
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "shape_mismatch_circle_vs_square": {
          const n1 = g.addNode(new Node(1, 100, 100));
          n1.setShape("Circle");
          const n2 = g.addNode(new Node(2, 100, 100));
          n2.setShape("Square");
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "size_ratio_exactly_4x": {
          const n1 = g.addNode(new Node(1, 25, 100));
          const n2 = g.addNode(new Node(2, 100, 100));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "size_ratio_beyond_4x": {
          const n1 = g.addNode(new Node(1, 24, 100));
          const n2 = g.addNode(new Node(2, 100, 100));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "circle_cluster_fixed_size": {
          const n1 = g.addNode(new Node(1, 80, 80));
          n1.setShape("Circle");
          const n2 = g.addNode(new Node(2, 80, 80));
          n2.setShape("Circle");
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "connected_to_sequence_forced_row": {
          const n1 = g.addNode(new Node(1, 50, 200));
          const n2 = g.addNode(new Node(2, 50, 200));
          const target = g.addNode(new Node(3, 80, 80));
          const seqVessel = g.addNode(new Node(99, 100, 100));
          seqVessel.isClusterVessel = true;
          const seq = new Sequence({ Vessel: seqVessel, Nodes: [target] });
          target.Sequence = seq;
          g.Sequences.set(seqVessel, seq);
          g.connect(n1, target);
          g.connect(n2, target);
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "table_column_edge_metadata": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          const e1 = g.connect(n1, target);
          const e2 = g.connect(n2, target);
          e1.ToTableColumnIndex = 0;
          e2.ToTableColumnIndex = 0;
          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "ordinary_node_vessel_id_collision": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(1n);
          const predictedID = rndTest.Int63();
          g.addNode(new Node(predictedID, 50, 50));
          return { g, seed: 1n, containerSeed: 42n };
        }
        case "sequence_vessel_id_collision": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(2n);
          const predictedID = rndTest.Int63();
          const seqV = new Node(predictedID, 50, 50);
          g.Sequences.set(seqV, { Vessel: seqV, Nodes: [] });
          return { g, seed: 2n, containerSeed: 42n };
        }
        case "sequence_member_id_collision": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(3n);
          const predictedID = rndTest.Int63();
          const seqV = new Node(999, 50, 50);
          const seqM = new Node(predictedID, 50, 50);
          g.Sequences.set(seqV, { Vessel: seqV, Nodes: [seqM] });
          return { g, seed: 3n, containerSeed: 42n };
        }
        case "tree_sentinel_id_collision": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(4n);
          const predictedID = rndTest.Int63();
          const sentinel = new Node(predictedID, 50, 50);
          g.Trees.set(sentinel, []);
          return { g, seed: 4n, containerSeed: 42n };
        }
        case "tree_node_id_collision": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target);
          g.connect(n2, target);
          const rndTest = new GoRand(5n);
          const predictedID = rndTest.Int63();
          const sentinel = new Node(998, 50, 50);
          const treeNode = new Node(predictedID, 50, 50);
          g.Trees.set(sentinel, [{ Node: treeNode, Children: [] }]);
          return { g, seed: 5n, containerSeed: 42n };
        }
        case "nested_containers": {
          const cRoot = g.addNode(new Node(10, 500, 500));
          cRoot.isContainer = true;
          const cInner = new Node(20, 300, 300);
          cInner.isContainer = true;
          g.addNodeToContainer(cRoot, cInner);

          const n1 = new Node(21, 80, 40);
          const n2 = new Node(22, 80, 40);
          const target = new Node(23, 60, 60);
          g.addNodeToContainer(cInner, n1);
          g.addNodeToContainer(cInner, n2);
          g.addNodeToContainer(cInner, target);

          g.connect(n1, target);
          g.connect(n2, target);

          return { g, seed: 12345n, containerSeed: 42n };
        }
        case "two_containers_equal_square_clusters": {
          const cA = g.addNode(new Node(10, 300, 300));
          cA.isContainer = true;
          g.addNodeToContainer(null, cA);

          const cB = g.addNode(new Node(20, 300, 300));
          cB.isContainer = true;
          g.addNodeToContainer(null, cB);

          const nA1 = new Node(11, 80, 80);
          const nA2 = new Node(12, 80, 80);
          const targetA = new Node(13, 60, 60);
          g.addNodeToContainer(cA, nA1);
          g.addNodeToContainer(cA, nA2);
          g.addNodeToContainer(cA, targetA);
          g.connect(nA1, targetA);
          g.connect(nA2, targetA);

          const nB1 = new Node(21, 80, 80);
          const nB2 = new Node(22, 80, 80);
          const targetB = new Node(23, 60, 60);
          g.addNodeToContainer(cB, nB1);
          g.addNodeToContainer(cB, nB2);
          g.addNodeToContainer(cB, targetB);
          g.connect(nB1, targetB);
          g.connect(nB2, targetB);

          return { g, seed: 54321n, containerSeed: 100n };
        }
        case "multiple_accepted_clusters": {
          const n1 = g.addNode(new Node(1, 100, 50));
          const n2 = g.addNode(new Node(2, 100, 50));
          const target1 = g.addNode(new Node(3, 80, 80));
          g.connect(n1, target1);
          g.connect(n2, target1);

          const n4 = g.addNode(new Node(4, 120, 60));
          const n5 = g.addNode(new Node(5, 120, 60));
          const target2 = g.addNode(new Node(6, 70, 70));
          g.connect(n4, target2);
          g.connect(n5, target2);

          return { g, seed: 99999n, containerSeed: 77n };
        }
        case "candidate_rejected_before_vessel_draw": {
          const c = g.addNode(new Node(10, 300, 300));
          c.isContainer = true;
          g.addNodeToContainer(null, c);

          const n1 = new Node(11, 80, 80);
          const n2 = new Node(12, 80, 80);
          g.addNodeToContainer(c, n1);
          g.addNodeToContainer(c, n2);

          g.connect(n1, c);
          g.connect(n2, c);

          return { g, seed: 11111n, containerSeed: 42n };
        }
        default:
          throw new Error(`Unknown scenario ${name}`);
      }
    }

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
        }

        // Verify graph.Nodes
        const actualNodeIDs = g.Nodes.map((n) => n.ID.toString());
        expect(actualNodeIDs).toEqual(expected.nodes);

        // Verify graph.Edges
        if (expected.edges === null) {
          expect(g.Edges.length).toBe(0);
        } else {
          expect(g.Edges.length).toBe(expected.edges.length);
          for (let i = 0; i < expected.edges.length; i++) {
            const expEdge = expected.edges[i];
            const actualEdge = g.Edges[i];
            expect(actualEdge.From.ID.toString()).toBe(expEdge.from);
            expect(actualEdge.To.ID.toString()).toBe(expEdge.to);
          }
        }
      });
    }
  });
});
