import { describe, it, expect } from "bun:test";
import { elkToTalaGraph, talaToElkGraph, parseElkDirection } from "../../src/elk/adapter.js";
import { Point } from "../../src/geometry/point.js";
import { Orientation } from "../../src/geometry/orientation.js";
import { Label } from "../../src/graph/label.js";
import { LabelPosition, normalizeLabelPosition } from "../../src/graph/label-position.js";
import {
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_ENGINE_ROUTE_POINTS,
  MAX_ENGINE_TREE_DEPTH,
} from "../../src/limits/constants.js";
import fixtureJson from "../fixtures/labels-directions-routes.json";
import metadataPreservation from "../fixtures/metadata-preservation.json";

const fresh = () => JSON.parse(JSON.stringify(fixtureJson));

function findById(list, id) {
  return (list || []).find((x) => x.id === id);
}

function nestedChain(depth) {
  // Builds root -> n1 -> n2 -> ... -> n{depth} iteratively.
  const root = { id: "root", children: [] };
  let parent = root;
  for (let i = 1; i <= depth; i++) {
    const node = { id: `n${i}`, width: 1, height: 1 };
    parent.children = [node];
    parent = node;
  }
  return root;
}

function assertPlainJson(value) {
  const stack = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null) continue;
    const t = typeof v;
    if (t === "string" || t === "boolean") continue;
    if (t === "number") {
      expect(Number.isFinite(v)).toBe(true);
      continue;
    }
    expect(t).toBe("object");
    const proto = Object.getPrototypeOf(v);
    expect(proto === Object.prototype || proto === Array.prototype).toBe(true);
    for (const k of Object.keys(v)) stack.push(v[k]);
  }
}

