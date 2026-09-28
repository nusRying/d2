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
    // Explicit port vs port collision
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a", ports: [{id: "shared-port"}]}, {id: "b", ports: [{id: "shared-port"}]}]})).toThrow("duplicate endpoint id \"shared-port\"");
  });

  it("should reject invalid endpoint types explicitly", () => {
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}], edges: [{id: "e1", sources: [123], targets: ["b"]}]})).toThrow("source endpoint must be a string");
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}], edges: [{id: "e1", sources: ["a"], targets: [null]}]})).toThrow("target endpoint must be a string");
  });

  it("should reject unknown endpoints", () => {
    expect(() => elkToTalaGraph({ id: "r", edges: [{id: "e1", sources: ["missing"], targets: ["a"]}]})).toThrow("does not exist");
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}], edges: [{id: "e1", sources: ["a"], targets: ["missing"]}]})).toThrow("does not exist");
  });

  it("should reject hyperedges", () => {
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}, {id: "c"}], edges: [{id: "e1", sources: ["a", "b"], targets: ["c"]}]})).toThrow("hyperedges are not supported");
    expect(() => elkToTalaGraph({ id: "r", children: [{id: "a"}, {id: "b"}, {id: "c"}], edges: [{id: "e1", sources: ["a"], targets: ["b", "c"]}]})).toThrow("hyperedges are not supported");
  });

  it("should resolve port endpoints accurately and expose endpoint index", () => {
    const originalInput = JSON.parse(JSON.stringify(portsFixture));
    const graph = elkToTalaGraph(originalInput);
    
    // Check edge references
    const e1 = graph.edges.get("e1");
    expect(e1.from.id).toBe("table");
    expect(e1.to.id).toBe("b");
    expect(e1.sourceEndpointId).toBe("table.column.src");
    expect(e1.targetEndpointId).toBe("b");

    // Check endpoints API
    const nodeEndpoint = graph.endpoints.get("b"); 
    expect(nodeEndpoint.kind).toBe("node"); 
    expect(nodeEndpoint.node).toBe(graph.nodes.get("b"));

    const portEndpoint = graph.endpoints.get("table.column.src"); 
    expect(portEndpoint.kind).toBe("port"); 
    expect(portEndpoint.node).toBe(graph.nodes.get("table"));
    
    // Check cloning isolation for ports
    const originalInputPort = originalInput.children[0].ports[0];
    expect(portEndpoint.port).not.toBe(originalInputPort);
    
    // Mutate the cloned port and ensure input is safe
    portEndpoint.port.x = 999;
    expect(originalInputPort.x).toBe(5);
  });

  it("should avoid inserting duplicate self-loops in edges array", () => {
    const graph = elkToTalaGraph({ id: "r", children: [{id: "a"}], edges: [{id: "e1", sources: ["a"], targets: ["a"]}] });
    const a = graph.nodes.get("a");
    expect(a.edges.length).toBe(1);
    expect(a.edges[0].id).toBe("e1");
  });

  it("should preserve metadata during round-trip, including ports", () => {
    // 1. Check general metadata preservation
    const graph = elkToTalaGraph(metadataPreservation);
    const output = talaToElkGraph(graph);

    expect(output.children[0].labels).toBeDefined();
    expect(output.children[0].labels[0].text).toBe("Hello World");
    expect(output.children[0].layoutOptions["elk.direction"]).toBe("RIGHT");
    expect(output.children[0].customProperty).toBe("preserved_value");
    expect(output.edges[0].layoutOptions["elk.edgeRouting"]).toBe("ORTHOGONAL");
    
    // 2. Check port metadata preservation
    const graphWithPorts = elkToTalaGraph(portsFixture);
    const outputWithPorts = talaToElkGraph(graphWithPorts);
    const tableNode = outputWithPorts.children.find(c => c.id === "table");
    const port = tableNode.ports[0];
    expect(port.id).toBe("table.column.src");
    expect(port.x).toBe(5);
    expect(port.y).toBe(10);
    expect(port.customPortMetadata).toBe("preserve-me");
  });

  it("should update geometry and edge routes during round-trip", () => {
    const graph = elkToTalaGraph(metadataPreservation);
    
    // Mutate geometry in TALA graph
    const n = graph.nodes.get("a");
    n.x = 500;
    n.y = 500;
    n.width = 1000;
    
    const e1 = graph.edges.get("e1");
    e1.route = [{ startPoint: {x: 0, y: 0}, endPoint: {x: 100, y: 100} }];

    const output = talaToElkGraph(graph);
    
    const outN = output.children.find(c => c.id === "a");
    expect(outN.x).toBe(500);
    expect(outN.y).toBe(500);
    expect(outN.width).toBe(1000);
    
    const outE1 = output.edges.find(e => e.id === "e1");
    expect(outE1.sections).toBeDefined();
    expect(outE1.sections[0].endPoint.x).toBe(100);
    
    // Ensure that patching routes didn't destruct other edge metadata
    expect(outE1.layoutOptions["elk.edgeRouting"]).toBe("ORTHOGONAL");
  });

  it("should isolate references during cloneGraph", () => {
    const originalInput = JSON.parse(JSON.stringify(portsFixture));
    const graph = elkToTalaGraph(originalInput);
    const clonedGraph = cloneGraph(graph);
    
    const table = graph.nodes.get("table");
    const clonedTable = clonedGraph.nodes.get("table");
    
    expect(table).not.toBe(clonedTable);
    
    const e1 = graph.edges.get("e1");
    const clonedE1 = clonedGraph.edges.get("e1");
    
    expect(e1).not.toBe(clonedE1);
    expect(clonedE1.from).toBe(clonedTable);
    expect(clonedE1.from).not.toBe(table);
    
    expect(clonedTable.edges[0]).toBe(clonedE1);
    expect(clonedTable.edges[0]).not.toBe(e1);
    
    // Check endpoint cloning
    const clonedPortEndpoint = clonedGraph.endpoints.get("table.column.src"); 
    expect(clonedPortEndpoint.node).toBe(clonedGraph.nodes.get("table")); 
    expect(clonedPortEndpoint.node).not.toBe(graph.nodes.get("table"));
    
    // Ensure the payload port was cloned independently
    const originalEndpoint = graph.endpoints.get("table.column.src");
    expect(clonedPortEndpoint.port).not.toBe(originalEndpoint.port);
    clonedPortEndpoint.port.x = 555;
    expect(originalEndpoint.port.x).toBe(5); // unaltered original
  });
});
