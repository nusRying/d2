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

  it("should clone cleanly isolating references", () => {
    const g = new Graph();
    g.ID = "test-graph";
    
    const n1 = new Node(1n);
    n1.TopLeft = new Point(10, 20);
    
    const n2 = new Node(2n);
    
    g.addNodeUnchecked(n1);
    g.addNewNodeToContainer(n1, n2);
    n1.addNear(n2);

    const e1 = g.connect(n1, n2);
    e1.Points.push(new Point(0,0));

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
    
    expect(cE1).not.toBe(e1);
    expect(cE1.Points[0]).not.toBe(e1.Points[0]);
    expect(cE1.From).toBe(cN1);
    expect(cE1.To).toBe(cN2);

    // Structure isolation
    expect(cN1.isContainer).toBe(true);
    expect(cN2.Container).toBe(cN1);
    
    const cChildren = cloned.Containers.get(cN1);
    expect(cChildren.length).toBe(1);
    expect(cChildren[0]).toBe(cN2);

    // Nears isolation
    expect(cN1.Nears.size).toBe(1);
    expect(Array.from(cN1.Nears)[0]).toBe(cN2);
  });
});
