import { describe, it, expect } from "bun:test";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Graph } from "../../src/graph/graph.js";
import { EdgeAbduction } from "../../src/graph/edge-abduction.js";
import { Sequence } from "../../src/graph/sequence.js";
import { Cluster, ClusterArrangement, flipArrangement } from "../../src/graph/cluster.js";
import { Tree, newTree, NewTree } from "../../src/graph/tree.js";

describe("Group Model Unit Tests", () => {
  describe("EdgeAbduction", () => {
    it("should initialize default null fields", () => {
      const ea = new EdgeAbduction();
      expect(ea.Edge).toBeNull();
      expect(ea.OriginallyFrom).toBeNull();
      expect(ea.OriginallyTo).toBeNull();
      expect(ea.CurrentFrom).toBeNull();
      expect(ea.CurrentTo).toBeNull();
    });

    it("should initialize fields passed via constructor", () => {
      const n1 = new Node(1n);
      const n2 = new Node(2n);
      const edge = new Edge(n1, n2);
      const ea = new EdgeAbduction({
        Edge: edge,
        OriginallyFrom: n1,
        OriginallyTo: n2,
        CurrentFrom: n1,
        CurrentTo: n2,
      });
      expect(ea.Edge).toBe(edge);
      expect(ea.OriginallyFrom).toBe(n1);
      expect(ea.OriginallyTo).toBe(n2);
      expect(ea.CurrentFrom).toBe(n1);
      expect(ea.CurrentTo).toBe(n2);
    });
  });

  describe("Sequence", () => {
    it("should report active state based on Vessel.Graph", () => {
      const g = new Graph();
      const vessel = new Node(10n);
      const s1 = new Node(11n);
      const s2 = new Node(12n);

      const seq = new Sequence({
        Vessel: vessel,
        Nodes: [s1, s2],
      });

      // Vessel has no Graph -> inactive
      expect(seq.isActive()).toBe(false);
      expect(seq.IsActive()).toBe(false);

      // Add vessel to graph
      g.addNodeUnchecked(vessel);
      expect(seq.isActive()).toBe(true);
      expect(seq.IsActive()).toBe(true);

      // Detach vessel from graph
      vessel.Graph = null;
      expect(seq.isActive()).toBe(false);
    });

    it("should return first and last nodes safely", () => {
      const emptySeq = new Sequence();
      expect(emptySeq.first()).toBeNull();
      expect(emptySeq.First()).toBeNull();
      expect(emptySeq.last()).toBeNull();
      expect(emptySeq.Last()).toBeNull();

      const n1 = new Node(1n);
      const n2 = new Node(2n);
      const n3 = new Node(3n);
      const seq = new Sequence({ Nodes: [n1, n2, n3] });

      expect(seq.first()).toBe(n1);
      expect(seq.First()).toBe(n1);
      expect(seq.last()).toBe(n3);
      expect(seq.Last()).toBe(n3);
    });
  });

  describe("Cluster", () => {
    it("should flip arrangement matching Go semantics", () => {
      expect(flipArrangement(ClusterArrangement.Row)).toBe(ClusterArrangement.Column);
      expect(flipArrangement(ClusterArrangement.Column)).toBe(ClusterArrangement.Row);
      expect(flipArrangement("InvalidOrUnknown")).toBe(ClusterArrangement.Row);

      const cluster = new Cluster({ Arrangement: ClusterArrangement.Row });
      expect(cluster.Arrangement).toBe(ClusterArrangement.Row);

      cluster.flip();
      expect(cluster.Arrangement).toBe(ClusterArrangement.Column);

      cluster.Flip();
      expect(cluster.Arrangement).toBe(ClusterArrangement.Row);
    });

    it("should report active state based on Vessel.Graph", () => {
      const g = new Graph();
      const vessel = new Node(20n);
      vessel.setClusterVessel(true);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [new Node(21n)],
      });

      expect(cluster.isActive()).toBe(false);
      expect(cluster.IsActive()).toBe(false);

      g.addNodeUnchecked(vessel);
      expect(cluster.isActive()).toBe(true);
      expect(cluster.IsActive()).toBe(true);
    });
  });

  describe("Tree", () => {
    it("should initialize tree node and empty children", () => {
      const n = new Node(30n);
      const t1 = newTree(n);
      const t2 = NewTree(n);

      expect(t1.Node).toBe(n);
      expect(t1.Parent).toBeNull();
      expect(t1.Children).toEqual([]);
      expect(t1.SentinelEdge).toBeNull();

      expect(t2.Node).toBe(n);
      expect(t2.Children).toEqual([]);
    });

    it("should resolve sentinelNode strictly based on endpoint equality", () => {
      const nRoot = new Node(100n);
      const nSentinel = new Node(101n);
      const tree = new Tree(nRoot);

      expect(tree.sentinelNode()).toBeNull();

      // Edge from nRoot to nSentinel
      const edgeFwd = new Edge(nRoot, nSentinel);
      tree.SentinelEdge = edgeFwd;

      expect(tree.isSentinelEdgeSource()).toBe(true);
      expect(tree.IsSentinelEdgeSource()).toBe(true);
      expect(tree.sentinelNode()).toBe(nSentinel);
      expect(tree.SentinelNode()).toBe(nSentinel);

      // Edge from nSentinel to nRoot (reversed)
      const edgeRev = new Edge(nSentinel, nRoot);
      tree.SentinelEdge = edgeRev;

      expect(tree.isSentinelEdgeSource()).toBe(false);
      expect(tree.sentinelNode()).toBe(nSentinel);
    });
  });
});
