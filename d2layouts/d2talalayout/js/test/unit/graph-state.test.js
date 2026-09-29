import { describe, it, expect } from "bun:test";
import {
  Graph,
  Node,
  Edge,
  Point,
  Box,
  Cluster,
  Sequence,
  Tree,
  EdgeAbduction,
  Label,
  Icon,
  Hierarchy,
  HerdAssignment,
  LongDistanceNeighborRequirements,
  Orientation,
  NewGraphStateSnapshot,
  RestoreGraphState,
  WorkGuard,
  WorkContext,
  WorkLimitError,
  cloneGraph,
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_ENGINE_WORK_UNITS,
  captureExactSlice,
  captureExactSliceMap,
  captureEdgeStyle,
} from "../../src/index.js";

describe("Slice 09 GraphState Focused Unit Tests", () => {
  describe("Exact Array Snapshot and Rollback Helpers", () => {
    it("restores original array in place preserving === identity and elements", () => {
      const a = { id: "a" };
      const b = { id: "b" };
      const c = { id: "c" };
      const x = { id: "x" };

      const original = [a, b];
      const alias = original;

      const snap = captureExactSlice(original);

      original.push(c);
      original[0] = x;
      expect(original.length).toBe(3);
      expect(original[0]).toBe(x);

      const restored = snap.restore();

      expect(restored).toBe(original);
      expect(alias).toBe(original);
      expect(original.length).toBe(2);
      expect(original[0]).toBe(a);
      expect(original[1]).toBe(b);
    });

    it("handles null array snapshot gracefully", () => {
      const snap = captureExactSlice(null);
      expect(snap).toBeNull();
    });

    it("restores exact slice map in place preserving original Map and child Array identities", () => {
      const key1 = { k: 1 };
      const itemA = { val: "A" };
      const arr1 = [itemA];
      const map = new Map([[key1, arr1]]);
      const mapAlias = map;
      const arr1Alias = arr1;

      const snap = captureExactSliceMap(map);

      map.set({ k: 2 }, [{ val: "B" }]);
      arr1.push({ val: "mutated" });
      arr1[0] = { val: "replaced" };

      const restoredMap = snap.restore();

      expect(restoredMap).toBe(map);
      expect(mapAlias).toBe(map);
      expect(map.size).toBe(1);
      expect(map.has(key1)).toBe(true);

      const restoredArr1 = map.get(key1);
      expect(restoredArr1).toBe(arr1);
      expect(arr1Alias).toBe(arr1);
      expect(restoredArr1.length).toBe(1);
      expect(restoredArr1[0]).toBe(itemA);
    });
  });

  describe("Pointer and Flag Preservation (GraphState vs Clone)", () => {
    it("restores TopLeft and FixedTopLeft pointer identity and value", () => {
      const g = new Graph();
      const node = new Node(1n, 50, 40);
      const originalTopLeft = new Point(10, 20);
      const originalFixedTopLeft = new Point(15, 25);
      node.TopLeft = originalTopLeft;
      node.FixedTopLeft = originalFixedTopLeft;
      g.addNodeUnchecked(node);

      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      originalTopLeft.X = 999;
      node.TopLeft = new Point(111, 222);
      originalFixedTopLeft.X = 888;
      node.FixedTopLeft = new Point(333, 444);

      RestoreGraphState(g, state);

      expect(node.TopLeft).toBe(originalTopLeft);
      expect(originalTopLeft.X).toBe(10);
      expect(originalTopLeft.Y).toBe(20);

      expect(node.FixedTopLeft).toBe(originalFixedTopLeft);
      expect(originalFixedTopLeft.X).toBe(15);
      expect(originalFixedTopLeft.Y).toBe(25);
    });

    it("restores Label object identity, text, and PositionFixed flag", () => {
      const g = new Graph();
      const node = new Node(1n, 50, 40);
      const label = new Label("Header", 60, 20);
      label.FixPosition();
      node.Label = label;
      g.addNodeUnchecked(node);

      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      label.Text = "Modified";
      label._positionFixed = false;
      node.Label = new Label("Replaced", 10, 10);

      RestoreGraphState(g, state);

      expect(node.Label).toBe(label);
      expect(label.Text).toBe("Header");
      expect(label.PositionFixed()).toBe(true);
    });

    it("restores Icon object identity and PositionFixed flag", () => {
      const g = new Graph();
      const node = new Node(1n, 50, 40);
      const icon = new Icon();
      icon.FixPosition();
      node.Icon = icon;
      g.addNodeUnchecked(node);

      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      icon._positionFixed = false;
      node.Icon = new Icon();

      RestoreGraphState(g, state);

      expect(node.Icon).toBe(icon);
      expect(icon.PositionFixed()).toBe(true);
    });

    it("restores Edge route points array identity and point values", () => {
      const g = new Graph();
      const n1 = new Node(1n, 10, 10);
      const n2 = new Node(2n, 10, 10);
      g.addNodeUnchecked(n1);
      g.addNodeUnchecked(n2);
      const edge = g.connect(n1, n2);
      const pt1 = new Point(5, 5);
      const pt2 = new Point(15, 15);
      edge.Points = [pt1, pt2];
      const originalPointsArray = edge.Points;

      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true });
      state.UpdateWithWorkGuard(g, guard);

      pt1.X = 999;
      edge.Points.push(new Point(100, 100));
      edge.Points = [new Point(50, 50)];

      RestoreGraphState(g, state);

      expect(edge.Points).toBe(originalPointsArray);
      expect(edge.Points.length).toBe(2);
      expect(edge.Points[0]).toBe(pt1);
      expect(edge.Points[0].X).toBe(5);
      expect(edge.Points[1]).toBe(pt2);
    });
  });

  describe("Collections and Subgraphs", () => {
    it("restores Cluster, Sequence, Tree and EdgeAbductions in place", () => {
      const g = new Graph();
      const n1 = new Node(1n, 10, 10);
      const n2 = new Node(2n, 10, 10);
      g.addNodeUnchecked(n1);
      g.addNodeUnchecked(n2);
      const edge = g.connect(n1, n2);

      const clusterVessel = new Node(10n, 10, 10);
      const cluster = new Cluster({
        Vessel: clusterVessel,
        Nodes: [n1],
        Arrangement: "Column",
        DesiredArrangement: "Row",
        Padding: 8,
        Graph: g,
      });
      g.Clusters.set(clusterVessel, cluster);

      const seqVessel = new Node(20n, 10, 10);
      const seq = new Sequence({
        Vessel: seqVessel,
        Nodes: [n1, n2],
        Graph: g,
      });
      g.Sequences.set(seqVessel, seq);

      const tree = new Tree(n1);
      tree.Orientation = Orientation.Top;
      g.Trees.set(null, [tree]);
      g.NodeToTree.set(n1, tree);

      const abduction = new EdgeAbduction({
        Edge: edge,
        OriginallyFrom: n1,
        OriginallyTo: n2,
        CurrentFrom: n1,
        CurrentTo: n2,
      });
      cluster.EdgeAbductions = [abduction];

      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      const origClusterNodes = cluster.Nodes;
      const origSeqNodes = seq.Nodes;
      const origTreeChildren = tree.Children;

      cluster.Nodes.push(n2);
      seq.Nodes.push(n1);
      tree.Children.push(new Tree(n2));
      abduction.CurrentTo = n1;

      RestoreGraphState(g, state);

      expect(cluster.Nodes).toBe(origClusterNodes);
      expect(cluster.Nodes.length).toBe(1);
      expect(seq.Nodes).toBe(origSeqNodes);
      expect(seq.Nodes.length).toBe(2);
      expect(tree.Children).toBe(origTreeChildren);
      expect(tree.Children.length).toBe(0);
      expect(abduction.CurrentTo).toBe(n2);
    });

    it("restores HerdAssignment sets and Hierarchy levels map", () => {
      const g = new Graph();
      const n1 = new Node(1n, 10, 10);
      const n2 = new Node(2n, 10, 10);
      g.addNodeUnchecked(n1);
      g.addNodeUnchecked(n2);

      const herd = new HerdAssignment();
      herd.Orientation = Orientation.Right;
      herd.Val = 10;
      herd.PairSameSide(n1);
      herd.PairOppositeSide(n2);
      n1.HerdAssignment = herd;

      const hierarchy = new Hierarchy();
      hierarchy.LevelCount = 2;
      hierarchy.Levels().set(n1, 0);
      hierarchy.Levels().set(n2, 1);
      n1.Hierarchy = hierarchy;

      const origSameSet = herd.sameSidePaired;
      const origOppSet = herd.oppositeSidePaired;
      const origLevels = hierarchy.Levels();

      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      herd.sameSidePaired.add(n2);
      herd.oppositeSidePaired.clear();
      hierarchy.Levels().set(n1, 99);
      hierarchy.LevelCount = 10;

      RestoreGraphState(g, state);

      expect(herd.sameSidePaired).toBe(origSameSet);
      expect(herd.sameSidePaired.size).toBe(1);
      expect(herd.sameSidePaired.has(n1)).toBe(true);

      expect(herd.oppositeSidePaired).toBe(origOppSet);
      expect(herd.oppositeSidePaired.size).toBe(1);
      expect(herd.oppositeSidePaired.has(n2)).toBe(true);

      expect(hierarchy.Levels()).toBe(origLevels);
      expect(hierarchy.Levels().get(n1)).toBe(0);
      expect(hierarchy.LevelCount).toBe(2);
    });

    it("removes newly introduced nodes/edges/containers upon topology rollback", () => {
      const g = new Graph();
      const n1 = new Node(1n, 10, 10);
      g.addNodeUnchecked(n1);

      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      const nNew = new Node(999n, 20, 20);
      g.addNodeUnchecked(nNew);
      const eNew = g.connect(n1, nNew);
      g.Containers.set(n1, [nNew]);

      RestoreGraphState(g, state);

      expect(g.Nodes.length).toBe(1);
      expect(g.Nodes[0]).toBe(n1);
      expect(g.Edges.length).toBe(0);
      expect(g.Containers.has(n1)).toBe(false);
    });
  });

  describe("Limits and WorkGuard Behavior", () => {
    it("fails when node count exceeds MAX_ENGINE_NODES", () => {
      const g = new Graph();
      for (let i = 0; i <= MAX_ENGINE_NODES; i++) {
        g.Nodes.push(new Node(BigInt(i + 1), 1, 1));
      }
      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({});
      expect(() => state.UpdateWithWorkGuard(g, guard)).toThrow(
        `TALA transaction node count exceeds limit ${MAX_ENGINE_NODES}`
      );
    });

    it("fails when edge count exceeds MAX_ENGINE_EDGES", () => {
      const g = new Graph();
      const n = new Node(1n, 1, 1);
      for (let i = 0; i <= MAX_ENGINE_EDGES; i++) {
        g.Edges.push(new Edge(n, n));
      }
      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({});
      expect(() => state.UpdateWithWorkGuard(g, guard)).toThrow(
        `TALA transaction edge count exceeds limit ${MAX_ENGINE_EDGES}`
      );
    });

    it("fails when map size exceeds MAX_ENGINE_NODES + 1", () => {
      const g = new Graph();
      for (let i = 0; i <= MAX_ENGINE_NODES + 1; i++) {
        g.Containers.set(new Node(BigInt(i + 1), 1, 1), []);
      }
      const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({});
      expect(() => state.UpdateWithWorkGuard(g, guard)).toThrow(
        `TALA transaction container map exceeds limit ${MAX_ENGINE_NODES + 1}`
      );
    });

    it("leaves graph unmodified if WorkGuard budget runs out during capture", () => {
      const g = new Graph();
      const n1 = new Node(1n, 50, 40);
      n1.TopLeft = new Point(10, 20);
      g.addNodeUnchecked(n1);

      // Give 0 work budget
      const guard = new WorkGuard(new WorkContext(), "zeroBudget", 0);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });

      expect(() => state.UpdateWithWorkGuard(g, guard)).toThrow(WorkLimitError);

      // Graph must remain completely intact
      expect(g.Nodes.length).toBe(1);
      expect(g.Nodes[0]).toBe(n1);
      expect(n1.TopLeft.X).toBe(10);
    });
  });

  describe("Clone Compatibility Regressions", () => {
    it("proves cloneGraph cloner handles Hierarchy, HerdAssignment, LoopOffsets, LongDistance, Icon, and CommonUncleSiblings according to pinned Go specs", () => {
      const source = new Graph();
      const n1 = new Node(1n, 100, 80);
      n1.TopLeft = new Point(10, 20);

      // Icon with PositionFixed true
      n1.Icon = new Icon();
      n1.Icon.FixPosition();
      expect(n1.Icon.PositionFixed()).toBe(true);

      // HerdAssignment
      const herd = new HerdAssignment();
      herd.Orientation = Orientation.Right;
      herd.Val = 50;
      n1.HerdAssignment = herd;

      // LoopOffsets
      n1.LoopOffsets = new Map([[Orientation.Top, 10]]);

      // LongDistanceNeighborRequirements
      n1.LongDistanceNeighborRequirements = new Map([[n1, new LongDistanceNeighborRequirements(1, 2, 3)]]);

      // Hierarchy
      const hierarchy = new Hierarchy();
      hierarchy.LevelCount = 5;
      hierarchy.Levels().set(n1, 2);
      n1.Hierarchy = hierarchy;

      source.addNodeUnchecked(n1);
      source.CommonUncleSiblings = new Map([[n1, [n1]]]);

      // Clone
      const cloned = cloneGraph(source);
      const clonedNode = cloned.Nodes[0];

      // 1. Icon Position cloned, but PositionFixed reset to false
      expect(clonedNode.Icon).not.toBeNull();
      expect(clonedNode.Icon.PositionFixed()).toBe(false);

      // 2. HerdAssignment NOT cloned (must be null)
      expect(clonedNode.HerdAssignment).toBeNull();

      // 3. LoopOffsets NOT cloned (must be null)
      expect(clonedNode.LoopOffsets).toBeNull();

      // 4. LongDistanceNeighborRequirements NOT cloned (must be null)
      expect(clonedNode.LongDistanceNeighborRequirements).toBeNull();

      // 5. Hierarchy IS cloned, but LevelCount is NOT copied (remains 0)
      expect(clonedNode.Hierarchy).not.toBeNull();
      expect(clonedNode.Hierarchy).not.toBe(hierarchy);
      expect(clonedNode.Hierarchy.LevelCount).toBe(0);
      expect(clonedNode.Hierarchy.Levels().get(clonedNode)).toBe(2);

      // 6. CommonUncleSiblings is reset to null
      expect(cloned.CommonUncleSiblings).toBeNull();
    });

    it("verifies cloneGraph -> snapshot cloned workspace -> mutate clone -> rollback clone", () => {
      const source = new Graph();
      const n1 = new Node(1n, 100, 80);
      n1.TopLeft = new Point(10, 20);
      source.addNodeUnchecked(n1);

      // Clone
      const clone = cloneGraph(source);
      const cloneNode = clone.Nodes[0];

      // Snapshot clone
      const guard = new WorkGuard(new WorkContext(), "cloneSnap", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(clone, guard);

      // Mutate clone
      cloneNode.Width = 999;
      cloneNode.TopLeft.X = 888;
      clone.addNodeUnchecked(new Node(2n, 50, 50));

      // Restore clone
      RestoreGraphState(clone, state);

      // Cloned workspace restored
      expect(clone.Nodes.length).toBe(1);
      expect(cloneNode.Width).toBe(100);
      expect(cloneNode.TopLeft.X).toBe(10);

      // Source never mutated
      expect(source.Nodes.length).toBe(1);
      expect(n1.Width).toBe(100);
      expect(n1.TopLeft.X).toBe(10);
    });
  });

  describe("Slice 09 Review Parity Corrections", () => {
    it("restores original Box object identity after replacement in topology mode", () => {
      const g = new Graph();
      const node = new Node(1n, 100, 80);
      node.TopLeft = new Point(10, 20);
      g.addNodeUnchecked(node);

      const originalBox = node.Box;
      const originalTopLeft = node.TopLeft;

      const guard = new WorkGuard(new WorkContext(), "BoxTest", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      node.Box = new Box(new Point(500, 600), 999, 888);

      RestoreGraphState(g, state);

      expect(node.Box).toBe(originalBox);
      expect(node.TopLeft).toBe(originalTopLeft);
      expect(node.Width).toBe(100);
      expect(node.Height).toBe(80);
      expect(node.TopLeft.X).toBe(10);
      expect(node.TopLeft.Y).toBe(20);
    });

    it("restores original Box object identity after replacement in geometry-only mode", () => {
      const g = new Graph();
      const node = new Node(1n, 100, 80);
      node.TopLeft = new Point(10, 20);
      g.addNodeUnchecked(node);

      const originalBox = node.Box;
      const originalTopLeft = node.TopLeft;

      const guard = new WorkGuard(new WorkContext(), "BoxGeomTest", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: false, CaptureEdgeRoutes: false });
      state.UpdateWithWorkGuard(g, guard);

      node.Box = new Box(new Point(500, 600), 999, 888);

      RestoreGraphState(g, state);

      expect(node.Box).toBe(originalBox);
      expect(node.TopLeft).toBe(originalTopLeft);
      expect(node.Width).toBe(100);
      expect(node.Height).toBe(80);
      expect(node.TopLeft.X).toBe(10);
      expect(node.TopLeft.Y).toBe(20);
    });

    it("preserves Edge.Style object identity and pointer-target mutation semantics", () => {
      const g = new Graph();
      const n1 = new Node(1n, 10, 10);
      const n2 = new Node(2n, 10, 10);
      g.addNodeUnchecked(n1);
      g.addNodeUnchecked(n2);
      const edge = g.connect(n1, n2);

      const originalStyle = { Stroke: { Value: "red" }, Fill: { Value: "white" } };
      edge.Style = originalStyle;
      const originalStroke = originalStyle.Stroke;

      const guard = new WorkGuard(new WorkContext(), "StyleTest", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      // change pointer field and add new property
      originalStyle.Stroke = { Value: "blue" };
      originalStyle.Extra = "temp";

      // mutate original pointee
      originalStroke.Value = "green";

      RestoreGraphState(g, state);

      // Identity of Style object is preserved
      expect(edge.Style).toBe(originalStyle);
      // Top-level field Stroke is restored to original pointer
      expect(edge.Style.Stroke).toBe(originalStroke);
      // Pointee value was NOT deep-restored (remains green, matching Go)
      expect(edge.Style.Stroke.Value).toBe("green");
      // Added top-level property was cleared
      expect("Extra" in edge.Style).toBe(false);
    });

    it("preserves null Hierarchy levels without lazy allocation during capture or rollback", () => {
      const g = new Graph();
      const node = new Node(1n, 10, 10);
      g.addNodeUnchecked(node);

      const hierarchy = new Hierarchy();
      hierarchy.ReplaceLevels(null);
      node.Hierarchy = hierarchy;

      const guard = new WorkGuard(new WorkContext(), "HierarchyNullTest", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      // Capture must be read-only: levels must still be null before rollback
      expect(hierarchy.levels).toBeNull();

      RestoreGraphState(g, state);

      // After restore, levels must still be null
      expect(hierarchy.levels).toBeNull();
    });

    it("cloneGraph does not mutate source Hierarchy when levels is null", () => {
      const source = new Graph();
      const node = new Node(1n, 10, 10);
      source.addNodeUnchecked(node);

      const hierarchy = new Hierarchy();
      hierarchy.ReplaceLevels(null);
      node.Hierarchy = hierarchy;

      expect(hierarchy.levels).toBeNull();

      const cloned = cloneGraph(source);

      // Source hierarchy must remain null (capture/clone did not mutate source)
      expect(hierarchy.levels).toBeNull();
      expect(source.Nodes[0].Hierarchy.levels).toBeNull();
    });

    it("accepts null node in HerdAssignment pair methods matching Go nil key support", () => {
      const herd = new HerdAssignment();
      herd.PairSameSide(null);
      herd.PairOppositeSide(null);

      expect(herd.SameSidePairCount()).toBe(1);
      expect(herd.OppositeSidePairCount()).toBe(1);
      expect(herd.sameSidePaired.has(null)).toBe(true);
      expect(herd.oppositeSidePaired.has(null)).toBe(true);
    });

    it("restores explicitly null collections as null rather than converting to [] or Map", () => {
      const g = new Graph();
      const node = new Node(1n, 10, 10);
      g.addNodeUnchecked(node);

      node.Edges = null;
      node.LongDistanceNeighborRequirements = null;
      g.Containers = null;
      g.CommonUncleSiblings = null;

      const guard = new WorkGuard(new WorkContext(), "NullableTest", MAX_ENGINE_WORK_UNITS);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      state.UpdateWithWorkGuard(g, guard);

      // Mutate
      node.Edges = [];
      node.LongDistanceNeighborRequirements = new Map();
      g.Containers = new Map();
      g.CommonUncleSiblings = new Map();

      RestoreGraphState(g, state);

      expect(node.Edges).toBeNull();
      expect(node.LongDistanceNeighborRequirements).toBeNull();
      expect(g.Containers).toBeNull();
      expect(g.CommonUncleSiblings).toBeNull();
    });
  });
});
