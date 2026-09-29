import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  Graph,
  Node,
  Edge,
  Tree,
  Cluster,
  Sequence,
  Point,
  Validate,
  WorkGuard,
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_TOPOLOGY_REFERENCES,
  MAX_ROUTE_POINTS,
  MAX_TOPOLOGY_DEPTH,
  MAX_ENGINE_WORK_UNITS,
  backgroundWorkContext,
} from "../../src/index.js";

const fixturePath = resolve(
  import.meta.dir,
  "../fixtures/go-topology-preflight-reference.json"
);
const oracle = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("Slice 10 Go Topology Preflight Oracle Parity", () => {
  test("asserts oracle metadata and capacity representation gap", () => {
    expect(oracle.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    expect(oracle.metadata.referencePackage).toBe(
      "github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
    );
    expect(oracle.metadata.runtimeGoVersion).toBeTruthy();
    expect(oracle.metadata.runtimeGOOS).toBeTruthy();
    expect(oracle.metadata.runtimeGOARCH).toBeTruthy();
    expect(oracle.metadata.goSliceSpareCapacitySafety).toBe(true);
    expect(oracle.metadata.jsArrayCapacityRepresentable).toBe(false);
  });

  test("asserts oracle constants match JS limits", () => {
    expect(MAX_ENGINE_NODES).toBe(oracle.constants.MaxEngineNodes);
    expect(MAX_ENGINE_EDGES).toBe(oracle.constants.MaxEngineEdges);
    expect(MAX_TOPOLOGY_REFERENCES).toBe(oracle.constants.MaxTopologyReferences);
    expect(MAX_ROUTE_POINTS).toBe(oracle.constants.MaxRoutePoints);
    expect(MAX_TOPOLOGY_DEPTH).toBe(oracle.constants.MaxEngineTreeDepth);
  });

  describe("Replays Go Validate Scenarios", () => {
    const ctx = backgroundWorkContext();

    function runScenario(fn) {
      try {
        fn();
        return { success: true, error: null };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    test("1. valid_empty_graph", () => {
      const g = new Graph();
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.valid_empty_graph.success);
      expect(res.error).toBe(oracle.scenarios.valid_empty_graph.error);
    });

    test("2. nil_graph", () => {
      const res = runScenario(() => Validate(ctx, "test", null));
      expect(res.success).toBe(oracle.scenarios.nil_graph.success);
      expect(res.error).toBe(oracle.scenarios.nil_graph.error);
    });

    test("3. nil_context_valid_graph", () => {
      const g = new Graph();
      const res = runScenario(() => Validate(null, "AddSequences", g));
      expect(res.success).toBe(oracle.scenarios.nil_context_valid_graph.success);
      expect(res.error).toBe(oracle.scenarios.nil_context_valid_graph.error);
    });

    test("4. nil_graph_nil_context_error_ordering", () => {
      const res = runScenario(() => Validate(null, "AddSequences", null));
      expect(res.success).toBe(oracle.scenarios.nil_graph_nil_context_error_ordering.success);
      expect(res.error).toBe(oracle.scenarios.nil_graph_nil_context_error_ordering.error);
    });

    test("5. nil_graph_node_entry", () => {
      const g = new Graph();
      g.Nodes = [null];
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.nil_graph_node_entry.success);
      expect(res.error).toBe(oracle.scenarios.nil_graph_node_entry.error);
    });

    test("6. nil_graph_edge_entry", () => {
      const g = new Graph();
      g.Edges = [null];
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.nil_graph_edge_entry.success);
      expect(res.error).toBe(oracle.scenarios.nil_graph_edge_entry.error);
    });

    test("7. edge_missing_endpoint", () => {
      const g = new Graph();
      const e = new Edge(null, null);
      e.ID = 42n;
      g.Edges = [e];
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.edge_missing_endpoint.success);
      expect(res.error).toBe(oracle.scenarios.edge_missing_endpoint.error);
    });

    test("8. nil_container_child", () => {
      const g = new Graph();
      g.Containers.set(null, [null]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.nil_container_child.success);
      expect(res.error).toBe(oracle.scenarios.nil_container_child.error);
    });

    test("9. nil_route_point", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 10, 10));
      const n2 = g.addNode(new Node(2, 10, 10));
      const e = g.connect(n1, n2);
      e.Points = [null];
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.nil_route_point.success);
      expect(res.error).toBe(oracle.scenarios.nil_route_point.error);
    });

    test("10. nil_cluster_record", () => {
      const g = new Graph();
      const v = new Node(1, 10, 10);
      g.Clusters.set(v, null);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.nil_cluster_record.success);
      expect(res.error).toBe(oracle.scenarios.nil_cluster_record.error);
    });

    test("11. nil_sequence_record", () => {
      const g = new Graph();
      const v = new Node(1, 10, 10);
      g.Sequences.set(v, null);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.nil_sequence_record.success);
      expect(res.error).toBe(oracle.scenarios.nil_sequence_record.error);
    });

    test("12. valid_nil_tree_root_key", () => {
      const g = new Graph();
      const rootNode = new Node(1, 10, 10);
      const rootTree = new Tree(rootNode);
      g.Trees.set(null, [rootTree]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.valid_nil_tree_root_key.success);
      expect(res.error).toBe(oracle.scenarios.valid_nil_tree_root_key.error);
    });

    test("13. container_parent_cycle", () => {
      const g = new Graph();
      const a = g.addNode(new Node(1, 1, 1));
      a.Container = a;
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.container_parent_cycle.success);
      expect(res.error).toBe(oracle.scenarios.container_parent_cycle.error);
    });

    test("14. container_parent_depth_exceeded", () => {
      const g = new Graph();
      let parent = null;
      for (let i = 0; i <= MAX_TOPOLOGY_DEPTH; i++) {
        const node = g.addNode(new Node(i + 1, 1, 1));
        node.Container = parent;
        parent = node;
      }
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.container_parent_depth_exceeded.success);
      expect(res.error).toBe(oracle.scenarios.container_parent_depth_exceeded.error);
    });

    test("15. effective_container_cycle", () => {
      const g = new Graph();
      const a = new Node(1, 1, 1);
      const vesselA = new Node(2, 1, 1);
      vesselA.isClusterVessel = true;
      g.addNodeUnchecked(a);
      g.addNodeUnchecked(vesselA);
      const clusterA = new Cluster({ Vessel: vesselA, Nodes: [a], Graph: g });
      a.Cluster = clusterA;
      vesselA.Container = a;
      g.Clusters.set(vesselA, clusterA);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.effective_container_cycle.success);
      expect(res.error).toBe(oracle.scenarios.effective_container_cycle.error);
    });

    test("16. effective_container_depth_exceeded", () => {
      const g = new Graph();
      const members = [];
      const vessels = [];
      for (let i = 0; i <= MAX_TOPOLOGY_DEPTH; i++) {
        const member = new Node(i + 1, 1, 1);
        const vessel = new Node(10000 + i, 1, 1);
        vessel.isClusterVessel = true;
        g.addNodeUnchecked(member);
        g.addNodeUnchecked(vessel);
        members.push(member);
        vessels.push(vessel);
      }
      for (let i = 0; i < members.length; i++) {
        const cluster = new Cluster({ Vessel: vessels[i], Nodes: [members[i]], Graph: g });
        members[i].Cluster = cluster;
        if (i + 1 < members.length) {
          vessels[i].Container = members[i + 1];
        }
        g.Clusters.set(vessels[i], cluster);
      }
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.effective_container_depth_exceeded.success);
      expect(res.error).toBe(oracle.scenarios.effective_container_depth_exceeded.error);
    });

    test("17. cluster_ancestry_cycle", () => {
      const g = new Graph();
      const a = g.addNode(new Node(1, 1, 1));
      const clA = new Cluster({ Vessel: a, Nodes: [], Graph: g });
      a.Cluster = clA;
      g.Clusters.set(a, clA);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.cluster_ancestry_cycle.success);
      expect(res.error).toBe(oracle.scenarios.cluster_ancestry_cycle.error);
    });

    test("18. cluster_ancestry_depth_exceeded", () => {
      const g = new Graph();
      const nodes = [];
      for (let i = 0; i <= MAX_TOPOLOGY_DEPTH; i++) {
        const node = new Node(i + 1, 1, 1);
        g.addNodeUnchecked(node);
        nodes.push(node);
      }
      for (let i = 0; i + 1 < nodes.length; i++) {
        const cluster = new Cluster({ Vessel: nodes[i + 1], Nodes: [], Graph: g });
        nodes[i].Cluster = cluster;
        g.Clusters.set(nodes[i + 1], cluster);
      }
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.cluster_ancestry_depth_exceeded.success);
      expect(res.error).toBe(oracle.scenarios.cluster_ancestry_depth_exceeded.error);
    });

    test("19. sequence_ancestry_cycle", () => {
      const g = new Graph();
      const a = g.addNode(new Node(1, 1, 1));
      const seqA = new Sequence({ Vessel: a, Nodes: [], Graph: g });
      a.Sequence = seqA;
      g.Sequences.set(a, seqA);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.sequence_ancestry_cycle.success);
      expect(res.error).toBe(oracle.scenarios.sequence_ancestry_cycle.error);
    });

    test("20. sequence_ancestry_depth_exceeded", () => {
      const g = new Graph();
      const nodes = [];
      for (let i = 0; i <= MAX_TOPOLOGY_DEPTH; i++) {
        const node = new Node(i + 1, 1, 1);
        g.addNodeUnchecked(node);
        nodes.push(node);
      }
      for (let i = 0; i + 1 < nodes.length; i++) {
        const seq = new Sequence({ Vessel: nodes[i + 1], Nodes: [], Graph: g });
        nodes[i].Sequence = seq;
        g.Sequences.set(nodes[i + 1], seq);
      }
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.sequence_ancestry_depth_exceeded.success);
      expect(res.error).toBe(oracle.scenarios.sequence_ancestry_depth_exceeded.error);
    });

    test("21. direct_container_descendant_cycle", () => {
      const g = new Graph();
      const a = new Node(1, 1, 1);
      a.isContainer = true;
      g.addNodeUnchecked(a);
      g.Containers.set(a, [a]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.direct_container_descendant_cycle.success);
      expect(res.error).toBe(oracle.scenarios.direct_container_descendant_cycle.error);
    });

    test("22. sequence_descendant_cycle", () => {
      const g = new Graph();
      const a = new Node(1, 1, 1);
      g.addNodeUnchecked(a);
      const seqA = new Sequence({ Vessel: a, Nodes: [a], Graph: g });
      g.Sequences.set(a, seqA);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.sequence_descendant_cycle.success);
      expect(res.error).toBe(oracle.scenarios.sequence_descendant_cycle.error);
    });

    test("23. descendant_depth_exceeded", () => {
      const g = new Graph();
      let parent = null;
      for (let i = 0; i <= MAX_TOPOLOGY_DEPTH; i++) {
        const node = new Node(i + 1, 1, 1);
        node.isContainer = true;
        g.addNodeUnchecked(node);
        g.Containers.set(parent, [node]);
        parent = node;
      }
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.descendant_depth_exceeded.success);
      expect(res.error).toBe(oracle.scenarios.descendant_depth_exceeded.error);
    });

    test("24. cluster_vessel_missing_record", () => {
      const g = new Graph();
      const v = g.addNode(new Node(1, 1, 1));
      v.isClusterVessel = true;
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.cluster_vessel_missing_record.success);
      expect(res.error).toBe(oracle.scenarios.cluster_vessel_missing_record.error);
    });

    test("25. tree_child_cycle", () => {
      const g = new Graph();
      const a = new Tree(g.addNode(new Node(1, 1, 1)));
      const b = new Tree(g.addNode(new Node(2, 1, 1)));
      a.Children = [b];
      b.Children = [a];
      g.Trees.set(null, [a]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.tree_child_cycle.success);
      expect(res.error).toBe(oracle.scenarios.tree_child_cycle.error);
    });

    test("26. tree_parent_cycle", () => {
      const g = new Graph();
      const a = new Tree(g.addNode(new Node(1, 1, 1)));
      const b = new Tree(g.addNode(new Node(2, 1, 1)));
      a.Parent = b;
      b.Parent = a;
      g.Trees.set(null, [a, b]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.tree_parent_cycle.success);
      expect(res.error).toBe(oracle.scenarios.tree_parent_cycle.error);
    });

    test("27. tree_depth_exceeded", () => {
      const g = new Graph();
      const root = new Tree(g.addNode(new Node(1, 1, 1)));
      let curr = root;
      for (let i = 1; i <= MAX_TOPOLOGY_DEPTH; i++) {
        const next = new Tree(g.addNode(new Node(i + 1, 1, 1)));
        next.Parent = curr;
        curr.Children = [next];
        curr = next;
      }
      g.Trees.set(null, [root]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.tree_depth_exceeded.success);
      expect(res.error).toBe(oracle.scenarios.tree_depth_exceeded.error);
    });

    test("28. same_tree_repeated_as_root", () => {
      const g = new Graph();
      const t = new Tree(g.addNode(new Node(1, 1, 1)));
      g.Trees.set(null, [t, t]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.same_tree_repeated_as_root.success);
      expect(res.error).toBe(oracle.scenarios.same_tree_repeated_as_root.error);
    });

    test("29. same_tree_repeated_beneath_same_parent", () => {
      const g = new Graph();
      const root = new Tree(g.addNode(new Node(1, 1, 1)));
      const child = new Tree(g.addNode(new Node(2, 1, 1)));
      child.Parent = root;
      root.Children = [child, child];
      g.Trees.set(null, [root]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.same_tree_repeated_beneath_same_parent.success);
      expect(res.error).toBe(oracle.scenarios.same_tree_repeated_beneath_same_parent.error);
    });

    test("30. tree_shared_by_multiple_parents (inconsistent child parent)", () => {
      const g = new Graph();
      const root1 = new Tree(g.addNode(new Node(1, 1, 1)));
      const root2 = new Tree(g.addNode(new Node(2, 1, 1)));
      const child = new Tree(g.addNode(new Node(3, 1, 1)));
      child.Parent = root1;
      root1.Children = [child];
      root2.Children = [child];
      g.Trees.set(null, [root1, root2]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.tree_shared_by_multiple_parents.success);
      expect(res.error).toBe(oracle.scenarios.tree_shared_by_multiple_parents.error);
    });

    test("31. same_node_owned_by_multiple_trees", () => {
      const g = new Graph();
      const sharedNode = g.addNode(new Node(1, 1, 1));
      const t1 = new Tree(sharedNode);
      const t2 = new Tree(sharedNode);
      g.Trees.set(null, [t1, t2]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.same_node_owned_by_multiple_trees.success);
      expect(res.error).toBe(oracle.scenarios.same_node_owned_by_multiple_trees.error);
    });

    test("32. inconsistent_child_parent", () => {
      const g = new Graph();
      const root = new Tree(g.addNode(new Node(1, 1, 1)));
      const child = new Tree(g.addNode(new Node(2, 1, 1)));
      child.Parent = null;
      root.Children = [child];
      g.Trees.set(null, [root]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.inconsistent_child_parent.success);
      expect(res.error).toBe(oracle.scenarios.inconsistent_child_parent.error);
    });

    test("33. root_also_has_installed_parent", () => {
      const g = new Graph();
      const p = new Tree(g.addNode(new Node(1, 1, 1)));
      const r = new Tree(g.addNode(new Node(2, 1, 1)));
      r.Parent = p;
      g.Trees.set(null, [p, r]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.root_also_has_installed_parent.success);
      expect(res.error).toBe(oracle.scenarios.root_also_has_installed_parent.error);
    });

    test("34. placement_wrapper_occurrence_mismatch", () => {
      const g = new Graph();
      const wrapper = new Tree(new Node(99, 1, 1));
      wrapper.Children = [];
      const root = new Tree(g.addNode(new Node(1, 1, 1)));
      root.Parent = wrapper;
      g.Trees.set(null, [root]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.placement_wrapper_occurrence_mismatch.success);
      expect(res.error).toBe(oracle.scenarios.placement_wrapper_occurrence_mismatch.error);
    });

    test("35. node_to_tree_alias_does_not_match_node", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      const t = new Tree(n2);
      g.Trees.set(null, [t]);
      g.NodeToTree.set(n1, t);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.node_to_tree_alias_does_not_match_node.success);
      expect(res.error).toBe(oracle.scenarios.node_to_tree_alias_does_not_match_node.error);
    });

    test("36. node_to_tree_alias_outside_installed_forest", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      const t1 = new Tree(n1);
      const t2 = new Tree(n2);
      g.Trees.set(null, [t1]);
      g.NodeToTree.set(n2, t2);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.node_to_tree_alias_outside_installed_forest.success);
      expect(res.error).toBe(oracle.scenarios.node_to_tree_alias_outside_installed_forest.error);
    });

    test("37. node_to_tree_aliases_do_not_cover_installed_forest", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      const t1 = new Tree(n1);
      const t2 = new Tree(n2);
      g.Trees.set(null, [t1, t2]);
      g.NodeToTree.set(n1, t1);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.node_to_tree_aliases_do_not_cover_installed_forest.success);
      expect(res.error).toBe(oracle.scenarios.node_to_tree_aliases_do_not_cover_installed_forest.error);
    });

    test("38. canceled_context", () => {
      const controller = new AbortController();
      controller.abort();
      const g = new Graph();
      const res = runScenario(() => Validate(controller.signal, "AddSequences", g));
      expect(res.success).toBe(oracle.scenarios.canceled_context.success);
      expect(res.error).toBe(oracle.scenarios.canceled_context.error);
    });

    test("39. rdfs_canonical_fixture", () => {
      const g = new Graph();

      function makeNodes(start, count) {
        const res = [];
        for (let i = 0; i < count; i++) {
          res.push(new Node(start + i, 1, 1));
        }
        return res;
      }

      const ns = makeNodes(1, 10);
      for (const n of ns) {
        g.addNode(n);
      }

      function addToContainers(targetGraph, nodeList) {
        const rootList = targetGraph.Containers.get(null) || [];
        rootList.push(nodeList[0]);
        targetGraph.Containers.set(null, rootList);

        targetGraph.Containers.set(nodeList[0], [nodeList[1], nodeList[2]]);
        targetGraph.Containers.set(nodeList[1], [nodeList[3]]);
        targetGraph.Containers.set(nodeList[3], [nodeList[5]]);
        targetGraph.Containers.set(nodeList[5], [nodeList[7]]);
        targetGraph.Containers.set(nodeList[2], [nodeList[4]]);
        targetGraph.Containers.set(nodeList[4], [nodeList[6], nodeList[8]]);
        targetGraph.Containers.set(nodeList[8], [nodeList[9]]);

        for (const [container, children] of targetGraph.Containers.entries()) {
          for (const child of children) {
            child.Container = container;
          }
          if (container !== null) {
            container.isContainer = true;
          }
        }
      }

      const ns2 = makeNodes(11, 10);
      const cl = new Cluster({ Vessel: ns2[0], Nodes: ns2.slice(1), Graph: g });
      g.Clusters.set(ns2[0], cl);
      ns2[0].isClusterVessel = true;
      for (const n of cl.Nodes) {
        g.addNode(n);
      }

      addToContainers(g, ns);
      addToContainers(g, ns2);

      const guard = new WorkGuard(ctx, "TestGraphRDFSOrder", MAX_ENGINE_WORK_UNITS);
      const orderNodes = g.ContainerRDFSOrder(null, guard);
      const ids = orderNodes.map((n) => Number(n.ID));

      expect(ids).toEqual(oracle.scenarios.rdfs_canonical_fixture.order);
      expect(Number(guard.Used())).toBe(oracle.scenarios.rdfs_canonical_fixture.used);
    });

    test("40. rdfs_guarded_accounting and exact-limit behavior", () => {
      const g = new Graph();
      const c1 = g.addNode(new Node(1, 10, 10));
      c1.isContainer = true;
      const c2 = g.addNode(new Node(2, 10, 10));
      c2.isContainer = true;
      const leaf1 = g.addNode(new Node(3, 10, 10));

      const clVessel = g.addNode(new Node(4, 10, 10));
      clVessel.isClusterVessel = true;
      const c3 = g.addNode(new Node(5, 10, 10));
      c3.isContainer = true;
      const leaf2 = g.addNode(new Node(6, 10, 10));
      const leaf3 = g.addNode(new Node(7, 10, 10));

      const cl = new Cluster({ Vessel: clVessel, Nodes: [c3, leaf2], Graph: g });
      g.Clusters.set(clVessel, cl);

      g.Containers.set(null, [c1, clVessel]);
      g.Containers.set(c1, [c2]);
      g.Containers.set(c2, [leaf1]);
      g.Containers.set(c3, [leaf3]);

      const probeGuard = new WorkGuard(ctx, "probe", MAX_ENGINE_WORK_UNITS);
      const measuredOrder = g.ContainerRDFSOrder(null, probeGuard);
      const measuredIds = measuredOrder.map((n) => Number(n.ID));
      const requiredUnits = probeGuard.Used();

      expect(measuredIds).toEqual(oracle.scenarios.rdfs_guarded_accounting.order);
      expect(Number(requiredUnits)).toBe(oracle.scenarios.rdfs_guarded_accounting.requiredUnits);

      // Exact limit succeeds
      const exactGuard = new WorkGuard(ctx, "exact", requiredUnits);
      expect(() => g.ContainerRDFSOrder(null, exactGuard)).not.toThrow();

      // One below limit fails with WorkLimitError matching Go
      const oneBelowGuard = new WorkGuard(ctx, "one_below", requiredUnits - 1n);
      expect(() => g.ContainerRDFSOrder(null, oneBelowGuard)).toThrow(
        oracle.scenarios.rdfs_guarded_accounting.belowLimitErrorMsg
      );
    });

    test("41. tree_shared_by_multiple_parents_explicit", () => {
      const g = new Graph();
      const p = new Tree(g.addNode(new Node(1, 1, 1)));
      const child = new Tree(g.addNode(new Node(2, 1, 1)));
      child.Parent = p;
      p.Children = [child];
      g.Trees.set(null, [child, p]);
      const res = runScenario(() => Validate(ctx, "test", g));
      expect(res.success).toBe(oracle.scenarios.tree_shared_by_multiple_parents_explicit.success);
      expect(res.error).toBe(oracle.scenarios.tree_shared_by_multiple_parents_explicit.error);
    });

    test("42. rdfs_nil_guard_non_container_root", () => {
      const g = new Graph();
      const leaf = g.addNode(new Node(1, 1, 1));
      let order = null;
      const res = runScenario(() => {
        order = g.ContainerRDFSOrder(leaf, null);
      });
      expect(res.success).toBe(oracle.scenarios.rdfs_nil_guard_non_container_root.success);
      expect(order.map((n) => Number(n.ID))).toEqual(oracle.scenarios.rdfs_nil_guard_non_container_root.order);
      expect(res.error).toBe(oracle.scenarios.rdfs_nil_guard_non_container_root.error);
    });

    test("43. rdfs_nil_guard_empty_root", () => {
      const g = new Graph();
      let order = null;
      const res = runScenario(() => {
        order = g.ContainerRDFSOrder(null, null);
      });
      expect(res.success).toBe(oracle.scenarios.rdfs_nil_guard_empty_root.success);
      expect(order.map((n) => Number(n.ID))).toEqual(oracle.scenarios.rdfs_nil_guard_empty_root.order);
      expect(res.error).toBe(oracle.scenarios.rdfs_nil_guard_empty_root.error);
    });

    test("44. large_repeated_references", () => {
      const g = new Graph();
      const child = g.addNode(new Node(1, 1, 1));
      const count = 200000;
      const children = new Array(count);
      children.fill(child);
      g.Containers.set(null, children);
      const res = runScenario(() => Validate(ctx, "largeRepeated", g));
      expect(res.success).toBe(oracle.scenarios.large_repeated_references.success);
      expect(res.error).toBe(oracle.scenarios.large_repeated_references.error);
    });
  });
});