describe("ELK adapter final: labels", () => {
  it("imports one node label and one edge label as unset-position Labels", () => {
    const graph = elkToTalaGraph(fresh());
    const group = graph.nodesByExternalId.get("group");
    const a = graph.nodesByExternalId.get("a");
    const b = graph.nodesByExternalId.get("b");
    const inner = graph.edgesByExternalId.get("inner");
    const untouched = graph.edgesByExternalId.get("untouched");

    expect(group.Label).toBeInstanceOf(Label);
    expect(group.Label.Text).toBe("Group");
    expect(group.Label.Width).toBe(50);
    expect(group.Label.Height).toBe(15);
    expect(normalizeLabelPosition(group.Label.Position)).toBe(LabelPosition.Unset);

    // x/y on the input label are not used to infer a position.
    expect(a.Label.Text).toBe("A");
    expect(normalizeLabelPosition(a.Label.Position)).toBe(LabelPosition.Unset);
    expect(b.Label).toBe(null);

    expect(inner.Label).toBeInstanceOf(Label);
    expect(inner.Label.Text).toBe("inner label");
    expect(inner.Label.Width).toBe(40);
    expect(inner.Label.Height).toBe(10);
    expect(normalizeLabelPosition(inner.Label.Position)).toBe(LabelPosition.Unset);
    expect(untouched.Label).toBe(null);
  });

  it("defaults missing label dimensions and text", () => {
    const graph = elkToTalaGraph({
      id: "r",
      children: [{ id: "a", labels: [{ id: "l" }] }, { id: "b" }],
      edges: [{ id: "e", sources: ["a"], targets: ["b"], labels: [{ text: "t" }] }],
    });
    const a = graph.nodesByExternalId.get("a");
    expect(a.Label.Text).toBe("");
    expect(a.Label.Width).toBe(0);
    expect(a.Label.Height).toBe(0);
    const e = graph.edgesByExternalId.get("e");
    expect(e.Label.Text).toBe("t");
    expect(e.Label.Width).toBe(0);
  });

  it("rejects more than one label per node or edge", () => {
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a", labels: [{ text: "1" }, { text: "2" }] }] }),
    ).toThrow("TALA ELK adapter supports at most one node label per node");
    expect(() =>
      elkToTalaGraph({
        id: "r",
        children: [{ id: "a" }, { id: "b" }],
        edges: [{ id: "e", sources: ["a"], targets: ["b"], labels: [{ text: "1" }, { text: "2" }] }],
      }),
    ).toThrow("TALA ELK adapter supports at most one edge label per edge");
  });

  it("rejects negative or non-finite label dimensions", () => {
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a", labels: [{ width: -1 }] }] }),
    ).toThrow('Invalid ELK label on node "a": width must be a finite non-negative number');
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a", labels: [{ height: Infinity }] }] }),
    ).toThrow('Invalid ELK label on node "a": height must be a finite non-negative number');
    expect(() =>
      elkToTalaGraph({
        id: "r",
        children: [{ id: "a" }, { id: "b" }],
        edges: [{ id: "e", sources: ["a"], targets: ["b"], labels: [{ width: NaN }] }],
      }),
    ).toThrow('Invalid ELK label on edge "e": width must be a finite non-negative number');
  });

  it("exports node label geometry relative to the node and preserves label metadata", () => {
    const input = fresh();
    const graph = elkToTalaGraph(input);
    const group = graph.nodesByExternalId.get("group");
    const a = graph.nodesByExternalId.get("a");
    group.Label.Position = LabelPosition.OutsideTopLeft;
    group.Label.Width = 55;

    const out = talaToElkGraph(graph);
    const outGroup = findById(out.children, "group");
    const label = outGroup.labels[0];
    // OutsideTopLeft: (TL.x - 5, TL.y - 5 - height) relative to node TopLeft.
    expect(label.x).toBe(-5);
    expect(label.y).toBe(-20);
    expect(label.width).toBe(55);
    expect(label.height).toBe(15);
    expect(label.id).toBe("group.label");
    expect(label.text).toBe("Group");
    expect(label.custom).toBe("keep");

    // Engine-computed equivalence (absolute minus node TopLeft).
    const tl = group.labelTopLeft(group.Label.Position, 55, 15);
    expect(label.x).toBe(tl.X - group.TopLeft.X);
    expect(label.y).toBe(tl.Y - group.TopLeft.Y);

    // A label without an engine position keeps its input x/y, sizes are written.
    a.Label.Width = 11;
    const out2 = talaToElkGraph(graph);
    const aLabel = findById(findById(out2.children, "group").children, "a").labels[0];
    expect(aLabel.x).toBe(999);
    expect(aLabel.y).toBe(999);
    expect(aLabel.width).toBe(11);
    expect(aLabel.id).toBe("a.label");
  });

  it("exports edge label geometry relative to the edge owner", () => {
    const graph = elkToTalaGraph(fresh());
    const inner = graph.edgesByExternalId.get("inner");
    inner.Points = [new Point(40, 60), new Point(140, 60)];
    inner.Label.Position = LabelPosition.InsideMiddleCenter;

    const out = talaToElkGraph(graph);
    const outInner = findById(findById(out.children, "group").edges, "inner");
    const label = outInner.labels[0];
    // Center at (90,60) absolute, TL (70,55); owner "group" at (10,20).
    expect(label.x).toBe(60);
    expect(label.y).toBe(35);
    expect(label.width).toBe(40);
    expect(label.height).toBe(10);
    expect(label.id).toBe("inner.label");
    expect(label.text).toBe("inner label");
    expect(label.meta).toEqual({ k: 1 });

    // Root-owned edge: absolute == relative.
    const outer = graph.edgesByExternalId.get("outer");
    outer.Points = [new Point(310, 120), new Point(410, 120)];
    outer.Label.Position = LabelPosition.InsideMiddleCenter;
    const out2 = talaToElkGraph(graph);
    const outerLabel = findById(out2.edges, "outer").labels[0];
    expect(outerLabel.x).toBe(360 - 15);
    expect(outerLabel.y).toBe(120 - 4);
  });
});

