import { describe, expect, test } from "bun:test";
import referenceData from "../fixtures/go-cluster-mutation-reference.json";

import {
  Graph,
  Node,
  Edge,
  Cluster,
  ClusterArrangement,
  Point,
  WorkGuard,
  backgroundWorkContext,
  WorkLimitError,
  WorkCanceledError,
  abortSignalWorkContext,
} from "../../src/internal.js";

import {
  createVessel,
  addCluster,
  abductClusterEdges,
} from "../../src/grouping/index.js";

function connectWithID(g, id, from, to) {
  const edge = g.connect(from, to);
  edge.ID = BigInt(id);
  return edge;
}

describe("Slice 14 Go Oracle Parity - Cluster Mutation and Edge Abduction Primitives", () => {
  const { metadata, scenarios } = referenceData;

  test("fixture metadata matches expectations", () => {
    expect(metadata.pinnedD2SHA).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    expect(metadata.oracleBuildTag).toBe("tala_cluster_mutation_oracle");
    expect(typeof metadata.runtimeGoVersion).toBe("string");
  });

  describe("1. Cluster.Resize", () => {
    const s = scenarios.resize;

    test("row_unequal_dimensions", () => {
      const exp = s.row_unequal_dimensions;
      const n1 = new Node(1, 50, 30);
      const n2 = new Node(2, 80, 20);
      const n3 = new Node(3, 40, 60);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2, n3],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
      expect(n3.Width).toBe(exp.node3Width);
      expect(n3.Height).toBe(exp.node3Height);
    });

    test("column_unequal_dimensions", () => {
      const exp = s.column_unequal_dimensions;
      const n1 = new Node(1, 30, 40);
      const n2 = new Node(2, 50, 20);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Column,
        Padding: 15,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("row_fixed_size", () => {
      const exp = s.row_fixed_size;
      const n1 = new Node(1, 50, 30);
      const n2 = new Node(2, 80, 20);
      const n3 = new Node(3, 40, 60);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2, n3],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: true,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
      expect(n3.Width).toBe(exp.node3Width);
      expect(n3.Height).toBe(exp.node3Height);
    });

    test("column_fixed_size", () => {
      const exp = s.column_fixed_size;
      const n1 = new Node(1, 30, 40);
      const n2 = new Node(2, 50, 20);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Column,
        Padding: 15,
        FixedSize: true,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("negative_dimensions", () => {
      const exp = s.negative_dimensions;
      const n1 = new Node(1, -10, -20);
      const n2 = new Node(2, -5, 15);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 5,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("zero_dimensions", () => {
      const exp = s.zero_dimensions;
      const n1 = new Node(1, 0, 0);
      const n2 = new Node(2, 0, 0);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Column,
        Padding: 8,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("duplicate_member_reference", () => {
      const exp = s.duplicate_member_reference;
      const n1 = new Node(1, 25, 35);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, n1],
        Arrangement: ClusterArrangement.Row,
        Padding: 12,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
    });

    test("empty_row", () => {
      const exp = s.empty_row;
      const vessel = new Node(99, 100, 100);
      const c = new Cluster({
        Nodes: [],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
    });

    test("empty_column", () => {
      const exp = s.empty_column;
      const vessel = new Node(99, 100, 100);
      const c = new Cluster({
        Nodes: [],
        Arrangement: ClusterArrangement.Column,
        Padding: 15,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
    });

    test("unknown_arrangement", () => {
      const exp = s.unknown_arrangement;
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 50, 20);
      const vessel = new Node(99, 999, 888);
      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: "Other",
        Padding: 10,
        FixedSize: false,
      });

      c.resize(vessel);

      expect(vessel.Width).toBe(exp.vesselWidth);
      expect(vessel.Height).toBe(exp.vesselHeight);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("nil_member_failure", () => {
      const exp = s.nil_member_failure;
      const n1 = new Node(1, 10, 10);
      const n2 = new Node(2, 20, 20);
      const vessel = new Node(99, 0, 0);
      const c = new Cluster({
        Nodes: [n1, null, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      expect(() => c.resize(vessel)).toThrow("cluster contains a nil node");
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("nil_vessel_failure", () => {
      const n1 = new Node(1, 10, 10);
      const c = new Cluster({
        Nodes: [n1],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      expect(() => c.resize(null)).toThrow("cluster is missing its vessel");
    });
  });

  describe("2. CreateVessel", () => {
    const s = scenarios.createVessel;

    test("row_unsorted_positioned", () => {
      const exp = s.row_unsorted_positioned;
      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(100, 50);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = new Point(20, 80);
      const n3 = new Node(3, 40, 30);
      n3.TopLeft = new Point(60, 10);

      const c = new Cluster({
        Nodes: [n1, n2, n3],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      const v = createVessel(c, 500);

      expect(String(v.ID)).toBe(exp.vessel.id);
      expect(v.Width).toBe(exp.vessel.width);
      expect(v.Height).toBe(exp.vessel.height);
      expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
      expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      expect(v.isClusterVessel).toBe(true);
      expect(c.Nodes.map((n) => String(n.ID))).toEqual(exp.nodeOrder);
      expect(c.Vessel).toBe(null); // CreateVessel does NOT assign c.Vessel!
    });

    test("column_unsorted_positioned", () => {
      const exp = s.column_unsorted_positioned;
      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(50, 100);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = new Point(80, 20);
      const n3 = new Node(3, 40, 30);
      n3.TopLeft = new Point(10, 60);

      const c = new Cluster({
        Nodes: [n1, n2, n3],
        Arrangement: ClusterArrangement.Column,
        Padding: 15,
        FixedSize: false,
      });

      const v = createVessel(c, 501);

      expect(String(v.ID)).toBe(exp.vessel.id);
      expect(v.Width).toBe(exp.vessel.width);
      expect(v.Height).toBe(exp.vessel.height);
      expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
      expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      expect(c.Nodes.map((n) => String(n.ID))).toEqual(exp.nodeOrder);
    });

    test("independent_min_x_min_y", () => {
      const exp = s.independent_min_x_min_y;
      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(15, 80);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = new Point(90, 25);

      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      const v = createVessel(c, 502);

      expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
      expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
    });

    test("no_positioned_members", () => {
      const exp = s.no_positioned_members;
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 50, 20);

      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      const v = createVessel(c, 503);

      expect(v.TopLeft).toBe(null);
      expect(c.Nodes.map((n) => String(n.ID))).toEqual(exp.nodeOrder);
    });

    test("fixed_size_false_resize", () => {
      const exp = s.fixed_size_false_resize;
      const n1 = new Node(1, 30, 40);
      n1.TopLeft = new Point(10, 10);
      const n2 = new Node(2, 60, 25);
      n2.TopLeft = new Point(50, 50);

      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: false,
      });

      const v = createVessel(c, 504);

      expect(v.Width).toBe(exp.vessel.width);
      expect(v.Height).toBe(exp.vessel.height);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("fixed_size_true", () => {
      const exp = s.fixed_size_true;
      const n1 = new Node(1, 30, 40);
      n1.TopLeft = new Point(10, 10);
      const n2 = new Node(2, 60, 25);
      n2.TopLeft = new Point(50, 50);

      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: true,
      });

      const v = createVessel(c, 505);

      expect(v.Width).toBe(exp.vessel.width);
      expect(v.Height).toBe(exp.vessel.height);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("negative_dimensions_resize", () => {
      const exp = s.negative_dimensions_resize;
      const n1 = new Node(1, -10, -5);
      n1.TopLeft = new Point(5, 5);
      const n2 = new Node(2, -20, 30);
      n2.TopLeft = new Point(20, 20);

      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Column,
        Padding: 5,
        FixedSize: false,
      });

      const v = createVessel(c, 506);

      expect(v.Width).toBe(exp.vessel.width);
      expect(v.Height).toBe(exp.vessel.height);
      expect(n1.Width).toBe(exp.node1Width);
      expect(n1.Height).toBe(exp.node1Height);
      expect(n2.Width).toBe(exp.node2Width);
      expect(n2.Height).toBe(exp.node2Height);
    });

    test("equal_x_row_tie", () => {
      const exp = s.equal_x_row_tie;
      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(50, 10);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = new Point(50, 20);
      const n3 = new Node(3, 40, 30);
      n3.TopLeft = new Point(20, 30);
      const n4 = new Node(4, 40, 30);
      n4.TopLeft = new Point(50, 5);

      const c = new Cluster({
        Nodes: [n1, n2, n3, n4],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: true,
      });

      const v = createVessel(c, 507);

      expect(c.Nodes.map((n) => String(n.ID))).toEqual(exp.nodeOrder);
      expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
      expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
    });

    test("equal_y_column_tie", () => {
      const exp = s.equal_y_column_tie;
      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(10, 50);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = new Point(20, 50);
      const n3 = new Node(3, 40, 30);
      n3.TopLeft = new Point(30, 20);
      const n4 = new Node(4, 40, 30);
      n4.TopLeft = new Point(5, 50);

      const c = new Cluster({
        Nodes: [n1, n2, n3, n4],
        Arrangement: ClusterArrangement.Column,
        Padding: 10,
        FixedSize: true,
      });

      const v = createVessel(c, 508);

      expect(c.Nodes.map((n) => String(n.ID))).toEqual(exp.nodeOrder);
      expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
      expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
    });

    test("mixed_positioned_unpositioned", () => {
      const exp = s.mixed_positioned_unpositioned;
      expect(exp.panicked).toBe(true);

      const n1 = new Node(1, 40, 30);
      n1.TopLeft = new Point(10, 20);
      const n2 = new Node(2, 40, 30);
      n2.TopLeft = null;

      const c = new Cluster({
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
        FixedSize: true,
      });

      expect(() => createVessel(c, 509)).toThrow();
    });

    test("large_tie_13_row_and_column", () => {
      // Row
      {
        const exp = s.row_large_tie_13;
        const nodes = exp.inputMemberIDs.map((id, idx) => {
          const n = new Node(Number(id), 40, 30);
          n.TopLeft = new Point(exp.coordinates[idx], 10);
          return n;
        });
        const c = new Cluster({
          Nodes: nodes,
          Arrangement: ClusterArrangement.Row,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1100);
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.outputMemberIDs);
        expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
        expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      }
      // Column
      {
        const exp = s.col_large_tie_13;
        const nodes = exp.inputMemberIDs.map((id, idx) => {
          const n = new Node(Number(id), 40, 30);
          n.TopLeft = new Point(10, exp.coordinates[idx]);
          return n;
        });
        const c = new Cluster({
          Nodes: nodes,
          Arrangement: ClusterArrangement.Column,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1200);
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.outputMemberIDs);
        expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
        expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      }
    });

    test("large_tie_20_row_and_column", () => {
      // Row
      {
        const exp = s.row_large_tie_20;
        const nodes = exp.inputMemberIDs.map((id, idx) => {
          const n = new Node(Number(id), 40, 30);
          n.TopLeft = new Point(exp.coordinates[idx], 10);
          return n;
        });
        const c = new Cluster({
          Nodes: nodes,
          Arrangement: ClusterArrangement.Row,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1300);
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.outputMemberIDs);
        expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
        expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      }
      // Column
      {
        const exp = s.col_large_tie_20;
        const nodes = exp.inputMemberIDs.map((id, idx) => {
          const n = new Node(Number(id), 40, 30);
          n.TopLeft = new Point(10, exp.coordinates[idx]);
          return n;
        });
        const c = new Cluster({
          Nodes: nodes,
          Arrangement: ClusterArrangement.Column,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1400);
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.outputMemberIDs);
        expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
        expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      }
    });

    test("large_tie_32_row_and_column", () => {
      // Row
      {
        const exp = s.row_large_tie_32;
        const nodes = exp.inputMemberIDs.map((id, idx) => {
          const n = new Node(Number(id), 40, 30);
          n.TopLeft = new Point(exp.coordinates[idx], 10);
          return n;
        });
        const c = new Cluster({
          Nodes: nodes,
          Arrangement: ClusterArrangement.Row,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1500);
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.outputMemberIDs);
        expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
        expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      }
      // Column
      {
        const exp = s.col_large_tie_32;
        const nodes = exp.inputMemberIDs.map((id, idx) => {
          const n = new Node(Number(id), 40, 30);
          n.TopLeft = new Point(10, exp.coordinates[idx]);
          return n;
        });
        const c = new Cluster({
          Nodes: nodes,
          Arrangement: ClusterArrangement.Column,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1600);
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.outputMemberIDs);
        expect(v.TopLeft.X).toBe(exp.vessel.topLeft.x);
        expect(v.TopLeft.Y).toBe(exp.vessel.topLeft.y);
      }
    });

    test("special_coordinates_negative_inf", () => {
      // Row with min X = -Inf
      {
        const exp = s.row_min_x_neg_inf;
        const n1 = new Node(701, 40, 30);
        n1.TopLeft = new Point(-Infinity, 20);
        const n2 = new Node(702, 40, 30);
        n2.TopLeft = new Point(50, 20);
        const c = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Row,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1701);
        expect(v.TopLeft !== null).toBe(exp.hasTopLeft);
        expect(v.TopLeft.X === -Infinity).toBe(true);
        expect(exp.topLeftXKind).toBe("negative_inf");
        expect(v.TopLeft.Y).toBe(20);
        expect(exp.topLeftYKind).toBe("finite");
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.finalMemberIDs);
      }
      // Column with min Y = -Inf
      {
        const exp = s.col_min_y_neg_inf;
        const n1 = new Node(711, 40, 30);
        n1.TopLeft = new Point(20, 50);
        const n2 = new Node(712, 40, 30);
        n2.TopLeft = new Point(20, -Infinity);
        const c = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Column,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1711);
        expect(v.TopLeft !== null).toBe(exp.hasTopLeft);
        expect(v.TopLeft.X).toBe(20);
        expect(exp.topLeftXKind).toBe("finite");
        expect(v.TopLeft.Y === -Infinity).toBe(true);
        expect(exp.topLeftYKind).toBe("negative_inf");
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.finalMemberIDs);
      }
    });

    test("special_coordinates_nan", () => {
      // Row with NaN X
      {
        const exp = s.row_nan_x;
        const n1 = new Node(721, 40, 30);
        n1.TopLeft = new Point(NaN, 20);
        const n2 = new Node(722, 40, 30);
        n2.TopLeft = new Point(50, 20);
        const c = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Row,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1721);
        expect(v.TopLeft !== null).toBe(exp.hasTopLeft);
        expect(Number.isNaN(v.TopLeft.X)).toBe(true);
        expect(exp.topLeftXKind).toBe("nan");
        expect(v.TopLeft.Y).toBe(20);
        expect(exp.topLeftYKind).toBe("finite");
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.finalMemberIDs);
      }
      // Column with NaN Y
      {
        const exp = s.col_nan_y;
        const n1 = new Node(731, 40, 30);
        n1.TopLeft = new Point(20, NaN);
        const n2 = new Node(732, 40, 30);
        n2.TopLeft = new Point(20, 50);
        const c = new Cluster({
          Nodes: [n1, n2],
          Arrangement: ClusterArrangement.Column,
          Padding: 10,
          FixedSize: true,
        });
        const v = createVessel(c, 1731);
        expect(v.TopLeft !== null).toBe(exp.hasTopLeft);
        expect(v.TopLeft.X).toBe(20);
        expect(exp.topLeftXKind).toBe("finite");
        expect(Number.isNaN(v.TopLeft.Y)).toBe(true);
        expect(exp.topLeftYKind).toBe("nan");
        expect(c.Nodes.map(n => String(n.ID))).toEqual(exp.finalMemberIDs);
      }
    });
  });

  describe("3. AddCluster", () => {
    const s = scenarios.addCluster;

    test("root_level_cluster", () => {
      const exp = s.root_level_cluster;
      const g = new Graph();
      const c1 = new Node(10, 40, 30);
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const c2 = new Node(20, 40, 30);
      g.addNewNodeToContainer(null, c1);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, c2);

      const vessel = new Node(500, 90, 30);
      vessel.setClusterVessel(true);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: null,
        Graph: g,
      });

      addCluster(g, cluster);

      expect(g.Nodes.map((n) => String(n.ID))).toEqual(exp.graphNodes);
      expect(g.Containers.get(null).map((n) => String(n.ID))).toEqual(exp.rootChildren);
      expect(g.Nodes.includes(vessel)).toBe(exp.vesselInGraph);
      expect(vessel.Container).toBe(null);
      expect(vessel.Graph).toBe(g);
      expect(n1.Cluster).toBe(cluster);
      expect(n2.Cluster).toBe(cluster);
      expect(n1.Container).toBe(null);
      expect(n2.Container).toBe(null);
      expect(n1.Graph).toBe(g);
      expect(n2.Graph).toBe(g);
      expect(g.Clusters.get(vessel)).toBe(cluster);
    });

    test("nested_container_cluster", () => {
      const exp = s.nested_container_cluster;
      const g = new Graph();
      const parent = new Node(100, 200, 200);
      parent.isContainer = true;
      g.addNewNodeToContainer(null, parent);

      const c1 = new Node(10, 40, 30);
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const c2 = new Node(20, 40, 30);
      g.addNewNodeToContainer(parent, c1);
      g.addNewNodeToContainer(parent, n1);
      g.addNewNodeToContainer(parent, n2);
      g.addNewNodeToContainer(parent, c2);

      const vessel = new Node(501, 90, 30);
      vessel.setClusterVessel(true);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: parent,
        Graph: g,
      });

      addCluster(g, cluster);

      expect(g.Containers.get(parent).map((n) => String(n.ID))).toEqual(exp.parentChildren);
      expect(g.Nodes.includes(vessel)).toBe(exp.vesselInGraph);
      expect(String(vessel.Container.ID)).toBe(exp.vesselContainer);
      expect(g.Clusters.get(vessel)).toBe(cluster);
      expect(g.Nodes.includes(n1)).toBe(exp.node1InGraph);
      expect(g.Nodes.includes(n2)).toBe(exp.node2InGraph);
    });

    test("duplicate_member_in_cluster_nodes", () => {
      const exp = s.duplicate_member_in_cluster_nodes;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);

      const vessel = new Node(502, 90, 30);
      vessel.setClusterVessel(true);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2, n1],
        Container: null,
        Graph: g,
      });

      addCluster(g, cluster);

      expect(g.Containers.get(null).map((n) => String(n.ID))).toEqual(exp.rootChildren);
      expect(g.Nodes.includes(vessel)).toBe(exp.vesselInGraph);
      expect(g.Nodes.includes(n1)).toBe(exp.node1InGraph);
      expect(g.Nodes.includes(n2)).toBe(exp.node2InGraph);
      expect(g.Clusters.get(vessel)).toBe(cluster);
    });

    test("duplicate_member_in_graph_nodes", () => {
      const exp = s.duplicate_member_in_graph_nodes;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const n3 = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.Nodes.push(n1); // duplicate pointer in graph.Nodes
      g.addNewNodeToContainer(null, n3);

      const vessel = new Node(503, 90, 30);
      vessel.setClusterVessel(true);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: null,
        Graph: g,
      });

      addCluster(g, cluster);

      expect(g.Nodes.map((n) => String(n.ID))).toEqual(exp.graphNodes);
      expect(g.Nodes.filter((n) => n === n1).length).toBe(exp.node1Count);
      expect(g.Nodes.includes(vessel)).toBe(exp.vesselInGraph);
    });

    test("extra_child_with_same_cluster", () => {
      const exp = s.extra_child_with_same_cluster;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const rogue = new Node(99, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, rogue);

      const vessel = new Node(504, 90, 30);
      vessel.setClusterVessel(true);

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: null,
        Graph: g,
      });

      rogue.Cluster = cluster;

      addCluster(g, cluster);

      expect(g.Containers.get(null).map((n) => String(n.ID))).toEqual(exp.rootChildren);
      expect(g.Nodes.includes(rogue)).toBe(exp.rogueInGraph);
      expect(g.Containers.get(null).includes(rogue)).toBe(exp.rogueInContainer);
    });

    test("preexisting_unrelated_cluster", () => {
      const exp = s.preexisting_unrelated_cluster;
      const g = new Graph();
      const unrelatedVessel = new Node(400, 50, 50);
      const unrelatedCluster = new Cluster({ Vessel: unrelatedVessel });
      g.Clusters.set(unrelatedVessel, unrelatedCluster);

      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);

      const vessel = new Node(505, 90, 30);
      vessel.setClusterVessel(true);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: null,
        Graph: g,
      });

      addCluster(g, cluster);

      expect(g.Clusters.size).toBe(exp.clusterCount);
      expect(g.Clusters.get(unrelatedVessel)).toBe(unrelatedCluster);
      expect(g.Clusters.get(vessel)).toBe(cluster);
    });

    test("members_with_incident_edges", () => {
      const exp = s.members_with_incident_edges;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext);

      const e1 = connectWithID(g, 101, n1, ext);
      const e2 = connectWithID(g, 102, ext, n2);
      const eInternal = connectWithID(g, 103, n1, n2);

      const vessel = new Node(506, 90, 30);
      vessel.setClusterVessel(true);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        Container: null,
        Graph: g,
      });

      addCluster(g, cluster);

      expect(String(e1.From.ID)).toBe(exp.e1From);
      expect(String(e1.To.ID)).toBe(exp.e1To);
      expect(String(e2.From.ID)).toBe(exp.e2From);
      expect(String(e2.To.ID)).toBe(exp.e2To);
      expect(String(eInternal.From.ID)).toBe(exp.eInternalFrom);
      expect(String(eInternal.To.ID)).toBe(exp.eInternalTo);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
      expect(n1.Edges.length).toBe(exp.n1EdgesLen);
      expect(n2.Edges.length).toBe(exp.n2EdgesLen);
    });
  });

  describe("4. abductClusterEdges", () => {
    const s = scenarios.abductClusterEdges;

    test("no_supplied_edges", () => {
      const exp = s.no_supplied_edges;
      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel });
      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);

      abductClusterEdges(cluster, [], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(cluster.EdgeAbductions.length).toBe(exp.abductionsCount);
    });

    test("one_irrelevant_edge", () => {
      const exp = s.one_irrelevant_edge;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const ext1 = new Node(2, 40, 30);
      const ext2 = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext1);
      g.addNewNodeToContainer(null, ext2);
      const e = connectWithID(g, 201, ext1, ext2);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1] });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [e], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(cluster.EdgeAbductions.length).toBe(exp.abductionsCount);
      expect(String(e.From.ID)).toBe(exp.edgeFrom);
      expect(String(e.To.ID)).toBe(exp.edgeTo);
    });

    test("one_outgoing_edge", () => {
      const exp = s.one_outgoing_edge;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const ext = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext);
      const e = connectWithID(g, 202, n1, ext);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1] });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [e], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(String(e.From.ID)).toBe(exp.edgeFrom);
      expect(String(e.To.ID)).toBe(exp.edgeTo);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
      expect(n1.Edges.length).toBe(exp.n1EdgesLen);
      expect(cluster.EdgeAbductions.length).toBe(exp.abductions.length);
      expect(String(cluster.EdgeAbductions[0].OriginallyFrom.ID)).toBe(exp.abductions[0].originallyFrom);
      expect(String(cluster.EdgeAbductions[0].CurrentFrom.ID)).toBe(exp.abductions[0].currentFrom);
      expect(String(cluster.EdgeAbductions[0].CurrentTo.ID)).toBe(exp.abductions[0].currentTo);
    });

    test("one_incoming_edge", () => {
      const exp = s.one_incoming_edge;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const ext = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext);
      const e = connectWithID(g, 203, ext, n1);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1] });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [e], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(String(e.From.ID)).toBe(exp.edgeFrom);
      expect(String(e.To.ID)).toBe(exp.edgeTo);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
      expect(n1.Edges.length).toBe(exp.n1EdgesLen);
      expect(cluster.EdgeAbductions.length).toBe(exp.abductions.length);
      expect(String(cluster.EdgeAbductions[0].OriginallyTo.ID)).toBe(exp.abductions[0].originallyTo);
      expect(String(cluster.EdgeAbductions[0].CurrentTo.ID)).toBe(exp.abductions[0].currentTo);
      expect(String(cluster.EdgeAbductions[0].CurrentFrom.ID)).toBe(exp.abductions[0].currentFrom);
    });

    test("one_internal_edge (2 abductions, dynamic charging)", () => {
      const exp = s.one_internal_edge;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      const e = connectWithID(g, 204, n1, n2);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1, n2] });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [e], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(String(e.From.ID)).toBe(exp.edgeFrom);
      expect(String(e.To.ID)).toBe(exp.edgeTo);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
      expect(n1.Edges.length).toBe(exp.n1EdgesLen);
      expect(n2.Edges.length).toBe(exp.n2EdgesLen);
      expect(cluster.EdgeAbductions.length).toBe(2);

      // Abduction 1: From reconnect
      expect(String(cluster.EdgeAbductions[0].OriginallyFrom.ID)).toBe(exp.abductions[0].originallyFrom);
      expect(String(cluster.EdgeAbductions[0].CurrentFrom.ID)).toBe(exp.abductions[0].currentFrom);
      expect(String(cluster.EdgeAbductions[0].CurrentTo.ID)).toBe(exp.abductions[0].currentTo);

      // Abduction 2: To reconnect
      expect(String(cluster.EdgeAbductions[1].OriginallyTo.ID)).toBe(exp.abductions[1].originallyTo);
      expect(String(cluster.EdgeAbductions[1].CurrentTo.ID)).toBe(exp.abductions[1].currentTo);
      expect(String(cluster.EdgeAbductions[1].CurrentFrom.ID)).toBe(exp.abductions[1].currentFrom);
    });

    test("one_self_loop", () => {
      const exp = s.one_self_loop;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      g.addNewNodeToContainer(null, n1);
      const e = connectWithID(g, 205, n1, n1);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1] });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [e], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(String(e.From.ID)).toBe(exp.edgeFrom);
      expect(String(e.To.ID)).toBe(exp.edgeTo);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
      expect(n1.Edges.length).toBe(exp.n1EdgesLen);
      expect(cluster.EdgeAbductions.length).toBe(exp.abductions.length);
    });

    test("multiple_supplied_edges", () => {
      const exp = s.multiple_supplied_edges;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext1 = new Node(3, 40, 30);
      const ext2 = new Node(4, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext1);
      g.addNewNodeToContainer(null, ext2);

      const eIrrelevant = connectWithID(g, 301, ext1, ext2);
      const eOut = connectWithID(g, 302, n1, ext1);
      const eIn = connectWithID(g, 303, ext2, n2);
      const eInternal = connectWithID(g, 304, n1, n2);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1, n2] });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      const edges = [eIrrelevant, eOut, eIn, eInternal];
      abductClusterEdges(cluster, edges, guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(cluster.EdgeAbductions.length).toBe(exp.abductions.length);
      expect(String(eIrrelevant.From.ID)).toBe(exp.eIrrelevantFrom);
      expect(String(eIrrelevant.To.ID)).toBe(exp.eIrrelevantTo);
      expect(String(eOut.From.ID)).toBe(exp.eOutFrom);
      expect(String(eOut.To.ID)).toBe(exp.eOutTo);
      expect(String(eIn.From.ID)).toBe(exp.eInFrom);
      expect(String(eIn.To.ID)).toBe(exp.eInTo);
      expect(String(eInternal.From.ID)).toBe(exp.eInternalFrom);
      expect(String(eInternal.To.ID)).toBe(exp.eInternalTo);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
    });

    test("vessel_preexisting_edges", () => {
      const exp = s.vessel_preexisting_edges;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const ext1 = new Node(2, 40, 30);
      const ext2 = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext1);
      g.addNewNodeToContainer(null, ext2);

      const vessel = new Node(500, 0, 0);
      g.addNewNodeToContainer(null, vessel);

      connectWithID(g, 401, vessel, ext2);
      connectWithID(g, 402, ext2, vessel);
      const eMember = connectWithID(g, 403, n1, ext1);

      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1] });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [eMember], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
    });

    test("route_preservation", () => {
      const exp = s.route_preservation;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const ext = new Node(2, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext);
      const e = connectWithID(g, 501, n1, ext);

      const pts = [
        new Point(10, 20),
        new Point(30, 20),
        new Point(30, 40),
        new Point(50, 40),
      ];
      e.Points = pts;

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1] });
      n1.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 1000);
      abductClusterEdges(cluster, [e], guard);

      expect(e.Points).toBe(pts); // exact array identity preserved!
      expect(e.Points.length).toBe(exp.pointsCount);
      for (let i = 0; i < pts.length; i++) {
        expect(e.Points[i].X).toBe(exp.points[i].x);
        expect(e.Points[i].Y).toBe(exp.points[i].y);
      }
    });
  });

  describe("5. WorkGuard Boundaries and Nontransactional Partial Failure", () => {
    const s = scenarios.boundaries;

    test("exact_limit_success", () => {
      const exp = s.exact_limit_success;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext1 = new Node(3, 40, 30);
      const ext2 = new Node(4, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext1);
      g.addNewNodeToContainer(null, ext2);
      const eIrrelevant = connectWithID(g, 301, ext1, ext2);
      const eOut = connectWithID(g, 302, n1, ext1);
      const eIn = connectWithID(g, 303, ext2, n2);
      const eInternal = connectWithID(g, 304, n1, n2);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1, n2] });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", exp.limit);
      abductClusterEdges(cluster, [eIrrelevant, eOut, eIn, eInternal], guard);

      expect(guard.Used()).toBe(BigInt(exp.used));
    });

    test("limit_minus_1_failure", () => {
      const exp = s.limit_minus_1_failure;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext1 = new Node(3, 40, 30);
      const ext2 = new Node(4, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext1);
      g.addNewNodeToContainer(null, ext2);
      const eIrrelevant = connectWithID(g, 301, ext1, ext2);
      const eOut = connectWithID(g, 302, n1, ext1);
      const eIn = connectWithID(g, 303, ext2, n2);
      const eInternal = connectWithID(g, 304, n1, n2);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({ Vessel: vessel, Nodes: [n1, n2] });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", exp.limit);
      expect(() => {
        abductClusterEdges(cluster, [eIrrelevant, eOut, eIn, eInternal], guard);
      }).toThrow(WorkLimitError);

      expect(guard.Used()).toBe(BigInt(exp.used));
    });

    test("partial_mutation_failure (first edge succeeds, second edge fails)", () => {
      const exp = s.partial_mutation_failure;
      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext);

      const e1 = connectWithID(g, 601, n1, ext);
      const e2 = connectWithID(g, 602, n2, ext);

      const vessel = new Node(500, 0, 0);
      const sentinelEdge = connectWithID(g, 999, ext, ext);
      const sentinelAbduction = { Edge: sentinelEdge };
      const sentinelArray = [sentinelAbduction];

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        EdgeAbductions: sentinelArray,
      });
      n1.Cluster = cluster;
      n2.Cluster = cluster;

      const guard = new WorkGuard(backgroundWorkContext(), "test", 2);
      expect(() => {
        abductClusterEdges(cluster, [e1, e2], guard);
      }).toThrow(WorkLimitError);

      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(String(e1.From.ID)).toBe(exp.e1From);
      expect(String(e1.To.ID)).toBe(exp.e1To);
      expect(String(e2.From.ID)).toBe(exp.e2From);
      expect(String(e2.To.ID)).toBe(exp.e2To);
      expect(cluster.EdgeAbductions).toBe(sentinelArray); // sentinel array retained untouched!
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
      expect(n1.Edges.length).toBe(exp.n1EdgesLen);
      expect(n2.Edges.length).toBe(exp.n2EdgesLen);
    });
  });

  describe("6. Mid-operation Cancellation", () => {
    const exp = scenarios.cancellation.mid_operation_cancellation;

    test("mid_operation_cancellation from guard.Step() inside charging loop", () => {
      const controller = new AbortController();
      const ctx = abortSignalWorkContext(controller.signal);

      const g = new Graph();
      const n1 = new Node(1, 40, 30);
      const n2 = new Node(2, 40, 30);
      const ext = new Node(3, 40, 30);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, n2);
      g.addNewNodeToContainer(null, ext);

      const e1 = connectWithID(g, 701, n1, ext);

      // Add 1070 edges on n2 to ensure charge loop crosses 1024 stride
      for (let i = 0; i < 70; i++) {
        connectWithID(g, 800 + i, n2, ext);
      }
      const e2 = connectWithID(g, 702, n2, ext);
      for (let i = 0; i < 1000; i++) {
        connectWithID(g, 2000 + i, n2, ext);
      }

      const vessel = new Node(500, 0, 0);
      const sentinelEdge = connectWithID(g, 999, ext, ext);
      const sentinelAbduction = { Edge: sentinelEdge };
      const sentinelArray = [sentinelAbduction];

      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1, n2],
        EdgeAbductions: sentinelArray,
      });
      n1.Cluster = cluster;
      n2.Cluster = cluster

      const guard = new WorkGuard(ctx, "test", 10000);
      // Cancel context now (cancellable context checks at 1024 stride)
      controller.abort();

      let caughtErr;
      try {
        abductClusterEdges(cluster, [e1, e2], guard);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(WorkCanceledError);
      expect(caughtErr.location).toBe(exp.expectedLocation);
      expect(exp.isCanceled).toBe(true);
      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(String(e1.From.ID)).toBe(exp.e1From);
      expect(String(e2.From.ID)).toBe(exp.e2From);
      expect(cluster.EdgeAbductions).toBe(sentinelArray);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
    });

    test("final_finish_cancellation: published abductions and reconnected topology preserved before cancel", () => {
      const exp = scenarios.cancellation.final_finish_cancellation;
      const controller = new AbortController();
      const ctx = abortSignalWorkContext(controller.signal);

      const g = new Graph();
      const n1 = new Node(1, 10, 10);
      const ext = new Node(2, 10, 10);
      g.addNewNodeToContainer(null, n1);
      g.addNewNodeToContainer(null, ext);
      const e1 = connectWithID(g, 901, n1, ext);

      const vessel = new Node(500, 0, 0);
      const cluster = new Cluster({
        Vessel: vessel,
        Nodes: [n1],
      });
      n1.Cluster = cluster;

      const guard = new WorkGuard(ctx, "test", 10000);
      // Abort after guard creation; total loop steps is 2, well below 1024 stride
      controller.abort();

      let caughtErr;
      try {
        abductClusterEdges(cluster, [e1], guard);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(WorkCanceledError);
      expect(caughtErr.location).toBe(exp.expectedLocation);
      expect(exp.isCanceled).toBe(true);
      expect(guard.Used()).toBe(BigInt(exp.used));
      expect(cluster.EdgeAbductions.length).toBe(exp.publishedAbductionsLen);
      expect(String(e1.From.ID)).toBe(exp.e1From);
      expect(String(e1.To.ID)).toBe(exp.e1To);
      expect(vessel.Edges.length).toBe(exp.vesselEdgesLen);
      expect(n1.Edges.length).toBe(exp.n1EdgesLen);
    });
  });
});
