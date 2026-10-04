package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
)

type HubEntryDTO struct {
	HubID  string   `json:"hubId"`
	Spokes []string `json:"spokes"`
}

type ScenarioResult struct {
	Name            string        `json:"name"`
	Success         bool          `json:"success"`
	ErrorMessage    string        `json:"errorMessage,omitempty"`
	Panicked        bool          `json:"panicked"`
	SameHubsMap     bool          `json:"sameHubsMap"`
	Hubs            []HubEntryDTO `json:"hubs"`
	Nodes           []string      `json:"nodes"`
	OldHubPreserved bool          `json:"oldHubPreserved,omitempty"`
}

type OracleOutput struct {
	Metadata  map[string]string         `json:"metadata"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

type cancelAfterSteps struct {
	context.Context
	remaining int
}

func (ctx *cancelAfterSteps) Err() error {
	if ctx.remaining <= 0 {
		return context.Canceled
	}
	ctx.remaining--
	return ctx.Context.Err()
}

func runSafe(fn func()) (panicked bool, panicMsg string) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
			if err, ok := r.(error); ok {
				panicMsg = err.Error()
			} else {
				panicMsg = fmt.Sprintf("%v", r)
			}
		}
	}()
	fn()
	return false, ""
}

func captureScenario(name string, g *layoutgraph.Graph, oldPtr uintptr, oldHubKey *layoutgraph.Node, err error, panicked bool, panicMsg string) ScenarioResult {
	res := ScenarioResult{
		Name:         name,
		Success:      err == nil && !panicked,
		Panicked:     panicked,
		ErrorMessage: panicMsg,
		Hubs:         make([]HubEntryDTO, 0),
		Nodes:        make([]string, 0),
	}
	if err != nil {
		res.ErrorMessage = err.Error()
	}

	if g != nil {
		newPtr := reflect.ValueOf(g.Hubs).Pointer()
		res.SameHubsMap = (newPtr == oldPtr)

		for _, n := range g.Nodes {
			if n != nil {
				res.Nodes = append(res.Nodes, fmt.Sprintf("%v", n.ID))
			} else {
				res.Nodes = append(res.Nodes, "null")
			}
		}

		// Sort hub keys deterministically for JSON output
		hubKeys := make([]*layoutgraph.Node, 0, len(g.Hubs))
		for k := range g.Hubs {
			hubKeys = append(hubKeys, k)
		}
		sort.Slice(hubKeys, func(i, j int) bool {
			if hubKeys[i] == nil {
				return true
			}
			if hubKeys[j] == nil {
				return false
			}
			return hubKeys[i].ID < hubKeys[j].ID
		})

		for _, h := range hubKeys {
			hID := "null"
			if h != nil {
				hID = fmt.Sprintf("%v", h.ID)
			}
			spokes := g.Hubs[h]
			spokeIDs := make([]string, 0, len(spokes))
			for _, s := range spokes {
				if s != nil {
					spokeIDs = append(spokeIDs, fmt.Sprintf("%v", s.ID))
				} else {
					spokeIDs = append(spokeIDs, "null")
				}
			}
			res.Hubs = append(res.Hubs, HubEntryDTO{
				HubID:  hID,
				Spokes: spokeIDs,
			})
		}

		if oldHubKey != nil {
			if spokes, ok := g.Hubs[oldHubKey]; ok && len(spokes) > 0 {
				res.OldHubPreserved = true
			}
		}
	}

	return res
}

func main() {
	out := &OracleOutput{
		Metadata: map[string]string{
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"runtimeGoVersion": runtime.Version(),
			"slice":            "Slice 28 — Proximity Hub Discovery (AddHubs)",
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// A. empty_graph
	{
		g := layoutgraph.NewGraph()
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		panicked, panicMsg := runSafe(func() {
			err := proximity.AddHubs(context.Background(), g)
			out.Scenarios["empty_graph"] = captureScenario("empty_graph", g, oldPtr, nil, err, false, "")
		})
		if panicked {
			out.Scenarios["empty_graph"] = captureScenario("empty_graph", g, oldPtr, nil, nil, true, panicMsg)
		}
	}

	// B. canonical_hub
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		spoke := layoutgraph.NewNode(2, 10, 10)
		connected := layoutgraph.NewNode(3, 10, 10)
		other := layoutgraph.NewNode(4, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, spoke, connected, other} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, spoke)
		g.Connect(hub, connected)
		g.Connect(connected, other)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["canonical_hub"] = captureScenario("canonical_hub", g, oldPtr, nil, err, false, "")
	}

	// C. leaf_spokes_only
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		s1 := layoutgraph.NewNode(2, 10, 10)
		s2 := layoutgraph.NewNode(3, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, s1, s2} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, s1)
		g.Connect(hub, s2)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["leaf_spokes_only"] = captureScenario("leaf_spokes_only", g, oldPtr, nil, err, false, "")
	}

	// D. non_leaf_connections_only
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		c1 := layoutgraph.NewNode(2, 10, 10)
		c2 := layoutgraph.NewNode(3, 10, 10)
		o1 := layoutgraph.NewNode(4, 10, 10)
		o2 := layoutgraph.NewNode(5, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, c1, c2, o1, o2} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, c1)
		g.Connect(hub, c2)
		g.Connect(c1, o1)
		g.Connect(c2, o2)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["non_leaf_connections_only"] = captureScenario("non_leaf_connections_only", g, oldPtr, nil, err, false, "")
	}

	// E. minimal_valid_hub
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		spoke := layoutgraph.NewNode(2, 10, 10)
		connected := layoutgraph.NewNode(3, 10, 10)
		other := layoutgraph.NewNode(4, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, spoke, connected, other} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, spoke)
		g.Connect(hub, connected)
		g.Connect(connected, other)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["minimal_valid_hub"] = captureScenario("minimal_valid_hub", g, oldPtr, nil, err, false, "")
	}

	// F. multiple_spokes
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		s1 := layoutgraph.NewNode(2, 10, 10)
		s2 := layoutgraph.NewNode(3, 10, 10)
		s3 := layoutgraph.NewNode(4, 10, 10)
		c1 := layoutgraph.NewNode(5, 10, 10)
		o1 := layoutgraph.NewNode(6, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, s1, s2, s3, c1, o1} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, s1)
		g.Connect(hub, s2)
		g.Connect(hub, s3)
		g.Connect(hub, c1)
		g.Connect(c1, o1)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["multiple_spokes"] = captureScenario("multiple_spokes", g, oldPtr, nil, err, false, "")
	}

	// G. spoke_order_differs_from_id
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		s30 := layoutgraph.NewNode(30, 10, 10)
		c := layoutgraph.NewNode(2, 10, 10)
		other := layoutgraph.NewNode(3, 10, 10)
		s10 := layoutgraph.NewNode(10, 10, 10)
		s20 := layoutgraph.NewNode(20, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, s30, c, other, s10, s20} {
			g.AddNewNodeToContainer(nil, n)
		}
		// Connect in order: s30, c, s10, s20
		g.Connect(hub, s30)
		g.Connect(hub, c)
		g.Connect(c, other)
		g.Connect(hub, s10)
		g.Connect(hub, s20)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["spoke_order_differs_from_id"] = captureScenario("spoke_order_differs_from_id", g, oldPtr, nil, err, false, "")
	}

	// H. edge_to_different_direct_container
	{
		g := layoutgraph.NewGraph()
		cntA := layoutgraph.NewNode(10, 100, 100)
		cntA.SetContainer(true)
		cntB := layoutgraph.NewNode(20, 100, 100)
		cntB.SetContainer(true)
		hub := layoutgraph.NewNode(1, 10, 10)
		spokeInB := layoutgraph.NewNode(2, 10, 10)
		for _, n := range []*layoutgraph.Node{cntA, cntB} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.AddNewNodeToContainer(cntA, hub)
		g.AddNewNodeToContainer(cntB, spokeInB)
		g.Connect(hub, spokeInB)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["edge_to_different_direct_container"] = captureScenario("edge_to_different_direct_container", g, oldPtr, nil, err, false, "")
	}

	// I. cross_container_leaf_plus_same_container_non_leaf
	{
		g := layoutgraph.NewGraph()
		cntA := layoutgraph.NewNode(10, 100, 100)
		cntA.SetContainer(true)
		cntB := layoutgraph.NewNode(20, 100, 100)
		cntB.SetContainer(true)
		hub := layoutgraph.NewNode(1, 10, 10)
		connectedInA := layoutgraph.NewNode(2, 10, 10)
		otherInA := layoutgraph.NewNode(3, 10, 10)
		leafInB := layoutgraph.NewNode(4, 10, 10)

		g.AddNewNodeToContainer(nil, cntA)
		g.AddNewNodeToContainer(nil, cntB)
		g.AddNewNodeToContainer(cntA, hub)
		g.AddNewNodeToContainer(cntA, connectedInA)
		g.AddNewNodeToContainer(cntA, otherInA)
		g.AddNewNodeToContainer(cntB, leafInB)

		g.Connect(hub, connectedInA)
		g.Connect(connectedInA, otherInA)
		g.Connect(hub, leafInB)

		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["cross_container_leaf_plus_same_container_non_leaf"] = captureScenario("cross_container_leaf_plus_same_container_non_leaf", g, oldPtr, nil, err, false, "")
	}

	// J. same_container_leaf_plus_cross_container_non_leaf
	{
		g := layoutgraph.NewGraph()
		cntA := layoutgraph.NewNode(10, 100, 100)
		cntA.SetContainer(true)
		cntB := layoutgraph.NewNode(20, 100, 100)
		cntB.SetContainer(true)
		hub := layoutgraph.NewNode(1, 10, 10)
		leafInA := layoutgraph.NewNode(2, 10, 10)
		connInB := layoutgraph.NewNode(3, 10, 10)
		otherInB := layoutgraph.NewNode(4, 10, 10)

		g.AddNewNodeToContainer(nil, cntA)
		g.AddNewNodeToContainer(nil, cntB)
		g.AddNewNodeToContainer(cntA, hub)
		g.AddNewNodeToContainer(cntA, leafInA)
		g.AddNewNodeToContainer(cntB, connInB)
		g.AddNewNodeToContainer(cntB, otherInB)

		g.Connect(hub, leafInA)
		g.Connect(hub, connInB)
		g.Connect(connInB, otherInB)

		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["same_container_leaf_plus_cross_container_non_leaf"] = captureScenario("same_container_leaf_plus_cross_container_non_leaf", g, oldPtr, nil, err, false, "")
	}

	// K. root_level_nodes
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		spoke := layoutgraph.NewNode(2, 10, 10)
		connected := layoutgraph.NewNode(3, 10, 10)
		other := layoutgraph.NewNode(4, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, spoke, connected, other} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, spoke)
		g.Connect(hub, connected)
		g.Connect(connected, other)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["root_level_nodes"] = captureScenario("root_level_nodes", g, oldPtr, nil, err, false, "")
	}

	// L. active_grouping_owning_container
	{
		g := layoutgraph.NewGraph()
		parent := layoutgraph.NewNode(100, 200, 200)
		parent.SetContainer(true)
		g.AddNewNodeToContainer(nil, parent)

		vessel := layoutgraph.NewNode(10, 50, 50)
		vessel.SetClusterVessel(true)
		g.AddNewNodeToContainer(parent, vessel)

		hub := layoutgraph.NewNode(1, 10, 10)
		spoke := layoutgraph.NewNode(2, 10, 10)
		conn := layoutgraph.NewNode(3, 10, 10)
		other := layoutgraph.NewNode(4, 10, 10)

		// hub and spoke are members of active cluster with vessel in parent
		c := &layoutgraph.Cluster{
			Vessel: vessel,
			Nodes:  []*layoutgraph.Node{hub, spoke},
			Graph:  g,
		}
		g.Clusters[vessel] = c
		hub.Cluster = c
		spoke.Cluster = c

		// conn and other are directly in parent
		g.AddNewNodeToContainer(parent, conn)
		g.AddNewNodeToContainer(parent, other)

		// hub and spoke added to graph.Nodes
		g.Nodes = append(g.Nodes, hub, spoke)

		g.Connect(hub, spoke)
		g.Connect(hub, conn)
		g.Connect(conn, other)

		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["active_grouping_owning_container"] = captureScenario("active_grouping_owning_container", g, oldPtr, nil, err, false, "")
	}

	// M. parallel_multiple_incident_edges
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		candidate := layoutgraph.NewNode(2, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, candidate} {
			g.AddNewNodeToContainer(nil, n)
		}
		// Connect two parallel edges between hub and candidate
		g.Connect(hub, candidate)
		g.Connect(hub, candidate)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["parallel_multiple_incident_edges"] = captureScenario("parallel_multiple_incident_edges", g, oldPtr, nil, err, false, "")
	}

	// N. self_loop
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		spoke := layoutgraph.NewNode(2, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, spoke} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, spoke)
		// self loop on hub
		g.Connect(hub, hub)
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["self_loop"] = captureScenario("self_loop", g, oldPtr, nil, err, false, "")
	}

	// O. existing_non_empty_hubs_replaced
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		spoke := layoutgraph.NewNode(2, 10, 10)
		conn := layoutgraph.NewNode(3, 10, 10)
		other := layoutgraph.NewNode(4, 10, 10)
		oldDummy := layoutgraph.NewNode(99, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, spoke, conn, other, oldDummy} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, spoke)
		g.Connect(hub, conn)
		g.Connect(conn, other)

		// Pre-populate old Hubs
		g.Hubs[oldDummy] = []*layoutgraph.Node{spoke}
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()

		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["existing_non_empty_hubs_replaced"] = captureScenario("existing_non_empty_hubs_replaced", g, oldPtr, oldDummy, err, false, "")
	}

	// P. successful_empty_result_replaces_old_map
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		g.AddNewNodeToContainer(nil, n1)
		g.Hubs[n1] = []*layoutgraph.Node{n1}
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()

		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["successful_empty_result_replaces_old_map"] = captureScenario("successful_empty_result_replaces_old_map", g, oldPtr, n1, err, false, "")
	}

	// Q. pre_cancelled_context
	{
		g := layoutgraph.NewGraph()
		hub := layoutgraph.NewNode(1, 10, 10)
		spoke := layoutgraph.NewNode(2, 10, 10)
		conn := layoutgraph.NewNode(3, 10, 10)
		other := layoutgraph.NewNode(4, 10, 10)
		for _, n := range []*layoutgraph.Node{hub, spoke, conn, other} {
			g.AddNewNodeToContainer(nil, n)
		}
		g.Connect(hub, spoke)
		g.Connect(hub, conn)
		g.Connect(conn, other)

		g.Hubs[hub] = []*layoutgraph.Node{spoke}
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()

		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		err := proximity.AddHubs(ctx, g)
		out.Scenarios["pre_cancelled_context"] = captureScenario("pre_cancelled_context", g, oldPtr, hub, err, false, "")
	}

	// R. mid_operation_cancellation
	{
		g := layoutgraph.NewGraph()
		for i := 0; i < 130; i++ {
			node := layoutgraph.NewNode(layoutgraph.EntityID(i+1), 10, 10)
			g.AddNodeUnchecked(node)
		}
		g.Hubs[g.Nodes[0]] = []*layoutgraph.Node{g.Nodes[1]}
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()

		ctx := &cancelAfterSteps{Context: context.Background(), remaining: 1}
		err := proximity.AddHubs(ctx, g)
		out.Scenarios["mid_operation_cancellation"] = captureScenario("mid_operation_cancellation", g, oldPtr, g.Nodes[0], err, false, "")
	}

	// S. validation_failure_atomicity
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n2 := layoutgraph.NewNode(2, 10, 10)
		g.Nodes = []*layoutgraph.Node{n1, n2}
		// Create a cycle in Container relationship
		n1.Container = n2
		n2.Container = n1
		n1.SetContainer(true)
		n2.SetContainer(true)

		g.Hubs[n1] = []*layoutgraph.Node{n2}
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()

		err := proximity.AddHubs(context.Background(), g)
		out.Scenarios["validation_failure_atomicity"] = captureScenario("validation_failure_atomicity", g, oldPtr, n1, err, false, "")
	}

	// T. nil_graph_nodes
	{
		g := layoutgraph.NewGraph()
		g.Nodes = nil
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()
		panicked, panicMsg := runSafe(func() {
			err := proximity.AddHubs(context.Background(), g)
			out.Scenarios["nil_graph_nodes"] = captureScenario("nil_graph_nodes", g, oldPtr, nil, err, false, "")
		})
		if panicked {
			out.Scenarios["nil_graph_nodes"] = captureScenario("nil_graph_nodes", g, oldPtr, nil, nil, true, panicMsg)
		}
	}

	// U. nil_node_edges
	{
		g := layoutgraph.NewGraph()
		node := layoutgraph.NewNode(1, 10, 10)
		g.AddNodeUnchecked(node)
		node.Edges = nil

		// Pre-populate old Hubs to verify replacement semantics
		g.Hubs[node] = []*layoutgraph.Node{node}
		oldPtr := reflect.ValueOf(g.Hubs).Pointer()

		panicked, panicMsg := runSafe(func() {
			err := proximity.AddHubs(context.Background(), g)
			out.Scenarios["nil_node_edges"] = captureScenario("nil_node_edges", g, oldPtr, node, err, false, "")
		})
		if panicked {
			out.Scenarios["nil_node_edges"] = captureScenario("nil_node_edges", g, oldPtr, node, nil, true, panicMsg)
		}
	}

	// Generate JSON
	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	targetPath := "test/fixtures/go-add-hubs-reference.json"
	if len(os.Args) > 1 {
		targetPath = os.Args[1]
	} else if _, err := os.Stat("d2layouts/d2talalayout/js"); err == nil {
		targetPath = "d2layouts/d2talalayout/js/test/fixtures/go-add-hubs-reference.json"
	} else if _, err := os.Stat("../fixtures"); err == nil {
		targetPath = filepath.Join("..", "fixtures", "go-add-hubs-reference.json")
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(targetPath, bytes, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(bytes))
}
