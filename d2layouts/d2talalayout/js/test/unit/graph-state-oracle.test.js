import { describe, it, expect } from "bun:test";
import fixture from "../fixtures/go-graph-state-reference.json";
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
  MAX_ENGINE_NODES,
  MAX_ENGINE_EDGES,
  MAX_ENGINE_WORK_UNITS,
} from "../../src/index.js";

describe("Slice 09 GraphState Go Oracle Parity", () => {
  it("asserts fixture metadata and constants", () => {
    expect(typeof fixture.metadata.runtimeGoVersion).toBe("string");
    expect(fixture.metadata.runtimeGoVersion.length).toBeGreaterThan(0);
    expect(typeof fixture.metadata.runtimeGOOS).toBe("string");
    expect(fixture.metadata.runtimeGOOS.length).toBeGreaterThan(0);
    expect(typeof fixture.metadata.runtimeGOARCH).toBe("string");
    expect(fixture.metadata.runtimeGOARCH.length).toBeGreaterThan(0);
    expect(fixture.metadata.d2BaseCommit).toBe("01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579");
    expect(fixture.metadata.referencePackage).toBe(
      "github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
    );

    expect(fixture.constants.MaxEngineNodes).toBe(MAX_ENGINE_NODES);
    expect(fixture.constants.MaxEngineEdges).toBe(MAX_ENGINE_EDGES);
    expect(fixture.constants.MaxEngineWorkUnits).toBe(Number(MAX_ENGINE_WORK_UNITS));
  });
  it("replays topology_full_rollback", () => {
    const sc = fixture.scenarios.topology_full_rollback;

    const g = new Graph();
    const n1 = new Node(1n, 100, 80);
    n1.TopLeft = new Point(10, 20);
    n1.FixedTopLeft = new Point(10, 20);
    n1.DesiredWidth = 120;
    n1.DesiredHeight = 90;
    n1.FontSize = 14;
    n1.D2ID = "node_1";
    n1.Label = new Label("N1", 30, 15);
    n1.Label.FixPosition();
    n1.Icon = new Icon();
    n1.Icon.FixPosition();
    n1.LoopOffsets = new Map([[Orientation.Top, 5.0]]);

    const n2 = new Node(2n, 60, 40);
    n2.TopLeft = new Point(200, 100);
    g.addNodeUnchecked(n1);
    g.addNodeUnchecked(n2);

    n1.addNear(n2);
    n1.LongDistanceNeighborRequirements = new Map([
      [n2, new LongDistanceNeighborRequirements(2, 50, 30)],
    ]);

    const edge = g.connect(n1, n2);
    edge.Points = [new Point(110, 60), new Point(200, 120)];
    edge.Label = new Label("E1", 20, 10);
    edge.Label.FixPosition();

    const clusterVessel = new Node(10n, 10, 10);
    const cluster = new Cluster({
      Vessel: clusterVessel,
      Nodes: [n1],
      Arrangement: "Column",
      DesiredArrangement: "Row",
      Padding: 12.0,
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

    g.Hubs.set(n1, [n2]);
    g.Directions.set(n1, Orientation.Bottom);
    g.CommonUncleSiblings = new Map([[n1, [n2]]]);

    const herd = new HerdAssignment();
    herd.Orientation = Orientation.Right;
    herd.Val = 42.5;
    herd.PairSameSide(n2);
    herd.PairOppositeSide(n1);
    n1.HerdAssignment = herd;

    const hierarchy = new Hierarchy();
    hierarchy.LevelCount = 3;
    hierarchy.Levels().set(n1, 0);
    hierarchy.Levels().set(n2, 1);
    n1.Hierarchy = hierarchy;
    n2.Hierarchy = hierarchy;

    const origN1Box = n1.Box;
    const originalStroke = { Value: "red" };
    edge.Style = { Stroke: originalStroke };
    const origEdgeStyle = edge.Style;

    const guard = new WorkGuard(new WorkContext(), "Snapshot", MAX_ENGINE_WORK_UNITS);
    const state = NewGraphStateSnapshot({
      CaptureTopology: true,
      CaptureEdgeRoutes: true,
    });
    state.UpdateWithWorkGuard(g, guard);

    // Keep references to test identity preservation
    const origN1TopLeft = n1.TopLeft;
    const origN1FixedTopLeft = n1.FixedTopLeft;
    const origN1Label = n1.Label;
    const origN1Icon = n1.Icon;
    const origEdgePoints = edge.Points;
    const origEdgeFirstPoint = edge.Points[0];
    const origClusters = g.Clusters;
    const origContainers = g.Containers;
    const origSequences = g.Sequences;
    const origNodeToTree = g.NodeToTree;
    const origDirections = g.Directions;
    const origN1Nears = n1.Nears;
    const origN1LoopOffsets = n1.LoopOffsets;
    const origN1Reqs = n1.LongDistanceNeighborRequirements;
    const origHierarchyLevels = hierarchy.Levels();

    // Mutate everything
    n1.Box = new Box(new Point(555, 444), 999, 888);
    origN1TopLeft.X = 777;
    origN1TopLeft.Y = 666;
    origN1FixedTopLeft.X = 333;
    n1.FixedTopLeft = new Point(222, 111);
    n1.Label.Text = "MUTATED";
    n1.Icon = new Icon();
    edge.Points[0].X = 9999;
    edge.Points.push(new Point(300, 300));
    edge.Style.Stroke = { Value: "blue" };
    originalStroke.Value = "green";
    g.Nodes.push(new Node(99n, 1, 1));
    g.Clusters = new Map();
    g.Sequences = new Map();
    n1.Nears = new Set();
    herd.Val = 100.0;

    // Rollback
    RestoreGraphState(g, state);

    // Representation mapping: Go embedded-field address stability -> JS Box object identity
    expect(n1.Box === origN1Box).toBe(sc.boxStorageIdentityRestored);
    expect(edge.Style).toBe(origEdgeStyle);
    expect(edge.Style.Stroke === originalStroke).toBe(sc.styleStrokeIdentityRestored);
    expect(edge.Style.Stroke.Value).toBe(sc.styleStrokeFinalValue);

    // Verify exact scalar restorations
    expect(n1.Width).toBe(sc.n1Width);
    expect(n1.Height).toBe(sc.n1Height);
    expect(n1.TopLeft.X).toBe(sc.n1TopLeftX);
    expect(n1.TopLeft.Y).toBe(sc.n1TopLeftY);
    expect(n1.FixedTopLeft.X).toBe(sc.n1FixedTopLeftX);
    expect(n1.Label.Text).toBe(sc.n1LabelText);
    expect(n1.Label.PositionFixed()).toBe(sc.n1LabelPositionFixed);
    expect(n1.Icon.PositionFixed()).toBe(sc.n1IconPositionFixed);
    expect(edge.Points.length).toBe(sc.edgePointsLength);
    expect(edge.Points[0].X).toBe(sc.edgeFirstPointX);
    expect(g.Clusters.size).toBe(sc.clustersCount);
    expect(g.Sequences.size).toBe(sc.sequencesCount);
    expect(n1.LongDistanceNeighborRequirements.size).toBe(sc.n1RequirementsCount);
    expect(n1.LongDistanceNeighborRequirements.get(n2).EdgeCount).toBe(sc.n1RequirementEdgeCount);
    expect(herd.Val).toBe(sc.herdVal);
    expect(herd.SameSidePairCount()).toBe(1);
    expect(hierarchy.LevelCount).toBe(sc.hierarchyLevelCount);
    expect(g.Nodes.length).toBe(sc.graphNodesCount);

    // Verify exact reference/identity restorations
    expect(n1.TopLeft).toBe(origN1TopLeft);
    expect(n1.FixedTopLeft).toBe(origN1FixedTopLeft);
    expect(n1.Label).toBe(origN1Label);
    expect(n1.Icon).toBe(origN1Icon);
    expect(edge.Points).toBe(origEdgePoints);
    expect(edge.Points[0]).toBe(origEdgeFirstPoint);
    expect(g.Clusters).toBe(origClusters);
    expect(g.Containers).toBe(origContainers);
    expect(g.Sequences).toBe(origSequences);
    expect(g.NodeToTree).toBe(origNodeToTree);
    expect(g.Directions).toBe(origDirections);
    expect(n1.Nears).toBe(origN1Nears);
    expect(n1.LoopOffsets).toBe(origN1LoopOffsets);
    expect(n1.LongDistanceNeighborRequirements).toBe(origN1Reqs);
    expect(hierarchy.Levels()).toBe(origHierarchyLevels);
  });

  it("replays exact_slice_backing", () => {
    const sc = fixture.scenarios.exact_slice_backing;

    const g = new Graph();
    const node = new Node(1n, 10, 10);
    node.TopLeft = new Point(0, 0);
    g.addNodeUnchecked(node);

    const edge = g.connect(node, node);
    edge.Points = [new Point(0, 0)];

    const tailNode = new Node(90n, 1, 1);
    const tailEdge = new Edge(tailNode, tailNode);
    const tailAbduction = new EdgeAbduction({ Edge: tailEdge });

    const clusterVessel = new Node(2n, 1, 1);
    const clusterNodes = [node];
    const clusterAbductions = [new EdgeAbduction({ Edge: edge })];
    const cluster = new Cluster({
      Vessel: clusterVessel,
      Nodes: clusterNodes,
      EdgeAbductions: clusterAbductions,
      Graph: g,
    });
    g.Clusters.set(clusterVessel, cluster);

    const sequenceVessel = new Node(3n, 1, 1);
    const sequenceNodes = [node];
    const sequenceAbductions = [new EdgeAbduction({ Edge: edge })];
    const sequence = new Sequence({
      Vessel: sequenceVessel,
      Nodes: sequenceNodes,
      EdgeAbductions: sequenceAbductions,
      Graph: g,
    });
    g.Sequences.set(sequenceVessel, sequence);

    const childTree = new Tree(tailNode);
    const tree = new Tree(node);
    tree.Children = [childTree];
    g.Trees.set(null, [tree]);
    g.NodeToTree.set(node, tree);

    g.Hubs.set(node, [node]);
    g.CommonUncleSiblings = new Map([[node, [node]]]);
    g.Containers.set(null, [node]);

    const guard = new WorkGuard(new WorkContext(), "ExactSliceTest", MAX_ENGINE_WORK_UNITS);
    const state = NewGraphStateSnapshot({ CaptureTopology: true, CaptureEdgeRoutes: true });
    state.UpdateWithWorkGuard(g, guard);

    const origClusterNodes = cluster.Nodes;
    const origClusterAbductions = cluster.EdgeAbductions;
    const origSeqNodes = sequence.Nodes;
    const origSeqAbductions = sequence.EdgeAbductions;
    const origTreeChildren = tree.Children;
    const origTreeRoots = g.Trees.get(null);
    const origHubs = g.Hubs.get(node);
    const origCommon = g.CommonUncleSiblings.get(node);
    const origRoute = edge.Points;
    const origPoint = edge.Points[0];

    // Mutate arrays and points
    cluster.Nodes.push(tailNode);
    cluster.EdgeAbductions.push(tailAbduction);
    sequence.Nodes.push(tailNode);
    sequence.EdgeAbductions.push(tailAbduction);
    tree.Children.push(childTree);
    g.Trees.get(null).push(childTree);
    g.Hubs.get(node).push(tailNode);
    g.CommonUncleSiblings.get(node).push(tailNode);
    edge.Points[0].X = 123;
    edge.Points.push(new Point(5, 5));

    RestoreGraphState(g, state);

    expect(cluster.Nodes).toBe(origClusterNodes);
    expect(cluster.Nodes.length).toBe(sc.clusterNodesLen);
    expect(cluster.EdgeAbductions).toBe(origClusterAbductions);
    expect(cluster.EdgeAbductions.length).toBe(sc.clusterAbductionsLen);

    expect(sequence.Nodes).toBe(origSeqNodes);
    expect(sequence.Nodes.length).toBe(sc.sequenceNodesLen);
    expect(sequence.EdgeAbductions).toBe(origSeqAbductions);
    expect(sequence.EdgeAbductions.length).toBe(sc.sequenceAbductionsLen);

    expect(tree.Children).toBe(origTreeChildren);
    expect(tree.Children.length).toBe(sc.treeChildrenLen);
    expect(g.Trees.get(null)).toBe(origTreeRoots);
    expect(g.Trees.get(null).length).toBe(sc.treeRootsLen);

    expect(g.Hubs.get(node)).toBe(origHubs);
    expect(g.Hubs.get(node).length).toBe(sc.hubsLen);
    expect(g.CommonUncleSiblings.get(node)).toBe(origCommon);
    expect(g.CommonUncleSiblings.get(node).length).toBe(sc.commonLen);

    expect(edge.Points).toBe(origRoute);
    expect(edge.Points.length).toBe(sc.routeLen);
    expect(edge.Points[0]).toBe(origPoint);
    expect(edge.Points[0].X).toBe(0);
  });

  it("replays hidden_runtime_objects", () => {
    const sc = fixture.scenarios.hidden_runtime_objects;

    const g = new Graph();
    const vessel = new Node(1n, 10, 10);
    const hiddenNode = new Node(2n, 50, 40);
    hiddenNode.TopLeft = new Point(15, 25);

    const cluster = new Cluster({
      Vessel: vessel,
      Nodes: [hiddenNode],
      Graph: g,
    });
    g.Clusters.set(vessel, cluster);

    const guard = new WorkGuard(new WorkContext(), "HiddenTest", MAX_ENGINE_WORK_UNITS);
    const state = NewGraphStateSnapshot({ CaptureTopology: true });
    state.UpdateWithWorkGuard(g, guard);

    hiddenNode.Width = 999;
    hiddenNode.TopLeft.X = 888;

    RestoreGraphState(g, state);

    expect(hiddenNode.Width).toBe(sc.hiddenNodeWidth);
    expect(hiddenNode.TopLeft.X).toBe(sc.hiddenNodeTopLeftX);
  });

  it("replays geometry_only", () => {
    const sc = fixture.scenarios.geometry_only;

    const g = new Graph();
    const n1 = new Node(1n, 100, 80);
    n1.TopLeft = new Point(10, 20);
    g.addNodeUnchecked(n1);

    const edge = g.connect(n1, n1);
    edge.Points = [new Point(1, 1), new Point(2, 2)];

    const c = new Cluster({
      Arrangement: "Column",
      DesiredArrangement: "Row",
      Padding: 10.0,
    });
    g.Clusters.set(n1, c);

    const tree = new Tree(n1);
    tree.Orientation = Orientation.Left;
    g.NodeToTree.set(n1, tree);

    const guard = new WorkGuard(new WorkContext(), "GeomOnly", MAX_ENGINE_WORK_UNITS);
    const state = NewGraphStateSnapshot({
      CaptureTopology: false,
      CaptureEdgeRoutes: false,
    });
    state.UpdateWithWorkGuard(g, guard);

    // Mutate geometry
    n1.Width = 250;
    n1.TopLeft.X = 75;
    c.Arrangement = "Row";
    c.Padding = 20.0;
    tree.Orientation = Orientation.Right;

    // Mutate topology map (should NOT be restored in geometry mode)
    const extraNode = new Node(99n, 10, 10);
    g.Clusters.set(extraNode, new Cluster());

    // Mutate edge route (should NOT be restored when CaptureEdgeRoutes=false)
    edge.Points[0].X = 999;

    RestoreGraphState(g, state);

    expect(n1.Width === 100).toBe(sc.n1WidthRestored);
    expect(n1.TopLeft.X === 10).toBe(sc.n1TopLeftXRestored);
    expect(c.Arrangement === "Column").toBe(sc.clusterArrangementRestored);
    expect(c.Padding === 10.0).toBe(sc.clusterPaddingRestored);
    expect(tree.Orientation === Orientation.Left).toBe(sc.treeOrientationRestored);
    expect(g.Clusters.has(extraNode)).toBe(sc.extraClusterMembershipKept);
    expect(edge.Points[0].X === 999).toBe(sc.edgeRouteMutationKept);
  });

  it("replays geometry_with_routes", () => {
    const sc = fixture.scenarios.geometry_with_routes;

    const g = new Graph();
    const n1 = new Node(1n, 100, 80);
    n1.TopLeft = new Point(10, 20);
    g.addNodeUnchecked(n1);

    const edge = g.connect(n1, n1);
    edge.Points = [new Point(1, 1), new Point(2, 2)];

    const guard = new WorkGuard(new WorkContext(), "GeomRoutes", MAX_ENGINE_WORK_UNITS);
    const state = NewGraphStateSnapshot({
      CaptureTopology: false,
      CaptureEdgeRoutes: true,
    });
    state.UpdateWithWorkGuard(g, guard);

    edge.Points[0].X = 999;
    edge.Points.push(new Point(3, 3));

    RestoreGraphState(g, state);

    expect(edge.Points[0].X === 1).toBe(sc.edgeRouteRestored);
    expect(edge.Points.length).toBe(sc.edgePointsLen);
  });

  it("replays topology_without_routes_option", () => {
    const sc = fixture.scenarios.topology_without_routes_option;

    const g = new Graph();
    const n1 = new Node(1n, 100, 80);
    n1.TopLeft = new Point(10, 20);
    g.addNodeUnchecked(n1);

    const edge = g.connect(n1, n1);
    edge.Points = [new Point(1, 1), new Point(2, 2)];

    const guard = new WorkGuard(new WorkContext(), "TopolNoRoutes", MAX_ENGINE_WORK_UNITS);
    const state = NewGraphStateSnapshot({
      CaptureTopology: true,
      CaptureEdgeRoutes: false,
    });
    state.UpdateWithWorkGuard(g, guard);

    edge.Points[0].X = 999;
    RestoreGraphState(g, state);

    expect(edge.Points[0].X === 1).toBe(sc.edgeRouteRestoredInTopology);
  });

  it("replays state_reuse", () => {
    const sc = fixture.scenarios.state_reuse;

    const g = new Graph();
    const n1 = new Node(1n, 100, 80);
    g.addNodeUnchecked(n1);

    const state = NewGraphStateSnapshot({ CaptureTopology: true });
    const guard1 = new WorkGuard(new WorkContext(), "Reuse1", MAX_ENGINE_WORK_UNITS);
    state.UpdateWithWorkGuard(g, guard1);

    // Mutate to state B
    n1.Width = 200;
    const guard2 = new WorkGuard(new WorkContext(), "Reuse2", MAX_ENGINE_WORK_UNITS);
    state.UpdateWithWorkGuard(g, guard2);

    // Mutate to state C
    n1.Width = 300;

    // Restore should restore state B
    RestoreGraphState(g, state);

    expect(n1.Width).toBe(sc.reusedStateRestoredWidth);
  });

  it("replays work_accounting_neighbor", () => {
    const sc = fixture.scenarios.work_accounting_neighbor;

    const g = new Graph();
    const from = new Node(1n, 10, 10);
    const to = new Node(2n, 10, 10);
    g.addNodeUnchecked(from);
    g.addNodeUnchecked(to);

    const measure = (limit) => {
      const guard = new WorkGuard(new WorkContext(), "GraphStateNeighborWork", limit);
      const state = NewGraphStateSnapshot({ CaptureTopology: true });
      let errMsg = "";
      try {
        state.UpdateWithWorkGuard(g, guard);
      } catch (e) {
        errMsg = e.message;
      }
      return { used: guard.Used(), errMsg };
    };

    const baseline = measure(MAX_ENGINE_WORK_UNITS);
    expect(baseline.used.toString()).toBe(sc.baselineUsed);

    from.LongDistanceNeighborRequirements = new Map([
      [to, new LongDistanceNeighborRequirements(3, 100, 200)],
    ]);

    const withNeighbor = measure(MAX_ENGINE_WORK_UNITS);
    expect(withNeighbor.used.toString()).toBe(sc.withNeighborUsed);
    expect((withNeighbor.used - baseline.used).toString()).toBe(sc.workDifference);

    const failed = measure(withNeighbor.used - 1n);
    expect(failed.errMsg).toBe(sc.failErrorMessage);

    const exact = measure(withNeighbor.used);
    expect(exact.used.toString()).toBe(sc.exactSuccessUsed);
    expect(exact.errMsg).toBe("");
  });

  it("replays error_messages", () => {
    const errs = fixture.scenarios.error_messages;

    const state = NewGraphStateSnapshot({});
    const guard = new WorkGuard(new WorkContext(), "test", MAX_ENGINE_WORK_UNITS);

    expect(() => state.UpdateWithWorkGuard(null, guard)).toThrow(errs.nil_graph);

    const g = new Graph();
    expect(() => state.UpdateWithWorkGuard(g, null)).toThrow(errs.nil_guard);

    g.Edges = [null];
    const geomRoutesState = NewGraphStateSnapshot({ CaptureEdgeRoutes: true });
    const guard2 = new WorkGuard(new WorkContext(), "test2", MAX_ENGINE_WORK_UNITS);
    expect(() => geomRoutesState.UpdateWithWorkGuard(g, guard2)).toThrow(errs.nil_edge_geometry);
  });

  it("replays nil_hierarchy_levels", () => {
    const sc = fixture.scenarios.nil_hierarchy_levels;

    const g = new Graph();
    const n1 = new Node(1n, 10, 10);
    g.addNodeUnchecked(n1);
    const h = new Hierarchy();
    h.ReplaceLevels(null);
    n1.Hierarchy = h;

    expect(h.levels === null).toBe(sc.hierarchyLevelNilBefore);

    const guard = new WorkGuard(new WorkContext(), "NilHierarchy", MAX_ENGINE_WORK_UNITS);
    const state = NewGraphStateSnapshot({ CaptureTopology: true });
    state.UpdateWithWorkGuard(g, guard);

    expect(h.levels === null).toBe(sc.hierarchyLevelNilAfterSnapshot);

    RestoreGraphState(g, state);

    expect(h.levels === null).toBe(sc.hierarchyLevelNilAfterRestore);
  });
});
