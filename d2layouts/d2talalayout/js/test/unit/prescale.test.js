import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Label } from "../../src/graph/label.js";
import { Point } from "../../src/geometry/point.js";
import { prescale, Prescale, talaFontSizes } from "../../src/placement/prescale.js";
import { elkToTalaGraph, talaToElkGraph } from "../../src/elk/adapter.js";

describe("Prescale Focused Unit Tests", () => {
  it("should provide an immutable font scale from talaFontSizes()", () => {
    const a = talaFontSizes();
    expect(a).toEqual([13, 14, 16, 20, 24, 28, 32]);
    a[0] = 999;
    expect(talaFontSizes()[0]).toBe(13);
  });

  it("should normalize AspectRatio1 before skipping on early return (e.g. FixedTopLeft)", () => {
    const g = new Graph();
    const circle = new Node(1, 40, 60);
    circle.SetShape("Circle");
    circle.FixedTopLeft = new Point(100, 100);

    const other = new Node(2, 80, 80);
    g.Nodes.push(circle, other);
    // 3 edges to force scaling if it weren't fixed
    g.connect(circle, other);
    g.connect(circle, other);
    g.connect(circle, other);

    prescale(g);

    // Initial AspectRatio1 squared it to max(40, 60) = 60x60.
    // FixedTopLeft then prevented edge-density enlargement to 160.
    expect(circle.Width).toBe(60);
    expect(circle.Height).toBe(60);
  });

  it("should count parallel edges toward the same neighbor without deduplicating", () => {
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    const nB = new Node(2, 80, 80);
    g.Nodes.push(nA, nB);

    // 2 parallel edges to B
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    // edgesPerSide = max(2, ceil(2/1)) = 2 -> minLength = (2+1)*40 = 120
    expect(nA.Width).toBe(120);
    expect(nA.Height).toBe(120);
  });

  it("should scale non-square nodes on one axis only if the other is already large enough", () => {
    const g = new Graph();
    const nA = new Node(1, 200, 80);
    const nB = new Node(2, 80, 80);
    g.Nodes.push(nA, nB);

    // minLength = 120
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(200); // Already 200 >= 120, unchanged
    expect(nA.Height).toBe(120); // Expanded from 80 to 120
  });

  it("should not scale label dimensions if FontSize is null", () => {
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = null;
    nA.Label = new Label("text", 40, 20);

    const nB = new Node(2, 80, 80);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(120);
    expect(nA.Height).toBe(120);
    // Geometry scaled, but Label dimensions were untouched
    expect(nA.Label.Width).toBe(40);
    expect(nA.Label.Height).toBe(20);
  });

  it("should safely update FontSize when Label is null without creating Label", () => {
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = null;

    const nB = new Node(2, 80, 80);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);

    expect(nA.Width).toBe(120);
    expect(nA.Height).toBe(120);
    expect(nA.FontSize).toBe(24);
    expect(nA.Label).toBeNull();
  });

  it("should preserve topology invariants and only mutate allowed node fields", () => {
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.D2ID = "nodeA";
    nA.TopLeft = new Point(10, 15);
    nA.FontSize = 16;
    nA.Label = new Label("lbl", 30, 10);

    const nB = new Node(2, 100, 100);
    nB.D2ID = "nodeB";
    nB.TopLeft = new Point(200, 200);

    g.Nodes.push(nA, nB);
    const edge1 = g.connect(nA, nB);
    const edge2 = g.connect(nA, nB);

    const initialNodes = [...g.Nodes];
    const initialEdges = [...g.Edges];
    const nAEdges = [...nA.Edges];
    const nBEdges = [...nB.Edges];

    prescale(g);

    // Graph and edge topology identities remain unchanged
    expect(g.Nodes).toEqual(initialNodes);
    expect(g.Edges).toEqual(initialEdges);
    expect(nA.Edges).toEqual(nAEdges);
    expect(nB.Edges).toEqual(nBEdges);

    // Positions and identifiers preserved
    expect(nA.TopLeft.X).toBe(10);
    expect(nA.TopLeft.Y).toBe(15);
    expect(nA.D2ID).toBe("nodeA");
    expect(nA.ID).toBe(1);

    // Only allowed fields mutated
    expect(nA.Width).toBe(120);
    expect(nA.Height).toBe(120);
    expect(nA.FontSize).toBe(24);
    expect(nA.Label.Width).toBe(45);
    expect(nA.Label.Height).toBe(15);
  });

  it("should be deterministic regardless of node iteration order in Graph.Nodes", () => {
    function makeGraph() {
      const g = new Graph();
      const n1 = new Node(1, 80, 80);
      n1.FontSize = 16;
      const n2 = new Node(2, 80, 80);
      n2.FontSize = 16;
      g.connect(n1, n2);
      g.connect(n1, n2);
      return { g, n1, n2 };
    }

    const { g: gForward, n1: f1, n2: f2 } = makeGraph();
    gForward.Nodes = [f1, f2];
    prescale(gForward);

    const { g: gReverse, n1: r1, n2: r2 } = makeGraph();
    gReverse.Nodes = [r2, r1];
    prescale(gReverse);

    expect(f1.Width).toBe(r1.Width);
    expect(f1.Height).toBe(r1.Height);
    expect(f1.FontSize).toBe(r1.FontSize);

    expect(f2.Width).toBe(r2.Width);
    expect(f2.Height).toBe(r2.Height);
    expect(f2.FontSize).toBe(r2.FontSize);
  });

  it("should be idempotent on repeated runs", () => {
    const g = new Graph();
    const nA = new Node(1, 80, 80);
    nA.FontSize = 16;
    nA.Label = new Label("text", 30, 10);
    const nB = new Node(2, 100, 100);
    g.Nodes.push(nA, nB);
    g.connect(nA, nB);
    g.connect(nA, nB);

    prescale(g);
    const firstW = nA.Width;
    const firstH = nA.Height;
    const firstFS = nA.FontSize;
    const firstLW = nA.Label.Width;
    const firstLH = nA.Label.Height;

    prescale(g);
    expect(nA.Width).toBe(firstW);
    expect(nA.Height).toBe(firstH);
    expect(nA.FontSize).toBe(firstFS);
    expect(nA.Label.Width).toBe(firstLW);
    expect(nA.Label.Height).toBe(firstLH);
  });

  it("should integrate with ELK adapter through full round-trip smoke test", () => {
    const elkInput = {
      id: "root",
      children: [
        { id: "node1", width: 80, height: 80, x: 0, y: 0 },
        { id: "node2", width: 100, height: 100, x: 200, y: 0 },
      ],
      edges: [
        { id: "e1", sources: ["node1"], targets: ["node2"] },
        { id: "e2", sources: ["node1"], targets: ["node2"] },
        { id: "e3", sources: ["node1"], targets: ["node2"] },
      ],
    };

    // Deep freeze / snapshot to verify input ELK object remains unmutated
    const inputSnapshot = JSON.parse(JSON.stringify(elkInput));

    // Ingest into TALA graph
    const talaGraph = elkToTalaGraph(elkInput);
    expect(elkInput).toEqual(inputSnapshot);

    const n1 = talaGraph.Nodes.find((n) => n.D2ID === "node1");
    expect(n1).toBeDefined();
    expect(n1.Width).toBe(80);
    expect(n1.Height).toBe(80);

    // Run Prescale stage
    Prescale(talaGraph);

    // 3 parallel edges: edgesPerSide = 3 -> minLength = (3+1)*40 = 160
    expect(n1.Width).toBe(160);
    expect(n1.Height).toBe(160);

    // Convert back to ELK graph
    const elkOutput = talaToElkGraph(talaGraph);

    // Verify input remained unmutated
    expect(elkInput).toEqual(inputSnapshot);

    // Verify output ELK reflects scaled dimensions
    const elkN1 = elkOutput.children.find((c) => c.id === "node1");
    expect(elkN1.width).toBe(160);
    expect(elkN1.height).toBe(160);

    // Verify edges and metadata are preserved
    expect(elkOutput.edges.length).toBe(3);
    const edgeIds = elkOutput.edges.map((e) => e.id);
    expect(edgeIds).toContain("e1");
    expect(edgeIds).toContain("e2");
    expect(edgeIds).toContain("e3");
  });
});
