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
    test("grouping exports required orchestration primitives and aliases without private PascalCase alias", () => {
      expect(typeof averageClusterDimensions).toBe("function");
      expect(groupingExports.AverageClusterDimensions).toBeUndefined();

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

    test("averageClusterDimensions handles empty cluster returning NaN plain array", () => {
      const emptyCluster = new Cluster({ Nodes: [] });
      const res = averageClusterDimensions(emptyCluster);
      expect(Array.isArray(res)).toBe(true);
      expect(res.length).toBe(2);
      expect(res.width).toBeUndefined();
      expect(res.height).toBeUndefined();
      const [w, h] = res;
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

      // Shortest Euclidean distance between zero-sized boxes at TopLeft (0, 0) and (300, 400) -> dx=300, dy=400 -> dist = 500
      expect(n1.distanceTo(n2, false)).toBe(500);

      // With includeSizes=true (closed axis-aligned boxes)
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

  describe("Transaction WorkGuard Helper Behavior", () => {
    test("fresh guard created with 1_000_000_000n limit, correct location, and derived context", () => {
      const ctx = new WorkContext();
      const [derived, guard] = ensureTransactionWorkGuard(ctx, "AddClustersTransactions");

      expect(guard.limit).toBe(1_000_000_000n);
      expect(guard.location).toBe("AddClustersTransactions");
      expect(derived).not.toBe(ctx);

      const [existingGuard, exists] = existingTransactionWorkGuard(derived, "AddClustersTransactions");
      expect(exists).toBe(true);
      expect(existingGuard).toBe(guard);
    });

    test("existing guard reuse returns same context, same guard, preserved Used(), location, and limit", () => {
      const parentCtx = new WorkContext();
      const guard = new WorkGuard(parentCtx, "OriginalLocation", 500n);
      guard.Step();
      guard.Step();
      const usedBefore = guard.Used();
      expect(usedBefore).toBe(2n);

      const wrapped = contextWithTransactionWorkGuard(parentCtx, guard);
      const [outCtx, outGuard] = ensureTransactionWorkGuard(wrapped, "different-location");

      expect(outCtx).toBe(wrapped);
      expect(outGuard).toBe(guard);
      expect(outGuard.Used()).toBe(usedBefore);
      expect(outGuard.location).toBe("OriginalLocation");
      expect(outGuard.limit).toBe(500n);
    });

    test("existing canceled guard throws typed WorkCanceledError from Finish() check", () => {
      let cancelled = false;
      const parentCtx = new WorkContext({ isCancelled: () => cancelled });
      const guard = new WorkGuard(parentCtx, "AddClustersTransactions", 500n);
      const wrapped = contextWithTransactionWorkGuard(parentCtx, guard);

      cancelled = true;
      expect(() => {
        existingTransactionWorkGuard(wrapped, "AddClustersTransactions");
      }).toThrow(WorkCanceledError);
    });
  });

  describe("Transaction WorkGuard and Atomic Rollback", () => {
    // Exact AddClusters state-capture helper
    function captureGraphDeepState(g) {
      const captured = {
        nodesArray: g.Nodes,
        nodesOrder: [...g.Nodes],
        edgesArray: g.Edges,
        edgesOrder: [...g.Edges],

        containersMap: g.Containers,
        containersEntries: new Map(),

        clustersMap: g.Clusters,
        clustersEntries: new Map(g.Clusters),

        sequencesMap: g.Sequences,
        sequencesEntries: new Map(g.Sequences),

        treesMap: g.Trees,
        treesEntries: new Map(g.Trees),

        nodeToTreeMap: g.NodeToTree,
        nodeToTreeEntries: new Map(g.NodeToTree),

        nodeStates: new Map(),
        edgeStates: new Map(),
      };

      for (const [c, children] of g.Containers.entries()) {
        captured.containersEntries.set(c, {
          array: children,
          order: [...children],
        });
      }

      function recordNode(n) {
        if (!n || captured.nodeStates.has(n)) return;
        captured.nodeStates.set(n, {
          box: n.Box,
          topLeft: n.TopLeft,
          tlX: n.TopLeft ? n.TopLeft.X : null,
          tlY: n.TopLeft ? n.TopLeft.Y : null,
          width: n.Width,
          height: n.Height,
          graph: n.Graph,
          container: n.Container,
          cluster: n.Cluster,
          sequence: n.Sequence,
          isClusterVessel: n.isClusterVessel,
          edgesArray: n.Edges,
          edgesOrder: [...n.Edges],
        });
      }

      for (const n of g.Nodes) recordNode(n);
      for (const [, children] of g.Containers.entries()) {
        if (children) {
          for (const ch of children) recordNode(ch);
        }
      }
      for (const e of g.Edges) {
        recordNode(e.From);
        recordNode(e.To);
        captured.edgeStates.set(e, {
          from: e.From,
          to: e.To,
          pointsArray: e.Points,
          points: e.Points ? e.Points.map((p) => ({ obj: p, x: p.X, y: p.Y })) : null,
        });
      }

      return captured;
    }

    function assertGraphDeepStateRestored(g, captured) {
      // Top-level arrays and maps identity and order
      expect(g.Nodes).toBe(captured.nodesArray);
      expect(g.Nodes.length).toBe(captured.nodesOrder.length);
      for (let i = 0; i < captured.nodesOrder.length; i++) {
        expect(g.Nodes[i]).toBe(captured.nodesOrder[i]);
      }

      expect(g.Edges).toBe(captured.edgesArray);
      expect(g.Edges.length).toBe(captured.edgesOrder.length);
      for (let i = 0; i < captured.edgesOrder.length; i++) {
        expect(g.Edges[i]).toBe(captured.edgesOrder[i]);
      }

      expect(g.Containers).toBe(captured.containersMap);
      expect(g.Containers.size).toBe(captured.containersEntries.size);
      for (const [c, expectedEntry] of captured.containersEntries.entries()) {
        const actualChildren = g.Containers.get(c);
        expect(actualChildren).toBe(expectedEntry.array);
        expect(actualChildren.length).toBe(expectedEntry.order.length);
        for (let i = 0; i < expectedEntry.order.length; i++) {
          expect(actualChildren[i]).toBe(expectedEntry.order[i]);
        }
      }

      expect(g.Clusters).toBe(captured.clustersMap);
      expect(g.Clusters.size).toBe(captured.clustersEntries.size);
      for (const [k, v] of captured.clustersEntries.entries()) {
        expect(g.Clusters.get(k)).toBe(v);
      }

      expect(g.Sequences).toBe(captured.sequencesMap);
      expect(g.Sequences.size).toBe(captured.sequencesEntries.size);
      for (const [k, v] of captured.sequencesEntries.entries()) {
        expect(g.Sequences.get(k)).toBe(v);
      }

      expect(g.Trees).toBe(captured.treesMap);
      expect(g.Trees.size).toBe(captured.treesEntries.size);
      for (const [k, v] of captured.treesEntries.entries()) {
        expect(g.Trees.get(k)).toBe(v);
      }

      expect(g.NodeToTree).toBe(captured.nodeToTreeMap);
      expect(g.NodeToTree.size).toBe(captured.nodeToTreeEntries.size);
      for (const [k, v] of captured.nodeToTreeEntries.entries()) {
        expect(g.NodeToTree.get(k)).toBe(v);
      }

      // For every original Node:
      for (const [n, expectedState] of captured.nodeStates.entries()) {
        expect(n.Box).toBe(expectedState.box);
        expect(n.TopLeft).toBe(expectedState.topLeft);
        if (expectedState.topLeft) {
          expect(n.TopLeft.X).toBe(expectedState.tlX);
          expect(n.TopLeft.Y).toBe(expectedState.tlY);
        }
        expect(n.Width).toBe(expectedState.width);
        expect(n.Height).toBe(expectedState.height);
        expect(n.Graph).toBe(expectedState.graph);
        expect(n.Container).toBe(expectedState.container);
        expect(n.Cluster).toBe(expectedState.cluster);
        expect(n.Sequence).toBe(expectedState.sequence);
        expect(n.isClusterVessel).toBe(expectedState.isClusterVessel);

        expect(n.Edges).toBe(expectedState.edgesArray);
        expect(n.Edges.length).toBe(expectedState.edgesOrder.length);
        for (let i = 0; i < expectedState.edgesOrder.length; i++) {
          expect(n.Edges[i]).toBe(expectedState.edgesOrder[i]);
        }
      }

      // For every original Edge:
      for (const [e, expectedState] of captured.edgeStates.entries()) {
        expect(e.From).toBe(expectedState.from);
        expect(e.To).toBe(expectedState.to);
        expect(e.Points).toBe(expectedState.pointsArray);
        if (expectedState.points) {
          expect(e.Points.length).toBe(expectedState.points.length);
          for (let i = 0; i < expectedState.points.length; i++) {
            expect(e.Points[i]).toBe(expectedState.points[i].obj);
            expect(e.Points[i].X).toBe(expectedState.points[i].x);
            expect(e.Points[i].Y).toBe(expectedState.points[i].y);
          }
        }
      }
    }

    // Graph with enough work after first cluster publication for WorkGuard polling to occur
    function createLateFailureGraph() {
      const g = new Graph();

      // Container A: forms a cluster first with routed edges
      const cA = g.addNode(new Node(10, 300, 300));
      cA.isContainer = true;
      g.addNodeToContainer(null, cA);

      const n1 = new Node(11, 80, 80);
      const n2 = new Node(12, 80, 80);
      const target1 = new Node(13, 60, 60);
      g.addNodeToContainer(cA, n1);
      g.addNodeToContainer(cA, n2);
      g.addNodeToContainer(cA, target1);

      const e1 = g.connect(n1, target1);
      e1.Points = [new Point(10, 20), new Point(30, 40), new Point(50, 60)];
      const e2 = g.connect(n2, target1);
      e2.Points = [new Point(15, 25), new Point(35, 45)];

      // Container B: contains 8 nodes so chargeKernel executes 64 steps, crossing polling stride
      const cB = g.addNode(new Node(20, 300, 300));
      cB.isContainer = true;
      g.addNodeToContainer(null, cB);

      const bNodes = [];
      for (let i = 1; i <= 8; i++) {
        const bn = new Node(20 + i, 50, 50);
        g.addNodeToContainer(cB, bn);
        bNodes.push(bn);
      }
      g.connect(bNodes[0], bNodes[2]);
      g.connect(bNodes[1], bNodes[2]);

      return { g, cA, cB, n1, n2, target1, e1, e2, bNodes };
    }

    test("successful transaction preserves graph.Clusters Map identity", () => {
      const { g } = createLateFailureGraph();
      const clustersMapRef = g.Clusters;
      const rnd = new GoRand(12345n);
      const ctx = backgroundWorkContext();

      addClusters(ctx, g, 42n, rnd);

      expect(g.Clusters).toBe(clustersMapRef);
      expect(g.Clusters.size).toBeGreaterThan(0);
    });

    test("TestAddClustersCancellationAfterMutationRestoresExactWholeStageState equivalent - post-mutation cancellation restores exact state", () => {
      const { g } = createLateFailureGraph();
      const captured = captureGraphDeepState(g);
      const rnd = new GoRand(12345n);

      let observedMutation = false;
      const ctx = new WorkContext({
        isCancelled: () => {
          if (g.Clusters.size > 0) {
            observedMutation = true;
            return true;
          }
          return false;
        },
        doneAvailable: false,
      });

      let caughtError = null;
      try {
        addClusters(ctx, g, 42n, rnd);
      } catch (err) {
        caughtError = err;
      }

      expect(observedMutation).toBe(true);
      expect(caughtError).toBeInstanceOf(WorkCanceledError);
      assertGraphDeepStateRestored(g, captured);
    });

    test("TestAddClustersPanicAfterMutationRestoresExactWholeStageState equivalent - post-mutation sentinel exception rethrows and restores exact state", () => {
      const { g } = createLateFailureGraph();
      const captured = captureGraphDeepState(g);
      const rnd = new GoRand(12345n);
      const sentinelError = new Error("SENTINEL_PANIC_POST_MUTATION");

      let observedMutation = false;
      const ctx = new WorkContext({
        isCancelled: () => {
          if (g.Clusters.size > 0) {
            observedMutation = true;
            throw sentinelError;
          }
          return false;
        },
        doneAvailable: false,
      });

      let caughtError = null;
      try {
        addClusters(ctx, g, 42n, rnd);
      } catch (err) {
        caughtError = err;
      }

      expect(observedMutation).toBe(true);
      expect(caughtError).toBe(sentinelError);
      assertGraphDeepStateRestored(g, captured);
    });

    test("routed-edge rollback alias proof preserves Points array, Point object identities, and coordinates", () => {
      const { g, e1, n1, target1 } = createLateFailureGraph();
      const originalPointsArray = e1.Points;
      const originalP0 = e1.Points[0];
      const originalP1 = e1.Points[1];
      const originalP2 = e1.Points[2];
      const originalN1Edges = n1.Edges;

      const captured = captureGraphDeepState(g);
      const rnd = new GoRand(12345n);

      let observedMutation = false;
      const ctx = new WorkContext({
        isCancelled: () => {
          if (g.Clusters.size > 0) {
            observedMutation = true;
            return true;
          }
          return false;
        },
        doneAvailable: false,
      });

      expect(() => {
        addClusters(ctx, g, 42n, rnd);
      }).toThrow(WorkCanceledError);

      expect(observedMutation).toBe(true);
      expect(e1.Points).toBe(originalPointsArray);
      expect(e1.Points[0]).toBe(originalP0);
      expect(e1.Points[1]).toBe(originalP1);
      expect(e1.Points[2]).toBe(originalP2);
      expect(e1.Points[0].X).toBe(10);
      expect(e1.Points[0].Y).toBe(20);
      expect(e1.Points[1].X).toBe(30);
      expect(e1.Points[1].Y).toBe(40);
      expect(e1.Points[2].X).toBe(50);
      expect(e1.Points[2].Y).toBe(60);
      expect(e1.From).toBe(n1);
      expect(e1.To).toBe(target1);
      expect(n1.Edges).toBe(originalN1Edges);

      assertGraphDeepStateRestored(g, captured);
    });

    test("WorkLimit exactUsed - 1n triggers complete rollback, exact state restoration, and external RNG is NOT rewound", () => {
      // First run to get exact work units used
      const { g: gSuccess } = createLateFailureGraph();
      const rndSuccess = new GoRand(12345n);
      const parentCtxSuccess = new WorkContext();
      const guardSuccess = new WorkGuard(
        parentCtxSuccess,
        "AddClustersTransactions",
        1_000_000_000n
      );
      const txCtxSuccess = contextWithTransactionWorkGuard(
        parentCtxSuccess,
        guardSuccess
      );

      addClusters(txCtxSuccess, gSuccess, 42n, rndSuccess);
      const exactUsed = guardSuccess.used;
      expect(typeof exactUsed).toBe("bigint");
      expect(exactUsed).toBeGreaterThan(0n);
      const expectedNextRnd = rndSuccess.Int63();

      // Now run with limit = exactUsed - 1n to trigger rollback
      const { g: gFail } = createLateFailureGraph();
      const captured = captureGraphDeepState(gFail);
      const rndFail = new GoRand(12345n);

      const parentCtxFail = new WorkContext();
      const guardFail = new WorkGuard(
        parentCtxFail,
        "AddClustersTransactions",
        exactUsed - 1n
      );
      const txCtxFail = contextWithTransactionWorkGuard(
        parentCtxFail,
        guardFail
      );

      expect(() => {
        addClusters(txCtxFail, gFail, 42n, rndFail);
      }).toThrow(WorkLimitError);

      assertGraphDeepStateRestored(gFail, captured);

      // Verify external RNG remained advanced and was NOT rewound upon rollback
      expect(rndFail.Int63()).toBe(expectedNextRnd);
    });

    test("pre-work cancellation aborts and leaves state unchanged", () => {
      const { g } = createLateFailureGraph();
      const captured = captureGraphDeepState(g);
      const controller = new AbortController();
      const parentCtx = abortSignalWorkContext(controller.signal);

      // Abort before run
      controller.abort();

      const rnd = new GoRand(12345n);

      expect(() => {
        addClusters(parentCtx, g, 42n, rnd);
      }).toThrow(WorkCanceledError);

      assertGraphDeepStateRestored(g, captured);
    });

    test("malformed cluster vessel preflight error aborts before execution", () => {
      const { g } = createLateFailureGraph();
      const captured = captureGraphDeepState(g);
      const rnd = new GoRand(12345n);
      const ctx = backgroundWorkContext();

      // Break topology by injecting a nil cluster vessel
      const badVessel = new Node(999, 100, 100);
      badVessel.isClusterVessel = true;
      g.addNode(badVessel);

      expect(() => {
        addClusters(ctx, g, 42n, rnd);
      }).toThrow("TALA engine cluster vessel 999 has no cluster record");

      // Verify nil cluster vessel was removed and state was restored
      g.Nodes.pop();
      assertGraphDeepStateRestored(g, captured);
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