describe("ELK adapter final: directions", () => {
  it("maps root and container directions", () => {
    const graph = elkToTalaGraph(fresh());
    const group = graph.nodesByExternalId.get("group");
    const b = graph.nodesByExternalId.get("b");
    const a = graph.nodesByExternalId.get("a");
    expect(graph.Directions.get(null)).toBe(Orientation.Bottom);
    expect(graph.direction(null)).toBe(Orientation.Bottom);
    expect(graph.Directions.get(group)).toBe(Orientation.Left);
    // Unknown value "sideways" and absent option leave the direction unset.
    expect(graph.Directions.has(b)).toBe(false);
    expect(graph.direction(b)).toBe(Orientation.NONE);
    expect(graph.Directions.has(a)).toBe(false);
  });

  it("is case-insensitive and follows Go parseDirection", () => {
    const cases = [
      ["UP", Orientation.Top],
      ["up", Orientation.Top],
      ["Down", Orientation.Bottom],
      ["LEFT", Orientation.Left],
      ["rIgHt", Orientation.Right],
    ];
    for (const [value, expected] of cases) {
      expect(parseElkDirection(value)).toBe(expected);
      const graph = elkToTalaGraph({
        id: "r",
        layoutOptions: { "org.eclipse.elk.direction": value },
        children: [{ id: "c", layoutOptions: { "elk.direction": value }, children: [{ id: "x" }] }],
      });
      expect(graph.Directions.get(null)).toBe(expected);
      expect(graph.Directions.get(graph.nodesByExternalId.get("c"))).toBe(expected);
    }
  });

  it("ignores unknown, UNDEFINED, and non-string directions", () => {
    for (const value of ["UNDEFINED", "diagonal", "", 3, null, { v: "UP" }]) {
      const graph = elkToTalaGraph({ id: "r", layoutOptions: { "elk.direction": value } });
      expect(graph.Directions.has(null)).toBe(false);
    }
    const g2 = elkToTalaGraph({ id: "r", layoutOptions: "not-an-object" });
    expect(g2.Directions.size).toBe(0);
  });
});

describe("ELK adapter final: routes", () => {
  it("converts engine Points to one owner-relative section for root and nested edges", () => {
    const input = fresh();
    const graph = elkToTalaGraph(input);
    const inner = graph.edgesByExternalId.get("inner");
    const outer = graph.edgesByExternalId.get("outer");

    // Absolute internal coordinates set by hand (group abs TopLeft = (10,20)).
    expect(graph.nodesByExternalId.get("group").TopLeft.X).toBe(10);
    expect(graph.nodesByExternalId.get("a").TopLeft.Y).toBe(50);
    inner.Points = [new Point(40, 60), new Point(100, 60), new Point(100, 90), new Point(170, 90)];
    outer.Points = [new Point(310, 120), new Point(350, 120), new Point(400, 15)];

    const out = talaToElkGraph(graph);
    const outInner = findById(findById(out.children, "group").edges, "inner");
    expect(outInner.sections).toEqual([
      {
        id: "inner_s0",
        startPoint: { x: 30, y: 40 },
        bendPoints: [{ x: 90, y: 40 }, { x: 90, y: 70 }],
        endPoint: { x: 160, y: 70 },
      },
    ]);
    expect(outInner.customEdge).toBe("inner-meta");

    const outOuter = findById(out.edges, "outer");
    expect(outOuter.sections).toEqual([
      {
        id: "outer_s0",
        startPoint: { x: 310, y: 120 },
        bendPoints: [{ x: 350, y: 120 }],
        endPoint: { x: 400, y: 15 },
      },
    ]);
    expect(outOuter.layoutOptions).toEqual({ "elk.edgeRouting": "ORTHOGONAL" });

    // Stale sections kept only when there are no engine Points.
    expect(findById(out.edges, "untouched").sections).toEqual(input.edges[1].sections);
  });

  it("uses the moved container's absolute offset for nested edges and children", () => {
    const graph = elkToTalaGraph(fresh());
    const group = graph.nodesByExternalId.get("group");
    const a = graph.nodesByExternalId.get("a");
    group.TopLeft = new Point(100, 100);
    a.TopLeft = new Point(120, 130);
    graph.edgesByExternalId.get("inner").Points = [new Point(130, 150), new Point(200, 150)];

    const out = talaToElkGraph(graph);
    const outGroup = findById(out.children, "group");
    expect(outGroup.x).toBe(100);
    expect(outGroup.y).toBe(100);
    const outA = findById(outGroup.children, "a");
    expect(outA.x).toBe(20);
    expect(outA.y).toBe(30);
    const sec = findById(outGroup.edges, "inner").sections;
    expect(sec.length).toBe(1);
    expect(sec[0].startPoint).toEqual({ x: 30, y: 50 });
    expect(sec[0].bendPoints).toEqual([]);
    expect(sec[0].endPoint).toEqual({ x: 100, y: 50 });
  });

  it("omits section id when the original had none, and keeps sections for short Points", () => {
    const input = {
      id: "r",
      children: [{ id: "a" }, { id: "b" }],
      edges: [
        { id: "e1", sources: ["a"], targets: ["b"] },
        { id: "e2", sources: ["a"], targets: ["b"], sections: [{ id: "s", startPoint: { x: 1, y: 1 }, endPoint: { x: 2, y: 2 } }] },
      ],
    };
    const graph = elkToTalaGraph(input);
    graph.edgesByExternalId.get("e1").Points = [new Point(0, 0), new Point(5, 5)];
    graph.edgesByExternalId.get("e2").Points = [new Point(0, 0)];
    const out = talaToElkGraph(graph);
    expect(out.edges[0].sections).toEqual([
      { startPoint: { x: 0, y: 0 }, bendPoints: [], endPoint: { x: 5, y: 5 } },
    ]);
    expect("id" in out.edges[0].sections[0]).toBe(false);
    expect(out.edges[1].sections).toEqual(input.edges[1].sections);
  });

  it("rejects non-finite engine route output", () => {
    const graph = elkToTalaGraph(fresh());
    graph.edgesByExternalId.get("outer").Points = [new Point(0, 0), new Point(NaN, 1)];
    expect(() => talaToElkGraph(graph)).toThrow('TALA ELK adapter produced non-finite route point for edge "outer"');
  });
});

