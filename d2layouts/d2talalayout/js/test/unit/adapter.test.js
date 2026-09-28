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
    expect(graph.id).toBe("root");
    expect(graph.rootNodes.length).toBe(3);
    expect(graph.nodes.has("a")).toBe(true);
    expect(graph.nodes.has("b")).toBe(true);
    expect(graph.nodes.has("c")).toBe(true);

    const a = graph.nodes.get("a");
    const b = graph.nodes.get("b");
    
    expect(a.width).toBe(100);
    expect(a.height).toBe(50);
    expect(a.parent).toBe(null);
    expect(a.edges.length).toBe(1);

    const e1 = graph.edges.get("e1");
    expect(e1.from).toBe(a);
    expect(e1.to).toBe(b);
  });

  it("should parse nested containers", () => {
    const graph = elkToTalaGraph(nestedContainer);
    expect(graph.rootNodes.length).toBe(2);
    expect(graph.nodes.has("container")).toBe(true);
    expect(graph.nodes.has("a")).toBe(true);

    const container = graph.nodes.get("container");
    const a = graph.nodes.get("a");

    expect(container.children.length).toBe(2);
    expect(a.parent).toBe(container);
    expect(container.parent).toBe(null);

    const e_inner = graph.edges.get("e_inner");
    expect(e_inner).toBeDefined();
    expect(e_inner.from.id).toBe("a");
    expect(e_inner.to.id).toBe("b");
  });

  it("should handle empty or missing arrays gracefully", () => {
    const emptyGraph = elkToTalaGraph({ id: "empty" });
    expect(emptyGraph.id).toBe("empty");
    expect(emptyGraph.rootNodes.length).toBe(0);
    expect(emptyGraph.nodes.size).toBe(0);
  });
  
  it("should accept an empty-string root ID", () => {
    const graph = elkToTalaGraph({ id: "", children: [] });
    expect(graph.id).toBe("");
    expect(graph.rootNodes.length).toBe(0);
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
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a", ports: [{id: "a"}]}]})).toThrow("duplicate endpoint id \"a\"");
  });

  it("should reject unknown endpoints", () => {
    expect(() => elkToTalaGraph({ id: "r", edges: [{id: "e1", sources: ["missing"], targets: ["a"]}]})).toThrow("does not exist");
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}], edges: [{id: "e1", sources: ["a"], targets: ["missing"]}]})).toThrow("does not exist");
  });

  it("should reject hyperedges", () => {
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}, {id: "c"}], edges: [{id: "e1", sources: ["a", "b"], targets: ["c"]}]})).toThrow("hyperedges are not supported");
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}, {id: "c"}], edges: [{id: "e1", sources: ["a"], targets: ["b", "c"]}]})).toThrow("hyperedges are not supported");
  });

  it("should resolve port endpoints accurately", () => {
    const graph = elkToTalaGraph(portsFixture);
    const e1 = graph.edges.get("e1");
    expect(e1.from.id).toBe("table");
    expect(e1.to.id).toBe("b");
    expect(e1.sourceEndpointId).toBe("table.column.src");
    expect(e1.targetEndpointId).toBe("b");
  });

  it("should avoid inserting duplicate self-loops in edges array", () => {
    const graph = elkToTalaGraph({ id: "r", children: [{id: "a"}], edges: [{id: "e1", sources: ["a"], targets: ["a"]}] });
    const a = graph.nodes.get("a");
    expect(a.edges.length).toBe(1);
    expect(a.edges[0].id).toBe("e1");
  });

  it("should preserve metadata during round-trip", () => {
    const graph = elkToTalaGraph(metadataPreservation);
    const output = talaToElkGraph(graph);

    expect(output.children[0].labels).toBeDefined();
    expect(output.children[0].labels[0].text).toBe("Hello World");
    expect(output.children[0].layoutOptions["elk.direction"]).toBe("RIGHT");
    expect(output.children[0].customProperty).toBe("preserved_value");
    expect(output.edges[0].layoutOptions["elk.edgeRouting"]).toBe("ORTHOGONAL");
  });

  it("should update geometry and edge routes during round-trip", () => {
    const graph = elkToTalaGraph(simpleChain);
    
    // Mutate geometry in TALA graph
    const a = graph.nodes.get("a");
    a.x = 500;
    a.y = 500;
    a.width = 1000;
    
    const e1 = graph.edges.get("e1");
    e1.route = [{ startPoint: {x: 0, y: 0}, endPoint: {x: 100, y: 100} }];

    const output = talaToElkGraph(graph);
    
    const outA = output.children.find(c => c.id === "a");
    expect(outA.x).toBe(500);
    expect(outA.y).toBe(500);
    expect(outA.width).toBe(1000);
    
    const outE1 = output.edges.find(e => e.id === "e1");
    expect(outE1.sections).toBeDefined();
    expect(outE1.sections[0].endPoint.x).toBe(100);
  });

  it("should isolate references during cloneGraph", () => {
    const graph = elkToTalaGraph(simpleChain);
    const clonedGraph = cloneGraph(graph);
    
    const a = graph.nodes.get("a");
    const clonedA = clonedGraph.nodes.get("a");
    
    expect(a).not.toBe(clonedA);
    
    const e1 = graph.edges.get("e1");
    const clonedE1 = clonedGraph.edges.get("e1");
    
    expect(e1).not.toBe(clonedE1);
    expect(clonedE1.from).toBe(clonedA);
    expect(clonedE1.from).not.toBe(a);
    
    expect(clonedA.edges[0]).toBe(clonedE1);
    expect(clonedA.edges[0]).not.toBe(e1);
  });
});
