import { describe, expect, test } from "bun:test";

import {
  Graph,
  Node,
  Edge,
  Cluster,
  ClusterArrangement,
  Point,
  WorkGuard,
  WorkContext,
  backgroundWorkContext,
  abortSignalWorkContext,
  WorkLimitError,
  WorkCanceledError,
  contextWithTransactionWorkGuard,
  existingTransactionWorkGuard,
  ensureTransactionWorkGuard,
  MAX_TRANSACTION_WORK_UNITS,
} from "../../src/index.js";

import * as rootExports from "../../src/index.js";

import {
  averageClusterDimensions,
  AverageClusterDimensions,
  assignArrangement,
  AssignArrangement,
  paddingBetween,
  PaddingBetween,
  addClusters,
  AddClusters,
} from "../../src/grouping/index.js";

import * as groupingExports from "../../src/grouping/index.js";
import { GoRand } from "../../src/random/go-math-rand.js";
import { Spacing } from "../../src/graph/graph.js";

describe("Slice 15 Direct Unit Tests - Atomic AddClusters Orchestration", () => {
  describe("API and Export Boundaries", () => {
    test("grouping exports required orchestration primitives and aliases", () => {
      expect(typeof averageClusterDimensions).toBe("function");
      expect(typeof AverageClusterDimensions).toBe("function");
      expect(averageClusterDimensions).toBe(AverageClusterDimensions);

      expect(typeof assignArrangement).toBe("function");
      expect(typeof AssignArrangement).toBe("function");
      expect(assignArrangement).toBe(AssignArrangement);

      expect(typeof paddingBetween).toBe("function");
      expect(typeof PaddingBetween).toBe("function");
      expect(paddingBetween).toBe(PaddingBetween);

      expect(typeof addClusters).toBe("function");
      expect(typeof AddClusters).toBe("function");
      expect(addClusters).toBe(AddClusters);
    });

    test("root index.js does NOT export grouping primitives", () => {
      expect(rootExports.averageClusterDimensions).toBeUndefined();
      expect(rootExports.AverageClusterDimensions).toBeUndefined();
      expect(rootExports.assignArrangement).toBeUndefined();
      expect(rootExports.AssignArrangement).toBeUndefined();
      expect(rootExports.paddingBetween).toBeUndefined();
      expect(rootExports.PaddingBetween).toBeUndefined();
      expect(rootExports.addClusters).toBeUndefined();
      expect(rootExports.AddClusters).toBeUndefined();
    });

    test("limits exports transaction work guard helpers", () => {
      expect(typeof contextWithTransactionWorkGuard).toBe("function");
      expect(typeof existingTransactionWorkGuard).toBe("function");
      expect(typeof ensureTransactionWorkGuard).toBe("function");
      expect(MAX_TRANSACTION_WORK_UNITS).toBe(1_000_000_000n);
    });

    test("grouping index does NOT export Slice 16 functions", () => {
      expect(groupingExports.cleanup).toBeUndefined();
      expect(groupingExports.Cleanup).toBeUndefined();
      expect(groupingExports.resetClusters).toBeUndefined();
      expect(groupingExports.ResetClusters).toBeUndefined();
      expect(groupingExports.join).toBeUndefined();
      expect(groupingExports.Join).toBeUndefined();
      expect(groupingExports.joinDistancedClusters).toBeUndefined();
      expect(groupingExports.JoinDistancedClusters).toBeUndefined();
      expect(groupingExports.addHubs).toBeUndefined();
      expect(groupingExports.AddHubs).toBeUndefined();
    });
  });

  describe("Validation & Error Conditions", () => {
    test("addClusters requires context", () => {
      const g = new Graph();
      const rnd = new GoRand(1n);
      expect(() => addClusters(null, g, 1n, rnd)).toThrow(
        "TALA AddClusters requires a context"
      );
    });

    test("addClusters requires graph", () => {
      const ctx = backgroundWorkContext();
      const rnd = new GoRand(1n);
      expect(() => addClusters(ctx, null, 1n, rnd)).toThrow(
        "TALA AddClusters requires a graph"
      );
    });

    test("addClusters requires random generator", () => {
      const ctx = backgroundWorkContext();
      const g = new Graph();
      expect(() => addClusters(ctx, g, 1n, null)).toThrow(
        "TALA AddClusters requires a random generator"
      );
    });

    test("averageClusterDimensions handles empty cluster returning NaN", () => {
      const emptyCluster = new Cluster({ Nodes: [] });
      const [w, h] = averageClusterDimensions(emptyCluster);
      expect(Number.isNaN(w)).toBe(true);
      expect(Number.isNaN(h)).toBe(true);
    });

    test("assignArrangement returns Row when isConnectedToSequence is true", () => {
      const rnd = new GoRand(1n);
      const c = new Cluster({ Nodes: [new Node(1, 200, 100), new Node(2, 200, 100)] });
      expect(assignArrangement(c, true, rnd)).toBe(ClusterArrangement.Row);
    });

    test("paddingBetween calculates member spacing", () => {
      const n1 = new Node(1, 100, 50);
      const n2 = new Node(2, 100, 50);
      const c = new Cluster({ Nodes: [n1, n2], Arrangement: ClusterArrangement.Row });
      const pad = paddingBetween(c, false);
      expect(typeof pad).toBe("number");
      expect(pad).toBeGreaterThanOrEqual(20);
    });
  });

  describe("Helper Primitive Semantics", () => {
    test("Node.sameShape raw string comparison parity", () => {
      const n1 = new Node(1, 100, 100);
      const n2 = new Node(2, 100, 100);
      // Both default empty string ""
      expect(n1.sameShape(n2)).toBe(true);

      n2.setShape("Square");
      // Go raw shape comparison: "" != "Square", even though both render as square!
      expect(n1.sameShape(n2)).toBe(false);

      n1.setShape("Square");
      expect(n1.sameShape(n2)).toBe(true);

      n2.setShape("Circle");
      expect(n1.sameShape(n2)).toBe(false);
    });

    test("Node.distanceTo calculations", () => {
      const n1 = new Node(1, 100, 100);
      n1.TopLeft = new Point(0, 0);
      const n2 = new Node(2, 100, 100);
      n2.TopLeft = new Point(300, 400);

      // Centers are at (50, 50) and (350, 450) -> dx=300, dy=400 -> dist = 500
      expect(n1.distanceTo(n2, false)).toBe(500);

      // With includeSizes=true
      const distWithSizes = n1.distanceTo(n2, true);
      expect(distWithSizes).toBeGreaterThan(0);
    });

    test("Spacing representation and accessors", () => {
      const sp = new Spacing(10, 20, 30, 40);
      expect(sp.top).toBe(10);
      expect(sp.bottom).toBe(20);
      expect(sp.left).toBe(30);
      expect(sp.right).toBe(40);
      expect(sp.Top()).toBe(10);
      expect(sp.Bottom()).toBe(20);
      expect(sp.Left()).toBe(30);
      expect(sp.Right()).toBe(40);
    });

    test("assignArrangement logic and ratio rules", () => {
      // wide: width=200, height=100 -> Column
      const nWide1 = new Node(1, 200, 100);
      const nWide2 = new Node(2, 200, 100);
      const cWide = new Cluster({ Nodes: [nWide1, nWide2] });
      const rnd1 = new GoRand(42n);
      expect(assignArrangement(cWide, false, rnd1)).toBe(ClusterArrangement.Column);

      // tall: width=100, height=200 -> Row
      const nTall1 = new Node(3, 100, 200);
      const nTall2 = new Node(4, 100, 200);
      const cTall = new Cluster({ Nodes: [nTall1, nTall2] });
      const rnd2 = new GoRand(42n);
      expect(assignArrangement(cTall, false, rnd2)).toBe(ClusterArrangement.Row);

      // equal dimensions: random draw determines Row or Column
      const nEq1 = new Node(5, 100, 100);
      const nEq2 = new Node(6, 100, 100);
      const cEq = new Cluster({ Nodes: [nEq1, nEq2] });
      const rnd3 = new GoRand(12345n);
      const choice = assignArrangement(cEq, false, rnd3);
      expect([ClusterArrangement.Row, ClusterArrangement.Column]).toContain(choice);
    });
  });

  describe("Transaction WorkGuard and Atomic Rollback", () => {
    function createClusterableGraph() {
      const g = new Graph();
      const c = g.addNode(new Node(10, 300, 300));
      c.isContainer = true;
      g.addNodeToContainer(null, c);

      const n1 = g.addNode(new Node(11, 80, 80));
      const n2 = g.addNode(new Node(12, 80, 80));
      const target = g.addNode(new Node(13, 60, 60));
      g.addNodeToContainer(c, n1);
      g.addNodeToContainer(c, n2);
      g.addNodeToContainer(c, target);

      g.connect(n1, target);
      g.connect(n2, target);

      return { g, c, n1, n2, target };
    }

    test("successful transaction preserves graph.Clusters Map identity", () => {
      const { g } = createClusterableGraph();
      const clustersMapRef = g.Clusters;
      const rnd = new GoRand(12345n);
      const ctx = backgroundWorkContext();

      addClusters(ctx, g, 42n, rnd);

      expect(g.Clusters).toBe(clustersMapRef);
      expect(g.Clusters.size).toBe(1);
    });

    test("WorkLimitError triggers complete rollback and external RNG is NOT rewound", () => {
      // First run to get exact work units used
      const { g: gSuccess } = createClusterableGraph();
      const rndSuccess = new GoRand(12345n);
      const parentCtxSuccess = new WorkContext();
      const guardSuccess = new WorkGuard(
        parentCtxSuccess,
        "AddClustersTransactions",
        1_000_000_000
      );
      const txCtxSuccess = contextWithTransactionWorkGuard(
        parentCtxSuccess,
        guardSuccess
      );

      addClusters(txCtxSuccess, gSuccess, 42n, rndSuccess);
      const exactUsed = Number(guardSuccess.used);
      expect(exactUsed).toBeGreaterThan(0);

      // Now run with limit = exactUsed - 1 to trigger rollback
      const { g: gFail, n1, n2, target } = createClusterableGraph();
      const clustersMapRef = gFail.Clusters;
      const rndFail = new GoRand(12345n);

      const parentCtxFail = new WorkContext();
      const guardFail = new WorkGuard(
        parentCtxFail,
        "AddClustersTransactions",
        exactUsed - 1
      );
      const txCtxFail = contextWithTransactionWorkGuard(
        parentCtxFail,
        guardFail
      );

      expect(() => {
        addClusters(txCtxFail, gFail, 42n, rndFail);
      }).toThrow(WorkLimitError);

      // Verify complete rollback of graph
      expect(gFail.Clusters).toBe(clustersMapRef);
      expect(gFail.Clusters.size).toBe(0);
      expect(gFail.Nodes.length).toBe(4);
      expect(gFail.Edges.length).toBe(2);
      expect(n1.Cluster).toBeNull();
      expect(n2.Cluster).toBeNull();
      expect(target.Cluster).toBeNull();

      // Verify external RNG was consumed and NOT rewound upon rollback
      // It should match the successful run's external RNG state!
      expect(rndFail.Int63()).toBe(rndSuccess.Int63());
    });

    test("WorkCanceledError during transaction rolls back state", () => {
      const { g, n1, n2, target } = createClusterableGraph();
      const controller = new AbortController();
      const parentCtx = abortSignalWorkContext(controller.signal);

      // Abort before run
      controller.abort();

      const rnd = new GoRand(12345n);

      expect(() => {
        addClusters(parentCtx, g, 42n, rnd);
      }).toThrow(WorkCanceledError);

      expect(g.Clusters.size).toBe(0);
      expect(g.Nodes.length).toBe(4);
      expect(n1.Cluster).toBeNull();
      expect(n2.Cluster).toBeNull();
      expect(target.Cluster).toBeNull();
    });

    test("synthetic error during transaction rethrows and restores snapshot", () => {
      const { g } = createClusterableGraph();
      const rnd = new GoRand(12345n);
      const ctx = backgroundWorkContext();

      // Break topology by injecting a nil cluster vessel
      const badVessel = new Node(999, 100, 100);
      badVessel.isClusterVessel = true;
      g.addNode(badVessel);

      expect(() => {
        addClusters(ctx, g, 42n, rnd);
      }).toThrow("TALA engine cluster vessel 999 has no cluster record");

      // Verify state was intact
      expect(g.Clusters.size).toBe(0);
    });

    test("default shape vs square creates no cluster", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 100, 100)); // shape ""
      const n2 = g.addNode(new Node(2, 100, 100));
      n2.setShape("Square"); // shape "Square"
      const target = g.addNode(new Node(3, 80, 80));
      g.connect(n1, target);
      g.connect(n2, target);

      const rnd = new GoRand(12345n);
      const ctx = backgroundWorkContext();
      addClusters(ctx, g, 42n, rnd);

      // Because "" !== "Square", they do not have the same shape -> no cluster
      expect(g.Clusters.size).toBe(0);
    });
  });
});
