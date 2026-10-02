import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Point } from "../../src/geometry/point.js";
import { BackgroundWorkContext } from "../../src/index.js";
import { initializeByGraphDistance } from "../../src/placement/stress-initialize.js";
import * as placementBarrel from "../../src/placement/index.js";
import * as rootBarrel from "../../src/index.js";

function buildPathGraph(n) {
  const g = new Graph();
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const node = new Node(BigInt(i + 1));
    node.Graph = g;
    nodes.push(node);
    g.Nodes.push(node);
  }
  for (let i = 0; i < n - 1; i++) {
    const edge = new Edge(nodes[i], nodes[i + 1]);
    edge.Graph = g;
    g.Edges.push(edge);
    nodes[i].Edges.push(edge);
    nodes[i + 1].Edges.push(edge);
  }
  return { g, nodes };
}

describe("initializeByGraphDistance Direct Tests", () => {
  it("rejects graphs with fewer than 4 nodes without mutation", () => {
    const { g, nodes } = buildPathGraph(3);
    const ctx = BackgroundWorkContext();
    const result = initializeByGraphDistance(ctx, g);
    expect(result).toBe(false);
    for (const node of nodes) {
      expect(node.TopLeft).toBeNull();
    }
  });

  it("rejects graphs with more than 64 nodes without mutation", () => {
    const { g, nodes } = buildPathGraph(65);
    const ctx = BackgroundWorkContext();
    const result = initializeByGraphDistance(ctx, g);
    expect(result).toBe(false);
    for (const node of nodes) {
      expect(node.TopLeft).toBeNull();
    }
  });

  it("accepts graphs at boundary sizes 4 and 64", () => {
    const g4 = buildPathGraph(4).g;
    const ctx4 = BackgroundWorkContext();
    expect(initializeByGraphDistance(ctx4, g4)).toBe(true);
    for (const node of g4.Nodes) {
      expect(node.TopLeft).not.toBeNull();
    }

    const g64 = buildPathGraph(64).g;
    const ctx64 = BackgroundWorkContext();
    expect(initializeByGraphDistance(ctx64, g64)).toBe(true);
    for (const node of g64.Nodes) {
      expect(node.TopLeft).not.toBeNull();
    }
  });

  it("rejects graphs with fixed nodes without mutation", () => {
    const { g, nodes } = buildPathGraph(4);
    nodes[0].FixedTopLeft = new Point(10, 20);
    const ctx = BackgroundWorkContext();
    const result = initializeByGraphDistance(ctx, g);
    expect(result).toBe(false);
    expect(nodes[0].TopLeft).toBeNull();
    expect(nodes[1].TopLeft).toBeNull();
  });

  it("rejects disconnected graphs where shortest-path distance is infinite", () => {
    const g = new Graph();
    // Two disconnected 2-node components (total 4 nodes)
    const n1 = new Node(1n);
    const n2 = new Node(2n);
    const n3 = new Node(3n);
    const n4 = new Node(4n);
    for (const n of [n1, n2, n3, n4]) {
      n.Graph = g;
      g.Nodes.push(n);
    }
    const e1 = new Edge(n1, n2);
    e1.Graph = g;
    g.Edges.push(e1);
    n1.Edges.push(e1);
    n2.Edges.push(e1);

    const e2 = new Edge(n3, n4);
    e2.Graph = g;
    g.Edges.push(e2);
    n3.Edges.push(e2);
    n4.Edges.push(e2);

    const ctx = BackgroundWorkContext();
    const result = initializeByGraphDistance(ctx, g);
    expect(result).toBe(false);
    for (const n of [n1, n2, n3, n4]) {
      expect(n.TopLeft).toBeNull();
    }
  });

  it("successfully assigns integer coordinates and unique cells", () => {
    const { g, nodes } = buildPathGraph(5);
    const ctx = BackgroundWorkContext();
    const result = initializeByGraphDistance(ctx, g);
    expect(result).toBe(true);

    const occupied = new Set();
    for (const node of nodes) {
      expect(node.TopLeft).not.toBeNull();
      expect(Number.isInteger(node.TopLeft.X)).toBe(true);
      expect(Number.isInteger(node.TopLeft.Y)).toBe(true);
      const key = `${node.TopLeft.X},${node.TopLeft.Y}`;
      expect(occupied.has(key)).toBe(false);
      occupied.add(key);
    }
  });

  it("is deterministic across repeated invocations on identical graphs", () => {
    const { g: g1, nodes: nodes1 } = buildPathGraph(6);
    const { g: g2, nodes: nodes2 } = buildPathGraph(6);

    initializeByGraphDistance(BackgroundWorkContext(), g1);
    initializeByGraphDistance(BackgroundWorkContext(), g2);

    for (let i = 0; i < 6; i++) {
      expect(nodes1[i].TopLeft.X).toBe(nodes2[i].TopLeft.X);
      expect(nodes1[i].TopLeft.Y).toBe(nodes2[i].TopLeft.Y);
    }
  });

  it("preserves prior geometry atomically when cancelled", () => {
    const { g, nodes } = buildPathGraph(5);
    const priorPoint = new Point(999, 888);
    nodes[0].TopLeft = priorPoint;

    // Cancellation at step 4
    class CountingCtx {
      constructor(cancelAt) {
        this.cancelAt = cancelAt;
        this.checks = 0;
      }
      isCancelled() {
        this.checks++;
        return this.checks >= this.cancelAt;
      }
    }

    const ctx = new CountingCtx(4);

    expect(() => initializeByGraphDistance(ctx, g)).toThrow();
    // Prior TopLeft identity and coordinates must be preserved
    expect(nodes[0].TopLeft).toBe(priorPoint);
    expect(nodes[0].TopLeft.X).toBe(999);
    expect(nodes[0].TopLeft.Y).toBe(888);
    // Other nodes must not be assigned
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i].TopLeft).toBeNull();
    }
  });

  it("throws exact 'context canceled' at assignment-stage cancellation and preserves geometry", () => {
    const { g, nodes } = buildPathGraph(6);
    const priorPoint = new Point(123, 456);
    nodes[0].TopLeft = priorPoint;

    class CountingCtx {
      constructor(cancelAt) {
        this.cancelAt = cancelAt;
        this.checks = 0;
      }
      isCancelled() {
        this.checks++;
        return this.checks >= this.cancelAt;
      }
    }

    // Cancel during cell assignment (after Floyd-Warshall + relaxation)
    const ctx = new CountingCtx(56);
    let caught = null;
    try {
      initializeByGraphDistance(ctx, g);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toBe("context canceled");
    expect(nodes[0].TopLeft).toBe(priorPoint);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i].TopLeft).toBeNull();
    }
  });

  it("throws exact 'context canceled' at final cancellation check and preserves geometry", () => {
    const { g, nodes } = buildPathGraph(6);
    const priorPoint = new Point(123, 456);
    nodes[0].TopLeft = priorPoint;

    class CountingCtx {
      constructor(cancelAt) {
        this.cancelAt = cancelAt;
        this.checks = 0;
      }
      isCancelled() {
        this.checks++;
        return this.checks >= this.cancelAt;
      }
    }

    // Cancel at final check (after all cells assigned, before commit)
    const ctx = new CountingCtx(62);
    let caught = null;
    try {
      initializeByGraphDistance(ctx, g);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.message).toBe("context canceled");
    expect(nodes[0].TopLeft).toBe(priorPoint);
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i].TopLeft).toBeNull();
    }
  });

  it("is not exposed in placement or root barrels", () => {
    expect(placementBarrel.initializeByGraphDistance).toBeUndefined();
    expect(rootBarrel.initializeByGraphDistance).toBeUndefined();
  });
});
