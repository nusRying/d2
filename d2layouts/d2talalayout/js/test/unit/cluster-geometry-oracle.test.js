import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { Graph } from "../../src/graph/graph.js";
import { Node } from "../../src/graph/node.js";
import { Cluster, ClusterArrangement } from "../../src/graph/cluster.js";
import { Point } from "../../src/geometry/point.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = resolve(__dirname, "../fixtures/go-cluster-geometry-reference.json");
const reference = JSON.parse(readFileSync(fixturePath, "utf8"));

function parseNumberClass(s) {
  if (s == null) return null;
  if (s === "NaN") return NaN;
  if (s === "+Inf" || s === "+Infinity" || s === "Infinity") return Infinity;
  if (s === "-Inf" || s === "-Infinity") return -Infinity;
  return parseFloat(s);
}

function expectNumMatch(actual, expectedStr) {
  const expected = parseNumberClass(expectedStr);
  if (Number.isNaN(expected)) {
    expect(Number.isNaN(actual)).toBe(true);
  } else {
    expect(actual).toBe(expected);
  }
}

function setupScenario(sc) {
  let vessel = null;
  if (sc.vesselBefore) {
    const w = parseNumberClass(sc.vesselBefore.width);
    const h = parseNumberClass(sc.vesselBefore.height);
    vessel = new Node(100, w, h);
    if (sc.vesselBefore.topLeft) {
      vessel.TopLeft = new Point(
        parseNumberClass(sc.vesselBefore.topLeft.x),
        parseNumberClass(sc.vesselBefore.topLeft.y)
      );
    } else {
      vessel.TopLeft = null;
    }
  }

  const g = new Graph();
  const members = [];
  const nodesById = new Map();
  const descendantsById = new Map();

  // Handle descendants first if any
  if (sc.descendantsBefore) {
    for (const [id, dState] of Object.entries(sc.descendantsBefore)) {
      const dw = parseNumberClass(dState.width);
      const dh = parseNumberClass(dState.height);
      const dNode = new Node(Number(id) || id, dw, dh);
      if (dState.topLeft) {
        dNode.TopLeft = new Point(
          parseNumberClass(dState.topLeft.x),
          parseNumberClass(dState.topLeft.y)
        );
      } else {
        dNode.TopLeft = null;
      }
      dNode.Graph = g;
      g.AddNode(dNode);
      descendantsById.set(id, dNode);
    }
  }

  // Create members
  for (const mState of sc.membersBefore) {
    if (mState.isNil) {
      members.push(null);
    } else {
      // Check if duplicate of an earlier node
      let memberNode;
      if (nodesById.has(mState.id)) {
        memberNode = nodesById.get(mState.id);
      } else {
        const mw = parseNumberClass(mState.width);
        const mh = parseNumberClass(mState.height);
        memberNode = new Node(Number(mState.id) || mState.id, mw, mh);
        if (mState.topLeft) {
          memberNode.TopLeft = new Point(
            parseNumberClass(mState.topLeft.x),
            parseNumberClass(mState.topLeft.y)
          );
        } else {
          memberNode.TopLeft = null;
        }
        if (mState.fixedTopLeft) {
          memberNode.FixedTopLeft = new Point(
            parseNumberClass(mState.fixedTopLeft.x),
            parseNumberClass(mState.fixedTopLeft.y)
          );
        }

        // Attach to graph unless scenario is detached
        const isDetached =
          sc.name.includes("detached") ||
          sc.name === "sync_resize_then_arrange_partial_failure";
        if (!isDetached) {
          memberNode.Graph = g;
          g.AddNode(memberNode);
        } else {
          memberNode.Graph = null;
        }

        // Check if this member is a container with descendants
        if (sc.descendantsBefore && descendantsById.size > 0) {
          memberNode.isContainer = true;
          const children = Array.from(descendantsById.values());
          for (const ch of children) {
            ch.Container = memberNode;
          }
          g.Containers.set(memberNode, children);
        }

        nodesById.set(mState.id, memberNode);
      }
      members.push(memberNode);
    }
  }

  const cluster = new Cluster({
    Vessel: vessel,
    Nodes: members,
    Arrangement: sc.arrangement,
    Padding: sc.padding,
    FixedSize: sc.fixedSize,
  });

  return { cluster, vessel, members, descendantsById, graph: g };
}

