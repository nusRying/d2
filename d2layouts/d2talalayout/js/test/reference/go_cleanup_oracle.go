package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/grouping"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

type PointDTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type EdgeDTO struct {
	ID   string `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
}

type TrackedNodeDTO struct {
	ID                string    `json:"id"`
	InGraph           bool      `json:"inGraph"`
	InGraphNodes      bool      `json:"inGraphNodes"`
	Container         *string   `json:"container"`
	Nears             []string  `json:"nears"`
	Edges             []string  `json:"edges"`
	HasHerdAssignment bool      `json:"hasHerdAssignment"`
	TopLeft           *PointDTO `json:"topLeft,omitempty"`
	Width             float64   `json:"width"`
	Height            float64   `json:"height"`
}

type ScenarioResult struct {
	Name         string                    `json:"name"`
	Panicked     bool                      `json:"panicked"`
	PanicMessage string                    `json:"panicMessage,omitempty"`
	Nodes        []string                  `json:"nodes"`
	Containers   map[string][]string       `json:"containers"`
	Clusters     map[string]bool           `json:"clusters"`
	Sequences    map[string]bool           `json:"sequences"`
	Edges        []EdgeDTO                 `json:"edges"`
	TrackedNodes map[string]TrackedNodeDTO `json:"trackedNodes"`
}

type OracleOutput struct {
	Metadata  map[string]string         `json:"metadata"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

func nodeIDStr(n *layoutgraph.Node) *string {
	if n == nil {
		return nil
	}
	s := fmt.Sprintf("%v", n.ID)
	return &s
}

func pointToDTO(pt *geo.Point) *PointDTO {
	if pt == nil {
		return nil
	}
	return &PointDTO{X: pt.X, Y: pt.Y}
}

func captureScenario(name string, panicked bool, panicMsg string, g *layoutgraph.Graph, tracked []*layoutgraph.Node) ScenarioResult {
	res := ScenarioResult{
		Name:         name,
		Panicked:     panicked,
		PanicMessage: panicMsg,
		Nodes:        make([]string, 0),
		Containers:   make(map[string][]string),
		Clusters:     make(map[string]bool),
		Sequences:    make(map[string]bool),
		Edges:        make([]EdgeDTO, 0),
		TrackedNodes: make(map[string]TrackedNodeDTO),
	}

	if g == nil {
		return res
	}

	// Graph.Nodes
	for _, n := range g.Nodes {
		if n != nil {
			res.Nodes = append(res.Nodes, fmt.Sprintf("%v", n.ID))
		} else {
			res.Nodes = append(res.Nodes, "null")
		}
	}

	// Graph.Containers
	containerKeys := make([]*layoutgraph.Node, 0, len(g.Containers))
	for c := range g.Containers {
		containerKeys = append(containerKeys, c)
	}
	sort.Slice(containerKeys, func(i, j int) bool {
		if containerKeys[i] == nil {
			return true
		}
		if containerKeys[j] == nil {
			return false
		}
		return containerKeys[i].ID < containerKeys[j].ID
	})

	for _, c := range containerKeys {
		cKey := "null"
		if c != nil {
			cKey = fmt.Sprintf("%v", c.ID)
		}
		children := g.Containers[c]
		childIDs := make([]string, 0, len(children))
		for _, child := range children {
			if child != nil {
				childIDs = append(childIDs, fmt.Sprintf("%v", child.ID))
			} else {
				childIDs = append(childIDs, "null")
			}
		}
		res.Containers[cKey] = childIDs
	}

	// Graph.Clusters keys
	for k := range g.Clusters {
		if k != nil {
			res.Clusters[fmt.Sprintf("%v", k.ID)] = true
		} else {
			res.Clusters["null"] = true
		}
	}

	// Graph.Sequences keys
	for k := range g.Sequences {
		if k != nil {
			res.Sequences[fmt.Sprintf("%v", k.ID)] = true
		} else {
			res.Sequences["null"] = true
		}
	}

	// Graph.Edges
	for _, e := range g.Edges {
		if e == nil {
			continue
		}
		fromID := "null"
		if e.From != nil {
			fromID = fmt.Sprintf("%v", e.From.ID)
		}
		toID := "null"
		if e.To != nil {
			toID = fmt.Sprintf("%v", e.To.ID)
		}
		res.Edges = append(res.Edges, EdgeDTO{
			ID:   fmt.Sprintf("%v", e.ID),
			From: fromID,
			To:   toID,
		})
	}

	// Tracked nodes
	nodesInGraphMap := make(map[*layoutgraph.Node]bool)
	for _, n := range g.Nodes {
		if n != nil {
			nodesInGraphMap[n] = true
		}
	}

	for _, n := range tracked {
		if n == nil {
			continue
		}
		nID := fmt.Sprintf("%v", n.ID)

		// Ordered nears
		nearsList := make([]string, 0)
		for _, near := range n.OrderedNears() {
			if near != nil {
				nearsList = append(nearsList, fmt.Sprintf("%v", near.ID))
			}
		}

		// Incident edges
		edgeIDs := make([]string, 0)
		for _, e := range n.Edges {
			if e != nil {
				edgeIDs = append(edgeIDs, fmt.Sprintf("%v", e.ID))
			}
		}
		sort.Strings(edgeIDs)

		res.TrackedNodes[nID] = TrackedNodeDTO{
			ID:                nID,
			InGraph:           n.Graph != nil,
			InGraphNodes:      nodesInGraphMap[n],
			Container:         nodeIDStr(n.Container),
			Nears:             nearsList,
			Edges:             edgeIDs,
			HasHerdAssignment: n.HerdAssignment != nil,
			TopLeft:           pointToDTO(n.TopLeft),
			Width:             n.Width,
			Height:            n.Height,
		}
	}

	return res
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

func main() {
	out := &OracleOutput{
		Metadata: map[string]string{
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"runtimeGoVersion": runtime.Version(),
			"slice":            "Slice 27 — Grouping Cleanup",
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// A. empty_graph
	{
		g := layoutgraph.NewGraph()
		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["empty_graph"] = captureScenario("empty_graph", panicked, msg, g, nil)
	}

	// B. ordinary_nodes_only
	{
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.Graph = g
		n1.HerdAssignment = layoutgraph.NewHerdAssignment()
		n2 := layoutgraph.NewNode(2, 20, 20)
		n2.Graph = g
		g.Nodes = []*layoutgraph.Node{n1, n2}
		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["ordinary_nodes_only"] = captureScenario("ordinary_nodes_only", panicked, msg, g, []*layoutgraph.Node{n1, n2})
	}

	// C. one_simple_cluster
	{
		g := layoutgraph.NewGraph()
		parent := layoutgraph.NewNode(10, 100, 100)
		parent.Graph = g
		parent.SetContainer(true)
		vessel := layoutgraph.NewNode(1, 40, 40)
		vessel.Graph = g
		vessel.Container = parent
		vessel.SetClusterVessel(true)
		member := layoutgraph.NewNode(2, 20, 20)
		member.Graph = g
		c := &layoutgraph.Cluster{
			Vessel:    vessel,
			Nodes:     []*layoutgraph.Node{member},
			Graph:     g,
			Container: parent,
		}
		g.Clusters[vessel] = c
		g.Nodes = []*layoutgraph.Node{parent, vessel}
		g.Containers[parent] = []*layoutgraph.Node{vessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["one_simple_cluster"] = captureScenario("one_simple_cluster", panicked, msg, g, []*layoutgraph.Node{parent, vessel, member})
	}

	// D. cluster_geometry_arrangement
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		vessel.TopLeft = &geo.Point{X: 100, Y: 100}
		vessel.SetClusterVessel(true)
		m1 := layoutgraph.NewNode(2, 20, 20)
		m1.Graph = g
		m1.TopLeft = &geo.Point{X: 0, Y: 0}
		m2 := layoutgraph.NewNode(3, 30, 30)
		m2.Graph = g
		m2.TopLeft = &geo.Point{X: 0, Y: 0}
		c := &layoutgraph.Cluster{
			Vessel:      vessel,
			Nodes:       []*layoutgraph.Node{m1, m2},
			Graph:       g,
			Arrangement: layoutgraph.Row,
			Padding:     5,
		}
		g.Clusters[vessel] = c
		g.Nodes = []*layoutgraph.Node{vessel}
		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["cluster_geometry_arrangement"] = captureScenario("cluster_geometry_arrangement", panicked, msg, g, []*layoutgraph.Node{vessel, m1, m2})
	}

	// E. one_simple_sequence
	{
		g := layoutgraph.NewGraph()
		sVessel := layoutgraph.NewNode(1, 30, 30)
		sVessel.Graph = g
		sStep := layoutgraph.NewNode(2, 20, 20)
		sStep.Graph = g
		seq := &layoutgraph.Sequence{
			Vessel: sVessel,
			Nodes:  []*layoutgraph.Node{sStep},
			Graph:  g,
		}
		g.Sequences[sVessel] = seq
		g.Nodes = []*layoutgraph.Node{sVessel}
		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["one_simple_sequence"] = captureScenario("one_simple_sequence", panicked, msg, g, []*layoutgraph.Node{sVessel, sStep})
	}

	// F. cluster_and_sequence_together
	{
		g := layoutgraph.NewGraph()
		cVessel := layoutgraph.NewNode(20, 40, 40)
		cVessel.Graph = g
		cVessel.SetClusterVessel(true)
		cMember := layoutgraph.NewNode(21, 20, 20)
		cMember.Graph = g
		c := &layoutgraph.Cluster{Vessel: cVessel, Nodes: []*layoutgraph.Node{cMember}, Graph: g}
		g.Clusters[cVessel] = c

		sVessel := layoutgraph.NewNode(10, 30, 30)
		sVessel.Graph = g
		sStep := layoutgraph.NewNode(11, 20, 20)
		sStep.Graph = g
		seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{sStep}, Graph: g}
		g.Sequences[sVessel] = seq

		ord := layoutgraph.NewNode(1, 10, 10)
		ord.Graph = g

		// g.Nodes has ord, cVessel, sVessel
		g.Nodes = []*layoutgraph.Node{ord, cVessel, sVessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["cluster_and_sequence_together"] = captureScenario("cluster_and_sequence_together", panicked, msg, g, []*layoutgraph.Node{ord, cVessel, cMember, sVessel, sStep})
	}

	// G. multiple_clusters_inserted_out_of_order
	{
		g := layoutgraph.NewGraph()
		v30 := layoutgraph.NewNode(30, 10, 10)
		v30.Graph = g
		m31 := layoutgraph.NewNode(31, 10, 10)
		m31.Graph = g
		c30 := &layoutgraph.Cluster{Vessel: v30, Nodes: []*layoutgraph.Node{m31}, Graph: g}

		v10 := layoutgraph.NewNode(10, 10, 10)
		v10.Graph = g
		m11 := layoutgraph.NewNode(11, 10, 10)
		m11.Graph = g
		c10 := &layoutgraph.Cluster{Vessel: v10, Nodes: []*layoutgraph.Node{m11}, Graph: g}

		v20 := layoutgraph.NewNode(20, 10, 10)
		v20.Graph = g
		m21 := layoutgraph.NewNode(21, 10, 10)
		m21.Graph = g
		c20 := &layoutgraph.Cluster{Vessel: v20, Nodes: []*layoutgraph.Node{m21}, Graph: g}

		// Insert out of order
		g.Clusters[v30] = c30
		g.Clusters[v10] = c10
		g.Clusters[v20] = c20
		g.Nodes = []*layoutgraph.Node{v30, v10, v20}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["multiple_clusters_inserted_out_of_order"] = captureScenario("multiple_clusters_inserted_out_of_order", panicked, msg, g, []*layoutgraph.Node{v10, v20, v30, m11, m21, m31})
	}

	// H. multiple_sequences_inserted_out_of_order
	{
		g := layoutgraph.NewGraph()
		s30 := layoutgraph.NewNode(30, 10, 10)
		s30.Graph = g
		step31 := layoutgraph.NewNode(31, 10, 10)
		step31.Graph = g
		seq30 := &layoutgraph.Sequence{Vessel: s30, Nodes: []*layoutgraph.Node{step31}, Graph: g}

		s10 := layoutgraph.NewNode(10, 10, 10)
		s10.Graph = g
		step11 := layoutgraph.NewNode(11, 10, 10)
		step11.Graph = g
		seq10 := &layoutgraph.Sequence{Vessel: s10, Nodes: []*layoutgraph.Node{step11}, Graph: g}

		s20 := layoutgraph.NewNode(20, 10, 10)
		s20.Graph = g
		step21 := layoutgraph.NewNode(21, 10, 10)
		step21.Graph = g
		seq20 := &layoutgraph.Sequence{Vessel: s20, Nodes: []*layoutgraph.Node{step21}, Graph: g}

		// Insert out of order
		g.Sequences[s30] = seq30
		g.Sequences[s10] = seq10
		g.Sequences[s20] = seq20
		g.Nodes = []*layoutgraph.Node{s30, s10, s20}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["multiple_sequences_inserted_out_of_order"] = captureScenario("multiple_sequences_inserted_out_of_order", panicked, msg, g, []*layoutgraph.Node{s10, s20, s30, step11, step21, step31})
	}

	// I. member_order
	{
		g := layoutgraph.NewGraph()
		cVessel := layoutgraph.NewNode(1, 10, 10)
		cVessel.Graph = g
		m3 := layoutgraph.NewNode(3, 10, 10)
		m3.Graph = g
		m2 := layoutgraph.NewNode(2, 10, 10)
		m2.Graph = g
		m5 := layoutgraph.NewNode(5, 10, 10)
		m5.Graph = g
		c := &layoutgraph.Cluster{Vessel: cVessel, Nodes: []*layoutgraph.Node{m3, m2, m5}, Graph: g}
		g.Clusters[cVessel] = c

		sVessel := layoutgraph.NewNode(10, 10, 10)
		sVessel.Graph = g
		st13 := layoutgraph.NewNode(13, 10, 10)
		st13.Graph = g
		st12 := layoutgraph.NewNode(12, 10, 10)
		st12.Graph = g
		st15 := layoutgraph.NewNode(15, 10, 10)
		st15.Graph = g
		seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{st13, st12, st15}, Graph: g}
		g.Sequences[sVessel] = seq

		g.Nodes = []*layoutgraph.Node{cVessel, sVessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["member_order"] = captureScenario("member_order", panicked, msg, g, []*layoutgraph.Node{cVessel, sVessel, m3, m2, m5, st13, st12, st15})
	}

	// J. existing_container_siblings
	{
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(100, 100, 100)
		container.Graph = g
		container.SetContainer(true)
		sib1 := layoutgraph.NewNode(101, 10, 10)
		sib1.Graph = g
		sib1.Container = container
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		vessel.Container = container
		vessel.SetClusterVessel(true)
		sib2 := layoutgraph.NewNode(102, 10, 10)
		sib2.Graph = g
		sib2.Container = container

		m1 := layoutgraph.NewNode(2, 10, 10)
		m1.Graph = g
		m2 := layoutgraph.NewNode(3, 10, 10)
		m2.Graph = g
		c := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{m1, m2}, Container: container, Graph: g}
		g.Clusters[vessel] = c

		g.Nodes = []*layoutgraph.Node{container, sib1, vessel, sib2}
		g.Containers[container] = []*layoutgraph.Node{sib1, vessel, sib2}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["existing_container_siblings"] = captureScenario("existing_container_siblings", panicked, msg, g, []*layoutgraph.Node{container, sib1, vessel, sib2, m1, m2})
	}

	// K. root_container_nil_container
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		vessel.SetClusterVessel(true)
		m := layoutgraph.NewNode(2, 10, 10)
		m.Graph = g
		c := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{m}, Container: nil, Graph: g}
		g.Clusters[vessel] = c

		sVessel := layoutgraph.NewNode(3, 10, 10)
		sVessel.Graph = g
		step := layoutgraph.NewNode(4, 10, 10)
		step.Graph = g
		seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{step}, Container: nil, Graph: g}
		g.Sequences[sVessel] = seq

		g.Nodes = []*layoutgraph.Node{vessel, sVessel}
		g.Containers[nil] = []*layoutgraph.Node{vessel, sVessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["root_container_nil_container"] = captureScenario("root_container_nil_container", panicked, msg, g, []*layoutgraph.Node{vessel, m, sVessel, step})
	}

	// L. cluster_edge_abduction_from_restoration
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		origFrom := layoutgraph.NewNode(2, 10, 10)
		origFrom.Graph = g
		dest := layoutgraph.NewNode(3, 10, 10)
		dest.Graph = g
		g.Nodes = []*layoutgraph.Node{vessel, origFrom, dest}

		// Edge currently connects vessel -> dest, was abducted from origFrom
		e := g.Connect(vessel, dest)
		abduction := &layoutgraph.EdgeAbduction{
			Edge:           e,
			OriginallyFrom: origFrom,
		}
		c := &layoutgraph.Cluster{
			Vessel:         vessel,
			Nodes:          []*layoutgraph.Node{origFrom},
			Graph:          g,
			EdgeAbductions: []*layoutgraph.EdgeAbduction{abduction},
		}
		g.Clusters[vessel] = c

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["cluster_edge_abduction_from_restoration"] = captureScenario("cluster_edge_abduction_from_restoration", panicked, msg, g, []*layoutgraph.Node{vessel, origFrom, dest})
	}

	// M. cluster_edge_abduction_to_restoration
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		src := layoutgraph.NewNode(2, 10, 10)
		src.Graph = g
		origTo := layoutgraph.NewNode(3, 10, 10)
		origTo.Graph = g
		g.Nodes = []*layoutgraph.Node{vessel, src, origTo}

		// Edge currently connects src -> vessel, was abducted to origTo
		e := g.Connect(src, vessel)
		abduction := &layoutgraph.EdgeAbduction{
			Edge:         e,
			OriginallyTo: origTo,
		}
		c := &layoutgraph.Cluster{
			Vessel:         vessel,
			Nodes:          []*layoutgraph.Node{origTo},
			Graph:          g,
			EdgeAbductions: []*layoutgraph.EdgeAbduction{abduction},
		}
		g.Clusters[vessel] = c

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["cluster_edge_abduction_to_restoration"] = captureScenario("cluster_edge_abduction_to_restoration", panicked, msg, g, []*layoutgraph.Node{vessel, src, origTo})
	}

	// N. cluster_edge_abduction_both_endpoints
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		vessel2 := layoutgraph.NewNode(2, 10, 10)
		vessel2.Graph = g
		origFrom := layoutgraph.NewNode(3, 10, 10)
		origFrom.Graph = g
		origTo := layoutgraph.NewNode(4, 10, 10)
		origTo.Graph = g
		g.Nodes = []*layoutgraph.Node{vessel, vessel2}

		// Edge currently connects vessel -> vessel2
		e := g.Connect(vessel, vessel2)
		abduction := &layoutgraph.EdgeAbduction{
			Edge:           e,
			OriginallyFrom: origFrom,
			OriginallyTo:   origTo,
		}
		c := &layoutgraph.Cluster{
			Vessel:         vessel,
			Nodes:          []*layoutgraph.Node{origFrom, origTo},
			Graph:          g,
			EdgeAbductions: []*layoutgraph.EdgeAbduction{abduction},
		}
		g.Clusters[vessel] = c

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["cluster_edge_abduction_both_endpoints"] = captureScenario("cluster_edge_abduction_both_endpoints", panicked, msg, g, []*layoutgraph.Node{vessel, vessel2, origFrom, origTo})
	}

	// O. sequence_edge_abduction_equivalents
	{
		g := layoutgraph.NewGraph()
		sVessel := layoutgraph.NewNode(1, 10, 10)
		sVessel.Graph = g
		origFrom := layoutgraph.NewNode(2, 10, 10)
		origFrom.Graph = g
		dest := layoutgraph.NewNode(3, 10, 10)
		dest.Graph = g
		g.Nodes = []*layoutgraph.Node{sVessel, dest}

		e := g.Connect(sVessel, dest)
		abduction := &layoutgraph.EdgeAbduction{
			Edge:           e,
			OriginallyFrom: origFrom,
		}
		seq := &layoutgraph.Sequence{
			Vessel:         sVessel,
			Nodes:          []*layoutgraph.Node{origFrom},
			Graph:          g,
			EdgeAbductions: []*layoutgraph.EdgeAbduction{abduction},
		}
		g.Sequences[sVessel] = seq

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["sequence_edge_abduction_equivalents"] = captureScenario("sequence_edge_abduction_equivalents", panicked, msg, g, []*layoutgraph.Node{sVessel, origFrom, dest})
	}

	// P. cluster_near_transfer
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		m1 := layoutgraph.NewNode(2, 10, 10)
		m1.Graph = g
		m2 := layoutgraph.NewNode(3, 10, 10)
		m2.Graph = g
		near30 := layoutgraph.NewNode(30, 10, 10)
		near30.Graph = g
		near10 := layoutgraph.NewNode(10, 10, 10)
		near10.Graph = g
		near20 := layoutgraph.NewNode(20, 10, 10)
		near20.Graph = g

		// Insert nears out of order into vessel
		vessel.AddNear(near30)
		vessel.AddNear(near10)
		vessel.AddNear(near20)

		c := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{m1, m2}, Graph: g}
		g.Clusters[vessel] = c
		g.Nodes = []*layoutgraph.Node{vessel, near10, near20, near30}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["cluster_near_transfer"] = captureScenario("cluster_near_transfer", panicked, msg, g, []*layoutgraph.Node{vessel, m1, m2, near10, near20, near30})
	}

	// Q. sequence_near_transfer
	{
		g := layoutgraph.NewGraph()
		sVessel := layoutgraph.NewNode(1, 10, 10)
		sVessel.Graph = g
		step1 := layoutgraph.NewNode(2, 10, 10)
		step1.Graph = g
		step2 := layoutgraph.NewNode(3, 10, 10)
		step2.Graph = g
		near20 := layoutgraph.NewNode(20, 10, 10)
		near20.Graph = g
		near10 := layoutgraph.NewNode(10, 10, 10)
		near10.Graph = g

		sVessel.AddNear(near20)
		sVessel.AddNear(near10)

		seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{step1, step2}, Graph: g}
		g.Sequences[sVessel] = seq
		g.Nodes = []*layoutgraph.Node{sVessel, near10, near20}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["sequence_near_transfer"] = captureScenario("sequence_near_transfer", panicked, msg, g, []*layoutgraph.Node{sVessel, step1, step2, near10, near20})
	}

	// R. herd_assignment_clearing
	{
		g := layoutgraph.NewGraph()
		ord := layoutgraph.NewNode(1, 10, 10)
		ord.Graph = g
		ord.HerdAssignment = layoutgraph.NewHerdAssignment()

		cVessel := layoutgraph.NewNode(4, 10, 10)
		cVessel.Graph = g
		cVessel.HerdAssignment = layoutgraph.NewHerdAssignment()
		cMember := layoutgraph.NewNode(2, 10, 10)
		cMember.Graph = g
		cMember.HerdAssignment = layoutgraph.NewHerdAssignment()
		c := &layoutgraph.Cluster{Vessel: cVessel, Nodes: []*layoutgraph.Node{cMember}, Graph: g}
		g.Clusters[cVessel] = c

		sVessel := layoutgraph.NewNode(5, 10, 10)
		sVessel.Graph = g
		sVessel.HerdAssignment = layoutgraph.NewHerdAssignment()
		sStep := layoutgraph.NewNode(3, 10, 10)
		sStep.Graph = g
		sStep.HerdAssignment = layoutgraph.NewHerdAssignment()
		seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{sStep}, Graph: g}
		g.Sequences[sVessel] = seq

		g.Nodes = []*layoutgraph.Node{ord, cVessel, sVessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["herd_assignment_clearing"] = captureScenario("herd_assignment_clearing", panicked, msg, g, []*layoutgraph.Node{ord, cMember, sStep, cVessel, sVessel})
	}

	// S. nil_cluster_nodes
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		c := &layoutgraph.Cluster{Vessel: vessel, Nodes: nil, Graph: g}
		g.Clusters[vessel] = c
		g.Nodes = []*layoutgraph.Node{vessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["nil_cluster_nodes"] = captureScenario("nil_cluster_nodes", panicked, msg, g, []*layoutgraph.Node{vessel})
	}

	// T. nil_sequence_nodes
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		seq := &layoutgraph.Sequence{Vessel: vessel, Nodes: nil, Graph: g}
		g.Sequences[vessel] = seq
		g.Nodes = []*layoutgraph.Node{vessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["nil_sequence_nodes"] = captureScenario("nil_sequence_nodes", panicked, msg, g, []*layoutgraph.Node{vessel})
	}

	// U. nil_cluster_map_value
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		g.Clusters[vessel] = nil
		g.Nodes = []*layoutgraph.Node{vessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["nil_cluster_map_value"] = captureScenario("nil_cluster_map_value", panicked, msg, g, []*layoutgraph.Node{vessel})
	}

	// V. nil_sequence_map_value
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		g.Sequences[vessel] = nil
		g.Nodes = []*layoutgraph.Node{vessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["nil_sequence_map_value"] = captureScenario("nil_sequence_map_value", panicked, msg, g, []*layoutgraph.Node{vessel})
	}

	// W. nil_edge_abduction_entry
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		c := &layoutgraph.Cluster{
			Vessel:         vessel,
			Nodes:          []*layoutgraph.Node{},
			Graph:          g,
			EdgeAbductions: []*layoutgraph.EdgeAbduction{nil},
		}
		g.Clusters[vessel] = c
		g.Nodes = []*layoutgraph.Node{vessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["nil_edge_abduction_entry"] = captureScenario("nil_edge_abduction_entry", panicked, msg, g, []*layoutgraph.Node{vessel})
	}

	// X. duplicate_vessel_occurrence
	{
		g := layoutgraph.NewGraph()
		parent := layoutgraph.NewNode(10, 100, 100)
		parent.Graph = g
		parent.SetContainer(true)
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		vessel.Container = parent
		m := layoutgraph.NewNode(2, 10, 10)
		m.Graph = g
		c := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{m}, Container: parent, Graph: g}
		g.Clusters[vessel] = c

		// Duplicate vessel in g.Nodes and g.Containers[parent]
		g.Nodes = []*layoutgraph.Node{parent, vessel, m, vessel}
		g.Containers[parent] = []*layoutgraph.Node{vessel, m, vessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
		})
		out.Scenarios["duplicate_vessel_occurrence"] = captureScenario("duplicate_vessel_occurrence", panicked, msg, g, []*layoutgraph.Node{parent, vessel, m})
	}

	// Y. repeated_cleanup_call
	{
		g := layoutgraph.NewGraph()
		cVessel := layoutgraph.NewNode(1, 10, 10)
		cVessel.Graph = g
		cMember := layoutgraph.NewNode(2, 10, 10)
		cMember.Graph = g
		c := &layoutgraph.Cluster{Vessel: cVessel, Nodes: []*layoutgraph.Node{cMember}, Graph: g}
		g.Clusters[cVessel] = c

		sVessel := layoutgraph.NewNode(3, 10, 10)
		sVessel.Graph = g
		sStep := layoutgraph.NewNode(4, 10, 10)
		sStep.Graph = g
		seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{sStep}, Graph: g}
		g.Sequences[sVessel] = seq

		g.Nodes = []*layoutgraph.Node{cVessel, sVessel}

		panicked, msg := runSafe(func() {
			grouping.Cleanup(g)
			grouping.Cleanup(g)
		})
		out.Scenarios["repeated_cleanup_call"] = captureScenario("repeated_cleanup_call", panicked, msg, g, []*layoutgraph.Node{cVessel, cMember, sVessel, sStep})
	}

	// Generate JSON
	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	targetPath := "test/fixtures/go-cleanup-reference.json"
	if len(os.Args) > 1 {
		targetPath = os.Args[1]
	} else if _, err := os.Stat("d2layouts/d2talalayout/js"); err == nil {
		targetPath = "d2layouts/d2talalayout/js/test/fixtures/go-cleanup-reference.json"
	} else if _, err := os.Stat("../fixtures"); err == nil {
		targetPath = filepath.Join("..", "fixtures", "go-cleanup-reference.json")
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(targetPath, bytes, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(bytes))
}
