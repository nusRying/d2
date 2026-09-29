import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Edge } from "../../src/graph/edge.js";
import { Orientation } from "../../src/geometry/orientation.js";
import { Point } from "../../src/geometry/point.js";
import { cloneGraph } from "../../src/graph/clone.js";

const fixturePath = path.join(import.meta.dir, "..", "fixtures", "go-layoutgraph-core-reference.json");
const oracleData = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const cases = oracleData.cases;

describe("LayoutGraph Go Parity", () => {
  it("NewGraphDefaults", () => {
    const g = new Graph();
    expect(g.IsRootHierarchy).toBe(cases.NewGraphDefaults.IsRootHierarchy);
    expect(g.CellSize).toBe(cases.NewGraphDefaults.CellSize);
  });

  it("NodeHierarchy", () => {
    const g = new Graph();
    const n1 = new Node(1n);
    const n2 = new Node(2n);
    const n3 = new Node(3n);
    g.addNodeUnchecked(n1);
    g.addNewNodeToContainer(n1, n2);
    g.addNodeToContainer(n1, n3);

    // addNodeToContainer does NOT add to Nodes, so only n1 and n2 are in g.Nodes
    expect(g.Nodes.length).toBe(2);

    const rootNodes = g.Containers.get(null) || [];
    expect(rootNodes.length).toBe(cases.NodeHierarchy.RootNodesCount);

    const n1Children = g.Containers.get(n1) || [];
    expect(n1Children.length).toBe(cases.NodeHierarchy.N1ChildrenCount);

    // N1Graph: n1.Graph != nil = true
    expect(n1.Graph !== null).toBe(cases.NodeHierarchy.N1Graph);
    // N1Container: n1.Container == nil = true
    expect(n1.Container === null).toBe(cases.NodeHierarchy.N1Container);
    // N2Graph: n2.Graph != nil = true
    expect(n2.Graph !== null).toBe(cases.NodeHierarchy.N2Graph);
    // N2Container: n2.Container != nil && ID==1 = true
    expect(n2.Container !== null && Number(n2.Container.ID) === 1).toBe(cases.NodeHierarchy.N2Container);
    // N3Graph: n3.Graph != nil = false (addNodeToContainer does not set Graph)
    expect(n3.Graph !== null).toBe(cases.NodeHierarchy.N3Graph);
    // N3Container: n3.Container != nil && ID==1 = true
    expect(n3.Container !== null && Number(n3.Container.ID) === 1).toBe(cases.NodeHierarchy.N3Container);
  });

  it("Nears", () => {
    // Go oracle: n4(4), n5(5), n6(6), n7(ID=2); n4.AddNear(n6), n4.AddNear(n5), n4.AddNear(n7)
    // orderedNears sorts by ID => [n7(2), n5(5), n6(6)]
    const n4 = new Node(4n);
    const n5 = new Node(5n);
    const n6 = new Node(6n);
    const n7 = new Node(2n);

    n4.addNear(n6);
    n4.addNear(n5);
    n4.addNear(n7);

    expect(n4.Nears.has(n6)).toBe(cases.Nears.N4HasN6);
    expect(n6.Nears.has(n4)).toBe(cases.Nears.N6HasN4);
    expect(n4.Nears.has(n5)).toBe(cases.Nears.N4HasN5);
    expect(n5.Nears.has(n4)).toBe(cases.Nears.N5HasN4);

    const ordered = n4.orderedNears();
    expect(ordered.map(n => Number(n.ID))).toEqual(cases.Nears.OrderedIDs);
  });

  it("Edges", () => {
    const g = new Graph();
    const n8 = new Node(8n);
    const n9 = new Node(9n);
    g.addNodeUnchecked(n8);
    g.addNodeUnchecked(n9);

    const e1 = g.connect(n8, n9);
    g.connect(n8, n8);

    expect(Number(e1.From.ID)).toBe(cases.Edges.E1From);
    expect(Number(e1.To.ID)).toBe(cases.Edges.E1To);
    expect(n8.Edges.length).toBe(cases.Edges.N8EdgesCount);
    expect(n9.Edges.length).toBe(cases.Edges.N9EdgesCount);
  });

  it("Disconnect", () => {
    const g = new Graph();
    const n8 = new Node(8n);
    const n9 = new Node(9n);
    g.addNodeUnchecked(n8);
    g.addNodeUnchecked(n9);
    const e1 = g.connect(n8, n9);
    g.connect(n8, n8);
    g.disconnect(e1);

    expect(n8.Edges.length).toBe(cases.Disconnect.N8EdgesCount);
    expect(n9.Edges.length).toBe(cases.Disconnect.N9EdgesCount);
    expect(g.Edges.length).toBe(cases.Disconnect.GraphEdgesCount);
  });

  it("Directions", () => {
    const g = new Graph();
    const n10 = new Node(10n);
    const n11 = new Node(11n);
    const n12 = new Node(12n);
    g.addNodeUnchecked(n10);
    g.addNodeUnchecked(n11);
    g.addNodeUnchecked(n12);
    g.connect(n10, n11);
    g.connect(n11, n12);

    // geo.Left=7, geo.Right=5 - keys in Orientation are PascalCase
    g.Directions.set(n10, Orientation.Left);
    g.Directions.set(n11, Orientation.Right);

    expect(g.direction(n10)).toBe(cases.Directions.N10Direction);
    expect(g.direction(n11)).toBe(cases.Directions.N11Direction);
  });

  it("ComputeCellSize", () => {
    const g = new Graph();
    const n13 = new Node(13n);
    n13.Width = 10;
    n13.Height = 20;
    const n14 = new Node(14n);
    n14.Width = 15;
    n14.Height = 25;
    g.addNodeUnchecked(n13);
    g.addNodeUnchecked(n14);
    g.computeCellSize();

    expect(g.CellSize).toBe(cases.ComputeCellSize);
  });

  it("Ports", () => {
    const n13 = new Node(13n);
    const n14 = new Node(14n);
    const e5 = new Edge(n13, n14);
    e5.Points = [new Point(1, 2), new Point(3, 4)];

    const sPort = e5.sourcePort();
    const tPort = e5.targetPort();

    expect(sPort.X).toBe(cases.Ports.SourcePortX);
    expect(tPort.X).toBe(cases.Ports.TargetPortX);
  });

  it("Reconnect", () => {
    const g = new Graph();
    const n13 = new Node(13n);
    const n14 = new Node(14n);
    const n15 = new Node(15n);
    const n16 = new Node(16n);
    g.addNodeUnchecked(n13);
    g.addNodeUnchecked(n14);
    g.addNodeUnchecked(n15);
    g.addNodeUnchecked(n16);
    const e6 = g.connect(n13, n14);

    e6.reconnect(n15, false);
    e6.reconnect(n16, true);

    expect(Number(e6.From.ID)).toBe(cases.Reconnect.E6FromID);
    expect(Number(e6.To.ID)).toBe(cases.Reconnect.E6ToID);
    expect(n13.Edges.length).toBe(cases.Reconnect.N13EdgesCount);
    expect(n15.Edges.length).toBe(cases.Reconnect.N15EdgesCount);
    expect(n14.Edges.length).toBe(cases.Reconnect.N14EdgesCount);
    expect(n16.Edges.length).toBe(cases.Reconnect.N16EdgesCount);
  });

  it("Clone", () => {
    // Go oracle: addNewNodeToContainer(n17, n18) → Containers[n17]=[n18]
    // n17 is NOT in Containers[nil]. Go copyContainers does RDFS from nil →
    // nil->Containers[nil]=[] → empty → n17 is never traversed.
    // Result: cloned n17.IsContainer()=false, cloned n18.Container=nil.
    const g5 = new Graph();
    const n17 = new Node(17n);
    n17.TopLeft = new Point(1, 2);
    const n18 = new Node(18n);
    n18.TopLeft = new Point(3, 4);
    g5.addNodeUnchecked(n17);
    g5.addNewNodeToContainer(n17, n18);
    n17.addNear(n18);
    const e7 = g5.connect(n17, n18);
    e7.Points = [new Point(5, 6)];

    const g5Cloned = cloneGraph(g5);

    let cN17 = g5Cloned.Nodes[0];
    let cN18 = g5Cloned.Nodes[1];
    if (cN17 && cN18 && cN17.ID === 18n) {
      const temp = cN17; cN17 = cN18; cN18 = temp;
    }
    const cE7 = g5Cloned.Edges[0];

    expect(cN17 !== n17).toBe(cases.Clone.N17PointerDiff);
    expect(cE7 !== e7).toBe(cases.Clone.E7PointerDiff);
    expect(cN17.TopLeft.X).toBe(cases.Clone.N17TopLeftX);
    expect(cN17.isContainer).toBe(cases.Clone.N17IsContainer);          // false
    expect(cN18.Container === null).toBe(!cases.Clone.N18HasContainer);  // null===true <=> !false
    expect(cN18.Container ? Number(cN18.Container.ID) : 0).toBe(cases.Clone.N18ContainerID); // 0
    expect(cN17.Nears.size).toBe(cases.Clone.N17NearsCount);
    expect(Number(cE7.From.ID)).toBe(cases.Clone.E7FromID);
    expect(Number(cE7.To.ID)).toBe(cases.Clone.E7ToID);
    expect(cE7.Points[0].X).toBe(cases.Clone.E7Points0X);
  });
});
