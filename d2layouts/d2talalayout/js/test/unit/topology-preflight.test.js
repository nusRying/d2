import { describe, expect, test } from "bun:test";

import {
  Graph,
  Node,
  Edge,
  Tree,
  Cluster,
  Sequence,
  HerdAssignment,
  Hierarchy,
  Point,
  Validate,
  validateEngineGraph,
  validateNodeParentRelation,
  ancestryParent,
  WorkGuard,
  WorkLimitError,
  WorkCanceledError,
  backgroundWorkContext,
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_TOPOLOGY_REFERENCES,
  MAX_ROUTE_POINTS,
  MAX_TOPOLOGY_DEPTH,
  MAX_ENGINE_WORK_UNITS,
  MAX_PREFLIGHT_WORK,
} from "../../src/index.js";

describe("Slice 10 Topology Preflight Unit Tests", () => {
  const ctx = backgroundWorkContext();

  describe("Error Ordering and Context Requirements", () => {
    test("rejects nil graph before checking context", () => {
      expect(() => Validate(null, "AddSequences", null)).toThrow(
        "TALA engine requires a graph"
      );
    });

    test("validates context when graph is non-null", () => {
      const g = new Graph();
      expect(() => Validate(null, "AddSequences", g)).toThrow(
        "TALA AddSequences requires a context"
      );
    });

    test("accepts valid empty graph with background context", () => {
      const g = new Graph();
      expect(() => Validate(ctx, "test", g)).not.toThrow();
    });
  });

  describe("Null vs Empty Collection Semantics", () => {
    test("handles null collections across all Graph fields without allocating", () => {
      const g = new Graph();
      g.Nodes = null;
      g.Edges = null;
      g.Containers = null;
      g.Clusters = null;
      g.Sequences = null;
      g.Trees = null;
      g.NodeToTree = null;
      g.Hubs = null;
      g.Directions = null;
      g.CommonUncleSiblings = null;

      expect(() => Validate(ctx, "test", g)).not.toThrow();
      expect(g.Nodes).toBeNull();
      expect(g.Edges).toBeNull();
      expect(g.Containers).toBeNull();
    });

    test("handles null collections on Node without allocating or mutating", () => {
      const g = new Graph();
      const node = new Node(1, 10, 10);
      node.Edges = null;
      node.Nears = null;
      node.LongDistanceNeighborRequirements = null;
      node.Cluster = null;
      node.Sequence = null;
      node.HerdAssignment = null;
      node.Hierarchy = null;
      g.addNode(node);

      expect(() => Validate(ctx, "test", g)).not.toThrow();
      expect(node.Edges).toBeNull();
      expect(node.Nears).toBeNull();
    });

    test("inspects raw Hierarchy without calling Levels() or allocating levels map", () => {
      const g = new Graph();
      const node = g.addNode(new Node(1, 10, 10));
      const hierarchy = new Hierarchy();
      hierarchy.levels = null; // raw field is null
      node.Hierarchy = hierarchy;

      expect(() => Validate(ctx, "test", g)).not.toThrow();
      expect(hierarchy.levels).toBeNull();
    });
  });

  describe("Identity and Unique Entity Limits", () => {
    test("enforces unique node count limit 10,000 on hidden nodes", () => {
      const g = new Graph();
      const hidden = [];
      for (let i = 0; i <= MAX_ENGINE_NODES; i++) {
        hidden.push(new Node(i + 1, 1, 1));
      }
      g.Containers.set(null, hidden);

      expect(() => Validate(ctx, "test", g)).toThrow(
        `TALA engine unique node count exceeds limit ${MAX_ENGINE_NODES}`
      );
    });

    test("enforces unique edge count limit 50,000", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      const edges = [];
      for (let i = 0; i <= MAX_ENGINE_EDGES; i++) {
        const e = new Edge(n1, n2);
        e.ID = BigInt(i + 1);
        edges.push(e);
      }
      g.Edges = edges;

      expect(() => Validate(ctx, "test", g)).toThrow(
        `TALA engine unique edge count exceeds limit ${MAX_ENGINE_EDGES}`
      );
    });

    test("object identity deduplication allows repeated references to same Node/Edge", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      const e = g.connect(n1, n2);
      // Repeatedly list same nodes and edges in containers, hubs, nears
      g.Containers.set(null, [n1, n2, n1, n2]);
      n1.Edges = [e, e, e];
      n1.Nears.add(n2);
      n2.Nears.add(n1);

      expect(() => Validate(ctx, "test", g)).not.toThrow();
    });
  });

  describe("Route Point Limits", () => {
    test("enforces visible route-point limit across edges", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      const e = g.connect(n1, n2);

      const sharedPt = new Point(0, 0);
      e.Points = new Array(MAX_ROUTE_POINTS + 1).fill(sharedPt);

      expect(() => Validate(ctx, "test", g)).toThrow(
        `TALA engine route point count exceeds limit ${MAX_ROUTE_POINTS}`
      );
    });
  });

  describe("Topology References Limit", () => {
    test("enforces MAX_TOPOLOGY_REFERENCES limit 1,000,000", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      // Create a container with 1,000,001 repeated references to n2
      const children = new Array(MAX_TOPOLOGY_REFERENCES + 1).fill(n2);
      g.Containers.set(n1, children);
      n1.isContainer = true;

      expect(() => Validate(ctx, "test", g)).toThrow(
        `TALA engine topology references exceed limit ${MAX_TOPOLOGY_REFERENCES} while visiting container child`
      );
    });
  });

  describe("Parent-Chain and Ancestry Validation", () => {
    test("ancestryParent precedence matches Container -> Cluster.Vessel -> Sequence.Vessel -> null", () => {
      const parent = new Node(1, 1, 1);
      const vesselCluster = new Node(2, 1, 1);
      const vesselSeq = new Node(3, 1, 1);

      const n = new Node(4, 1, 1);
      expect(ancestryParent(n)).toBeNull();

      n.Sequence = new Sequence({ Vessel: vesselSeq });
      expect(ancestryParent(n)).toBe(vesselSeq);

      n.Cluster = new Cluster({ Vessel: vesselCluster });
      expect(ancestryParent(n)).toBe(vesselCluster);

      n.Container = parent;
      expect(ancestryParent(n)).toBe(parent);
    });

    test("ancestryParent does not require group activity", () => {
      const vessel = new Node(1, 1, 1);
      const cl = new Cluster({ Vessel: vessel });
      // Inactive cluster (no active flag / not part of layout)
      const n = new Node(2, 1, 1);
      n.Cluster = cl;
      expect(ancestryParent(n)).toBe(vessel);
    });

    test("detects multi-node container parent cycle", () => {
      const g = new Graph();
      const a = g.addNode(new Node(1, 1, 1));
      const b = g.addNode(new Node(2, 1, 1));
      const c = g.addNode(new Node(3, 1, 1));
      a.Container = b;
      b.Container = c;
      c.Container = a;

      expect(() => Validate(ctx, "test", g)).toThrow(
        /TALA engine container parent cycle detected at node/
      );
    });
  });

  describe("Descendant Graph Validation", () => {
    test("detects 3-node descendant cycle through containers", () => {
      const g = new Graph();
      const a = g.addNode(new Node(1, 1, 1));
      const b = g.addNode(new Node(2, 1, 1));
      const c = g.addNode(new Node(3, 1, 1));
      a.isContainer = true;
      b.isContainer = true;
      c.isContainer = true;
      g.Containers.set(a, [b]);
      g.Containers.set(b, [c]);
      g.Containers.set(c, [a]);

      expect(() => Validate(ctx, "test", g)).toThrow(
        /TALA engine descendant cycle detected at node/
      );
    });

    test("detects descendant cycle through Cluster vessel nodes", () => {
      const g = new Graph();
      const vessel = g.addNode(new Node(1, 1, 1));
      vessel.isClusterVessel = true;
      const member = g.addNode(new Node(2, 1, 1));
      member.isContainer = true;
      const cl = new Cluster({ Vessel: vessel, Nodes: [member], Graph: g });
      g.Clusters.set(vessel, cl);
      g.Containers.set(member, [vessel]); // member contains vessel -> cycle!

      expect(() => Validate(ctx, "test", g)).toThrow(
        /TALA engine descendant cycle detected at node/
      );
    });
  });

  describe("Tree Forest Ownership and NodeToTree", () => {
    test("detects Tree child cycle of length 3", () => {
      const g = new Graph();
      const t1 = new Tree(g.addNode(new Node(1, 1, 1)));
      const t2 = new Tree(g.addNode(new Node(2, 1, 1)));
      const t3 = new Tree(g.addNode(new Node(3, 1, 1)));
      t1.Children = [t2];
      t2.Children = [t3];
      t3.Children = [t1];
      g.Trees.set(null, [t1]);

      expect(() => Validate(ctx, "test", g)).toThrow(
        "TALA engine tree child cycle detected"
      );
    });

    test("allows placement-only wrapper parent if root appears exactly once", () => {
      const g = new Graph();
      const rootNode = g.addNode(new Node(1, 1, 1));
      const wrapperNode = new Node(99, 1, 1);
      const rootTree = new Tree(rootNode);
      const wrapperTree = new Tree(wrapperNode);
      wrapperTree.Children = [rootTree]; // root appears exactly once in wrapper
      rootTree.Parent = wrapperTree;
      g.Trees.set(null, [rootTree]);

      expect(() => Validate(ctx, "test", g)).not.toThrow();
    });

    test("rejects placement parent if root appears multiple times", () => {
      const g = new Graph();
      const rootNode = g.addNode(new Node(1, 1, 1));
      const wrapperNode = new Node(99, 1, 1);
      const rootTree = new Tree(rootNode);
      const wrapperTree = new Tree(wrapperNode);
      wrapperTree.Children = [rootTree, rootTree]; // root appears twice!
      rootTree.Parent = wrapperTree;
      g.Trees.set(null, [rootTree]);

      expect(() => Validate(ctx, "test", g)).toThrow(
        "TALA engine tree root has an inconsistent placement parent"
      );
    });

    test("validates complete and matching NodeToTree coverage", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 1, 1));
      const n2 = g.addNode(new Node(2, 1, 1));
      const t1 = new Tree(n1);
      const t2 = new Tree(n2);
      g.Trees.set(null, [t1, t2]);
      g.NodeToTree.set(n1, t1);
      g.NodeToTree.set(n2, t2);

      expect(() => Validate(ctx, "test", g)).not.toThrow();
    });
  });

  describe("Guarded Container RDFS Order and Non-Mutation Guarantee", () => {
    test("ContainerRDFSOrder returns [] when root is non-null and not a container without charging work", () => {
      const g = new Graph();
      const leaf = g.addNode(new Node(1, 1, 1));
      leaf.isContainer = false;

      const guard = new WorkGuard(ctx, "test", 100n);
      const order = g.ContainerRDFSOrder(leaf, guard);

      expect(order).toEqual([]);
      expect(Number(guard.Used())).toBe(0);
    });

    test("ContainerRDFSOrder with nil guard returns [] on non-container root", () => {
      const g = new Graph();
      const leaf = new Node(1, 1, 1);
      g.addNode(leaf);
      const order = g.ContainerRDFSOrder(leaf, null);
      expect(order).toEqual([]);
    });

    test("ContainerRDFSOrder with nil guard returns [] on empty root", () => {
      const g = new Graph();
      const order = g.ContainerRDFSOrder(null, null);
      expect(order).toEqual([]);
    });

    test("Validate succeeds with large repeated references (200,000 children)", () => {
      const g = new Graph();
      const child = g.addNode(new Node(1, 1, 1));
      const children = new Array(200_000);
      children.fill(child);
      g.Containers.set(null, children);

      expect(() => Validate(ctx, "largeRepeated", g)).not.toThrow();
    });

    test("ContainerRDFSOrderUnbounded runs without guard", () => {
      const g = new Graph();
      const c = g.addNode(new Node(1, 1, 1));
      c.isContainer = true;
      g.Containers.set(null, [c]);

      const order = g.ContainerRDFSOrderUnbounded(null);
      expect(order).toEqual([c]);
    });

    test("ContainerRDFSOrderUnbounded succeeds with large nested containers (200,000 descendants)", () => {
      const g = new Graph();
      const parent = g.addNode(new Node(1, 1, 1));
      parent.isContainer = true;

      const count = 200_000;
      const child = g.addNode(new Node(2, 1, 1));
      child.isContainer = true;

      const children = new Array(count);
      children.fill(child);
      g.Containers.set(parent, children);
      g.Containers.set(null, [parent]);

      const order = g.ContainerRDFSOrderUnbounded(null);
      expect(order.length).toBe(count + 1);
      expect(order[order.length - 1]).toBe(parent);
    });

    test("Validate does not mutate graph, nodes, edges, or collections", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 10, 10));
      const n2 = g.addNode(new Node(2, 10, 10));
      const e = g.connect(n1, n2);
      e.Points = [new Point(0, 0), new Point(10, 10)];

      const nodesRef = g.Nodes;
      const edgesRef = g.Edges;
      const containersRef = g.Containers;
      const n1Box = n1.Box;
      const ePointsRef = e.Points;

      Validate(ctx, "test", g);

      expect(g.Nodes).toBe(nodesRef);
      expect(g.Edges).toBe(edgesRef);
      expect(g.Containers).toBe(containersRef);
      expect(n1.Box).toBe(n1Box);
      expect(e.Points).toBe(ePointsRef);
      expect(n1.Container).toBeNull();
    });

    test("Validate failure is completely read-only", () => {
      const g = new Graph();
      const n1 = g.addNode(new Node(1, 10, 10));
      n1.Container = n1; // cycle error

      const nodesRef = g.Nodes;
      const containersRef = g.Containers;

      expect(() => Validate(ctx, "test", g)).toThrow();

      expect(g.Nodes).toBe(nodesRef);
      expect(g.Containers).toBe(containersRef);
      expect(n1.Container).toBe(n1);
    });

    test("ContainerRDFSOrder failure due to work limit is completely read-only", () => {
      const g = new Graph();
      const c1 = g.addNode(new Node(1, 10, 10));
      c1.isContainer = true;
      const c2 = g.addNode(new Node(2, 10, 10));
      c2.isContainer = true;
      g.Containers.set(null, [c1]);
      g.Containers.set(c1, [c2]);

      const nodesRef = g.Nodes;
      const containersRef = g.Containers;
      const rootList = g.Containers.get(null);
      const c1List = g.Containers.get(c1);

      const guard = new WorkGuard(ctx, "tight_limit", 1n); // limit 1 will fail on nested container
      expect(() => g.ContainerRDFSOrder(null, guard)).toThrow(WorkLimitError);

      expect(g.Nodes).toBe(nodesRef);
      expect(g.Containers).toBe(containersRef);
      expect(g.Containers.get(null)).toBe(rootList);
      expect(g.Containers.get(c1)).toBe(c1List);
      expect(rootList).toEqual([c1]);
      expect(c1List).toEqual([c2]);
    });

    test("Validate cancellation error is thrown without mutating graph", () => {
      const controller = new AbortController();
      controller.abort();

      const g = new Graph();
      const n1 = g.addNode(new Node(1, 10, 10));
      const nodesRef = g.Nodes;

      expect(() => Validate(controller.signal, "CancelOp", g)).toThrow(
        "CancelOp: context canceled"
      );
      expect(g.Nodes).toBe(nodesRef);
    });
  });
});
