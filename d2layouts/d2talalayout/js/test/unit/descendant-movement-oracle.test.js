import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Node } from "../../src/graph/node.js";
import { Graph } from "../../src/graph/graph.js";
import { Point } from "../../src/geometry/point.js";
import { Cluster } from "../../src/graph/cluster.js";
import { Sequence } from "../../src/graph/sequence.js";
import { WorkGuard } from "../../src/limits/work-guard.js";
import { abortSignalWorkContext } from "../../src/limits/work-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/go-descendant-movement-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf-8"));

function makeGuard(limit = 10_000_000n) {
  const controller = new AbortController();
  const ctx = abortSignalWorkContext(controller.signal);
  return new WorkGuard(ctx, "TestGuard", limit);
}

describe("Descendant Traversal & Movement Oracle Reference Suite", () => {
  describe("Metadata verification", () => {
    test("pinned D2 SHA", () => {
      expect(reference.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    });
  });

  describe("Traversal Scenarios Replay", () => {
    test("containers_preorder", () => {
      const scenario = reference.traversalScenarios.containers_preorder;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      const childA = g.addNode(new Node(2, 50, 50));
      const childA1 = g.addNode(new Node(3, 20, 20));
      const childA2 = g.addNode(new Node(4, 20, 20));
      const childB = g.addNode(new Node(5, 50, 50));
      const childB1 = g.addNode(new Node(6, 20, 20));

      g.addNewNodeToContainer(null, root);
      g.addNewNodeToContainer(root, childA);
      g.addNewNodeToContainer(childA, childA1);
      g.addNewNodeToContainer(childA, childA2);
      g.addNewNodeToContainer(root, childB);
      g.addNewNodeToContainer(childB, childB1);

      const guard = makeGuard();
      const descendants = g.AllDescendantNodesWithWorkGuard(root, true, guard);
      const ids = descendants.map((d) => d.ID.toString());

      expect(ids).toEqual(scenario.descendantIDs);
      expect(Number(guard.Used())).toBe(scenario.used);
    });

    test("mixed_ownership_order", () => {
      const scenario = reference.traversalScenarios.mixed_ownership_order;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.setClusterVessel(true);

      const childC1 = g.addNode(new Node(2, 10, 10));
      const childC2 = g.addNode(new Node(3, 10, 10));
      g.addNewNodeToContainer(root, childC1);
      g.addNewNodeToContainer(root, childC2);

      const clusterM1 = g.addNode(new Node(4, 10, 10));
      const clusterM2 = g.addNode(new Node(5, 10, 10));
      g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [clusterM1, clusterM2] }));

      const seqM1 = g.addNode(new Node(6, 10, 10));
      const seqM2 = g.addNode(new Node(7, 10, 10));
      g.Sequences.set(root, new Sequence({ Nodes: [seqM1, seqM2] }));

      const guard = makeGuard();
      const descendants = g.AllDescendantNodesWithWorkGuard(root, true, guard);
      const ids = descendants.map((d) => d.ID.toString());

      expect(ids).toEqual(scenario.descendantIDs);
      expect(Number(guard.Used())).toBe(scenario.used);
    });

    test("include_structured_false", () => {
      const scenario = reference.traversalScenarios.include_structured_false;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.setClusterVessel(true);

      const ordChild = g.addNode(new Node(2, 10, 10));
      g.addNewNodeToContainer(root, ordChild);

      const clusterM1 = g.addNode(new Node(3, 10, 10));
      g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [clusterM1] }));

      const hiddenChild = g.addNode(new Node(4, 10, 10));
      g.addNewNodeToContainer(clusterM1, hiddenChild);

      const seqM1 = g.addNode(new Node(5, 10, 10));
      g.Sequences.set(root, new Sequence({ Nodes: [seqM1] }));
      const hiddenSeqChild = g.addNode(new Node(6, 10, 10));
      g.addNewNodeToContainer(seqM1, hiddenSeqChild);

      const guard = makeGuard();
      const descendants = g.AllDescendantNodesWithWorkGuard(root, false, guard);
      const ids = descendants.map((d) => d.ID.toString());

      expect(ids).toEqual(scenario.descendantIDs);
      expect(Number(guard.Used())).toBe(scenario.used);
    });

    test("duplicate_membership", () => {
      const scenario = reference.traversalScenarios.duplicate_membership;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.setClusterVessel(true);

      const shared = g.addNode(new Node(2, 10, 10));
      g.addNewNodeToContainer(root, shared);
      g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [shared] }));
      g.Sequences.set(root, new Sequence({ Nodes: [shared] }));

      // Distinct node with same ID = 2
      const distinctSameID = new Node(2, 20, 20);
      g.addNode(distinctSameID);
      g.addNewNodeToContainer(root, distinctSameID);

      const guard = makeGuard();
      const descendants = g.AllDescendantNodesWithWorkGuard(root, true, guard);
      const ids = descendants.map((d) => d.ID.toString());

      expect(ids).toEqual(scenario.descendantIDs);
      expect(descendants.length).toBe(2);
      expect(descendants[0]).toBe(shared);
      expect(descendants[1]).toBe(distinctSameID);
      expect(Number(guard.Used())).toBe(scenario.used);
    });

    test("nil_and_cycle", () => {
      const scenario = reference.traversalScenarios.nil_and_cycle;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.setClusterVessel(true);

      const c1 = g.addNode(new Node(2, 10, 10));
      const c2 = g.addNode(new Node(3, 10, 10));

      root.isContainer = true;
      c2.isContainer = true;

      g.Containers.set(root, [c1, null, c2, root]);
      g.Containers.set(c2, [c1]);
      g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [null, root] }));

      const guard = makeGuard();
      const descendants = g.AllDescendantNodesWithWorkGuard(root, true, guard);
      const ids = descendants.map((d) => d.ID.toString());

      expect(ids).toEqual(scenario.descendantIDs);
      expect(Number(guard.Used())).toBe(scenario.used);
    });

    test("null_root", () => {
      const scenario = reference.traversalScenarios.null_root;
      const g = new Graph();
      const r1 = g.addNode(new Node(1, 10, 10));
      const r2 = g.addNode(new Node(2, 10, 10));
      g.addNewNodeToContainer(null, r1);
      g.addNewNodeToContainer(null, r2);

      const seqM = g.addNode(new Node(3, 10, 10));
      g.Sequences.set(null, new Sequence({ Nodes: [seqM] }));

      const guard = makeGuard();
      const descendants = g.AllDescendantNodesWithWorkGuard(null, true, guard);
      const ids = descendants.map((d) => d.ID.toString());

      expect(ids).toEqual(scenario.descendantIDs);
      expect(Number(guard.Used())).toBe(scenario.used);
    });
  });

  describe("Movement Scenarios Replay", () => {
    test("fractional_container_move", () => {
      const scenario = reference.movementScenarios.fractional_container_move;
      const g = new Graph();
      const parent = g.addNode(new Node(1, 20, 20));
      parent.TopLeft = new Point(scenario.before["1"].x, scenario.before["1"].y);
      const child = g.addNode(new Node(2, 10, 10));
      child.TopLeft = new Point(scenario.before["2"].x, scenario.before["2"].y);
      g.addNewNodeToContainer(null, parent);
      g.addNewNodeToContainer(parent, child);

      parent.MoveWithChildren(0.5, 1.25);

      expect(parent.TopLeft.X).toBe(scenario.after["1"].x);
      expect(parent.TopLeft.Y).toBe(scenario.after["1"].y);
      expect(child.TopLeft.X).toBe(scenario.after["2"].x);
      expect(child.TopLeft.Y).toBe(scenario.after["2"].y);
    });

    test("mixed_structured_descendants_move", () => {
      const scenario = reference.movementScenarios.mixed_structured_descendants_move;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.TopLeft = new Point(scenario.before["1"].x, scenario.before["1"].y);
      root.setClusterVessel(true);

      const cChild = g.addNode(new Node(2, 10, 10));
      cChild.TopLeft = new Point(scenario.before["2"].x, scenario.before["2"].y);
      g.addNewNodeToContainer(root, cChild);

      const clMember = g.addNode(new Node(3, 10, 10));
      clMember.TopLeft = new Point(scenario.before["3"].x, scenario.before["3"].y);
      g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [clMember] }));

      const seqMember = g.addNode(new Node(4, 10, 10));
      seqMember.TopLeft = new Point(scenario.before["4"].x, scenario.before["4"].y);
      g.Sequences.set(root, new Sequence({ Nodes: [seqMember] }));

      root.MoveWithChildren(100.5, 200.75);

      expect(root.TopLeft.X).toBe(scenario.after["1"].x);
      expect(root.TopLeft.Y).toBe(scenario.after["1"].y);
      expect(cChild.TopLeft.X).toBe(scenario.after["2"].x);
      expect(cChild.TopLeft.Y).toBe(scenario.after["2"].y);
      expect(clMember.TopLeft.X).toBe(scenario.after["3"].x);
      expect(clMember.TopLeft.Y).toBe(scenario.after["3"].y);
      expect(seqMember.TopLeft.X).toBe(scenario.after["4"].x);
      expect(seqMember.TopLeft.Y).toBe(scenario.after["4"].y);
    });

    test("duplicate_membership_moves_once", () => {
      const scenario = reference.movementScenarios.duplicate_membership_moves_once;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.TopLeft = new Point(scenario.before["1"].x, scenario.before["1"].y);
      root.setClusterVessel(true);

      const shared = g.addNode(new Node(2, 10, 10));
      shared.TopLeft = new Point(scenario.before["2"].x, scenario.before["2"].y);
      g.addNewNodeToContainer(root, shared);
      g.Clusters.set(root, new Cluster({ Vessel: root, Nodes: [shared] }));

      root.MoveWithChildren(10, 10);

      expect(root.TopLeft.X).toBe(scenario.after["1"].x);
      expect(root.TopLeft.Y).toBe(scenario.after["1"].y);
      expect(shared.TopLeft.X).toBe(scenario.after["2"].x);
      expect(shared.TopLeft.Y).toBe(scenario.after["2"].y);
    });

    test("fixed_descendant_moves", () => {
      const scenario = reference.movementScenarios.fixed_descendant_moves;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.TopLeft = new Point(scenario.before["1"].x, scenario.before["1"].y);

      const fixedChild = g.addNode(new Node(2, 10, 10));
      fixedChild.TopLeft = new Point(scenario.before["2"].x, scenario.before["2"].y);
      fixedChild.FixedTopLeft = new Point(10, 10);
      g.addNewNodeToContainer(root, fixedChild);

      root.MoveWithChildren(5, 5);

      expect(root.TopLeft.X).toBe(scenario.after["1"].x);
      expect(root.TopLeft.Y).toBe(scenario.after["1"].y);
      expect(fixedChild.TopLeft.X).toBe(scenario.after["2"].x);
      expect(fixedChild.TopLeft.Y).toBe(scenario.after["2"].y);
    });

    test("absolute_move", () => {
      const scenario = reference.movementScenarios.absolute_move;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.TopLeft = new Point(scenario.before["1"].x, scenario.before["1"].y);

      const child = g.addNode(new Node(2, 10, 10));
      child.TopLeft = new Point(scenario.before["2"].x, scenario.before["2"].y);
      g.addNewNodeToContainer(root, child);

      root.MoveAbsWithChildren(20.5, 10.25);

      expect(root.TopLeft.X).toBe(scenario.after["1"].x);
      expect(root.TopLeft.Y).toBe(scenario.after["1"].y);
      expect(child.TopLeft.X).toBe(scenario.after["2"].x);
      expect(child.TopLeft.Y).toBe(scenario.after["2"].y);
    });

    test("absolute_equal_noop", () => {
      const scenario = reference.movementScenarios.absolute_equal_noop;
      const g = new Graph();
      const root = g.addNode(new Node(1, 100, 100));
      root.TopLeft = new Point(scenario.before["1"].x, scenario.before["1"].y);

      const child = g.addNode(new Node(2, 10, 10));
      child.TopLeft = new Point(scenario.before["2"].x, scenario.before["2"].y);
      g.addNewNodeToContainer(root, child);

      root.MoveAbsWithChildren(20.5, 10.25);

      expect(root.TopLeft.X).toBe(scenario.after["1"].x);
      expect(root.TopLeft.Y).toBe(scenario.after["1"].y);
      expect(child.TopLeft.X).toBe(scenario.after["2"].x);
      expect(child.TopLeft.Y).toBe(scenario.after["2"].y);
    });
  });

  describe("Panic Facts Verification", () => {
    test("detached_nonzero_partial_mutation", () => {
      const fact = reference.panicFacts.detached_nonzero_partial_mutation;
      expect(fact.panicked).toBe(true);

      const root = new Node(1, 10, 10);
      root.TopLeft = new Point(10, 20);
      root.Graph = null;

      expect(() => root.MoveWithChildren(5, 5)).toThrow();
      expect(root.TopLeft.X).toBe(fact.finalTopLeft.x);
      expect(root.TopLeft.Y).toBe(fact.finalTopLeft.y);
    });

    test("null_top_left_absolute_move", () => {
      const fact = reference.panicFacts.null_top_left_absolute_move;
      expect(fact.panicked).toBe(true);

      const root = new Node(1, 10, 10);
      root.TopLeft = null;

      expect(() => root.MoveAbsWithChildren(10, 10)).toThrow();
    });
  });
});
