package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"runtime"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/shape"
)

type OracleOutput struct {
	Metadata  map[string]interface{} `json:"metadata"`
	Scenarios map[string]interface{} `json:"scenarios"`
}

func connectWithID(g *layoutgraph.Graph, id layoutgraph.EntityID, from, to *layoutgraph.Node) *layoutgraph.Edge {
	edge := g.Connect(from, to)
	edge.ID = id
	return edge
}

func main() {
	outPath := "test/fixtures/go-sequence-analysis-reference.json"
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}

	out := OracleOutput{
		Metadata: map[string]interface{}{
			"runtimeGoVersion": runtime.Version(),
			"runtimeGOOS":      runtime.GOOS,
			"runtimeGOARCH":    runtime.GOARCH,
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"referencePackage": "github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping",
		},
		Scenarios: make(map[string]interface{}),
	}

	ctx := context.Background()

	// -------------------------------------------------------------
	// 1. Direct Public Accessors
	// -------------------------------------------------------------
	{
		containerNode := layoutgraph.NewNode(1, 100, 100)
		containerNode.SetContainer(true)
		ordinaryNode := layoutgraph.NewNode(2, 40, 30)

		stepNode := layoutgraph.NewNode(3, 40, 30)
		stepNode.SetShape(shape.STEP_TYPE)
		squareNode := layoutgraph.NewNode(4, 40, 30)
		squareNode.SetShape(shape.SQUARE_TYPE)

		connGraph := layoutgraph.NewGraph()
		nA := connGraph.AddNode(layoutgraph.NewNode(10, 40, 30))
		nB := connGraph.AddNode(layoutgraph.NewNode(20, 40, 30))
		nC := connGraph.AddNode(layoutgraph.NewNode(30, 40, 30))
		eAB := connGraph.Connect(nA, nB)
		eAB.ID = 50

		seqGraph := layoutgraph.NewGraph()
		vessel3 := layoutgraph.NewNode(300, 0, 0)
		vessel1 := layoutgraph.NewNode(100, 0, 0)
		vessel2 := layoutgraph.NewNode(200, 0, 0)
		seqGraph.Sequences[vessel3] = &layoutgraph.Sequence{Vessel: vessel3}
		seqGraph.Sequences[vessel1] = &layoutgraph.Sequence{Vessel: vessel1}
		seqGraph.Sequences[vessel2] = &layoutgraph.Sequence{Vessel: vessel2}
		orderedVessels := seqGraph.SequenceOrder()
		orderedIDs := make([]int64, len(orderedVessels))
		for i, v := range orderedVessels {
			orderedIDs[i] = int64(v.ID)
		}

		out.Scenarios["accessors"] = map[string]interface{}{
			"container_is_container":    containerNode.IsContainer(),
			"ordinary_is_container":     ordinaryNode.IsContainer(),
			"step_is_sequence_step":     stepNode.IsSequenceStep(),
			"square_is_sequence_step":   squareNode.IsSequenceStep(),
			"connection_ab_exists":      nA.ConnectionTo(nB) != nil && nA.ConnectionTo(nB).ID == eAB.ID,
			"connection_ac_nil":         nA.ConnectionTo(nC) == nil,
			"sequence_order_vessel_ids": orderedIDs,
		}
	}

	// -------------------------------------------------------------
	// 2. SequenceDefiningEdges Scenarios (exercises identifySequences)
	// -------------------------------------------------------------
	definingEdgesScenarios := make(map[string]interface{})

	recordDefiningEdges := func(name string, buildGraph func() *layoutgraph.Graph) {
		g := buildGraph()

		nodeCountBefore := len(g.Nodes)
		edgeCountBefore := len(g.Edges)
		seqCountBefore := len(g.Sequences)

		edges, err := grouping.SequenceDefiningEdges(ctx, g)
		if err != nil {
			definingEdgesScenarios[name] = map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}
			return
		}

		edgeIDs := make([]int64, 0, len(edges))
		for id := range edges {
			edgeIDs = append(edgeIDs, int64(id))
		}
		sort.Slice(edgeIDs, func(i, j int) bool { return edgeIDs[i] < edgeIDs[j] })

		// Read-only invariants check
		definingEdgesScenarios[name] = map[string]interface{}{
			"success":         true,
			"definingEdgeIDs": edgeIDs,
			"nodeCountBefore": nodeCountBefore,
			"nodeCountAfter":  len(g.Nodes),
			"edgeCountBefore": edgeCountBefore,
			"edgeCountAfter":  len(g.Edges),
			"seqCountBefore":  seqCountBefore,
			"seqCountAfter":   len(g.Sequences),
		}
	}

	// 2a. Two connected steps
	recordDefiningEdges("two_connected_steps", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 100, s1, s2)
		return g
	})

	// 2b. Reverse directed edge
	recordDefiningEdges("reverse_directed_edge", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 101, s2, s1) // reverse edge
		return g
	})

	// 2c. Three-step chain
	recordDefiningEdges("three_step_chain", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s3 := layoutgraph.NewNode(3, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s3.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, s3)
		connectWithID(g, 100, s1, s2)
		connectWithID(g, 101, s2, s3)
		return g
	})

	// 2d. Two separate runs
	recordDefiningEdges("two_separate_runs", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s3 := layoutgraph.NewNode(3, 40, 30)
		s4 := layoutgraph.NewNode(4, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s3.SetShape(shape.STEP_TYPE)
		s4.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, s3)
		g.AddNewNodeToContainer(nil, s4)
		connectWithID(g, 100, s1, s2)
		// s2 and s3 disconnected
		connectWithID(g, 101, s3, s4)
		return g
	})

	// 2e. Single step
	recordDefiningEdges("single_step", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		return g
	})

	// 2f. Non-step pair
	recordDefiningEdges("non_step_pair", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n1.SetShape(shape.SQUARE_TYPE)
		n2.SetShape(shape.SQUARE_TYPE)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		connectWithID(g, 100, n1, n2)
		return g
	})

	// 2g. Step container skipped
	recordDefiningEdges("step_container_skipped", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(1, 100, 100)
		c1.SetShape(shape.STEP_TYPE)
		c1.SetContainer(true)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, c1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 100, c1, s2)
		return g
	})

	// 2h. FixedTopLeft step skipped
	recordDefiningEdges("fixed_top_left_step_skipped", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s1.FixedTopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 100, s1, s2)
		return g
	})

	// 2i. Inactive remembered steps skipped
	recordDefiningEdges("inactive_remembered_steps_skipped", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 100, s1, s2)

		remSeq := &layoutgraph.Sequence{
			Vessel:    layoutgraph.NewNode(3, 0, 0),
			Nodes:     []*layoutgraph.Node{s1, s2},
			Graph:     g,
			Container: nil,
		}
		// Inactive because Vessel.Graph is nil
		s1.Sequence = remSeq
		s2.Sequence = remSeq
		return g
	})

	// 2j. Node absent from Graph.Nodes skipped
	recordDefiningEdges("node_absent_graph_nodes_skipped", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 100, s1, s2)
		// Remove s2 from graph.Nodes while keeping it in Containers
		g.RemoveNode(s2)
		return g
	})

	// 2k. Interleaved non-step child between connected steps
	recordDefiningEdges("interleaved_non_step_child", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		other := layoutgraph.NewNode(2, 40, 30)
		s3 := layoutgraph.NewNode(3, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		other.SetShape(shape.SQUARE_TYPE)
		s3.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, other)
		g.AddNewNodeToContainer(nil, s3)
		connectWithID(g, 100, s1, s3)
		return g
	})

	// 2l. Parallel edges: first matching edge chosen
	recordDefiningEdges("parallel_edges_first_chosen", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 200, s1, s2)
		connectWithID(g, 201, s1, s2)
		return g
	})

	// 2m. Container-local discovery split
	recordDefiningEdges("container_local_split", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(10, 100, 100)
		c2 := layoutgraph.NewNode(20, 100, 100)
		c1.SetContainer(true)
		c2.SetContainer(true)
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, c1)
		g.AddNewNodeToContainer(nil, c2)
		g.AddNewNodeToContainer(c1, s1)
		g.AddNewNodeToContainer(c2, s2)
		connectWithID(g, 100, s1, s2)
		return g
	})

	// 2n. Nested containers traversal
	recordDefiningEdges("nested_containers", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(10, 200, 200)
		c2 := layoutgraph.NewNode(20, 100, 100)
		c1.SetContainer(true)
		c2.SetContainer(true)
		g.AddNewNodeToContainer(nil, c1)
		g.AddNewNodeToContainer(c1, c2)

		// Root steps
		r1 := layoutgraph.NewNode(1, 40, 30)
		r2 := layoutgraph.NewNode(2, 40, 30)
		r1.SetShape(shape.STEP_TYPE)
		r2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, r1)
		g.AddNewNodeToContainer(nil, r2)
		connectWithID(g, 100, r1, r2)

		// C1 steps
		s3 := layoutgraph.NewNode(3, 40, 30)
		s4 := layoutgraph.NewNode(4, 40, 30)
		s3.SetShape(shape.STEP_TYPE)
		s4.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(c1, s3)
		g.AddNewNodeToContainer(c1, s4)
		connectWithID(g, 101, s3, s4)

		// C2 steps
		s5 := layoutgraph.NewNode(5, 40, 30)
		s6 := layoutgraph.NewNode(6, 40, 30)
		s5.SetShape(shape.STEP_TYPE)
		s6.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(c2, s5)
		g.AddNewNodeToContainer(c2, s6)
		connectWithID(g, 102, s5, s6)

		return g
	})

	out.Scenarios["sequence_defining_edges"] = definingEdgesScenarios

	// -------------------------------------------------------------
	// 3. Remembered-State Validity via Public AddSequences
	// -------------------------------------------------------------
	rememberedScenarios := make(map[string]interface{})

	// 3a. Valid remembered sequence rebuilt without defining edge
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.Connect(s1, s2)

		rnd := rand.New(rand.NewSource(1))
		if err := grouping.AddSequences(ctx, g, rnd); err != nil {
			panic(err)
		}
		var firstVesselID int64
		for v := range g.Sequences {
			firstVesselID = int64(v.ID)
		}
		grouping.Cleanup(g)

		// Confirm defining edge is gone
		edgeSurvives := s1.ConnectionTo(s2) != nil

		// Rebuild using AddSequences
		rnd2 := rand.New(rand.NewSource(1))
		if err := grouping.AddSequences(ctx, g, rnd2); err != nil {
			panic(err)
		}
		var rebuiltVesselID int64
		for v := range g.Sequences {
			rebuiltVesselID = int64(v.ID)
		}

		rememberedScenarios["valid_reconstruction_without_defining_edge"] = map[string]interface{}{
			"edgeSurvivesAfterCleanup": edgeSurvives,
			"initialVesselID":          firstVesselID,
			"initialVesselIDStr":       fmt.Sprintf("%d", firstVesselID),
			"rebuiltVesselID":          rebuiltVesselID,
			"rebuiltVesselIDStr":       fmt.Sprintf("%d", rebuiltVesselID),
			"sequenceCount":            len(g.Sequences),
			"vesselIDPreserved":        firstVesselID == rebuiltVesselID,
			"expectedValidRemembered":  true,
		}
	}

	// 3b. Stale / invalid remembered sequence cases
	newCleanedRememberedGraph := func() (*layoutgraph.Graph, *layoutgraph.Node, *layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		g.Connect(a, b)
		if err := grouping.AddSequences(ctx, g, rand.New(rand.NewSource(1))); err != nil {
			panic(err)
		}
		grouping.Cleanup(g)
		return g, a, b
	}

	testInvalidRemembered := func(name string, mutate func(*layoutgraph.Graph, *layoutgraph.Node, *layoutgraph.Node)) {
		g, a, b := newCleanedRememberedGraph()
		mutate(g, a, b)
		err := grouping.AddSequences(ctx, g, rand.New(rand.NewSource(1)))
		if err != nil {
			rememberedScenarios[name] = map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}
			return
		}
		rememberedScenarios[name] = map[string]interface{}{
			"success":                 true,
			"rebuiltSequencesCount":   len(g.Sequences),
			"aSequenceRetained":       a.Sequence != nil,
			"bSequenceRetained":       b.Sequence != nil,
			"expectedValidRemembered": false,
		}
	}

	testInvalidRemembered("shape_changed", func(_ *layoutgraph.Graph, _ *layoutgraph.Node, b *layoutgraph.Node) {
		b.SetShape(shape.SQUARE_TYPE)
	})

	testInvalidRemembered("container_changed", func(g *layoutgraph.Graph, _ *layoutgraph.Node, b *layoutgraph.Node) {
		container := layoutgraph.NewNode(10, 100, 100)
		container.SetContainer(true)
		g.AddNewNodeToContainer(nil, container)
		children := g.Containers[nil][:0]
		for _, child := range g.Containers[nil] {
			if child != b {
				children = append(children, child)
			}
		}
		g.Containers[nil] = children
		g.AddNodeToContainer(container, b)
	})

	testInvalidRemembered("membership_cleared", func(_ *layoutgraph.Graph, _ *layoutgraph.Node, b *layoutgraph.Node) {
		b.Sequence = nil
	})

	testInvalidRemembered("members_noncontiguous", func(g *layoutgraph.Graph, a, b *layoutgraph.Node) {
		other := layoutgraph.NewNode(10, 20, 20)
		g.AddNodeUnchecked(other)
		g.Containers[nil] = []*layoutgraph.Node{a, other, b}
	})

	testInvalidRemembered("removed_graph_node", func(g *layoutgraph.Graph, _ *layoutgraph.Node, b *layoutgraph.Node) {
		g.RemoveNode(b)
	})

	out.Scenarios["remembered_validity"] = rememberedScenarios

	// -------------------------------------------------------------
	// 4. ID Occupancy & Collision Resolution via Public AddSequences
	// -------------------------------------------------------------
	idScenarios := make(map[string]interface{})

	// 4a. Ordinary node collision
	{
		const seed int64 = 19
		probe := rand.New(rand.NewSource(seed))
		collidingID := probe.Int63()

		g := layoutgraph.NewGraph()
		ordinary := layoutgraph.NewNode(collidingID, 40, 30)
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, ordinary)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		g.Connect(a, b)

		layoutRand := rand.New(rand.NewSource(seed))
		if err := grouping.AddSequences(ctx, g, layoutRand); err != nil {
			panic(err)
		}

		var vessel *layoutgraph.Node
		for v := range g.Sequences {
			vessel = v
		}

		idScenarios["ordinary_node_collision"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"resolvedVesselID":    int64(vessel.ID),
			"resolvedVesselIDStr": fmt.Sprintf("%d", vessel.ID),
			"expectedVesselID":    collidingID + 1,
			"expectedVesselIDStr": fmt.Sprintf("%d", collidingID+1),
			"nextDraw":            layoutRand.Int63(),
			"nextDrawStr":         fmt.Sprintf("%d", layoutRand.Int63()),
			"probeNextDraw":       probe.Int63(),
			"probeNextDrawStr":    fmt.Sprintf("%d", probe.Int63()),
		}
	}

	// 4b. Cluster vessel collision
	{
		const seed int64 = 23
		probe := rand.New(rand.NewSource(seed))
		collidingID := probe.Int63()

		g := layoutgraph.NewGraph()
		clusterVessel := layoutgraph.NewNode(collidingID, 40, 30)
		clusterVessel.SetClusterVessel(true)
		g.Clusters[clusterVessel] = &layoutgraph.Cluster{Vessel: clusterVessel}

		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		g.Connect(a, b)

		layoutRand := rand.New(rand.NewSource(seed))
		if err := grouping.AddSequences(ctx, g, layoutRand); err != nil {
			panic(err)
		}

		var vessel *layoutgraph.Node
		for v := range g.Sequences {
			vessel = v
		}

		idScenarios["cluster_vessel_collision"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"resolvedVesselID":    int64(vessel.ID),
			"resolvedVesselIDStr": fmt.Sprintf("%d", vessel.ID),
			"expectedVesselID":    collidingID + 1,
			"expectedVesselIDStr": fmt.Sprintf("%d", collidingID+1),
		}
	}

	// 4c. Tree sentinel collision
	{
		const seed int64 = 31
		probe := rand.New(rand.NewSource(seed))
		collidingID := probe.Int63()

		g := layoutgraph.NewGraph()
		sentinel := layoutgraph.NewNode(collidingID, 40, 30)
		g.Trees[sentinel] = []*layoutgraph.Tree{}

		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		g.Connect(a, b)

		layoutRand := rand.New(rand.NewSource(seed))
		if err := grouping.AddSequences(ctx, g, layoutRand); err != nil {
			panic(err)
		}

		var vessel *layoutgraph.Node
		for v := range g.Sequences {
			vessel = v
		}

		idScenarios["tree_sentinel_collision"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"resolvedVesselID":    int64(vessel.ID),
			"resolvedVesselIDStr": fmt.Sprintf("%d", vessel.ID),
			"expectedVesselID":    collidingID + 1,
			"expectedVesselIDStr": fmt.Sprintf("%d", collidingID+1),
		}
	}

	// 4d. Tree node collision
	{
		const seed int64 = 47
		probe := rand.New(rand.NewSource(seed))
		collidingID := probe.Int63()

		g := layoutgraph.NewGraph()
		sentinel := layoutgraph.NewNode(100, 40, 30)
		treeNode := layoutgraph.NewNode(collidingID, 40, 30)
		g.Trees[sentinel] = []*layoutgraph.Tree{
			{Node: treeNode},
		}

		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		g.Connect(a, b)

		layoutRand := rand.New(rand.NewSource(seed))
		if err := grouping.AddSequences(ctx, g, layoutRand); err != nil {
			panic(err)
		}

		var vessel *layoutgraph.Node
		for v := range g.Sequences {
			vessel = v
		}

		idScenarios["tree_node_collision"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"resolvedVesselID":    int64(vessel.ID),
			"resolvedVesselIDStr": fmt.Sprintf("%d", vessel.ID),
			"expectedVesselID":    collidingID + 1,
			"expectedVesselIDStr": fmt.Sprintf("%d", collidingID+1),
		}
	}

	out.Scenarios["id_occupancy"] = idScenarios

	// -------------------------------------------------------------
	// Write JSON
	// -------------------------------------------------------------
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		panic(err)
	}

	fmt.Printf("Wrote oracle reference to %s\n", outPath)
}
