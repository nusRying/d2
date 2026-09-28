import { describe, it, expect } from "bun:test";
import { elkToTalaGraph, talaToElkGraph } from "../../src/elk/adapter.js";
import { cloneGraph } from "../../src/graph/clone.js";
import simpleChain from "../fixtures/simple-chain.json";
import nestedContainer from "../fixtures/nested-container.json";
import metadataPreservation from "../fixtures/metadata-preservation.json";

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
    expect(a.outEdges.length).toBe(1);
    expect(a.inEdges.length).toBe(0);

    const e1 = graph.edges.get("e1");
    expect(e1.source).toBe("a");
    expect(e1.target).toBe("b");
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
    expect(e_inner.source).toBe("a");
    expect(e_inner.target).toBe("b");
  });

  it("should handle empty or missing arrays gracefully", () => {
    const emptyGraph = elkToTalaGraph({ id: "empty" });
    expect(emptyGraph.id).toBe("empty");
    expect(emptyGraph.rootNodes.length).toBe(0);
    expect(emptyGraph.nodes.size).toBe(0);
  });

  it("should reject malformed input", () => {
    expect(() => elkToTalaGraph(null)).toThrow("Invalid ELK graph");
    expect(() => elkToTalaGraph({ children: [] })).toThrow("missing id");
    expect(() => elkToTalaGraph({ id: "r", children: [{ width: 100 }] })).toThrow("missing id");
    expect(() => elkToTalaGraph({ id: "r", edges: [{ id: "e" }] })).toThrow("missing sources");
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

  it("should update geometry during round-trip", () => {
    const graph = elkToTalaGraph(simpleChain);
    
    // Mutate geometry in TALA graph
    const a = graph.nodes.get("a");
    a.x = 500;
    a.y = 500;
    a.width = 1000;
    
    const output = talaToElkGraph(graph);
    
    const outA = output.children.find(c => c.id === "a");
    expect(outA.x).toBe(500);
    expect(outA.y).toBe(500);
    expect(outA.width).toBe(1000);
  });

  it("should not mutate the original input during clone and conversion", () => {
    const original = JSON.parse(JSON.stringify(simpleChain));
    const originalCopy = JSON.parse(JSON.stringify(simpleChain));
    
    const graph = elkToTalaGraph(original);
    const clonedGraph = cloneGraph(graph);
    
    // Mutate cloned graph
    const a = clonedGraph.nodes.get("a");
    a.x = 999;
    
    const output = talaToElkGraph(clonedGraph);
    
    expect(output.children[0].x).toBe(999);
    
    // Original input should remain untouched
    expect(original).toEqual(originalCopy);
    // Original TALA graph should remain untouched
    expect(graph.nodes.get("a").x).toBe(0);
  });
});
