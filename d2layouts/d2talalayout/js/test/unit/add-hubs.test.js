import { describe, it, expect } from "bun:test";
import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster } from "../../src/graph/cluster.js";
import { backgroundWorkContext, abortSignalWorkContext } from "../../src/limits/work-context.js";
import { WorkGuard } from "../../src/limits/work-guard.js";
import { MAX_ENGINE_WORK_UNITS } from "../../src/limits/constants.js";
import { addHubs, AddHubs } from "../../src/proximity/index.js";

describe("Slice 28 — Proximity AddHubs Direct Unit Tests", () => {
  it("exports both addHubs and AddHubs identically from proximity index", () => {
    expect(typeof addHubs).toBe("function");
    expect(typeof AddHubs).toBe("function");
    expect(AddHubs).toBe(addHubs);
  });

  it("1. Validate executes before hub replacement and prevents mutation on error", () => {
    const g = new Graph();
    const n1 = new Node(1, 10, 10);
    const n2 = new Node(2, 10, 10);
    g.Nodes = [n1, n2];
    // Create an invalid container cycle to trigger preflight validation error
    n1.Container = n2;
    n2.Container = n1;
    n1.isContainer = true;
    n2.isContainer = true;

    const initialHubs = new Map([[n1, [n2]]]);
    g.Hubs = initialHubs;

    expect(() => addHubs(backgroundWorkContext(), g)).toThrow(/cycle detected/);
    expect(g.Hubs).toBe(initialHubs);
    expect(g.Hubs.get(n1)).toEqual([n2]);
  });

  it("2. graph.Nodes source order is used without sorting or deduplication", () => {
    const g = new Graph();
    const h1 = new Node(100, 10, 10);
    const s1 = new Node(101, 10, 10);
    const c1 = new Node(102, 10, 10);
    const o1 = new Node(103, 10, 10);

    const h2 = new Node(10, 10, 10);
    const s2 = new Node(11, 10, 10);
    const c2 = new Node(12, 10, 10);
    const o2 = new Node(13, 10, 10);

    // Deliberately place h1 (ID 100) before h2 (ID 10) in graph.Nodes
    for (const n of [h1, s1, c1, o1, h2, s2, c2, o2]) {
      g.AddNewNodeToContainer(null, n);
    }
    g.Connect(h1, s1);
    g.Connect(h1, c1);
    g.Connect(c1, o1);

    g.Connect(h2, s2);
    g.Connect(h2, c2);
    g.Connect(c2, o2);

    addHubs(backgroundWorkContext(), g);

    // Map keys insertion order in JS preserves discovery order (which follows graph.Nodes order)
    const hubKeys = Array.from(g.Hubs.keys());
    expect(hubKeys).toEqual([h1, c1, h2, c2]);
  });

  it("3. node.Edges source order determines spoke order", () => {
    const g = new Graph();
    const hub = new Node(1, 10, 10);
    const s99 = new Node(99, 10, 10);
    const conn = new Node(5, 10, 10);
    const other = new Node(6, 10, 10);
    const s11 = new Node(11, 10, 10);
    const s55 = new Node(55, 10, 10);

    for (const n of [hub, s99, conn, other, s11, s55]) {
      g.AddNewNodeToContainer(null, n);
    }

    // Connect in order: s99, conn, s11, s55
    g.Connect(hub, s99);
    g.Connect(hub, conn);
    g.Connect(conn, other);
    g.Connect(hub, s11);
    g.Connect(hub, s55);

    addHubs(backgroundWorkContext(), g);

    const spokes = g.Hubs.get(hub);
    expect(spokes).toBeDefined();
    expect(spokes.map((s) => s.ID)).toEqual([99, 11, 55]);
  });

  it("4. OwningContainer is called and used, not raw Container comparison", () => {
    const g = new Graph();
    const parent = new Node(100, 200, 200);
    parent.isContainer = true;
    g.AddNewNodeToContainer(null, parent);

    const vessel = new Node(10, 50, 50);
    vessel.isClusterVessel = true;
    g.AddNewNodeToContainer(parent, vessel);

    const hub = new Node(1, 10, 10);
    const spoke = new Node(2, 10, 10);
    const conn = new Node(3, 10, 10);
    const other = new Node(4, 10, 10);

    const cluster = new Cluster({
      Vessel: vessel,
      Nodes: [hub, spoke],
      Graph: g,
    });
    g.Clusters.set(vessel, cluster);
    hub.Cluster = cluster;
    spoke.Cluster = cluster;

    // conn is directly in parent (Container = parent, Cluster = null)
    // hub is in cluster (Container = null, Cluster = cluster -> OwningContainer = parent)
    g.AddNewNodeToContainer(parent, conn);
    g.AddNewNodeToContainer(parent, other);
    g.Nodes.push(hub, spoke);

    g.Connect(hub, spoke);
    g.Connect(hub, conn);
    g.Connect(conn, other);

    // hub.Container (null) !== conn.Container (parent),
    // but hub.OwningContainer() (parent) === conn.OwningContainer() (parent)
    expect(hub.Container).not.toBe(conn.Container);
    expect(hub.OwningContainer()).toBe(conn.OwningContainer());

    let owningContainerCalls = 0;
    const origHubOwning = hub.OwningContainer.bind(hub);
    hub.OwningContainer = () => {
      owningContainerCalls++;
      return origHubOwning();
    };

    addHubs(backgroundWorkContext(), g);

    expect(owningContainerCalls).toBeGreaterThan(0);
    expect(g.Hubs.has(hub)).toBe(true);
    expect(g.Hubs.get(hub)).toEqual([spoke]);
  });

  it("5. WorkGuard Step accounting is exactly 1 per graph node + 1 per scanned node edge", () => {
    const g = new Graph();
    const hub = new Node(1, 10, 10);
    const spoke = new Node(2, 10, 10);
    const conn = new Node(3, 10, 10);
    const other = new Node(4, 10, 10);

    for (const n of [hub, spoke, conn, other]) {
      g.AddNewNodeToContainer(null, n);
    }
    g.Connect(hub, spoke);
    g.Connect(hub, conn);
    g.Connect(conn, other);

    // Node count = 4
    // Incident edges:
    // hub: 2 edges
    // spoke: 1 edge
    // conn: 2 edges
    // other: 1 edge
    // Total edge scans = 2 + 1 + 2 + 1 = 6
    // Total WorkGuard steps in AddHubs body = 4 (nodes) + 6 (edges) = 10 steps.
    let stepCount = 0;
    const origStep = WorkGuard.prototype.Step;
    WorkGuard.prototype.Step = function () {
      // Preflight guard calls SetLimit(MAX_PREFLIGHT_WORK).
      // AddHubs guard retains MAX_ENGINE_WORK_UNITS.
      if (this.location === "AddHubs" && this.limit === MAX_ENGINE_WORK_UNITS) {
        stepCount++;
      }
      return origStep.apply(this, arguments);
    };

    try {
      addHubs(backgroundWorkContext(), g);
      expect(stepCount).toBe(10);
    } finally {
      WorkGuard.prototype.Step = origStep;
    }
  });

  it("6. guard.Finish() occurs before graph.Hubs replacement", () => {
    const g = new Graph();
    const hub = new Node(1, 10, 10);
    const spoke = new Node(2, 10, 10);
    const conn = new Node(3, 10, 10);
    const other = new Node(4, 10, 10);

    for (const n of [hub, spoke, conn, other]) {
      g.AddNewNodeToContainer(null, n);
    }
    g.Connect(hub, spoke);
    g.Connect(hub, conn);
    g.Connect(conn, other);

    const oldHubs = g.Hubs;
    let finishCalled = false;
    let hubsAtFinishTime = null;

    const origFinish = WorkGuard.prototype.Finish;
    WorkGuard.prototype.Finish = function () {
      if (this.location === "AddHubs" && this.limit === MAX_ENGINE_WORK_UNITS) {
        finishCalled = true;
        hubsAtFinishTime = g.Hubs;
      }
      return origFinish.apply(this, arguments);
    };

    try {
      addHubs(backgroundWorkContext(), g);
      expect(finishCalled).toBe(true);
      // At the moment finish was called, g.Hubs must still be oldHubs
      expect(hubsAtFinishTime).toBe(oldHubs);
      // After completion, g.Hubs was replaced
      expect(g.Hubs).not.toBe(oldHubs);
    } finally {
      WorkGuard.prototype.Finish = origFinish;
    }
  });

  it("7. Failure preserves exact old Map reference and entries", () => {
    const g = new Graph();
    const hub = new Node(1, 10, 10);
    const spoke = new Node(2, 10, 10);
    g.AddNewNodeToContainer(null, hub);
    g.AddNewNodeToContainer(null, spoke);

    const oldHubs = new Map([[hub, [spoke]]]);
    g.Hubs = oldHubs;

    const controller = new AbortController();
    controller.abort();
    const ctx = abortSignalWorkContext(controller.signal);

    expect(() => addHubs(ctx, g)).toThrow();
    expect(g.Hubs).toBe(oldHubs);
    expect(g.Hubs.get(hub)).toEqual([spoke]);
  });

  it("8. Success installs a fresh Map reference even if empty", () => {
    const g = new Graph();
    const oldHubs = g.Hubs;

    addHubs(backgroundWorkContext(), g);

    expect(g.Hubs).not.toBe(oldHubs);
    expect(g.Hubs instanceof Map).toBe(true);
    expect(g.Hubs.size).toBe(0);
  });

  it("9. Successful result does not mutate any non-Hubs topology", () => {
    const g = new Graph();
    const hub = new Node(1, 10, 10);
    const spoke = new Node(2, 10, 10);
    const conn = new Node(3, 10, 10);
    const other = new Node(4, 10, 10);

    for (const n of [hub, spoke, conn, other]) {
      g.AddNewNodeToContainer(null, n);
    }
    g.Connect(hub, spoke);
    g.Connect(hub, conn);
    g.Connect(conn, other);

    const nodesSnapshot = [...g.Nodes];
    const edgesSnapshot = [...g.Edges];
    const containersSnapshot = new Map(g.Containers);
    const clustersSnapshot = new Map(g.Clusters);
    const sequencesSnapshot = new Map(g.Sequences);
    const nodeEdgesMap = new Map(g.Nodes.map((n) => [n, [...n.Edges]]));
    const nodeNearsMap = new Map(g.Nodes.map((n) => [n, new Set(n.Nears)]));

    addHubs(backgroundWorkContext(), g);

    expect(g.Nodes).toEqual(nodesSnapshot);
    expect(g.Edges).toEqual(edgesSnapshot);
    expect(Array.from(g.Containers.entries())).toEqual(Array.from(containersSnapshot.entries()));
    expect(Array.from(g.Clusters.entries())).toEqual(Array.from(clustersSnapshot.entries()));
    expect(Array.from(g.Sequences.entries())).toEqual(Array.from(sequencesSnapshot.entries()));

    for (const n of g.Nodes) {
      expect(n.Edges).toEqual(nodeEdgesMap.get(n));
      expect(n.Nears).toEqual(nodeNearsMap.get(n));
    }
  });
});
