import { describe, it, expect } from "bun:test";
import { elkToTalaGraph, talaToElkGraph } from "../../src/elk/adapter.js";
import { cloneGraph } from "../../src/graph/clone.js";
import simpleChain from "../fixtures/simple-chain.json";
import nestedContainer from "../fixtures/nested-container.json";
import metadataPreservation from "../fixtures/metadata-preservation.json";
import portsFixture from "../fixtures/ports.json";

describe("ELK Adapter", () => {
  it("should parse a simple chain graph", () => {
    const graph = elkToTalaGraph(simpleChain);
    expect(graph.ID).toBe("root");
    expect(graph.Nodes.length).toBe(3);
    
    const findNode = (id) => graph.Nodes.find(n => n.D2ID === id);
    const a = findNode("a");
    const b = findNode("b");
    const c = findNode("c");
    
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();

    expect(a.Width).toBe(100);
    expect(a.Height).toBe(50);
    expect(a.Container).toBe(null);
    expect(a.Edges.length).toBe(1);

    const findEdge = (id) => graph.Edges.find(e => e.D2ID === id);
    const e1 = findEdge("e1");
    expect(e1.From).toBe(a);
    expect(e1.To).toBe(b);
  });

  it("should parse nested containers", () => {
    const graph = elkToTalaGraph(nestedContainer);
    // Root nodes are nodes with Container == null
    const rootNodes = graph.Nodes.filter(n => n.Container === null);
    expect(rootNodes.length).toBe(2);
    
    const findNode = (id) => graph.Nodes.find(n => n.D2ID === id);
    const container = findNode("container");
    const a = findNode("a");
    const b = findNode("b");

    const children = graph.Containers.get(container) || [];
    expect(children.length).toBe(2);
    expect(children.includes(a)).toBe(true);
    expect(a.Container).toBe(container);
    expect(container.Container).toBe(null);

    const findEdge = (id) => graph.Edges.find(e => e.D2ID === id);
    const e_inner = findEdge("e_inner");
    expect(e_inner).toBeDefined();
    expect(e_inner.From.D2ID).toBe("a");
    expect(e_inner.To.D2ID).toBe("b");
  });

  it("should handle empty or missing arrays gracefully", () => {
    const emptyGraph = elkToTalaGraph({ id: "empty" });
    expect(emptyGraph.ID).toBe("empty");
    expect(emptyGraph.Nodes.length).toBe(0);
    expect(emptyGraph.Edges.length).toBe(0);
  });
  
  it("should accept an empty-string root ID", () => {
    const graph = elkToTalaGraph({ id: "", children: [] });
    expect(graph.ID).toBe("");
    expect(graph.Nodes.length).toBe(0);
  });

  it("should reject malformed input and missing ids", () => {
    expect(() => elkToTalaGraph(null)).toThrow("Invalid ELK graph");
    expect(() => elkToTalaGraph({ children: [] })).toThrow("missing id");
    // Node missing ID
    expect(() => elkToTalaGraph({ id: "r", children: [{ width: 100 }] })).toThrow("missing id");
    // Edge missing ID
    expect(() => elkToTalaGraph({ id: "r", edges: [{ id: "" }] })).toThrow("missing id");
  });

  it("should reject duplicate ids", () => {
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "a"}]})).toThrow("duplicate node id \"a\"");
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "x"}, {id: "y"}], edges: [{id: "e1", sources: ["x"], targets: ["y"]}, {id: "e1", sources: ["x"], targets: ["y"]}]})).toThrow("duplicate edge id \"e1\"");
  });

  it("should reject invalid endpoint types explicitly", () => {
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}], edges: [{id: "e1", sources: [123], targets: ["b"]}]})).toThrow("source endpoint must be a string");
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}], edges: [{id: "e1", sources: ["a"], targets: [null]}]})).toThrow("target endpoint must be a string");
  });

  it("should avoid inserting duplicate self-loops in edges array", () => {
    const graph = elkToTalaGraph({ id: "r", children: [{id: "a"}], edges: [{id: "e1", sources: ["a"], targets: ["a"]}] });
    const findNode = (id) => graph.Nodes.find(n => n.D2ID === id);
    const a = findNode("a");
    expect(a.Edges.length).toBe(1);
    expect(a.Edges[0].D2ID).toBe("e1");
  });

  it("should update geometry and edge routes during round-trip", () => {
    const graph = elkToTalaGraph(metadataPreservation);
    
    // Mutate geometry in TALA graph
    const findNode = (id) => graph.Nodes.find(n => n.D2ID === id);
    const n = findNode("a");
    // We update TopLeft to new values
    n.TopLeft.X = 500;
    n.TopLeft.Y = 500;
    n.Width = 1000;
    
    const findEdge = (id) => graph.Edges.find(e => e.D2ID === id);
    const e1 = findEdge("e1");
    // Points array in Edge
    import("../../src/geometry/point.js").then(({ Point }) => {
      e1.Points = [new Point(0, 0), new Point(100, 100)];

      const output = talaToElkGraph(graph);
      
      const outN = output.children.find(c => c.id === "a");
      // Since it's child of root, relative === absolute
      expect(outN.x).toBe(500);
      expect(outN.y).toBe(500);
      expect(outN.width).toBe(1000);
      
      const outE1 = output.edges.find(e => e.id === "e1");
      expect(outE1.sections).toBeDefined();
      expect(outE1.sections[0].endPoint.x).toBe(100);
      
      // Ensure that patching routes didn't destruct other edge metadata
      expect(outE1.layoutOptions["elk.edgeRouting"]).toBe("ORTHOGONAL");
    });
  });

  it("should isolate references during cloneGraph", () => {
    const originalInput = JSON.parse(JSON.stringify(portsFixture));
    const graph = elkToTalaGraph(originalInput);
    const clonedGraph = cloneGraph(graph);
    
    const findNode = (g, id) => g.Nodes.find(n => n.D2ID === id);
    const table = findNode(graph, "table");
    const clonedTable = findNode(clonedGraph, "table");
    
    expect(table).not.toBe(clonedTable);
    
    const findEdge = (g, id) => g.Edges.find(e => e.D2ID === id);
    const e1 = findEdge(graph, "e1");
    const clonedE1 = findEdge(clonedGraph, "e1");
    
    expect(e1).not.toBe(clonedE1);
    expect(clonedE1.From).toBe(clonedTable);
    expect(clonedE1.From).not.toBe(table);
    
    expect(clonedTable.Edges.includes(clonedE1)).toBe(true);
    expect(clonedTable.Edges.includes(e1)).toBe(false);
  });
});
