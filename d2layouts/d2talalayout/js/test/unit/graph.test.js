import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Point } from "../../src/geometry/point.js";
import { cloneGraph } from "../../src/graph/clone.js";

describe("LayoutGraph Structure", () => {
  it("should maintain bidirectional connections and removals", () => {
    const g = new Graph();
    const n1 = new Node(1n);
    const n2 = new Node(2n);
    const n3 = new Node(3n);

    g.addNodeUnchecked(n1);
    g.addNodeUnchecked(n2);
    g.addNodeUnchecked(n3);

    const e1 = g.connect(n1, n2);
    expect(g.Edges.length).toBe(1);
    expect(n1.Edges.length).toBe(1);
    expect(n2.Edges.length).toBe(1);
    expect(e1.From).toBe(n1);
    expect(e1.To).toBe(n2);

    const e2 = g.connect(n1, n1); // self-loop
    expect(g.Edges.length).toBe(2);
    expect(n1.Edges.length).toBe(2); // In TALA, self loops are added once
    expect(e2.From).toBe(n1);
    expect(e2.To).toBe(n1);

    const e3 = g.connect(n2, n3);

    // Disconnect e1
    g.disconnect(e1);
    expect(g.Edges.length).toBe(2);
    expect(n1.Edges.length).toBe(1); // e2 remains
    expect(n2.Edges.length).toBe(1); // e3 remains

    // Edge reconnect
    e3.reconnect(n1, false);
    expect(e3.From).toBe(n1);
    expect(e3.To).toBe(n3);
    expect(n2.Edges.length).toBe(0);
    expect(n1.Edges.includes(e3)).toBe(true);
    expect(n3.Edges.includes(e3)).toBe(true);
  });

  it("Graph.AddEdge() exact-object behavior", () => {
    const g = new Graph();
    const edgeObj1 = new Edge(null, null);
    edgeObj1.ID = 101n;
    const edgeObj2 = new Edge(null, null);
    edgeObj2.ID = 101n; // distinct object with identical fields

    // same Edge object added twice -> graph contains it once
    g.AddEdge(edgeObj1);
    g.AddEdge(edgeObj1);
    expect(g.Edges.length).toBe(1);
    expect(g.Edges[0]).toBe(edgeObj1);

    // two different Edge objects -> both allowed
    g.AddEdge(edgeObj2);
    expect(g.Edges.length).toBe(2);
    expect(g.Edges[1]).toBe(edgeObj2);
  });

  it("Graph.disconnect() loop semantics after reconnecting to loop", () => {
    const g = new Graph();
    const nodeA = new Node(10n);
    const nodeB = new Node(20n);
    g.addNodeUnchecked(nodeA);
    g.addNodeUnchecked(nodeB);

    // Connect A -> B
    const edge = g.connect(nodeA, nodeB);
    expect(nodeA.Edges.length).toBe(1);
    expect(nodeB.Edges.length).toBe(1);

    // Reconnect From to B => B -> B (loop with two incidence entries)
    edge.Reconnect(nodeB, false);
    expect(edge.From).toBe(nodeB);
    expect(edge.To).toBe(nodeB);
    expect(nodeA.Edges.length).toBe(0);
    expect(nodeB.Edges.length).toBe(2);

    // Disconnect edge: B.Edges must contain zero references, Graph.Edges must not contain edge
    g.Disconnect(edge);
    expect(nodeB.Edges.length).toBe(0);
    expect(nodeB.Edges.includes(edge)).toBe(false);
    expect(g.Edges.length).toBe(0);
    expect(g.Edges.includes(edge)).toBe(false);
  });

  it("should maintain container hierarchy", () => {
    const g = new Graph();
    const parent = new Node(1n);
    const child1 = new Node(2n);
    const child2 = new Node(3n);

    g.addNodeUnchecked(parent);
    g.addNewNodeToContainer(parent, child1);
    g.addNewNodeToContainer(parent, child2);

    expect(parent.isContainer).toBe(true);
    expect(child1.Container).toBe(parent);
    expect(child2.Container).toBe(parent);

    const children = g.Containers.get(parent);
    expect(children.length).toBe(2);
    expect(children.includes(child1)).toBe(true);
  });

  it("empty-container clone succeeds when Containers.size === 0", () => {
    const g = new Graph();
    const n1 = new Node(1n);
    const n2 = new Node(2n);
    g.addNodeUnchecked(n1);
    g.addNodeUnchecked(n2);
    const edge = g.connect(n1, n2);
    edge.ID = 10n;

    expect(g.Containers.size).toBe(0);

    const cloned = cloneGraph(g);
    expect(cloned).toBeDefined();
    expect(cloned.Nodes.length).toBe(2);
    expect(cloned.Edges.length).toBe(1);
    expect(cloned.Containers.size).toBe(0);
  });

  it("rejects malformed non-empty container maps with unreachable records", () => {
    const g = new Graph();
    const n1 = new Node(1n);
    const n2 = new Node(2n);
    const orphan = new Node(3n);
    const child = new Node(4n);

    g.addNodeUnchecked(n1);
    g.addNodeUnchecked(n2);
    g.addNodeUnchecked(orphan);
    g.addNodeUnchecked(child);

    // Root contains n1 and n2
    g.addNodeToContainer(null, n1);
    g.addNodeToContainer(null, n2);

    // Orphan is not reachable from root (null) but has container entry
    g.addNodeToContainer(orphan, child);

    expect(() => cloneGraph(g)).toThrow("unreachable containers exist in source");
  });

  it("validates edge records on clone (reject nil, reject duplicate object, validate IDs)", () => {
    // 1. Nil edge
    const gNil = new Graph();
    const n1 = new Node(1n);
    const n2 = new Node(2n);
    gNil.addNodeUnchecked(n1);
    gNil.addNodeUnchecked(n2);
    gNil.Edges.push(null);
    expect(() => cloneGraph(gNil)).toThrow("cannot clone a nil edge");

    // 2. Duplicate Edge object
    const gDup = new Graph();
    gDup.addNodeUnchecked(n1);
    gDup.addNodeUnchecked(n2);
    const e1 = new Edge(n1, n2);
    e1.ID = 1n;
    gDup.Edges.push(e1);
    gDup.Edges.push(e1);
    expect(() => cloneGraph(gDup)).toThrow(/cannot clone duplicate edge record/);

    // 3. Two different edges with ID=7n -> reject
    const gDupId = new Graph();
    gDupId.addNodeUnchecked(n1);
    gDupId.addNodeUnchecked(n2);
    const e2 = new Edge(n1, n2);
    e2.ID = 7n;
    const e3 = new Edge(n1, n2);
    e3.ID = 7n;
    gDupId.Edges.push(e2);
    gDupId.Edges.push(e3);
    expect(() => cloneGraph(gDupId)).toThrow("cannot clone duplicate edge ID 7");

    // 4. Two different edges with ID=0n -> allowed (zero is unassigned/reserved)
    const gZeroId = new Graph();
    gZeroId.addNodeUnchecked(n1);
    gZeroId.addNodeUnchecked(n2);
    const eZero1 = new Edge(n1, n2);
    eZero1.ID = 0n;
    const eZero2 = new Edge(n1, n2);
    eZero2.ID = 0n;
    gZeroId.Edges.push(eZero1);
    gZeroId.Edges.push(eZero2);
    const clonedZero = cloneGraph(gZeroId);
    expect(clonedZero.Edges.length).toBe(2);
    expect(clonedZero.Edges[0].ID).toBe(0n);
    expect(clonedZero.Edges[1].ID).toBe(0n);
    expect(clonedZero.Edges[0]).not.toBe(clonedZero.Edges[1]);
  });

  it("should establish near relationships stably", () => {
    const g = new Graph();
    const n1 = new Node(1n);
    const n2 = new Node(2n);
    const n3 = new Node(3n);

    n1.addNear(n2);
    n1.addNear(n3);
    n1.addNear(n2); // duplicate should be ignored

    expect(n1.Nears.size).toBe(2);
    expect(n1.orderedNears()).toEqual([n2, n3]);
  });

  it("should clone cleanly isolating references and boundary fields", () => {
    const g = new Graph();
    g.ID = "test-graph";

    const n1 = new Node(1n);
    n1.D2ID = "table";
    n1.TopLeft = new Point(10, 20);
    n1.elkData = { id: "table", label: "Table Node", customMeta: { flag: true } };

    const n2 = new Node(2n);
    n2.D2ID = "b";
    n2.elkData = { id: "b" };

    g.addNodeUnchecked(n1);
    g.addNewNodeToContainer(n1, n2);
    n1.addNear(n2);

    const e1 = g.connect(n1, n2);
    e1.ID = 101n;
    e1.D2ID = "e1";
    e1.sourceEndpointId = "table.column.src";
    e1.targetEndpointId = "b";
    e1.route = [{ id: "sec-1", points: [{ x: 1, y: 2 }] }];
    e1.elkData = { id: "e1", layout: "splines" };
    e1.Points.push(new Point(0, 0));

    // Register indexes and endpoints
    g.nodesByExternalId.set(n1.D2ID, n1);
    g.nodesByExternalId.set(n2.D2ID, n2);
    g.edgesByExternalId.set(e1.D2ID, e1);
    g.nodesByEntityId.set(n1.ID, n1);
    g.nodesByEntityId.set(n2.ID, n2);
    g.edgesByEntityId.set(e1.ID, e1);

    const originalPort = { id: "table.column.src", customPortMetadata: "preserve-me" };
    g.endpoints.set("table.column.src", {
      kind: "port",
      node: n1,
      port: originalPort,
    });
    g.endpoints.set("b", {
      kind: "node",
      node: n2,
    });

    const cloned = cloneGraph(g);

    expect(cloned.ID).toBe("test-graph");
    expect(cloned.Nodes.length).toBe(2);
    expect(cloned.Edges.length).toBe(1);

    const cN1 = cloned.Nodes.find(n => n.ID === 1n);
    const cN2 = cloned.Nodes.find(n => n.ID === 2n);
    const cE1 = cloned.Edges[0];

    // Reference isolation
    expect(cN1).not.toBe(n1);
    expect(cN1.TopLeft).not.toBe(n1.TopLeft);
    expect(cN1.TopLeft.X).toBe(10);

    // Node elkData clone isolation
    expect(cN1.elkData).toEqual(n1.elkData);
    expect(cN1.elkData).not.toBe(n1.elkData);
    cN1.elkData.customMeta.flag = false;
    expect(n1.elkData.customMeta.flag).toBe(true); // Original unchanged!

    expect(cE1).not.toBe(e1);
    expect(cE1.Points[0]).not.toBe(e1.Points[0]);
    expect(cE1.From).toBe(cN1);
    expect(cE1.To).toBe(cN2);

    // Edge boundary fields survival and isolation
    expect(cE1.sourceEndpointId).toBe("table.column.src");
    expect(cE1.targetEndpointId).toBe("b");
    expect(cE1.route).toEqual(e1.route);
    expect(cE1.route).not.toBe(e1.route);
    expect(cE1.elkData).toEqual(e1.elkData);
    expect(cE1.elkData).not.toBe(e1.elkData);

    // Port endpoint clone isolation
    const clonedPortEndpoint = cloned.endpoints.get("table.column.src");
    const originalPortEndpoint = g.endpoints.get("table.column.src");
    expect(clonedPortEndpoint).not.toBe(originalPortEndpoint);
    expect(clonedPortEndpoint.kind).toBe("port");
    expect(clonedPortEndpoint.node).toBe(cN1);
    expect(clonedPortEndpoint.node).not.toBe(n1);
    expect(clonedPortEndpoint.port).not.toBe(originalPortEndpoint.port);
    expect(clonedPortEndpoint.port.customPortMetadata).toBe("preserve-me");

    // Mutating clone port does not mutate original
    clonedPortEndpoint.port.customPortMetadata = "mutated";
    expect(originalPortEndpoint.port.customPortMetadata).toBe("preserve-me");

    // All graph indexes point exclusively to cloned records
    expect(cloned.nodesByExternalId.get("table")).toBe(cN1);
    expect(cloned.nodesByExternalId.get("b")).toBe(cN2);
    expect(cloned.edgesByExternalId.get("e1")).toBe(cE1);
    expect(cloned.nodesByEntityId.get(1n)).toBe(cN1);
    expect(cloned.nodesByEntityId.get(2n)).toBe(cN2);
    expect(cloned.edgesByEntityId.get(101n)).toBe(cE1);

    for (const [id, node] of cloned.nodesByExternalId.entries()) {
      expect(node).not.toBe(g.nodesByExternalId.get(id));
    }
    for (const [id, edge] of cloned.edgesByExternalId.entries()) {
      expect(edge).not.toBe(g.edgesByExternalId.get(id));
    }
    for (const [id, node] of cloned.nodesByEntityId.entries()) {
      expect(node).not.toBe(g.nodesByEntityId.get(id));
    }
    for (const [id, edge] of cloned.edgesByEntityId.entries()) {
      expect(edge).not.toBe(g.edgesByEntityId.get(id));
    }
    for (const [id, ep] of cloned.endpoints.entries()) {
      expect(ep).not.toBe(g.endpoints.get(id));
      expect(ep.node).not.toBe(g.endpoints.get(id).node);
    }
  });
});
