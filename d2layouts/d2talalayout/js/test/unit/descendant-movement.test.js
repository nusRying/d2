import { describe, expect, test } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Graph } from "../../src/graph/graph.js";
import { Point } from "../../src/geometry/point.js";
import { Cluster } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { WorkGuard, WorkLimitError, WorkCanceledError } from "../../src/limits/work-guard.js";
import { abortSignalWorkContext } from "../../src/limits/work-context.js";
import * as rootExports from "../../src/index.js";

describe("Slice 17 Direct Unit Tests - Descendant Traversal & Node Movement", () => {
  describe("API and Scope Boundaries", () => {
    test("Graph methods exist", () => {
      const g = new Graph();
      expect(typeof g.allDescendantNodesGuarded).toBe("function");
      expect(typeof g.allDescendantNodes).toBe("function");
      expect(typeof g.AllDescendantNodes).toBe("function");
      expect(typeof g.allDescendantNodesWithWorkGuard).toBe("function");
      expect(typeof g.AllDescendantNodesWithWorkGuard).toBe("function");
    });

    test("Node methods exist", () => {
      const n = new Node(1, 10, 10);
      expect(typeof n.translate).toBe("function");
      expect(typeof n.Translate).toBe("function");
      expect(typeof n.moveNodeWithChildren).toBe("function");
      expect(typeof n.moveWithChildren).toBe("function");
      expect(typeof n.MoveWithChildren).toBe("function");
      expect(typeof n.moveNodeAbsWithChildren).toBe("function");
      expect(typeof n.moveAbsWithChildren).toBe("function");
      expect(typeof n.MoveAbsWithChildren).toBe("function");
    });

    test("Forbidden Slice 21 / later methods are absent", () => {
      const g = new Graph();
      const n = new Node(1, 10, 10);
      expect(n.fixedBounds).toBeUndefined();
      expect(n.FixedBoundingBox).toBeUndefined();
      expect(n.wrapChildren).toBeUndefined();
      expect(n.fitToBoundingBox).toBeUndefined();
      expect(g.SyncClusters).toBeUndefined();
      expect(g.Cleanup).toBeUndefined();
      expect(g.cleanup).toBeUndefined();
    });

    test("root index does not expose grouping", () => {
      expect(rootExports.resetClusters).toBeUndefined();
      expect(rootExports.ResetClusters).toBeUndefined();
      expect(rootExports.addClusters).toBeUndefined();
      expect(rootExports.AddClusters).toBeUndefined();
    });
  });

  describe("Graph Descendant Traversal", () => {
    test("unguarded allDescendantNodes returns newly-owned array matching guarded results", () => {
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      const child = g.addNode(new Node(2, 50, 50));
      g.addNewNodeToContainer(root, child);

      const d1 = g.allDescendantNodes(root, true);
      const d2 = g.AllDescendantNodes(root, true);

      expect(d1).toEqual([child]);
      expect(d2).toEqual([child]);
      expect(d1).not.toBe(d2);
    });

    test("deep iterative traversal handles 20,000+ nodes without call-stack overflow", () => {
      const g = new Graph();
      const root = g.addNode(new Node(0, 10, 10));
      let parent = root;
      const count = 20_000;
      const firstChild = new Node(1, 10, 10);
      g.addNode(firstChild);
      g.addNewNodeToContainer(root, firstChild);
      parent = firstChild;

      for (let i = 2; i <= count; i++) {
        const child = g.addNode(new Node(i, 10, 10));
        g.addNewNodeToContainer(parent, child);
        parent = child;
      }

      const descendants = g.AllDescendantNodes(root, true);
      expect(descendants.length).toBe(count);
      expect(descendants[0].ID).toBe(1);
      expect(descendants[count - 1].ID).toBe(count);
    });

    test("WorkGuard exact limit accounting (exactUsed succeeds, exactUsed - 1 fails)", () => {
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      const child1 = g.addNode(new Node(2, 20, 20));
      const child2 = g.addNode(new Node(3, 20, 20));
      g.addNewNodeToContainer(root, child1);
      g.addNewNodeToContainer(root, child2);

      // Measure exact used units
      const measureController = new AbortController();
      const measureCtx = abortSignalWorkContext(measureController.signal);
      const measureGuard = new WorkGuard(measureCtx, "Measure", 1_000_000n);
      g.AllDescendantNodesWithWorkGuard(root, true, measureGuard);
      const exactUsed = measureGuard.Used();

      // Guard with exact limit succeeds
      const successController = new AbortController();
      const successCtx = abortSignalWorkContext(successController.signal);
      const successGuard = new WorkGuard(successCtx, "Success", exactUsed);
      const res = g.AllDescendantNodesWithWorkGuard(root, true, successGuard);
      expect(res.length).toBe(2);
      expect(successGuard.Used()).toBe(exactUsed);

      // Guard with exact limit - 1n fails with WorkLimitError
      const failController = new AbortController();
      const failCtx = abortSignalWorkContext(failController.signal);
      const failGuard = new WorkGuard(failCtx, "Fail", exactUsed - 1n);
      expect(() => g.AllDescendantNodesWithWorkGuard(root, true, failGuard)).toThrow(WorkLimitError);
    });

    test("WorkGuard cancellation terminates without mutating graph", () => {
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      for (let i = 2; i <= 2000; i++) {
        g.addNewNodeToContainer(root, new Node(i, 10, 10));
      }

      const controller = new AbortController();
      const ctx = abortSignalWorkContext(controller.signal);
      const guard = new WorkGuard(ctx, "CancelTest", 1_000_000n);
      controller.abort();

      expect(() => g.AllDescendantNodesWithWorkGuard(root, true, guard)).toThrow(WorkCanceledError);
      expect(g.Nodes.length).toBe(2000);
      expect(g.Containers.get(root).length).toBe(1999);
    });
  });

  describe("Node Movement Primitives", () => {
    test("translate and Translate mutate TopLeft in place preserving object identity", () => {
      const n = new Node(1, 10, 10);
      const originalTopLeft = new Point(10.5, 20.25);
      n.TopLeft = originalTopLeft;

      n.translate(5.25, -10.5);
      expect(n.TopLeft).toBe(originalTopLeft);
      expect(n.TopLeft.X).toBe(15.75);
      expect(n.TopLeft.Y).toBe(9.75);

      n.Translate(-5.75, 0.25);
      expect(n.TopLeft).toBe(originalTopLeft);
      expect(n.TopLeft.X).toBe(10.0);
      expect(n.TopLeft.Y).toBe(10.0);
    });

    test("translate throws TypeError if TopLeft is null", () => {
      const n = new Node(1, 10, 10);
      n.TopLeft = null;
      expect(() => n.translate(1, 1)).toThrow(TypeError);
    });

    test("moveNodeWithChildren(0, 0) returns early without dereferencing TopLeft or Graph", () => {
      const detached = new Node(1, 10, 10);
      detached.TopLeft = null;
      detached.Graph = null;

      expect(() => detached.moveNodeWithChildren(0, 0)).not.toThrow();
      expect(() => detached.MoveWithChildren(0, 0)).not.toThrow();
    });

    test("nonzero moveNodeWithChildren mutates root TopLeft before Graph lookup throws", () => {
      const detached = new Node(1, 10, 10);
      const originalPoint = new Point(10, 20);
      detached.TopLeft = originalPoint;
      detached.Graph = null;

      expect(() => detached.MoveWithChildren(5, 5)).toThrow();
      expect(detached.TopLeft).toBe(originalPoint);
      expect(detached.TopLeft.X).toBe(15);
      expect(detached.TopLeft.Y).toBe(25);
    });

    test("moveNodeWithChildren performs nontransactional partial mutation on bad descendant geometry", () => {
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.TopLeft = new Point(0, 0);

      const child1 = g.addNode(new Node(2, 10, 10));
      child1.TopLeft = new Point(10, 10);

      const child2 = g.addNode(new Node(3, 10, 10));
      child2.TopLeft = null; // Bad geometry

      const child3 = g.addNode(new Node(4, 10, 10));
      child3.TopLeft = new Point(30, 30);

      g.addNewNodeToContainer(root, child1);
      g.addNewNodeToContainer(root, child2);
      g.addNewNodeToContainer(root, child3);

      expect(() => root.MoveWithChildren(5, 5)).toThrow();
      // Root and child1 moved before child2 threw
      expect(root.TopLeft.X).toBe(5);
      expect(root.TopLeft.Y).toBe(5);
      expect(child1.TopLeft.X).toBe(15);
      expect(child1.TopLeft.Y).toBe(15);
      // child3 was not reached and remains at initial position
      expect(child3.TopLeft.X).toBe(30);
      expect(child3.TopLeft.Y).toBe(30);
    });

    test("MoveWithChildren preserves non-position fields and edge route Points aliases/values", () => {
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.TopLeft = new Point(0, 0);
      const child = g.addNode(new Node(2, 10, 10));
      child.TopLeft = new Point(10, 10);
      g.addNewNodeToContainer(root, child);

      const target = g.addNode(new Node(3, 10, 10));
      target.TopLeft = new Point(50, 50);
      g.addNewNodeToContainer(null, target);

      const edge = g.connect(child, target);
      const pt1 = new Point(15, 15);
      const pt2 = new Point(45, 45);
      const originalPoints = [pt1, pt2];
      edge.Points = originalPoints;

      root.MoveWithChildren(10, 20);

      expect(root.TopLeft.X).toBe(10);
      expect(root.TopLeft.Y).toBe(20);
      expect(child.TopLeft.X).toBe(20);
      expect(child.TopLeft.Y).toBe(30);

      // Verify edge route points are untouched
      expect(edge.Points).toBe(originalPoints);
      expect(edge.Points[0]).toBe(pt1);
      expect(edge.Points[1]).toBe(pt2);
      expect(edge.Points[0].X).toBe(15);
      expect(edge.Points[0].Y).toBe(15);
      expect(edge.Points[1].X).toBe(45);
      expect(edge.Points[1].Y).toBe(45);
      expect(child.Width).toBe(10);
      expect(child.Height).toBe(10);
    });

    test("moveNodeAbsWithChildren exact-target early return succeeds on detached node", () => {
      const detached = new Node(1, 10, 10);
      detached.TopLeft = new Point(100, 200);
      detached.Graph = null;

      expect(() => detached.moveNodeAbsWithChildren(100, 200)).not.toThrow();
      expect(() => detached.MoveAbsWithChildren(100, 200)).not.toThrow();
    });

    test("moveNodeAbsWithChildren throws if TopLeft is null", () => {
      const n = new Node(1, 10, 10);
      n.TopLeft = null;
      expect(() => n.MoveAbsWithChildren(10, 10)).toThrow();
    });
  });
});
