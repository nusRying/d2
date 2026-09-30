import { describe, expect, test } from "bun:test";

import {
  Graph,
  Node,
  Edge,
  Cluster,
  ClusterArrangement,
  Point,
  WorkGuard,
  backgroundWorkContext,
  abortSignalWorkContext,
  WorkLimitError,
  WorkCanceledError,
} from "../../src/index.js";

import * as rootExports from "../../src/index.js";

import {
  createVessel,
  CreateVessel,
  addCluster,
  AddCluster,
  abductClusterEdges,
} from "../../src/grouping/index.js";

import * as groupingExports from "../../src/grouping/index.js";

describe("Slice 14 Direct Unit Tests - Cluster Mutation Primitives", () => {
  describe("API and Export Boundaries", () => {
    test("grouping exports required mutation primitives", () => {
      expect(typeof createVessel).toBe("function");
      expect(typeof CreateVessel).toBe("function");
      expect(createVessel).toBe(CreateVessel);

      expect(typeof addCluster).toBe("function");
      expect(typeof AddCluster).toBe("function");
      expect(addCluster).toBe(AddCluster);

      expect(typeof abductClusterEdges).toBe("function");
      // abductClusterEdges is private in Go -> no PascalCase export!
      expect(groupingExports.AbductClusterEdges).toBeUndefined();
    });

    test("root index.js does NOT export grouping primitives", () => {
      expect(rootExports.createVessel).toBeUndefined();
      expect(rootExports.CreateVessel).toBeUndefined();
      expect(rootExports.addCluster).toBeUndefined();
      expect(rootExports.AddCluster).toBeUndefined();
      expect(rootExports.abductClusterEdges).toBeUndefined();
      expect(rootExports.buildClusterDiscoveryIndex).toBeUndefined();
    });

    test("Cluster class has resize and Resize methods", () => {
      const c = new Cluster();
      expect(typeof c.resize).toBe("function");
      expect(typeof c.Resize).toBe("function");
    });
  });

  describe("Cluster.Resize", () => {
    test("throws if vessel is null", () => {
      const c = new Cluster();
      expect(() => c.resize(null)).toThrow("cluster is missing its vessel");
      expect(() => c.Resize(null)).toThrow("cluster is missing its vessel");
    });

    test("throws if a member is null", () => {
      const n1 = new Node(1, 40, 30);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, null],
        Arrangement: ClusterArrangement.Row,
      });
      expect(() => c.resize(vessel)).toThrow("cluster contains a nil node");
    });

    test("normalizes members when FixedSize=false", () => {
      const n1 = new Node(1, 30, 50);
      const n2 = new Node(2, 60, 20);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(n1.Width).toBe(60);
      expect(n1.Height).toBe(50);
      expect(n2.Width).toBe(60);
      expect(n2.Height).toBe(50);
      expect(vessel.Width).toBe(60 * 2 + 10 * 1); // 130
      expect(vessel.Height).toBe(50);
    });

    test("does NOT normalize members when FixedSize=true", () => {
      const n1 = new Node(1, 30, 50);
      const n2 = new Node(2, 60, 20);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Column,
        Padding: 10,
        FixedSize: true,
      });

      c.resize(vessel);

      expect(n1.Width).toBe(30);
      expect(n1.Height).toBe(50);
      expect(n2.Width).toBe(60);
      expect(n2.Height).toBe(20);
      expect(vessel.Width).toBe(60);
      expect(vessel.Height).toBe(50 * 2 + 10 * 1); // 110
    });

    test("preserves empty cluster negative padding arithmetic", () => {
      const vessel = new Node(99, 50, 50);
      const cRow = new Cluster({
        Nodes: [],
        Arrangement: ClusterArrangement.Row,
        Padding: 20,
      });
      cRow.resize(vessel);
      expect(vessel.Width).toBe(-20); // 0 * 0 + 20 * -1
      expect(vessel.Height).toBe(0);

      const vesselCol = new Node(98, 50, 50);
      const cCol = new Cluster({
        Nodes: [],
        Arrangement: ClusterArrangement.Column,
        Padding: 35,
      });
      cCol.resize(vesselCol);
      expect(vesselCol.Width).toBe(0);
      expect(vesselCol.Height).toBe(-35); // 0 * 0 + 35 * -1
    });
  });

  describe("CreateVessel", () => {
    test("does NOT assign cluster.Vessel or install vessel into graph", () => {
      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(10, 20);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = new Point(50, 20);

      const cluster = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      expect(cluster.Vessel).toBe(null);

      const vessel = createVessel(cluster, 777);

      // Crucial: CreateVessel does NOT set cluster.Vessel
      expect(cluster.Vessel).toBe(null);
      expect(vessel.Graph).toBe(null);
      expect(vessel.Container).toBe(null);
      expect(vessel.isClusterVessel).toBe(true);
      expect(String(vessel.ID)).toBe("777");
      expect(n1.Cluster).toBe(null);
      expect(n2.Cluster).toBe(null);
    });

    test("sorts cluster.Nodes in place and sets vessel.TopLeft when positioned", () => {
      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(100, 50);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = new Point(20, 80);
      const n3 = new Node(3, 40, 30);
      n3.TopLeft = new Point(60, 10);

      const cluster = new Cluster({
        Nodes: [n1, n2, n3],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      const vessel = createVessel(cluster, 888);

      expect(cluster.Nodes).toEqual([n2, n3, n1]); // sorted ascending by X
      expect(vessel.TopLeft.X).toBe(20); // min X from n2
      expect(vessel.TopLeft.Y).toBe(10); // min Y from n3
    });

    test("does not sort when no member is positioned", () => {
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const cluster = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      const vessel = createVessel(cluster, 999);

      expect(cluster.Nodes).toEqual([n1, n2]); // unchanged
      expect(vessel.TopLeft).toBe(null);
    });

    test("special coordinates (-Infinity) gate and sorting parity", () => {
      // Row with -Infinity X
      {
        const n1 = new Node(1, 40, 30);
        n1.TopLeft = new Point(-Infinity, 20);
        const n2 = new Node(2, 40, 30);
        n2.TopLeft = new Point(50, 20);

        const cluster = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Row,
          Padding: 10,
        });
        const vessel = createVessel(cluster, 901);
        expect(vessel.TopLeft !== null).toBe(true);
        expect(vessel.TopLeft.X).toBe(-Infinity);
        expect(vessel.TopLeft.Y).toBe(20);
        expect(cluster.Nodes).toEqual([n1, n2]);
      }
      // Column with -Infinity Y
      {
        const n1 = new Node(1, 40, 30);
        n1.TopLeft = new Point(20, 50);
        const n2 = new Node(2, 40, 30);
        n2.TopLeft = new Point(20, -Infinity);

        const cluster = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Column,
          Padding: 10,
        });
        const vessel = createVessel(cluster, 902);
        expect(vessel.TopLeft !== null).toBe(true);
        expect(vessel.TopLeft.X).toBe(20);
        expect(vessel.TopLeft.Y).toBe(-Infinity);
        expect(cluster.Nodes).toEqual([n2, n1]); // n2 (-Inf) sorted before n1 (50)
      }
    });

    test("special coordinates (NaN) gate and sorting parity", () => {
      // Row with NaN X
      {
        const n1 = new Node(1, 40, 30);
        n1.TopLeft = new Point(NaN, 20);
        const n2 = new Node(2, 40, 30);
        n2.TopLeft = new Point(50, 20);

        const cluster = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Row,
          Padding: 10,
        });
        const vessel = createVessel(cluster, 903);
        expect(vessel.TopLeft !== null).toBe(true);
        expect(Number.isNaN(vessel.TopLeft.X)).toBe(true);
        expect(vessel.TopLeft.Y).toBe(20);
        expect(cluster.Nodes).toEqual([n1, n2]);
      }
      // Column with NaN Y
      {
        const n1 = new Node(1, 40, 30);
        n1.TopLeft = new Point(20, NaN);
        const n2 = new Node(2, 40, 30);
        n2.TopLeft = new Point(20, 50);

        const cluster = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Column,
          Padding: 10,
        });
        const vessel = createVessel(cluster, 904);
        expect(vessel.TopLeft !== null).toBe(true);
        expect(vessel.TopLeft.X).toBe(20);
        expect(Number.isNaN(vessel.TopLeft.Y)).toBe(true);
        expect(cluster.Nodes).toEqual([n1, n2]);
      }
    });

    test("large tie sets (13, 20, 32) match Go 1.27 sort.Slice pdqsort order", () => {
      const coords13 = [50, 50, 20, 50, 30, 30, 50, 20, 40, 50, 30, 20, 50];
      const expected13 = [8, 12, 3, 11, 5, 6, 9, 7, 1, 10, 4, 2, 13];

      const nodes13 = coords13.map((c, i) => {
        const n = new Node(i + 1, 40, 30);
        n.TopLeft = new Point(c, 10);
        return n;
      });
      const cluster13 = new Cluster({
        Nodes: nodes13,
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });
      createVessel(cluster13, 913);
      expect(cluster13.Nodes.map(n => n.ID)).toEqual(expected13);

      const coords20 = [50, 20, 30, 50, 20, 40, 30, 50, 20, 30, 40, 50, 20, 30, 50, 40, 20, 30, 50, 20];
      const expected20 = [13, 2, 20, 5, 17, 9, 3, 18, 7, 10, 14, 11, 16, 6, 12, 1, 15, 8, 19, 4];
      const nodes20 = coords20.map((c, i) => {
        const n = new Node(i + 1, 40, 30);
        n.TopLeft = new Point(10, c);
        return n;
      });
      const cluster20 = new Cluster({
        Nodes: nodes20,
        Arrangement: ClusterArrangement.Column,
        Padding: 10,
      });
      createVessel(cluster20, 920);
      expect(cluster20.Nodes.map(n => n.ID)).toEqual(expected20);

      const coords32 = [
        50, 20, 30, 50, 20, 40, 30, 50, 20, 30, 40, 50, 20, 30, 50, 40,
        20, 30, 50, 20, 10, 60, 30, 20, 50, 40, 30, 20, 50, 60, 10, 30,
      ];
      const expected32 = [21, 31, 17, 28, 5, 24, 20, 2, 9, 13, 7, 27, 10, 14, 32, 18, 3, 23, 11, 26, 6, 16, 15, 19, 25, 12, 1, 29, 8, 4, 22, 30];
      const nodes32 = coords32.map((c, i) => {
        const n = new Node(i + 1, 40, 30);
        n.TopLeft = new Point(c, 10);
        return n;
      });
      const cluster32 = new Cluster({
        Nodes: nodes32,
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });
      createVessel(cluster32, 932);
      expect(cluster32.Nodes.map(n => n.ID)).toEqual(expected32);
    });
  });

  describe("AddCluster", () => {
    test("does NOT reconnect edges or modify node.Edges", () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext);

      const e1 = g.connect(n1, ext);
      const e2 = g.connect(ext, n2);
      const eInternal = g.connect(n1, n2);

      const vessel = new Node(500, 90, 30);
      vessel.setClusterVessel(true);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: null,
        Graph: g,
      });

      addCluster(g, cluster);

      // Verify edges were NOT touched by AddCluster!
      expect(e1.From).toBe(n1);
      expect(e1.To).toBe(ext);
      expect(e2.From).toBe(ext);
      expect(e2.To).toBe(n2);
      expect(eInternal.From).toBe(n1);
      expect(eInternal.To).toBe(n2);

      expect(n1.Edges.length).toBe(2); // e1, eInternal
      expect(n2.Edges.length).toBe(2); // e2, eInternal
      expect(vessel.Edges.length).toBe(0); // vessel has no edges yet!
      expect(cluster.EdgeAbductions.length).toBe(0);
    });

    test("installs vessel and sets member attributes exactly", () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);

      const vessel = new Node(500, 90, 30);
      vessel.setClusterVessel(true);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: null,
        Graph: g,
      });

      addCluster(g, cluster);

      expect(g.Nodes.includes(vessel)).toBe(true);
      expect(vessel.Graph).toBe(g);
      expect(vessel.Container).toBe(null);
      expect(g.Containers.get(null)).toEqual([vessel]);

      expect(n1.Cluster).toBe(cluster);
      expect(n2.Cluster).toBe(cluster);
      expect(n1.Container).toBe(null);
      expect(n2.Container).toBe(null);
      expect(n1.Graph).toBe(g);
      expect(n2.Graph).toBe(g);

      expect(g.Nodes.includes(n1)).toBe(false);
      expect(g.Nodes.includes(n2)).toBe(false);
      expect(g.Clusters.get(vessel)).toBe(cluster);
    });

    test("filters out any existing container child with same cluster pointer", () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const rogue = new Node(99, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, rogue);

      const vessel = new Node(500, 90, 30);
      vessel.setClusterVessel(true);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Container: null,
        Graph: g,
      });

      // Rogue carries same cluster pointer
      rogue.Cluster = cluster;

      addCluster(g, cluster);

      // rogue is filtered from g.Containers[null] even though not in cluster.Nodes!
      expect(g.Containers.get(null).includes(rogue)).toBe(false);
      // but rogue was NOT in cluster.Nodes, so removeNode was not called on it:
      expect(g.Nodes.includes(rogue)).toBe(true);
    });
  });

  describe("abductClusterEdges", () => {
    test("does reconnect edges to vessel and creates abductions", () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const ext = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext);

      const eOut = g.connect(n1, ext);
      const eIn = g.connect(ext, n1);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
        Graph: g,
      });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [eOut, eIn], guard);

      expect(eOut.From).toBe(vessel);
      expect(eOut.To).toBe(ext);
      expect(eIn.From).toBe(ext);
      expect(eIn.To).toBe(vessel);

      expect(vessel.Edges).toEqual([eOut, eIn]);
      expect(n1.Edges.length).toBe(0);
      expect(cluster.EdgeAbductions.length).toBe(2);
    });

    test("publishes cluster.EdgeAbductions only after success", () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext);

      const e1 = g.connect(n1, ext);
      const e2 = g.connect(n2, ext);

      const vessel = new Node(500, 0, 0);
      const sentinel = [{ dummy: true }];
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        EdgeAbductions: sentinel,
      });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      // Limit of 2: e1 succeeds, e2 fails
      const guard = new WorkGuard(backgroundWorkContext(), "test", 2);

      expect(() => {
        abductClusterEdges(cluster, [e1, e2], guard);
      }).toThrow(WorkLimitError);

      // Exact identity of sentinel array retained!
      expect(cluster.EdgeAbductions).toBe(sentinel);
    });

    test("partial failure leaves earlier mutations in place without rollback", () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext);

      const e1 = g.connect(n1, ext);
      const e2 = g.connect(n2, ext);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
      });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 2);

      expect(() => {
        abductClusterEdges(cluster, [e1, e2], guard);
      }).toThrow(WorkLimitError);

      // e1 remains reconnected to vessel!
      expect(e1.From).toBe(vessel);
      expect(vessel.Edges.includes(e1)).toBe(true);
      expect(n1.Edges.includes(e1)).toBe(false);

      // e2 was not reached for reconnect:
      expect(e2.From).toBe(n2);
      expect(n2.Edges.includes(e2)).toBe(true);
    });

    test("preserves route point identities on abducted edges", () => {
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const ext = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext);

      const edge = g.connect(n1, ext);
      const pt1 = new Point(10, 10);
      const pt2 = new Point(50, 50);
      const pts = [pt1, pt2];
      edge.Points = pts;

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1] });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [edge], guard);

      expect(edge.Points).toBe(pts);
      expect(edge.Points[0]).toBe(pt1);
      expect(edge.Points[1]).toBe(pt2);
    });

    test("mid-operation cancellation asserts WorkCanceledError, location, and partial state", () => {
      const controller = new AbortController();
      const ctx = abortSignalWorkContext(controller.signal);

      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext);

      const e1 = g.connect(n1, ext);
      for (let i = 0; i < 70; i++) {
        g.connect(n2, ext);
      }
      const e2 = g.connect(n2, ext);
      for (let i = 0; i < 1000; i++) {
        g.connect(n2, ext);
      }

      const vessel = new Node(500, 0, 0);
      const sentinel = [{ dummy: true }];
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        EdgeAbductions: sentinel,
      });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      const guard = new WorkGuard(ctx, "test", 10000);
      controller.abort();

      let caughtErr;
      try {
        abductClusterEdges(cluster, [e1, e2], guard);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(WorkCanceledError);
      expect(caughtErr.location).toBe("test");
      expect(guard.Used()).toBe(1024n);

      // Partial mutation assertions:
      expect(e1.From).toBe(vessel);
      expect(e2.From).toBe(n2);
      expect(cluster.EdgeAbductions).toBe(sentinel); // exact identity retained
      expect(vessel.Edges.length).toBe(1);
    });

    test("final-Finish cancellation asserts WorkCanceledError, published abductions, and reconnected topology", () => {
      const controller = new AbortController();
      const ctx = abortSignalWorkContext(controller.signal);

      const g = new Graph();
      const n1 = new Node(1, 10, 10);
      const ext = new Node(2, 10, 10);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext);
      const e1 = g.connect(n1, ext);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
      });
      n1.Cluster = cluster;

      const guard = new WorkGuard(ctx, "test", 10000);
      controller.abort(); // Cancel after guard creation; loop charges 2 units, well below 1024 stride

      let caughtErr;
      try {
        abductClusterEdges(cluster, [e1], guard);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(WorkCanceledError);
      expect(caughtErr.location).toBe("test");
      expect(guard.Used()).toBe(2n);

      // Reconnects applied and abductions published before final Finish:
      expect(cluster.EdgeAbductions.length).toBe(1);
      expect(cluster.EdgeAbductions[0].CurrentFrom).toBe(vessel);
      expect(e1.From).toBe(vessel);
      expect(e1.To).toBe(ext);
      expect(vessel.Edges.length).toBe(1);
      expect(n1.Edges.length).toBe(0);
    });
  });
});