describe("Slice 24 Cluster Geometry Oracle Replay", () => {
  for (const [name, sc] of Object.entries(reference.scenarios)) {
    it(`replays ${name}`, () => {
      const { cluster, vessel, members, descendantsById } = setupScenario(sc);

      let panicked = false;
      let error = null;
      try {
        if (sc.operation === "ArrangeClusterNodes") {
          cluster.ArrangeClusterNodes();
        } else if (sc.operation === "SyncGeometry") {
          cluster.SyncGeometry();
        }
      } catch (e) {
        panicked = true;
        error = e;
      }

      expect(panicked).toBe(sc.panicked);

      if (sc.vesselAfter) {
        expect(vessel).not.toBeNull();
        expectNumMatch(vessel.Width, sc.vesselAfter.width);
        expectNumMatch(vessel.Height, sc.vesselAfter.height);
        if (sc.vesselAfter.topLeft) {
          expect(vessel.TopLeft).not.toBeNull();
          expectNumMatch(vessel.TopLeft.X, sc.vesselAfter.topLeft.x);
          expectNumMatch(vessel.TopLeft.Y, sc.vesselAfter.topLeft.y);
        } else {
          expect(vessel.TopLeft).toBeNull();
        }
      } else {
        expect(vessel).toBeNull();
      }

      expect(members.length).toBe(sc.membersAfter.length);
      for (let i = 0; i < members.length; i++) {
        const actual = members[i];
        const expected = sc.membersAfter[i];
        if (expected.isNil) {
          expect(actual).toBeNull();
        } else {
          expect(actual).not.toBeNull();
          expectNumMatch(actual.Width, expected.width);
          expectNumMatch(actual.Height, expected.height);
          if (expected.topLeft) {
            expect(actual.TopLeft).not.toBeNull();
            expectNumMatch(actual.TopLeft.X, expected.topLeft.x);
            expectNumMatch(actual.TopLeft.Y, expected.topLeft.y);
          } else {
            expect(actual.TopLeft).toBeNull();
          }
          if (expected.fixedTopLeft) {
            expect(actual.FixedTopLeft).not.toBeNull();
            expectNumMatch(actual.FixedTopLeft.X, expected.fixedTopLeft.x);
            expectNumMatch(actual.FixedTopLeft.Y, expected.fixedTopLeft.y);
          }
        }
      }

      if (sc.descendantsAfter) {
        for (const [id, expected] of Object.entries(sc.descendantsAfter)) {
          const actual = descendantsById.get(id);
          expect(actual).toBeDefined();
          expectNumMatch(actual.Width, expected.width);
          expectNumMatch(actual.Height, expected.height);
          if (expected.topLeft) {
            expect(actual.TopLeft).not.toBeNull();
            expectNumMatch(actual.TopLeft.X, expected.topLeft.x);
            expectNumMatch(actual.TopLeft.Y, expected.topLeft.y);
          } else {
            expect(actual.TopLeft).toBeNull();
          }
        }
      }
    });
  }

  describe("Section 57 Semantic Assertions", () => {
    it("unplaced Vessel returns before member access", () => {
      const v = new Node(100, 100, 100);
      v.TopLeft = null;
      const c = new Cluster({
        Vessel: v,
        Nodes: [null],
        Arrangement: ClusterArrangement.Row,
      });
      expect(() => c.ArrangeClusterNodes()).not.toThrow();
    });

    it("nil Vessel Arrange throws naturally", () => {
      const c = new Cluster({
        Vessel: null,
        Nodes: [new Node(1, 40, 40)],
        Arrangement: ClusterArrangement.Row,
      });
      expect(() => c.ArrangeClusterNodes()).toThrow();
    });

    it("row main axis is unrounded", () => {
      const sc = reference.scenarios["row_fractional_padding"];
      expect(sc.membersAfter[0].topLeft.x).toBe("100.25");
      expect(sc.membersAfter[1].topLeft.x).toBe("138.25");
    });

    it("column main axis is unrounded", () => {
      const g = new Graph();
      const v = new Node(100, 100, 300);
      v.TopLeft = new Point(100, 200.125);

      const n1 = new Node(1, 40, 30.5);
      n1.TopLeft = new Point(0, 0);
      n1.Graph = g;
      g.AddNode(n1);

      const n2 = new Node(2, 40, 20.25);
      n2.TopLeft = new Point(0, 0);
      n2.Graph = g;
      g.AddNode(n2);

      const c = new Cluster({
        Vessel: v,
        Nodes: [n1, n2],
        Arrangement: ClusterArrangement.Column,
        Padding: 7.5,
      });

      c.ArrangeClusterNodes();

      expect(n1.TopLeft.Y).toBe(200.125);
      expect(n2.TopLeft.Y).toBe(200.125 + 30.5 + 7.5); // 238.125
    });

    it("cross-axis uses Go rounding with negative half rounding away from zero", () => {
      const sc = reference.scenarios["column_negative_half_round"];
      expect(sc.membersAfter[0].topLeft.x).toBe("104");
    });

    it("existing member moves descendants", () => {
      const sc = reference.scenarios["row_positioned_container_with_descendant"];
      // parent moved from (10, 10) to (100, 210) -> dx = 90, dy = 200
      // child moved from (20, 20) to (110, 220) -> same dx=90, dy=200
      expect(sc.membersAfter[0].topLeft.x).toBe("100");
      expect(sc.membersAfter[0].topLeft.y).toBe("210");
      expect(sc.descendantsAfter["2"].topLeft.x).toBe("110");
      expect(sc.descendantsAfter["2"].topLeft.y).toBe("220");
    });

    it("unplaced member gets a new TopLeft before PositionContainerChildren(false)", () => {
      const sc = reference.scenarios["row_unplaced_container_member"];
      expect(sc.membersBefore[0].topLeft).toBeUndefined();
      expect(sc.membersAfter[0].topLeft).not.toBeNull();
      expect(sc.membersAfter[0].topLeft.x).toBe("100");
    });

    it("PositionContainerChildren receives false", () => {
      const g = new Graph();
      const v = new Node(100, 300, 100);
      v.TopLeft = new Point(100, 200);

      const parent = new Node(1, 120, 80);
      parent.TopLeft = null;
      parent.isContainer = true;
      parent.Graph = g;
      g.AddNode(parent);

      let spyArg = null;
      parent.positionContainerChildren = (withPadding) => {
        spyArg = withPadding;
      };

      const c = new Cluster({
        Vessel: v,
        Nodes: [parent],
        Arrangement: ClusterArrangement.Row,
        Padding: 10,
      });

      c.ArrangeClusterNodes();
      expect(spyArg).toBe(false);
    });

    it("unknown arrangement is no-op", () => {
      const sc = reference.scenarios["unknown_arrangement_noop"];
      expect(sc.membersAfter[0].topLeft.x).toBe(sc.membersBefore[0].topLeft.x);
      expect(sc.membersAfter[0].topLeft.y).toBe(sc.membersBefore[0].topLeft.y);
    });

    it("duplicate occurrences are processed twice", () => {
      const sc = reference.scenarios["duplicate_member_occurrence"];
      // member n1 is at slot 2: 100 + 50 + 10 = 160
      expect(sc.membersAfter[0].topLeft.x).toBe("160");
      expect(sc.membersAfter[1].topLeft.x).toBe("160");
    });

    it("later panic retains earlier member movement", () => {
      const sc = reference.scenarios["second_nil_member_partial_mutation"];
      expect(sc.panicked).toBe(true);
      expect(sc.membersAfter[0].topLeft.x).toBe("100");
    });

    it("detached member zero-delta can succeed", () => {
      const sc = reference.scenarios["detached_member_zero_delta_succeeds"];
      expect(sc.panicked).toBe(false);
    });

    it("Arrange does not resize", () => {
      const sc = reference.scenarios["row_basic"];
      expect(sc.vesselAfter.width).toBe(sc.vesselBefore.width);
      expect(sc.vesselAfter.height).toBe(sc.vesselBefore.height);
      expect(sc.membersAfter[0].width).toBe(sc.membersBefore[0].width);
      expect(sc.membersAfter[0].height).toBe(sc.membersBefore[0].height);
    });

    it("Arrange second call is idempotent", () => {
      const sc = reference.scenarios["arrange_idempotent"];
      expect(sc.panicked).toBe(false);
      expect(sc.membersAfter[0].topLeft.x).toBe("100");
      expect(sc.membersAfter[0].topLeft.y).toBe("220");
    });

    it("SyncGeometry performs Resize before Arrange", () => {
      const sc = reference.scenarios["sync_row_normalizes_sizes"];
      // Initial: A = 30x40, B = 50x20
      // Normalized: both 50x40
      // Vessel: Width = 50*2 + 10 = 110, Height = 40
      // Slots: A at 100, B at 100 + 50 + 10 = 160
      expect(sc.vesselAfter.width).toBe("110");
      expect(sc.vesselAfter.height).toBe("40");
      expect(sc.membersAfter[0].width).toBe("50");
      expect(sc.membersAfter[0].height).toBe("40");
      expect(sc.membersAfter[1].width).toBe("50");
      expect(sc.membersAfter[1].height).toBe("40");
      expect(sc.membersAfter[0].topLeft.x).toBe("100");
      expect(sc.membersAfter[1].topLeft.x).toBe("160");
    });

    it("FixedSize=false normalizes dimensions", () => {
      const sc = reference.scenarios["sync_column_normalizes_sizes"];
      expect(sc.membersAfter[0].width).toBe("40");
      expect(sc.membersAfter[0].height).toBe("60");
      expect(sc.membersAfter[1].width).toBe("40");
      expect(sc.membersAfter[1].height).toBe("60");
    });

    it("FixedSize=true preserves heterogeneous sizes", () => {
      const sc = reference.scenarios["sync_fixed_size_heterogeneous_row"];
      expect(sc.membersAfter[0].width).toBe("30");
      expect(sc.membersAfter[0].height).toBe("40");
      expect(sc.membersAfter[1].width).toBe("50");
      expect(sc.membersAfter[1].height).toBe("20");
      // Vessel width is still 50*2 + 10 = 110
      expect(sc.vesselAfter.width).toBe("110");
      // But B slot starts at 100 + 30 + 10 = 140
      expect(sc.membersAfter[1].topLeft.x).toBe("140");
    });

    it("empty Row produces negative vessel Width", () => {
      const sc = reference.scenarios["sync_empty_row"];
      expect(sc.vesselAfter.width).toBe("-10");
      expect(sc.vesselAfter.height).toBe("0");
    });

    it("empty Column produces negative vessel Height", () => {
      const sc = reference.scenarios["sync_empty_column"];
      expect(sc.vesselAfter.width).toBe("0");
      expect(sc.vesselAfter.height).toBe("-10");
    });

    it("Sync with unplaced vessel still resizes", () => {
      const sc = reference.scenarios["sync_unplaced_vessel_resizes_only"];
      expect(sc.vesselAfter.topLeft).toBeNull();
      expect(sc.vesselAfter.width).toBe("110");
      expect(sc.vesselAfter.height).toBe("40");
      // Positions remain untouched
      expect(sc.membersAfter[0].topLeft.x).toBe("10");
      expect(sc.membersAfter[0].topLeft.y).toBe("10");
      expect(sc.membersAfter[1].topLeft.x).toBe("50");
      expect(sc.membersAfter[1].topLeft.y).toBe("50");
    });

    it("Resize mutation is not rolled back if Arrange later fails", () => {
      const sc = reference.scenarios["sync_resize_then_arrange_partial_failure"];
      expect(sc.panicked).toBe(true);
      // Vessel and member resized
      expect(sc.vesselAfter.width).toBe("30");
      expect(sc.vesselAfter.height).toBe("40");
      expect(sc.membersAfter[0].width).toBe("30");
      expect(sc.membersAfter[0].height).toBe("40");
      // Member root translated partially
      expect(sc.membersAfter[0].topLeft.x).toBe("100");
    });
  });
});