describe("ELK adapter final: preservation and immutability", () => {
  it("preserves port endpoint ids, ports, and custom metadata", () => {
    const input = fresh();
    const graph = elkToTalaGraph(input);
    expect(graph.edgesByExternalId.get("outer").targetEndpointId).toBe("c.p");
    graph.edgesByExternalId.get("outer").Points = [new Point(310, 120), new Point(400, 10)];
    const out = talaToElkGraph(graph);
    const outer = findById(out.edges, "outer");
    expect(outer.sources).toEqual(["group"]);
    expect(outer.targets).toEqual(["c.p"]);
    expect(findById(out.children, "c").ports).toEqual(input.children[1].ports);
    expect(out.layoutOptions).toEqual(input.layoutOptions);
    expect(out.rootMetadata).toEqual({ owner: "fixture" });
    expect(findById(out.children, "group").layoutOptions).toEqual({ "org.eclipse.elk.direction": "Left" });
  });

  it("round-trips metadata-preservation.json, adding only layout-owned fields", () => {
    const input = JSON.parse(JSON.stringify(metadataPreservation));
    const graph = elkToTalaGraph(input);
    expect(graph.Directions.get(graph.nodesByExternalId.get("a"))).toBe(Orientation.Right);
    const out = talaToElkGraph(graph);
    const expected = JSON.parse(JSON.stringify(metadataPreservation));
    for (const child of expected.children) {
      child.x = 0;
      child.y = 0;
    }
    expect(out).toEqual(expected);
    expect(input).toEqual(metadataPreservation);
  });

  it("never mutates the input and never aliases it from the output", () => {
    const input = fresh();
    const snapshot = JSON.parse(JSON.stringify(input));
    const graph = elkToTalaGraph(input);
    expect(input).toEqual(snapshot);

    const group = graph.nodesByExternalId.get("group");
    group.TopLeft = new Point(70, 80);
    group.Label.Position = LabelPosition.OutsideTopLeft;
    graph.edgesByExternalId.get("inner").Points = [new Point(80, 90), new Point(150, 90)];
    graph.edgesByExternalId.get("outer").Points = [new Point(300, 100), new Point(400, 10)];

    const out = talaToElkGraph(graph);
    expect(input).toEqual(snapshot);

    expect(out).not.toBe(input);
    expect(out.children).not.toBe(input.children);
    expect(out.edges).not.toBe(input.edges);
    const outGroup = findById(out.children, "group");
    expect(outGroup).not.toBe(input.children[0]);
    expect(outGroup.labels).not.toBe(input.children[0].labels);
    expect(outGroup.labels[0]).not.toBe(input.children[0].labels[0]);
    expect(outGroup.edges[0].sections).not.toBe(input.children[0].edges[0].sections);
    expect(out.edges[0].sections).not.toBe(input.edges[0].sections);
    expect(out.edges[1].sections).not.toBe(input.edges[1].sections);

    // talaToElkGraph is repeatable: it does not mutate graph.elkData either.
    expect(talaToElkGraph(graph)).toEqual(out);
    expect(graph.elkData).toEqual(snapshot);
  });

  it("produces plain JSON-serializable output", () => {
    const graph = elkToTalaGraph(fresh());
    graph.nodesByExternalId.get("group").Label.Position = LabelPosition.OutsideTopLeft;
    const inner = graph.edgesByExternalId.get("inner");
    inner.Points = [new Point(40, 60), new Point(140, 60)];
    inner.Label.Position = LabelPosition.InsideMiddleCenter;
    const out = talaToElkGraph(graph);
    assertPlainJson(out);
    const text = JSON.stringify(out);
    expect(typeof text).toBe("string");
    expect(JSON.parse(text)).toEqual(out);
  });
});

