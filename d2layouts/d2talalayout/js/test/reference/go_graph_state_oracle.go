package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"runtime"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
	"github.com/d2lang/d2/lib/geo"
)

type OracleOutput struct {
	Metadata  map[string]interface{} `json:"metadata"`
	Constants map[string]interface{} `json:"constants"`
	Scenarios map[string]interface{} `json:"scenarios"`
}

func main() {
	outPath := "test/fixtures/go-graph-state-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"runtimeGoVersion": runtime.Version(),
			"runtimeGOOS":      runtime.GOOS,
			"runtimeGOARCH":    runtime.GOARCH,
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage": "github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph",
		},
		Constants: map[string]interface{}{
			"MaxEngineNodes":     limits.MaxEngineNodes,
			"MaxEngineEdges":     limits.MaxEngineEdges,
			"MaxEngineWorkUnits": limits.MaxEngineWorkUnits,
		},
		Scenarios: make(map[string]interface{}),
	}

	// 1. Mandatory topology oracle scenario
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 100, 80)
		n1.TopLeft = geo.NewPoint(10, 20)
		n1.FixedTopLeft = geo.NewPoint(10, 20)
		dw := 120.0
		dh := 90.0
		fs := 14
		d2id := "node_1"
		n1.DesiredWidth = &dw
		n1.DesiredHeight = &dh
		n1.FontSize = &fs
		n1.D2ID = &d2id
		n1.Label = &layoutgraph.Label{Text: "N1", Width: 30, Height: 15}
		n1.Label.FixPosition()
		n1.Icon = &layoutgraph.Icon{}
		n1.Icon.FixPosition()
		n1.LoopOffsets = map[geo.Orientation]float64{geo.Top: 5.0}

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(200, 100)
		g.AddNodeUnchecked(n1)
		g.AddNodeUnchecked(n2)

		n1.AddNear(n2)
		n1.LongDistanceNeighborRequirements = map[*layoutgraph.Node]layoutgraph.LongDistanceNeighborRequirements{
			n2: {EdgeCount: 2, MaxWidth: 50, MaxHeight: 30},
		}

		edge := g.Connect(n1, n2)
		edge.Points = []*geo.Point{geo.NewPoint(110, 60), geo.NewPoint(200, 120)}
		edge.Label = &layoutgraph.Label{Text: "E1", Width: 20, Height: 10}
		edge.Label.FixPosition()

		clusterVessel := layoutgraph.NewNode(10, 10, 10)
		cluster := &layoutgraph.Cluster{
			Vessel:             clusterVessel,
			Nodes:              []*layoutgraph.Node{n1},
			Arrangement:        layoutgraph.Column,
			DesiredArrangement: layoutgraph.Row,
			Padding:            12.0,
			Graph:              g,
		}
		g.Clusters[clusterVessel] = cluster

		seqVessel := layoutgraph.NewNode(20, 10, 10)
		seq := &layoutgraph.Sequence{
			Vessel: seqVessel,
			Nodes:  []*layoutgraph.Node{n1, n2},
			Graph:  g,
		}
		g.Sequences[seqVessel] = seq

		tree := &layoutgraph.Tree{
			Node:        n1,
			Orientation: geo.Top,
		}
		g.Trees[nil] = []*layoutgraph.Tree{tree}
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		g.NodeToTree[n1] = tree

		g.Hubs[n1] = []*layoutgraph.Node{n2}
		g.Directions[n1] = geo.Bottom
		g.CommonUncleSiblings = map[*layoutgraph.Node]layoutgraph.Nodes{
			n1: {n2},
		}

		herd := layoutgraph.NewHerdAssignment()
		herd.Orientation = geo.Right
		herd.Val = 42.5
		herd.PairSameSide(n2)
		herd.PairOppositeSide(n1)
		n1.HerdAssignment = herd

		hierarchy := layoutgraph.NewHierarchy()
		hierarchy.LevelCount = 3
		hierarchy.Levels()[n1] = 0
		hierarchy.Levels()[n2] = 1
		n1.Hierarchy = hierarchy
		n2.Hierarchy = hierarchy

		guard, err := limits.NewWorkGuard(context.Background(), "Snapshot", limits.MaxEngineWorkUnits)
		if err != nil {
			panic(err)
		}
		state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{
			CaptureTopology:   true,
			CaptureEdgeRoutes: true,
		})
		if err := state.UpdateWithWorkGuard(g, guard); err != nil {
			panic(err)
		}

		// Keep original identities
		origN1TopLeft := n1.TopLeft
		origN1FixedTopLeft := n1.FixedTopLeft
		origN1Label := n1.Label
		origN1Icon := n1.Icon
		origEdgePoints := edge.Points
		origEdgeFirstPoint := edge.Points[0]
		origClustersMapPtr := reflect.ValueOf(g.Clusters).Pointer()
		origContainersMapPtr := reflect.ValueOf(g.Containers).Pointer()
		origSequencesMapPtr := reflect.ValueOf(g.Sequences).Pointer()
		origNodeToTreeMapPtr := reflect.ValueOf(g.NodeToTree).Pointer()
		origDirectionsMapPtr := reflect.ValueOf(g.Directions).Pointer()
		origN1NearsPtr := reflect.ValueOf(n1.Nears).Pointer()
		origN1LoopOffsetsPtr := reflect.ValueOf(n1.LoopOffsets).Pointer()
		origN1ReqsPtr := reflect.ValueOf(n1.LongDistanceNeighborRequirements).Pointer()
		origHerdSamePtr := reflect.ValueOf(herd.SameSidePairCount()).Int()
		origHierarchyLevelsPtr := reflect.ValueOf(hierarchy.Levels()).Pointer()

		// Mutate everything
		n1.Width = 999
		n1.Height = 888
		origN1TopLeft.X = 777
		origN1TopLeft.Y = 666
		n1.TopLeft = geo.NewPoint(555, 444)
		origN1FixedTopLeft.X = 333
		n1.FixedTopLeft = geo.NewPoint(222, 111)
		n1.Label.Text = "MUTATED"
		n1.Icon = &layoutgraph.Icon{}
		edge.Points[0].X = 9999
		edge.Points = append(edge.Points, geo.NewPoint(300, 300))
		g.Nodes = append(g.Nodes, layoutgraph.NewNode(99, 1, 1))
		g.Clusters = make(map[*layoutgraph.Node]*layoutgraph.Cluster)
		g.Sequences = make(map[*layoutgraph.Node]*layoutgraph.Sequence)
		n1.Nears = make(map[*layoutgraph.Node]struct{})
		herd.Val = 100.0

		// Rollback
		layoutgraph.RestoreGraphState(g, state)

		scenario := map[string]interface{}{
			"n1Width":                             n1.Width,
			"n1Height":                            n1.Height,
			"n1TopLeftX":                          n1.TopLeft.X,
			"n1TopLeftY":                          n1.TopLeft.Y,
			"n1TopLeftIdentityRestored":           n1.TopLeft == origN1TopLeft,
			"n1FixedTopLeftIdentityRestored":      n1.FixedTopLeft == origN1FixedTopLeft,
			"n1FixedTopLeftX":                     n1.FixedTopLeft.X,
			"n1LabelIdentityRestored":             n1.Label == origN1Label,
			"n1LabelText":                         n1.Label.Text,
			"n1LabelPositionFixed":                n1.Label.PositionFixed(),
			"n1IconIdentityRestored":              n1.Icon == origN1Icon,
			"n1IconPositionFixed":                 n1.Icon.PositionFixed(),
			"edgePointsLength":                    len(edge.Points),
			"edgePointsBackingRestored":           &edge.Points[:cap(edge.Points)][0] == &origEdgePoints[:cap(origEdgePoints)][0],
			"edgeFirstPointIdentityRestored":      edge.Points[0] == origEdgeFirstPoint,
			"edgeFirstPointX":                     edge.Points[0].X,
			"clustersMapIdentityRestored":         reflect.ValueOf(g.Clusters).Pointer() == origClustersMapPtr,
			"clustersCount":                       len(g.Clusters),
			"sequencesMapIdentityRestored":        reflect.ValueOf(g.Sequences).Pointer() == origSequencesMapPtr,
			"sequencesCount":                      len(g.Sequences),
			"containersMapIdentityRestored":       reflect.ValueOf(g.Containers).Pointer() == origContainersMapPtr,
			"nodeToTreeMapIdentityRestored":       reflect.ValueOf(g.NodeToTree).Pointer() == origNodeToTreeMapPtr,
			"directionsMapIdentityRestored":       reflect.ValueOf(g.Directions).Pointer() == origDirectionsMapPtr,
			"n1NearsIdentityRestored":             reflect.ValueOf(n1.Nears).Pointer() == origN1NearsPtr,
			"n1LoopOffsetsIdentityRestored":       reflect.ValueOf(n1.LoopOffsets).Pointer() == origN1LoopOffsetsPtr,
			"n1RequirementsIdentityRestored":      reflect.ValueOf(n1.LongDistanceNeighborRequirements).Pointer() == origN1ReqsPtr,
			"n1RequirementsCount":                 len(n1.LongDistanceNeighborRequirements),
			"n1RequirementEdgeCount":              n1.LongDistanceNeighborRequirements[n2].EdgeCount,
			"herdVal":                             herd.Val,
			"herdSameSidePairCount":               herd.SameSidePairCount() == int(origHerdSamePtr),
			"hierarchyLevelCount":                 hierarchy.LevelCount,
			"hierarchyLevelsMapIdentityRestored":  reflect.ValueOf(hierarchy.Levels()).Pointer() == origHierarchyLevelsPtr,
			"graphNodesCount":                     len(g.Nodes),
		}
		out.Scenarios["topology_full_rollback"] = scenario
	}

	// 2. Exact Slice Backing Scenario (mirroring upstream TestTopologyRollbackRestoresEveryExactSliceBacking)
	{
		g := layoutgraph.NewGraph()
		node := layoutgraph.NewNode(1, 10, 10)
		node.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(node)
		edge := g.Connect(node, node)
		pointTail := geo.NewPoint(99, 99)
		pointBacking := make([]*geo.Point, 4)
		pointBacking[0] = geo.NewPoint(0, 0)
		for i := 1; i < len(pointBacking); i++ {
			pointBacking[i] = pointTail
		}
		edge.Points = pointBacking[:1]

		tailNode := layoutgraph.NewNode(90, 1, 1)
		tailEdge := layoutgraph.NewEdge(tailNode, tailNode)
		tailAbduction := &layoutgraph.EdgeAbduction{Edge: tailEdge}

		clusterVessel := layoutgraph.NewNode(2, 1, 1)
		clusterNodes := []*layoutgraph.Node{node, tailNode, tailNode}[:1]
		clusterAbductions := []*layoutgraph.EdgeAbduction{{Edge: edge}, tailAbduction, tailAbduction}[:1]
		cluster := &layoutgraph.Cluster{Vessel: clusterVessel, Nodes: clusterNodes, EdgeAbductions: clusterAbductions, Graph: g}
		g.Clusters[clusterVessel] = cluster

		sequenceVessel := layoutgraph.NewNode(3, 1, 1)
		sequenceNodes := []*layoutgraph.Node{node, tailNode, tailNode}[:1]
		sequenceAbductions := []*layoutgraph.EdgeAbduction{{Edge: edge}, tailAbduction, tailAbduction}[:1]
		sequence := &layoutgraph.Sequence{Vessel: sequenceVessel, Nodes: sequenceNodes, EdgeAbductions: sequenceAbductions, Graph: g}
		g.Sequences[sequenceVessel] = sequence

		childTree := &layoutgraph.Tree{Node: tailNode}
		treeChildren := []*layoutgraph.Tree{childTree, childTree, childTree}[:1]
		tree := &layoutgraph.Tree{Node: node, Children: treeChildren}
		treeRoots := []*layoutgraph.Tree{tree, childTree, childTree}[:1]
		g.Trees[nil] = treeRoots
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		g.NodeToTree[node] = tree

		hubNodes := []*layoutgraph.Node{node, tailNode, tailNode}[:1]
		g.Hubs[node] = hubNodes
		commonNodes := layoutgraph.Nodes{node, tailNode, tailNode}[:1]
		g.CommonUncleSiblings = make(map[*layoutgraph.Node]layoutgraph.Nodes)
		g.CommonUncleSiblings[node] = commonNodes
		containerNodes := []*layoutgraph.Node{node, tailNode, tailNode}[:1]
		g.Containers[nil] = containerNodes

		guard, _ := limits.NewWorkGuard(context.Background(), "ExactSliceTest", limits.MaxEngineWorkUnits)
		state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{CaptureTopology: true, CaptureEdgeRoutes: true})
		if err := state.UpdateWithWorkGuard(g, guard); err != nil {
			panic(err)
		}

		clusterNodesPtr := &cluster.Nodes[:cap(cluster.Nodes)][0]
		clusterAbductionsPtr := &cluster.EdgeAbductions[:cap(cluster.EdgeAbductions)][0]
		sequenceNodesPtr := &sequence.Nodes[:cap(sequence.Nodes)][0]
		sequenceAbductionsPtr := &sequence.EdgeAbductions[:cap(sequence.EdgeAbductions)][0]
		treeChildrenPtr := &tree.Children[:cap(tree.Children)][0]
		treeRootsPtr := &g.Trees[nil][:cap(g.Trees[nil])][0]
		hubsPtr := &g.Hubs[node][:cap(g.Hubs[node])][0]
		commonPtr := &g.CommonUncleSiblings[node][:cap(g.CommonUncleSiblings[node])][0]
		routePtr := &edge.Points[:cap(edge.Points)][0]
		routePointVal := *edge.Points[0]

		// Mutate slices
		cluster.Nodes = append(cluster.Nodes, tailNode)
		cluster.EdgeAbductions = append(cluster.EdgeAbductions, tailAbduction)
		sequence.Nodes = append(sequence.Nodes, tailNode)
		sequence.EdgeAbductions = append(sequence.EdgeAbductions, tailAbduction)
		tree.Children = append(tree.Children, childTree)
		g.Trees[nil] = append(g.Trees[nil], childTree)
		g.Hubs[node] = append(g.Hubs[node], tailNode)
		g.CommonUncleSiblings[node] = append(g.CommonUncleSiblings[node], tailNode)
		edge.Points[0].X = 123
		edge.Points = append(edge.Points, geo.NewPoint(5, 5))

		layoutgraph.RestoreGraphState(g, state)

		scenario := map[string]interface{}{
			"clusterNodesBackingRestored":      &cluster.Nodes[:cap(cluster.Nodes)][0] == clusterNodesPtr,
			"clusterNodesLen":                  len(cluster.Nodes),
			"clusterAbductionsBackingRestored": &cluster.EdgeAbductions[:cap(cluster.EdgeAbductions)][0] == clusterAbductionsPtr,
			"clusterAbductionsLen":             len(cluster.EdgeAbductions),
			"sequenceNodesBackingRestored":     &sequence.Nodes[:cap(sequence.Nodes)][0] == sequenceNodesPtr,
			"sequenceNodesLen":                 len(sequence.Nodes),
			"sequenceAbductionsRestored":       &sequence.EdgeAbductions[:cap(sequence.EdgeAbductions)][0] == sequenceAbductionsPtr,
			"sequenceAbductionsLen":            len(sequence.EdgeAbductions),
			"treeChildrenBackingRestored":      &tree.Children[:cap(tree.Children)][0] == treeChildrenPtr,
			"treeChildrenLen":                  len(tree.Children),
			"treeRootsBackingRestored":         &g.Trees[nil][:cap(g.Trees[nil])][0] == treeRootsPtr,
			"treeRootsLen":                     len(g.Trees[nil]),
			"hubsBackingRestored":              &g.Hubs[node][:cap(g.Hubs[node])][0] == hubsPtr,
			"hubsLen":                          len(g.Hubs[node]),
			"commonBackingRestored":            &g.CommonUncleSiblings[node][:cap(g.CommonUncleSiblings[node])][0] == commonPtr,
			"commonLen":                        len(g.CommonUncleSiblings[node]),
			"routeBackingRestored":             &edge.Points[:cap(edge.Points)][0] == routePtr,
			"routeLen":                         len(edge.Points),
			"routePointValueRestored":          *edge.Points[0] == routePointVal,
		}
		out.Scenarios["exact_slice_backing"] = scenario
	}

	// 3. Hidden runtime objects scenario (reachable outside Graph.Nodes)
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		hiddenNode := layoutgraph.NewNode(2, 50, 40)
		hiddenNode.TopLeft = geo.NewPoint(15, 25)

		cluster := &layoutgraph.Cluster{
			Vessel: vessel,
			Nodes:  []*layoutgraph.Node{hiddenNode},
			Graph:  g,
		}
		g.Clusters[vessel] = cluster

		guard, _ := limits.NewWorkGuard(context.Background(), "HiddenTest", limits.MaxEngineWorkUnits)
		state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{CaptureTopology: true})
		if err := state.UpdateWithWorkGuard(g, guard); err != nil {
			panic(err)
		}

		hiddenNode.Width = 999
		hiddenNode.TopLeft.X = 888

		layoutgraph.RestoreGraphState(g, state)

		scenario := map[string]interface{}{
			"hiddenNodeWidth":    hiddenNode.Width,
			"hiddenNodeTopLeftX": hiddenNode.TopLeft.X,
		}
		out.Scenarios["hidden_runtime_objects"] = scenario
	}

	// 4. Geometry-only scenario
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 100, 80)
		n1.TopLeft = geo.NewPoint(10, 20)
		g.AddNodeUnchecked(n1)

		edge := g.Connect(n1, n1)
		edge.Points = []*geo.Point{geo.NewPoint(1, 1), geo.NewPoint(2, 2)}

		c := &layoutgraph.Cluster{
			Arrangement:        layoutgraph.Column,
			DesiredArrangement: layoutgraph.Row,
			Padding:            10.0,
		}
		g.Clusters[n1] = c

		tree := &layoutgraph.Tree{Node: n1, Orientation: geo.Left}
		g.NodeToTree = make(map[*layoutgraph.Node]*layoutgraph.Tree)
		g.NodeToTree[n1] = tree

		guard, _ := limits.NewWorkGuard(context.Background(), "GeomOnly", limits.MaxEngineWorkUnits)
		state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{
			CaptureTopology:   false,
			CaptureEdgeRoutes: false,
		})
		if err := state.UpdateWithWorkGuard(g, guard); err != nil {
			panic(err)
		}

		// Mutate geometry
		n1.Width = 250
		n1.TopLeft.X = 75
		c.Arrangement = layoutgraph.Row
		c.Padding = 20.0
		tree.Orientation = geo.Right

		// Mutate topology map (should NOT be restored in geometry mode)
		extraNode := layoutgraph.NewNode(99, 10, 10)
		g.Clusters[extraNode] = &layoutgraph.Cluster{}

		// Mutate edge route (should NOT be restored when CaptureEdgeRoutes=false)
		edge.Points[0].X = 999

		layoutgraph.RestoreGraphState(g, state)

		scenario := map[string]interface{}{
			"n1WidthRestored":              n1.Width == 100,
			"n1TopLeftXRestored":           n1.TopLeft.X == 10,
			"clusterArrangementRestored":   c.Arrangement == layoutgraph.Column,
			"clusterPaddingRestored":       c.Padding == 10.0,
			"treeOrientationRestored":      tree.Orientation == geo.Left,
			"extraClusterMembershipKept":   g.Clusters[extraNode] != nil,
			"edgeRouteMutationKept":        edge.Points[0].X == 999,
		}
		out.Scenarios["geometry_only"] = scenario
	}

	// 5. Geometry + Routes scenario
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 100, 80)
		n1.TopLeft = geo.NewPoint(10, 20)
		g.AddNodeUnchecked(n1)

		edge := g.Connect(n1, n1)
		edge.Points = []*geo.Point{geo.NewPoint(1, 1), geo.NewPoint(2, 2)}

		guard, _ := limits.NewWorkGuard(context.Background(), "GeomRoutes", limits.MaxEngineWorkUnits)
		state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{
			CaptureTopology:   false,
			CaptureEdgeRoutes: true,
		})
		if err := state.UpdateWithWorkGuard(g, guard); err != nil {
			panic(err)
		}

		edge.Points[0].X = 999
		edge.Points = append(edge.Points, geo.NewPoint(3, 3))

		layoutgraph.RestoreGraphState(g, state)

		scenario := map[string]interface{}{
			"edgeRouteRestored": edge.Points[0].X == 1,
			"edgePointsLen":     len(edge.Points),
		}
		out.Scenarios["geometry_with_routes"] = scenario
	}

	// 6. Topology without routes option scenario (Requirement 75/93)
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 100, 80)
		n1.TopLeft = geo.NewPoint(10, 20)
		g.AddNodeUnchecked(n1)

		edge := g.Connect(n1, n1)
		edge.Points = []*geo.Point{geo.NewPoint(1, 1), geo.NewPoint(2, 2)}

		guard, _ := limits.NewWorkGuard(context.Background(), "TopolNoRoutes", limits.MaxEngineWorkUnits)
		state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{
			CaptureTopology:   true,
			CaptureEdgeRoutes: false,
		})
		if err := state.UpdateWithWorkGuard(g, guard); err != nil {
			panic(err)
		}

		edge.Points[0].X = 999
		layoutgraph.RestoreGraphState(g, state)

		scenario := map[string]interface{}{
			"edgeRouteRestoredInTopology": edge.Points[0].X == 1,
		}
		out.Scenarios["topology_without_routes_option"] = scenario
	}

	// 7. State reuse scenario (Requirement 94)
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 100, 80)
		g.AddNodeUnchecked(n1)

		state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{CaptureTopology: true})
		guard1, _ := limits.NewWorkGuard(context.Background(), "Reuse1", limits.MaxEngineWorkUnits)
		if err := state.UpdateWithWorkGuard(g, guard1); err != nil {
			panic(err)
		}

		// Mutate to state B
		n1.Width = 200
		guard2, _ := limits.NewWorkGuard(context.Background(), "Reuse2", limits.MaxEngineWorkUnits)
		if err := state.UpdateWithWorkGuard(g, guard2); err != nil {
			panic(err)
		}

		// Mutate to state C
		n1.Width = 300

		// Restore should restore state B
		layoutgraph.RestoreGraphState(g, state)

		scenario := map[string]interface{}{
			"reusedStateRestoredWidth": n1.Width,
		}
		out.Scenarios["state_reuse"] = scenario
	}

	// 8. Work accounting neighbor (+1 step, Requirement 95)
	{
		g := layoutgraph.NewGraph()
		from := g.AddNode(layoutgraph.NewNode(1, 10, 10))
		to := g.AddNode(layoutgraph.NewNode(2, 10, 10))

		measure := func(limit int64) (int64, string, error) {
			guard, err := limits.NewWorkGuard(context.Background(), "GraphStateNeighborWork", limit)
			if err != nil {
				return 0, "", err
			}
			state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{CaptureTopology: true})
			err = state.UpdateWithWorkGuard(g, guard)
			errMsg := ""
			if err != nil {
				errMsg = err.Error()
			}
			return guard.Used(), errMsg, err
		}

		baseline, _, err := measure(limits.MaxEngineWorkUnits)
		if err != nil {
			panic(err)
		}

		from.LongDistanceNeighborRequirements = map[*layoutgraph.Node]layoutgraph.LongDistanceNeighborRequirements{
			to: {EdgeCount: 3, MaxWidth: 100, MaxHeight: 200},
		}

		withNeighbor, _, err := measure(limits.MaxEngineWorkUnits)
		if err != nil {
			panic(err)
		}

		diff := withNeighbor - baseline

		_, failMsg, _ := measure(withNeighbor - 1)
		usedExact, _, errExact := measure(withNeighbor)

		scenario := map[string]interface{}{
			"baselineUsed":        strconv.FormatInt(baseline, 10),
			"withNeighborUsed":    strconv.FormatInt(withNeighbor, 10),
			"workDifference":      strconv.FormatInt(diff, 10),
			"failErrorMessage":    failMsg,
			"exactSuccessUsed":    strconv.FormatInt(usedExact, 10),
			"exactSuccessNoError": errExact == nil,
		}
		out.Scenarios["work_accounting_neighbor"] = scenario
	}

	// 9. Error classification and wording scenario (Requirement 96)
	{
		errorsMap := make(map[string]string)

		// nil graph
		{
			state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{})
			guard, _ := limits.NewWorkGuard(context.Background(), "test", limits.MaxEngineWorkUnits)
			err := state.UpdateWithWorkGuard(nil, guard)
			if err != nil {
				errorsMap["nil_graph"] = err.Error()
			}
		}

		// nil guard
		{
			state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{})
			g := layoutgraph.NewGraph()
			err := state.UpdateWithWorkGuard(g, nil)
			if err != nil {
				errorsMap["nil_guard"] = err.Error()
			}
		}

		// nil edge in geometry snapshot
		{
			g := layoutgraph.NewGraph()
			g.Edges = []*layoutgraph.Edge{nil}
			state := layoutgraph.NewGraphStateSnapshot(layoutgraph.GraphStateSnapshotOptions{CaptureEdgeRoutes: true})
			guard, _ := limits.NewWorkGuard(context.Background(), "test", limits.MaxEngineWorkUnits)
			err := state.UpdateWithWorkGuard(g, guard)
			if err != nil {
				errorsMap["nil_edge_geometry"] = err.Error()
			}
		}

		out.Scenarios["error_messages"] = errorsMap
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Wrote oracle fixture to %s\n", outPath)
}
