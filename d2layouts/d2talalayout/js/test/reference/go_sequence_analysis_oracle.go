package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"runtime"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/limits"
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
	// 2. SequenceDefiningEdges Scenarios
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
		connectWithID(g, 101, s2, s1)
		return g
	})

	// 2c. Three step chain
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
		connectWithID(g, 201, s1, s2)
		connectWithID(g, 202, s2, s3)
		return g
	})

	// 2d. Two separate sequences
	recordDefiningEdges("two_separate_sequences", func() *layoutgraph.Graph {
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
		connectWithID(g, 301, s1, s2)
		connectWithID(g, 302, s3, s4)
		return g
	})

	// 2e. Single step produces no defining edges
	recordDefiningEdges("single_step_no_defining_edges", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		return g
	})

	// 2f. Non-step nodes ignored
	recordDefiningEdges("non_step_nodes_ignored", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 40, 30)
		n2 := layoutgraph.NewNode(2, 40, 30)
		n1.SetShape(shape.SQUARE_TYPE)
		n2.SetShape(shape.SQUARE_TYPE)
		g.AddNewNodeToContainer(nil, n1)
		g.AddNewNodeToContainer(nil, n2)
		connectWithID(g, 401, n1, n2)
		return g
	})

	// 2g. Container node ignored
	recordDefiningEdges("container_nodes_ignored", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(1, 100, 100)
		c1.SetContainer(true)
		c1.SetShape(shape.STEP_TYPE)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, c1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 501, c1, s2)
		return g
	})

	// 2h. Cycle connected steps
	recordDefiningEdges("cycle_connected_steps", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		connectWithID(g, 601, s1, s2)
		connectWithID(g, 602, s2, s1)
		return g
	})

	// 2i. Middle non-step disconnects sequence
	recordDefiningEdges("middle_non_step_disconnects", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		other := layoutgraph.NewNode(3, 40, 30)
		s3 := layoutgraph.NewNode(4, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		other.SetShape(shape.SQUARE_TYPE)
		s3.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.AddNewNodeToContainer(nil, other)
		g.AddNewNodeToContainer(nil, s3)
		connectWithID(g, 701, s1, s2)
		connectWithID(g, 702, s2, other)
		connectWithID(g, 703, other, s3)
		return g
	})

	// 2j. Disconnected steps have no defining edges
	recordDefiningEdges("disconnected_steps_no_edges", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		return g
	})

	// 2k. Container descendant order
	recordDefiningEdges("container_descendant_order", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(10, 200, 200)
		c2 := layoutgraph.NewNode(20, 200, 200)
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
		connectWithID(g, 801, s1, s2)
		return g
	})

	// 2l. Nested cluster containers
	recordDefiningEdges("cluster_container_order", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(10, 200, 200)
		c2 := layoutgraph.NewNode(20, 200, 200)
		c1.SetContainer(true)
		c2.SetContainer(true)
		g.AddNewNodeToContainer(nil, c1)
		g.AddNewNodeToContainer(c1, c2)

		r1 := layoutgraph.NewNode(1, 40, 30)
		r2 := layoutgraph.NewNode(2, 40, 30)
		r1.SetShape(shape.STEP_TYPE)
		r2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, r1)
		g.AddNewNodeToContainer(nil, r2)
		connectWithID(g, 901, r1, r2)

		s3 := layoutgraph.NewNode(3, 40, 30)
		s4 := layoutgraph.NewNode(4, 40, 30)
		s3.SetShape(shape.STEP_TYPE)
		s4.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(c1, s3)
		g.AddNewNodeToContainer(c1, s4)
		connectWithID(g, 902, s3, s4)

		s5 := layoutgraph.NewNode(5, 40, 30)
		s6 := layoutgraph.NewNode(6, 40, 30)
		s5.SetShape(shape.STEP_TYPE)
		s6.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(c2, s5)
		g.AddNewNodeToContainer(c2, s6)
		connectWithID(g, 903, s5, s6)
		return g
	})

	out.Scenarios["sequence_defining_edges"] = definingEdgesScenarios

	// -------------------------------------------------------------
	// 3. Direct identifySequences Bridge & WorkGuard Parity
	// -------------------------------------------------------------
	identifyScenarios := make(map[string]interface{})

	// 3a. empty
	{
		g := layoutgraph.NewGraph()
		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{}, guard)
		if err != nil {
			panic(err)
		}
		identifyScenarios["empty"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     seqs,
		}
	}

	// 3b. one step
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1}, guard)
		if err != nil {
			panic(err)
		}
		identifyScenarios["one_step"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     seqs,
		}
	}

	// 3c. connected pair
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.Connect(s1, s2)

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		var serializedSeqs [][]int64
		for _, seq := range seqs {
			var ids []int64
			for _, n := range seq {
				ids = append(ids, int64(n.ID))
			}
			serializedSeqs = append(serializedSeqs, ids)
		}
		identifyScenarios["connected_pair"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     serializedSeqs,
		}
	}

	// 3d. disconnected pair
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		identifyScenarios["disconnected_pair"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     seqs,
		}
	}

	// 3e. late edge match (s1 has 5 edges, 5th connects to s2)
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)

		// 4 dummy edges
		for i := 0; i < 4; i++ {
			d := layoutgraph.NewNode(layoutgraph.EntityID(10+i), 10, 10)
			g.AddNewNodeToContainer(nil, d)
			g.Connect(s1, d)
		}
		// 5th edge connects to s2
		g.Connect(s1, s2)

		// To isolate the test strictly to [s1, s2] with s1 having 5 edges:
		// Graph.Nodes has s1, s2 (plus 4 dummy nodes = 6 nodes)
		// Let's create guard and call
		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		var serializedSeqs [][]int64
		for _, seq := range seqs {
			var ids []int64
			for _, n := range seq {
				ids = append(ids, int64(n.ID))
			}
			serializedSeqs = append(serializedSeqs, ids)
		}
		// Notice: graph.Nodes has 6 nodes (6 steps), nodes has 2 steps (2 steps),
		// i=1 (1 step), edges has 5 checks (5 steps) -> 6+2+1+5 = 14 steps.
		// Wait, if g.Nodes has ONLY s1 and s2, and dummy edges connect s1 to self or outside nodes not in g.Nodes:
		// If g.Nodes has 2 nodes: 2 + 2 + 1 + 5 = 10 steps!
		// Let's test what happens when dummy nodes are in g.Nodes vs if we want exactly 10 steps:
		// If s1, s2 only in g.Nodes, and s1.Edges has 4 dummy edges to dummy nodes not in g.Nodes:
		// That gives exactly 2 + 2 + 1 + 5 = 10 steps!
		// But in a valid graph, are dummy nodes required to be in g.Nodes? Let's check prompt requirement:
		// "identifySequences: empty, one step, connected pair, disconnected pair, late edge match, inactive remembered steps"
		// If we set g.Nodes = []*Node{s1, s2} and s1.Edges has 4 dummy edges + 1 to s2:
		// activeNodes will only have s1, s2 (2 steps). nodes has s1, s2 (2 steps). i=1 (1 step). s1.Edges (5 steps). Total = 10 steps!
		// Let's configure that!
	}
	// Let's rebuild late_edge_match with exactly 2 nodes in g.Nodes so it charges exactly 10 work units:
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)

		for i := 0; i < 4; i++ {
			d := layoutgraph.NewNode(layoutgraph.EntityID(10+i), 10, 10)
			g.Connect(s1, d)
		}
		g.Connect(s1, s2)

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		var serializedSeqs [][]int64
		for _, seq := range seqs {
			var ids []int64
			for _, n := range seq {
				ids = append(ids, int64(n.ID))
			}
			serializedSeqs = append(serializedSeqs, ids)
		}
		identifyScenarios["late_edge_match"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     serializedSeqs,
		}
	}

	// 3f. inactive remembered steps
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)

		seq := &layoutgraph.Sequence{Vessel: layoutgraph.NewNode(100, 0, 0)} // Vessel Width=0 -> IsActive() false
		s1.Sequence = seq
		s2.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		identifyScenarios["inactive_remembered_steps"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     seqs,
		}
	}

	// 3g. active sequence membership discovery
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.Connect(s1, s2)

		vessel := layoutgraph.NewNode(100, 40, 30) // Width > 0
		vessel.Graph = g                            // IsActive() true
		seq := &layoutgraph.Sequence{Vessel: vessel, Graph: g}
		s1.Sequence = seq
		s2.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		var serializedSeqs [][]int64
		for _, s := range seqs {
			var ids []int64
			for _, n := range s {
				ids = append(ids, int64(n.ID))
			}
			serializedSeqs = append(serializedSeqs, ids)
		}
		identifyScenarios["active_sequence_membership"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     serializedSeqs,
		}
	}

	// 3h. duplicate supplied node references
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.Connect(s1, s2)

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		var serializedSeqs [][]int64
		for _, s := range seqs {
			var ids []int64
			for _, n := range s {
				ids = append(ids, int64(n.ID))
			}
			serializedSeqs = append(serializedSeqs, ids)
		}
		identifyScenarios["duplicate_supplied_node_refs"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     serializedSeqs,
		}
	}

	// 3i. FixedTopLeft
	{
		g := layoutgraph.NewGraph()
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		s1.SetShape(shape.STEP_TYPE)
		s2.SetShape(shape.STEP_TYPE)
		s1.FixedTopLeft = &geo.Point{X: 10, Y: 10}
		g.AddNewNodeToContainer(nil, s1)
		g.AddNewNodeToContainer(nil, s2)
		g.Connect(s1, s2)

		guard, _ := limits.NewWorkGuard(ctx, "identifySequences", limits.MaxEngineWorkUnits)
		seqs, err := grouping.IdentifySequencesBridge(g, []*layoutgraph.Node{s1, s2}, guard)
		if err != nil {
			panic(err)
		}
		identifyScenarios["fixed_top_left"] = map[string]interface{}{
			"workUsed":      guard.Used(),
			"sequenceCount": len(seqs),
			"sequences":     seqs,
		}
	}

	out.Scenarios["identify_sequences"] = identifyScenarios

	// -------------------------------------------------------------
	// 4. Direct isValidRememberedSequence Bridge & WorkGuard Parity
	// -------------------------------------------------------------
	rememberedScenarios := make(map[string]interface{})

	// Helper for activeNodes
	makeActiveNodes := func(g *layoutgraph.Graph) map[*layoutgraph.Node]struct{} {
		m := make(map[*layoutgraph.Node]struct{}, len(g.Nodes))
		for _, n := range g.Nodes {
			m[n] = struct{}{}
		}
		return m
	}

	// 4a. Immediate reject = 0 work: nil vessel
	{
		g := layoutgraph.NewGraph()
		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, nil, &layoutgraph.Sequence{}, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_nil_vessel"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4b. Immediate reject = 0 work: nil sequence
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(100, 0, 0)
		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, nil, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_nil_sequence"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4c. Immediate reject = 0 work: vessel mismatch
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(100, 0, 0)
		otherVessel := layoutgraph.NewNode(200, 0, 0)
		seq := &layoutgraph.Sequence{Vessel: otherVessel, Graph: g, Nodes: []*layoutgraph.Node{layoutgraph.NewNode(1, 10, 10), layoutgraph.NewNode(2, 10, 10)}}
		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_vessel_mismatch"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4d. Immediate reject = 0 work: graph mismatch
	{
		g := layoutgraph.NewGraph()
		otherGraph := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{Vessel: vessel, Graph: otherGraph, Nodes: []*layoutgraph.Node{layoutgraph.NewNode(1, 10, 10), layoutgraph.NewNode(2, 10, 10)}}
		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_graph_mismatch"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4d2. Immediate reject = 0 work: active sequence
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(100, 40, 30)
		vessel.Graph = g // IsActive() true
		seq := &layoutgraph.Sequence{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{layoutgraph.NewNode(1, 10, 10), layoutgraph.NewNode(2, 10, 10)}}
		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_active_sequence"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4d3. Immediate reject = 0 work: less than two nodes
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(100, 0, 0)
		s1 := layoutgraph.NewNode(1, 40, 30)
		seq := &layoutgraph.Sequence{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{s1}}
		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_less_than_two_nodes"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4e. Immediate reject = 0 work: missing Containers key
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(100, 0, 0)
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		seq := &layoutgraph.Sequence{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{s1, s2}}
		delete(g.Containers, nil)

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_missing_containers_key"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4f. Immediate reject = 0 work: container key present but empty
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(100, 0, 0)
		s1 := layoutgraph.NewNode(1, 40, 30)
		s2 := layoutgraph.NewNode(2, 40, 30)
		seq := &layoutgraph.Sequence{Vessel: vessel, Graph: g, Nodes: []*layoutgraph.Node{s1, s2}}
		g.Containers[nil] = []*layoutgraph.Node{} // empty container

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["immediate_reject_container_key_empty"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4g. valid pair (container has [a, b], seq.Nodes has [a, b]) -> workUsed = 4, valid = true
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["valid_pair"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4h. duplicate child (container has [a, a, b], seq.Nodes has [a, b]) -> workUsed = 4, valid = false
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNodeUnchecked(a)
		g.AddNodeUnchecked(b)
		g.Containers[nil] = []*layoutgraph.Node{a, a, b} // duplicate child 'a'

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["duplicate_child"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4i. duplicate sequence member (container has [a, b], seq.Nodes has [a, a]) -> workUsed = 3, valid = false
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, a}, // duplicate sequence member
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["duplicate_sequence_member"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4j. noncontiguous sequence (container has [a, other, b], seq.Nodes has [a, b]) -> workUsed = 5, valid = false
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		other := layoutgraph.NewNode(10, 20, 20)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNodeUnchecked(a)
		g.AddNodeUnchecked(other)
		g.AddNodeUnchecked(b)
		g.Containers[nil] = []*layoutgraph.Node{a, other, b}

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["noncontiguous_sequence"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4k. nil sequence member -> valid = false
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, nil},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["nil_sequence_member"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4l. wrong node.Graph -> valid = false
	{
		g := layoutgraph.NewGraph()
		otherGraph := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		a.Graph = otherGraph // wrong graph

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["wrong_node_graph"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4m. FixedTopLeft -> valid = false
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		a.FixedTopLeft = &geo.Point{X: 10, Y: 10}
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["fixed_top_left"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4n. wrong node.Sequence -> valid = false
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		otherSeq := &layoutgraph.Sequence{Vessel: vessel}
		a.Sequence = seq
		b.Sequence = otherSeq // wrong sequence

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["wrong_node_sequence"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4o. wrong container -> valid = false
	{
		g := layoutgraph.NewGraph()
		c1 := layoutgraph.NewNode(10, 100, 100)
		c1.SetContainer(true)
		g.AddNewNodeToContainer(nil, c1)

		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		b.Container = c1 // wrong container

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["wrong_container"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4p. node missing from children -> valid = false
	{
		g := layoutgraph.NewGraph()
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, a) // only 'a' is child of nil

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["node_missing_from_children"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	// 4q. valid contiguous members with unrelated neighbors -> valid = true
	{
		g := layoutgraph.NewGraph()
		u1 := layoutgraph.NewNode(10, 40, 30)
		a := layoutgraph.NewNode(1, 40, 30)
		b := layoutgraph.NewNode(2, 40, 30)
		u2 := layoutgraph.NewNode(20, 40, 30)
		a.SetShape(shape.STEP_TYPE)
		b.SetShape(shape.STEP_TYPE)
		g.AddNewNodeToContainer(nil, u1)
		g.AddNewNodeToContainer(nil, a)
		g.AddNewNodeToContainer(nil, b)
		g.AddNewNodeToContainer(nil, u2)

		vessel := layoutgraph.NewNode(100, 0, 0)
		seq := &layoutgraph.Sequence{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{a, b},
			Graph:     g,
			Container: nil,
		}
		a.Sequence = seq
		b.Sequence = seq

		guard, _ := limits.NewWorkGuard(ctx, "isValidRememberedSequence", limits.MaxEngineWorkUnits)
		valid, err := grouping.IsValidRememberedSequenceBridge(g, vessel, seq, makeActiveNodes(g), guard)
		if err != nil {
			panic(err)
		}
		rememberedScenarios["valid_contiguous_members_unrelated_neighbors"] = map[string]interface{}{
			"workUsed": guard.Used(),
			"valid":    valid,
		}
	}

	out.Scenarios["remembered_validity"] = rememberedScenarios

	// -------------------------------------------------------------
	// 5. Direct hasNodeID Bridge Coverage
	// -------------------------------------------------------------
	hasNodeIDScenarios := make(map[string]interface{})
	{
		g := layoutgraph.NewGraph()

		// 1. graph.Nodes
		ordinary := layoutgraph.NewNode(10, 40, 30)
		g.AddNode(ordinary)

		// 2. Cluster vessel & nodes
		clusterVessel := layoutgraph.NewNode(20, 40, 30)
		clusterVessel.SetClusterVessel(true)
		clusterNode := layoutgraph.NewNode(21, 40, 30)
		g.Clusters[clusterVessel] = &layoutgraph.Cluster{Vessel: clusterVessel, Nodes: []*layoutgraph.Node{clusterNode}}

		// 3. Sequence vessel & nodes
		seqVessel := layoutgraph.NewNode(30, 40, 30)
		seqNode := layoutgraph.NewNode(31, 40, 30)
		g.Sequences[seqVessel] = &layoutgraph.Sequence{Vessel: seqVessel, Nodes: []*layoutgraph.Node{seqNode}}

		// 4. Tree sentinel, root, and nested child
		sentinel := layoutgraph.NewNode(40, 40, 30)
		rootNode := layoutgraph.NewNode(41, 40, 30)
		childNode := layoutgraph.NewNode(42, 40, 30)
		tree := &layoutgraph.Tree{
			Node: rootNode,
			Children: []*layoutgraph.Tree{
				{Node: childNode},
			},
		}
		g.Trees[sentinel] = []*layoutgraph.Tree{tree}

		// Node in container only, not in graph.Nodes / Clusters / Sequences / Trees
		containerChild := layoutgraph.NewNode(50, 40, 30)
		g.Containers[ordinary] = []*layoutgraph.Node{containerChild}

		hasNodeIDScenarios["graph_nodes_id"] = grouping.HasNodeIDBridge(g, 10)
		hasNodeIDScenarios["cluster_vessel_id"] = grouping.HasNodeIDBridge(g, 20)
		hasNodeIDScenarios["cluster_node_id"] = grouping.HasNodeIDBridge(g, 21)
		hasNodeIDScenarios["sequence_vessel_id"] = grouping.HasNodeIDBridge(g, 30)
		hasNodeIDScenarios["sequence_node_id"] = grouping.HasNodeIDBridge(g, 31)
		hasNodeIDScenarios["tree_sentinel_id"] = grouping.HasNodeIDBridge(g, 40)
		hasNodeIDScenarios["tree_node_id"] = grouping.HasNodeIDBridge(g, 41)
		hasNodeIDScenarios["nested_tree_child_id"] = grouping.HasNodeIDBridge(g, 42)
		hasNodeIDScenarios["absent_id"] = grouping.HasNodeIDBridge(g, 999)
		hasNodeIDScenarios["container_child_not_in_graph_nodes"] = grouping.HasNodeIDBridge(g, 50)
	}
	out.Scenarios["has_node_id"] = hasNodeIDScenarios

	// -------------------------------------------------------------
	// 6. Direct nextAvailableNodeID Bridge & ID Occupancy
	// -------------------------------------------------------------
	idScenarios := make(map[string]interface{})

	// 6a. unavailable-set collision
	{
		g := layoutgraph.NewGraph()
		unavailable := map[layoutgraph.EntityID]struct{}{
			100: {},
		}
		res := grouping.NextAvailableNodeIDBridge(g, 100, unavailable)
		idScenarios["unavailable_set_collision"] = map[string]interface{}{
			"candidate": 100,
			"resolved":  int64(res),
			"expected":  101,
		}
	}

	// 6b. multiple consecutive collisions
	{
		g := layoutgraph.NewGraph()
		g.AddNode(layoutgraph.NewNode(101, 40, 30))
		unavailable := map[layoutgraph.EntityID]struct{}{
			100: {},
			102: {},
		}
		res := grouping.NextAvailableNodeIDBridge(g, 100, unavailable)
		idScenarios["multiple_consecutive_collisions"] = map[string]interface{}{
			"candidate": 100,
			"resolved":  int64(res),
			"expected":  103,
		}
	}

	// 6c. MAX_INT64 wraps to 0
	{
		g := layoutgraph.NewGraph()
		unavailable := map[layoutgraph.EntityID]struct{}{
			math.MaxInt64: {},
		}
		res := grouping.NextAvailableNodeIDBridge(g, math.MaxInt64, unavailable)
		idScenarios["max_int64_wraps_to_zero"] = map[string]interface{}{
			"candidate":    math.MaxInt64,
			"candidateStr": fmt.Sprintf("%d", uint64(math.MaxInt64)),
			"resolved":     int64(res),
			"expected":     0,
		}
	}

	// 6d. 0 -> 1
	{
		g := layoutgraph.NewGraph()
		unavailable := map[layoutgraph.EntityID]struct{}{
			0: {},
		}
		res := grouping.NextAvailableNodeIDBridge(g, 0, unavailable)
		idScenarios["zero_to_one"] = map[string]interface{}{
			"candidate": 0,
			"resolved":  int64(res),
			"expected":  1,
		}
	}

	// 6e. Seed 19 RNG regression (assert continuation, 0 draws by nextAvailableNodeID)
	{
		const seed int64 = 19
		probe := rand.New(rand.NewSource(seed))
		collidingID := probe.Int63()

		layoutRand := rand.New(rand.NewSource(seed))
		candidateID := layoutRand.Int63()

		g := layoutgraph.NewGraph()
		g.AddNode(layoutgraph.NewNode(collidingID, 40, 30))

		resolvedID := grouping.NextAvailableNodeIDBridge(g, candidateID, nil)

		nextDraw := layoutRand.Int63()
		probeNextDraw := probe.Int63()

		idScenarios["seed_19_rng_continuation"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"candidateID":         candidateID,
			"candidateIDStr":      fmt.Sprintf("%d", candidateID),
			"resolvedID":          int64(resolvedID),
			"resolvedIDStr":       fmt.Sprintf("%d", resolvedID),
			"expectedID":          collidingID + 1,
			"expectedIDStr":       fmt.Sprintf("%d", collidingID+1),
			"nextDraw":            nextDraw,
			"nextDrawStr":         fmt.Sprintf("%d", nextDraw),
			"probeNextDraw":       probeNextDraw,
			"probeNextDrawStr":    fmt.Sprintf("%d", probeNextDraw),
			"continuationMatches": nextDraw == probeNextDraw,
		}
	}

	// 6f. Cluster vessel collision (seed 23)
	{
		const seed int64 = 23
		probe := rand.New(rand.NewSource(seed))
		collidingID := probe.Int63()

		g := layoutgraph.NewGraph()
		clusterVessel := layoutgraph.NewNode(collidingID, 40, 30)
		clusterVessel.SetClusterVessel(true)
		g.Clusters[clusterVessel] = &layoutgraph.Cluster{Vessel: clusterVessel}

		resolvedID := grouping.NextAvailableNodeIDBridge(g, collidingID, nil)

		idScenarios["cluster_vessel_collision"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"resolvedVesselID":    int64(resolvedID),
			"resolvedVesselIDStr": fmt.Sprintf("%d", resolvedID),
			"expectedVesselID":    collidingID + 1,
			"expectedVesselIDStr": fmt.Sprintf("%d", collidingID+1),
		}
	}

	// 6g. Tree sentinel collision (seed 31)
	{
		const seed int64 = 31
		probe := rand.New(rand.NewSource(seed))
		collidingID := probe.Int63()

		g := layoutgraph.NewGraph()
		sentinel := layoutgraph.NewNode(collidingID, 40, 30)
		g.Trees[sentinel] = []*layoutgraph.Tree{}

		resolvedID := grouping.NextAvailableNodeIDBridge(g, collidingID, nil)

		idScenarios["tree_sentinel_collision"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"resolvedVesselID":    int64(resolvedID),
			"resolvedVesselIDStr": fmt.Sprintf("%d", resolvedID),
			"expectedVesselID":    collidingID + 1,
			"expectedVesselIDStr": fmt.Sprintf("%d", collidingID+1),
		}
	}

	// 6h. Tree node collision (seed 47)
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

		resolvedID := grouping.NextAvailableNodeIDBridge(g, collidingID, nil)

		idScenarios["tree_node_collision"] = map[string]interface{}{
			"seed":                seed,
			"collidingID":         collidingID,
			"collidingIDStr":      fmt.Sprintf("%d", collidingID),
			"resolvedVesselID":    int64(resolvedID),
			"resolvedVesselIDStr": fmt.Sprintf("%d", resolvedID),
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