describe("ELK adapter final: bounds and errors", () => {
  it("rejects null, non-object, and missing root id", () => {
    expect(() => elkToTalaGraph(null)).toThrow("Invalid ELK graph: must be an object");
    expect(() => elkToTalaGraph(undefined)).toThrow("Invalid ELK graph: must be an object");
    expect(() => elkToTalaGraph([])).toThrow("Invalid ELK graph: must be an object");
    expect(() => elkToTalaGraph({})).toThrow("Invalid ELK graph: missing id");
    expect(() => elkToTalaGraph({ id: 5 })).toThrow("Invalid ELK graph: missing id");
  });

  it("rejects duplicate node and edge ids across nesting levels", () => {
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a", children: [{ id: "a" }] }] }),
    ).toThrow('Invalid ELK graph: duplicate node id "a"');
    expect(() =>
      elkToTalaGraph({
        id: "r",
        children: [{ id: "g", children: [{ id: "x" }], edges: [{ id: "e", sources: ["x"], targets: ["x"] }] }],
        edges: [{ id: "e", sources: ["g"], targets: ["g"] }],
      }),
    ).toThrow('Invalid ELK graph: duplicate edge id "e"');
  });

  it("rejects unknown endpoints and hyperedges", () => {
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a" }], edges: [{ id: "e", sources: ["a"], targets: ["zz"] }] }),
    ).toThrow('Invalid ELK edge "e": target endpoint "zz" does not exist');
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a" }, { id: "b" }], edges: [{ id: "e", sources: ["a", "b"], targets: ["b"] }] }),
    ).toThrow('ELK hyperedges are not supported yet: edge "e" has 2 sources');
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a" }, { id: "b" }], edges: [{ id: "e", sources: ["a"], targets: [] }] }),
    ).toThrow('ELK hyperedges are not supported yet: edge "e" has 0 targets');
  });

  it("rejects negative or non-finite node dimensions and coordinates", () => {
    expect(() => elkToTalaGraph({ id: "r", children: [{ id: "a", width: -1 }] })).toThrow(
      'Invalid ELK node "a": width must be a finite non-negative number',
    );
    expect(() => elkToTalaGraph({ id: "r", children: [{ id: "a", height: Infinity }] })).toThrow(
      'Invalid ELK node "a": height must be a finite non-negative number',
    );
    expect(() => elkToTalaGraph({ id: "r", children: [{ id: "a", width: "10" }] })).toThrow(
      'Invalid ELK node "a": width must be a finite non-negative number',
    );
    expect(() => elkToTalaGraph({ id: "r", children: [{ id: "a", x: NaN }] })).toThrow(
      'Invalid ELK node "a": x must be a finite number',
    );
  });

  it("rejects 300-deep nesting with a bounded error, not a stack overflow", () => {
    let error = null;
    try {
      elkToTalaGraph(nestedChain(300));
    } catch (e) {
      error = e;
    }
    expect(error).not.toBe(null);
    expect(error instanceof RangeError).toBe(false);
    expect(error.message).toBe(
      `Invalid ELK graph: nesting depth exceeds the limit of ${MAX_ENGINE_TREE_DEPTH} at node "n${MAX_ENGINE_TREE_DEPTH + 1}"`,
    );
  });

  it("rejects pathologically deep nesting without recursion", () => {
    expect(() => elkToTalaGraph(nestedChain(200_000))).toThrow("nesting depth exceeds the limit");
  });

  it("accepts nesting exactly at the depth limit and round-trips it", () => {
    const input = nestedChain(MAX_ENGINE_TREE_DEPTH);
    const graph = elkToTalaGraph(input);
    expect(graph.Nodes.length).toBe(MAX_ENGINE_TREE_DEPTH);
    const deepest = graph.nodesByExternalId.get(`n${MAX_ENGINE_TREE_DEPTH}`);
    expect(deepest.Container.D2ID).toBe(`n${MAX_ENGINE_TREE_DEPTH - 1}`);
    const out = talaToElkGraph(graph);
    expect(typeof JSON.stringify(out)).toBe("string");
  });

  it("rejects node count overflow", () => {
    const flat = { id: "r", children: Array.from({ length: MAX_ENGINE_NODES + 1 }, (_, i) => ({ id: `n${i}` })) };
    expect(() => elkToTalaGraph(flat)).toThrow(
      `Invalid ELK graph: node count exceeds the limit of ${MAX_ENGINE_NODES}`,
    );
    // Spread across containers so no single array exceeds the limit.
    const half = Math.ceil((MAX_ENGINE_NODES + 1) / 2);
    const split = {
      id: "r",
      children: [
        { id: "g1", children: Array.from({ length: half }, (_, i) => ({ id: `a${i}` })) },
        { id: "g2", children: Array.from({ length: half }, (_, i) => ({ id: `b${i}` })) },
      ],
    };
    expect(() => elkToTalaGraph(split)).toThrow("node count exceeds the limit");
  });

  it("accepts exactly the node limit", () => {
    const flat = { id: "r", children: Array.from({ length: MAX_ENGINE_NODES }, (_, i) => ({ id: `n${i}` })) };
    expect(elkToTalaGraph(flat).Nodes.length).toBe(MAX_ENGINE_NODES);
  });

  it("rejects edge count overflow before building edges", () => {
    const edges = Array.from({ length: MAX_ENGINE_EDGES + 1 }, (_, i) => ({ id: `e${i}`, sources: ["a"], targets: ["a"] }));
    expect(() => elkToTalaGraph({ id: "r", children: [{ id: "a" }], edges })).toThrow(
      `Invalid ELK graph: edge count exceeds the limit of ${MAX_ENGINE_EDGES}`,
    );
    // Split between a container and the root.
    const half = Math.ceil((MAX_ENGINE_EDGES + 1) / 2);
    const mk = (p) => Array.from({ length: half }, (_, i) => ({ id: `${p}${i}`, sources: ["a"], targets: ["a"] }));
    expect(() =>
      elkToTalaGraph({ id: "r", children: [{ id: "a", edges: mk("x") }], edges: mk("y") }),
    ).toThrow("edge count exceeds the limit");
  });

  it("rejects aggregate input route point overflow", () => {
    const bendPoints = new Array(MAX_ENGINE_ROUTE_POINTS - 1); // sparse: cheap
    const input = {
      id: "r",
      children: [{ id: "a" }],
      edges: [
        {
          id: "e",
          sources: ["a"],
          targets: ["a"],
          sections: [{ startPoint: { x: 0, y: 0 }, bendPoints, endPoint: { x: 1, y: 1 } }],
        },
        { id: "e2", sources: ["a"], targets: ["a"], sections: [{ startPoint: { x: 0, y: 0 } }] },
      ],
    };
    expect(() => elkToTalaGraph(input)).toThrow(
      `Invalid ELK graph: route point count exceeds the limit of ${MAX_ENGINE_ROUTE_POINTS}`,
    );
  });
});
