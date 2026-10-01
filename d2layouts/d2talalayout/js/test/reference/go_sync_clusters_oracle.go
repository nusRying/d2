package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

type PointDTO struct {
	X string `json:"x"`
	Y string `json:"y"`
}

type NodeGeometryDTO struct {
	ID      string    `json:"id"`
	TopLeft *PointDTO `json:"topLeft,omitempty"`
	Width   string    `json:"width"`
	Height  string    `json:"height"`
}

type RDFSScenarioResult struct {
	Name         string   `json:"name"`
	Visited      []string `json:"visited"`
	Panicked     bool     `json:"panicked"`
	PanicMessage string   `json:"panicMessage,omitempty"`
}

type SyncClusterScenarioResult struct {
	Name         string                     `json:"name"`
	Panicked     bool                       `json:"panicked"`
	PanicMessage string                     `json:"panicMessage,omitempty"`
	NodesBefore  map[string]NodeGeometryDTO `json:"nodesBefore,omitempty"`
	NodesAfter   map[string]NodeGeometryDTO `json:"nodesAfter,omitempty"`
}

type OracleOutput struct {
	Metadata             map[string]string                     `json:"metadata"`
	RDFSScenarios        map[string]RDFSScenarioResult        `json:"rdfsScenarios"`
	SyncClusterScenarios map[string]SyncClusterScenarioResult `json:"syncClusterScenarios"`
}

func numberClass(v float64) string {
	switch {
	case math.IsNaN(v):
		return "NaN"
	case math.IsInf(v, 1):
		return "+Inf"
	case math.IsInf(v, -1):
		return "-Inf"
	default:
		return strconv.FormatFloat(v, 'g', -1, 64)
	}
}

func pointToDTO(pt *geo.Point) *PointDTO {
	if pt == nil {
		return nil
	}
	return &PointDTO{
		X: numberClass(pt.X),
		Y: numberClass(pt.Y),
	}
}

func captureNodeGeometry(n *layoutgraph.Node) NodeGeometryDTO {
	idStr := ""
	if n != nil {
		idStr = fmt.Sprintf("%v", n.ID)
	}
	if n == nil {
		return NodeGeometryDTO{ID: idStr}
	}
	return NodeGeometryDTO{
		ID:      idStr,
		TopLeft: pointToDTO(n.TopLeft),
		Width:   numberClass(n.Width),
		Height:  numberClass(n.Height),
	}
}

func captureAllNodesGeometry(nodes []*layoutgraph.Node) map[string]NodeGeometryDTO {
	res := make(map[string]NodeGeometryDTO)
	for _, n := range nodes {
		if n != nil {
			idStr := fmt.Sprintf("%v", n.ID)
			res[idStr] = captureNodeGeometry(n)
		}
	}
	return res
}

func runSafe(fn func()) (panicked bool, panicMsg string) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
			panicMsg = fmt.Sprintf("%v", r)
		}
	}()
	fn()
	return false, ""
}

func main() {
	out := OracleOutput{
		Metadata: map[string]string{
			"runtimeGoVersion": runtime.Version(),
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"slice":            "Slice 25 — RDFS Traversal Parity & Graph SyncClusters",
		},
		RDFSScenarios:        make(map[string]RDFSScenarioResult),
		SyncClusterScenarios: make(map[string]SyncClusterScenarioResult),
	}

	// ==========================================
	// Section 1: Mandatory RDFS Scenarios
	// ==========================================

	// 1. ordinary_leaf
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 50, 50)
		n.Graph = g
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			n.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["ordinary_leaf"] = RDFSScenarioResult{
			Name:         "ordinary_leaf",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 2. ordinary_nil_graph_panics_before_callback
	{
		n := layoutgraph.NewNode(1, 50, 50)
		n.Graph = nil
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			n.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["ordinary_nil_graph_panics_before_callback"] = RDFSScenarioResult{
			Name:         "ordinary_nil_graph_panics_before_callback",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 3. container_missing_children_key_succeeds
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 50, 50)
		n.Graph = g
		n.SetContainer(true)
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			n.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["container_missing_children_key_succeeds"] = RDFSScenarioResult{
			Name:         "container_missing_children_key_succeeds",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 4. container_postorder
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 50, 50)
		root.Graph = g
		root.SetContainer(true)
		childA := layoutgraph.NewNode(2, 20, 20)
		childA.Graph = g
		childB := layoutgraph.NewNode(3, 20, 20)
		childB.Graph = g
		g.Containers[root] = []*layoutgraph.Node{childA, childB}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			root.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["container_postorder"] = RDFSScenarioResult{
			Name:         "container_postorder",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 5. nested_container_postorder
	{
		g := layoutgraph.NewGraph()
		A := layoutgraph.NewNode(1, 100, 100)
		A.Graph = g
		A.SetContainer(true)
		B := layoutgraph.NewNode(2, 60, 60)
		B.Graph = g
		B.SetContainer(true)
		C := layoutgraph.NewNode(3, 30, 30)
		C.Graph = g
		g.Containers[A] = []*layoutgraph.Node{B}
		g.Containers[B] = []*layoutgraph.Node{C}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			A.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["nested_container_postorder"] = RDFSScenarioResult{
			Name:         "nested_container_postorder",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 6. cluster_member_postorder
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 100, 100)
		vessel.Graph = g
		vessel.SetClusterVessel(true)
		m1 := layoutgraph.NewNode(2, 30, 30)
		m1.Graph = g
		m2 := layoutgraph.NewNode(3, 30, 30)
		m2.Graph = g
		g.Clusters[vessel] = &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{m1, m2}, Graph: g}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			vessel.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["cluster_member_postorder"] = RDFSScenarioResult{
			Name:         "cluster_member_postorder",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 7. sequence_step_postorder
	{
		g := layoutgraph.NewGraph()
		sVessel := layoutgraph.NewNode(1, 100, 100)
		sVessel.Graph = g
		s1 := layoutgraph.NewNode(2, 30, 30)
		s1.Graph = g
		s2 := layoutgraph.NewNode(3, 30, 30)
		s2.Graph = g
		g.Sequences[sVessel] = &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{s1, s2}, Graph: g}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			sVessel.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["sequence_step_postorder"] = RDFSScenarioResult{
			Name:         "sequence_step_postorder",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 8. cluster_overrides_sequence
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		root.Graph = g
		root.SetClusterVessel(true)
		cMember := layoutgraph.NewNode(2, 30, 30)
		cMember.Graph = g
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{cMember}, Graph: g}
		sStep := layoutgraph.NewNode(3, 30, 30)
		sStep.Graph = g
		g.Sequences[root] = &layoutgraph.Sequence{Vessel: root, Nodes: []*layoutgraph.Node{sStep}, Graph: g}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			root.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["cluster_overrides_sequence"] = RDFSScenarioResult{
			Name:         "cluster_overrides_sequence",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 9. container_then_cluster_then_self
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		root.Graph = g
		root.SetContainer(true)
		root.SetClusterVessel(true)
		childA := layoutgraph.NewNode(2, 20, 20)
		childA.Graph = g
		g.Containers[root] = []*layoutgraph.Node{childA}
		cm1 := layoutgraph.NewNode(3, 20, 20)
		cm1.Graph = g
		g.Clusters[root] = &layoutgraph.Cluster{Vessel: root, Nodes: []*layoutgraph.Node{cm1}, Graph: g}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			root.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["container_then_cluster_then_self"] = RDFSScenarioResult{
			Name:         "container_then_cluster_then_self",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 10. container_then_sequence_then_self
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		root.Graph = g
		root.SetContainer(true)
		root.SetClusterVessel(false)
		childA := layoutgraph.NewNode(2, 20, 20)
		childA.Graph = g
		g.Containers[root] = []*layoutgraph.Node{childA}
		s1 := layoutgraph.NewNode(3, 20, 20)
		s1.Graph = g
		g.Sequences[root] = &layoutgraph.Sequence{Vessel: root, Nodes: []*layoutgraph.Node{s1}, Graph: g}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			root.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["container_then_sequence_then_self"] = RDFSScenarioResult{
			Name:         "container_then_sequence_then_self",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 11. duplicate_container_child_occurrence
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		root.Graph = g
		root.SetContainer(true)
		childA := layoutgraph.NewNode(2, 20, 20)
		childA.Graph = g
		g.Containers[root] = []*layoutgraph.Node{childA, childA}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			root.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["duplicate_container_child_occurrence"] = RDFSScenarioResult{
			Name:         "duplicate_container_child_occurrence",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 12. nil_container_child_panics_before_parent_callback
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		root.Graph = g
		root.SetContainer(true)
		g.Containers[root] = []*layoutgraph.Node{nil}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			root.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["nil_container_child_panics_before_parent_callback"] = RDFSScenarioResult{
			Name:         "nil_container_child_panics_before_parent_callback",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 13. nil_cluster_member_panics_before_vessel_callback
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 100, 100)
		vessel.Graph = g
		vessel.SetClusterVessel(true)
		g.Clusters[vessel] = &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{nil}, Graph: g}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			vessel.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["nil_cluster_member_panics_before_vessel_callback"] = RDFSScenarioResult{
			Name:         "nil_cluster_member_panics_before_vessel_callback",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 14. nil_sequence_step_panics_before_owner_callback
	{
		g := layoutgraph.NewGraph()
		sVessel := layoutgraph.NewNode(1, 100, 100)
		sVessel.Graph = g
		g.Sequences[sVessel] = &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{nil}, Graph: g}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			sVessel.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["nil_sequence_step_panics_before_owner_callback"] = RDFSScenarioResult{
			Name:         "nil_sequence_step_panics_before_owner_callback",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 15. cluster_vessel_missing_cluster_entry_panics
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 100, 100)
		vessel.Graph = g
		vessel.SetClusterVessel(true)
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			vessel.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["cluster_vessel_missing_cluster_entry_panics"] = RDFSScenarioResult{
			Name:         "cluster_vessel_missing_cluster_entry_panics",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 16. null_sequence_entry_panics
	{
		g := layoutgraph.NewGraph()
		sVessel := layoutgraph.NewNode(1, 100, 100)
		sVessel.Graph = g
		g.Sequences[sVessel] = nil
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			sVessel.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["null_sequence_entry_panics"] = RDFSScenarioResult{
			Name:         "null_sequence_entry_panics",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// 17. shared_node_alias_visited_twice
	{
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(1, 100, 100)
		root.Graph = g
		root.SetContainer(true)
		c1 := layoutgraph.NewNode(2, 50, 50)
		c1.Graph = g
		c1.SetContainer(true)
		c2 := layoutgraph.NewNode(3, 50, 50)
		c2.Graph = g
		c2.SetContainer(true)
		sharedLeaf := layoutgraph.NewNode(4, 20, 20)
		sharedLeaf.Graph = g
		g.Containers[root] = []*layoutgraph.Node{c1, c2}
		g.Containers[c1] = []*layoutgraph.Node{sharedLeaf}
		g.Containers[c2] = []*layoutgraph.Node{sharedLeaf}
		visited := make([]string, 0)
		panicked, panicMsg := runSafe(func() {
			root.WalkRDFS(func(curr *layoutgraph.Node) {
				visited = append(visited, fmt.Sprintf("%v", curr.ID))
			})
		})
		out.RDFSScenarios["shared_node_alias_visited_twice"] = RDFSScenarioResult{
			Name:         "shared_node_alias_visited_twice",
			Visited:      visited,
			Panicked:     panicked,
			PanicMessage: panicMsg,
		}
	}

	// ==========================================
	// Section 2: Mandatory SyncClusters Scenarios
	// ==========================================

	// 1. empty_clusters_map_noop
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 50, 50)
		n.TopLeft = &geo.Point{X: 10, Y: 10}
		n.Graph = g
		g.Nodes = []*layoutgraph.Node{n}
		tracked := []*layoutgraph.Node{n}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["empty_clusters_map_noop"] = SyncClusterScenarioResult{
			Name:         "empty_clusters_map_noop",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 2. empty_clusters_map_skips_malformed_nodes
	{
		g := layoutgraph.NewGraph()
		g.Nodes = []*layoutgraph.Node{nil}
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		out.SyncClusterScenarios["empty_clusters_map_skips_malformed_nodes"] = SyncClusterScenarioResult{
			Name:         "empty_clusters_map_skips_malformed_nodes",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  nil,
			NodesAfter:   nil,
		}
	}

	// 3. simple_cluster_sync
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.TopLeft = &geo.Point{X: 0, Y: 0}
		vessel.Graph = g
		vessel.SetClusterVessel(true)
		m1 := layoutgraph.NewNode(2, 40, 40)
		m1.TopLeft = &geo.Point{X: 0, Y: 0}
		m1.Graph = g
		m2 := layoutgraph.NewNode(3, 40, 40)
		m2.TopLeft = &geo.Point{X: 0, Y: 0}
		m2.Graph = g
		c := &layoutgraph.Cluster{
			Vessel:      vessel,
			Nodes:       []*layoutgraph.Node{m1, m2},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}
		g.Clusters[vessel] = c
		g.Nodes = []*layoutgraph.Node{vessel}
		tracked := []*layoutgraph.Node{vessel, m1, m2}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["simple_cluster_sync"] = SyncClusterScenarioResult{
			Name:         "simple_cluster_sync",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 4. graph_nodes_source_order
	{
		g := layoutgraph.NewGraph()
		vesselA := layoutgraph.NewNode(10, 10, 10)
		vesselA.TopLeft = &geo.Point{X: 0, Y: 0}
		vesselA.Graph = g
		vesselA.SetClusterVessel(true)
		mA := layoutgraph.NewNode(11, 30, 30)
		mA.TopLeft = &geo.Point{X: 0, Y: 0}
		mA.Graph = g
		cA := &layoutgraph.Cluster{
			Vessel:      vesselA,
			Nodes:       []*layoutgraph.Node{mA},
			Arrangement: layoutgraph.Row,
			Padding:     5,
			Graph:       g,
		}
		g.Clusters[vesselA] = cA

		vesselB := layoutgraph.NewNode(5, 10, 10)
		vesselB.TopLeft = &geo.Point{X: 0, Y: 0}
		vesselB.Graph = g
		vesselB.SetClusterVessel(true)
		mB := layoutgraph.NewNode(6, 40, 40)
		mB.TopLeft = &geo.Point{X: 0, Y: 0}
		mB.Graph = g
		cB := &layoutgraph.Cluster{
			Vessel:      vesselB,
			Nodes:       []*layoutgraph.Node{mB},
			Arrangement: layoutgraph.Row,
			Padding:     8,
			Graph:       g,
		}
		g.Clusters[vesselB] = cB

		// Scrambled order: vesselB (ID 5) before vesselA (ID 10)
		g.Nodes = []*layoutgraph.Node{vesselB, vesselA}
		tracked := []*layoutgraph.Node{vesselB, mB, vesselA, mA}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["graph_nodes_source_order"] = SyncClusterScenarioResult{
			Name:         "graph_nodes_source_order",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 5. map_entry_without_vessel_flag_not_synced
	{
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 20, 20)
		n.TopLeft = &geo.Point{X: 5, Y: 5}
		n.Graph = g
		n.SetClusterVessel(false)
		m := layoutgraph.NewNode(2, 40, 40)
		m.TopLeft = &geo.Point{X: 0, Y: 0}
		m.Graph = g
		c := &layoutgraph.Cluster{
			Vessel:      n,
			Nodes:       []*layoutgraph.Node{m},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}
		g.Clusters[n] = c
		g.Nodes = []*layoutgraph.Node{n}
		tracked := []*layoutgraph.Node{n, m}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["map_entry_without_vessel_flag_not_synced"] = SyncClusterScenarioResult{
			Name:         "map_entry_without_vessel_flag_not_synced",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 6. marked_vessel_missing_outer_cluster_entry_panics
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.Graph = g
		vessel.SetClusterVessel(true)

		otherVessel := layoutgraph.NewNode(2, 10, 10)
		otherVessel.Graph = g
		otherVessel.SetClusterVessel(true)
		m := layoutgraph.NewNode(3, 20, 20)
		m.Graph = g
		g.Clusters[otherVessel] = &layoutgraph.Cluster{
			Vessel:      otherVessel,
			Nodes:       []*layoutgraph.Node{m},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}

		g.Nodes = []*layoutgraph.Node{vessel}
		tracked := []*layoutgraph.Node{vessel}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["marked_vessel_missing_outer_cluster_entry_panics"] = SyncClusterScenarioResult{
			Name:         "marked_vessel_missing_outer_cluster_entry_panics",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 7. nested_cluster_inner_before_outer
	{
		g := layoutgraph.NewGraph()
		outerVessel := layoutgraph.NewNode(1, 10, 10)
		outerVessel.TopLeft = &geo.Point{X: 0, Y: 0}
		outerVessel.Graph = g
		outerVessel.SetClusterVessel(true)

		innerVessel := layoutgraph.NewNode(2, 10, 10)
		innerVessel.TopLeft = &geo.Point{X: 0, Y: 0}
		innerVessel.Graph = g
		innerVessel.SetClusterVessel(true)

		innerMember := layoutgraph.NewNode(3, 50, 50)
		innerMember.TopLeft = &geo.Point{X: 0, Y: 0}
		innerMember.Graph = g

		innerCluster := &layoutgraph.Cluster{
			Vessel:      innerVessel,
			Nodes:       []*layoutgraph.Node{innerMember},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}
		outerCluster := &layoutgraph.Cluster{
			Vessel:      outerVessel,
			Nodes:       []*layoutgraph.Node{innerVessel},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}
		g.Clusters[innerVessel] = innerCluster
		g.Clusters[outerVessel] = outerCluster
		g.Nodes = []*layoutgraph.Node{outerVessel}

		tracked := []*layoutgraph.Node{outerVessel, innerVessel, innerMember}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["nested_cluster_inner_before_outer"] = SyncClusterScenarioResult{
			Name:         "nested_cluster_inner_before_outer",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 8. nested_container_cluster_order
	{
		g := layoutgraph.NewGraph()
		container := layoutgraph.NewNode(1, 100, 100)
		container.TopLeft = &geo.Point{X: 0, Y: 0}
		container.Graph = g
		container.SetContainer(true)

		cVessel := layoutgraph.NewNode(2, 10, 10)
		cVessel.TopLeft = &geo.Point{X: 0, Y: 0}
		cVessel.Graph = g
		cVessel.SetClusterVessel(true)

		cMember := layoutgraph.NewNode(3, 40, 40)
		cMember.TopLeft = &geo.Point{X: 0, Y: 0}
		cMember.Graph = g

		cluster := &layoutgraph.Cluster{
			Vessel:      cVessel,
			Nodes:       []*layoutgraph.Node{cMember},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}
		g.Clusters[cVessel] = cluster
		g.Containers[container] = []*layoutgraph.Node{cVessel}
		g.Nodes = []*layoutgraph.Node{container}

		tracked := []*layoutgraph.Node{container, cVessel, cMember}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["nested_container_cluster_order"] = SyncClusterScenarioResult{
			Name:         "nested_container_cluster_order",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 9. cluster_reached_through_sequence_step
	{
		g := layoutgraph.NewGraph()
		sVessel := layoutgraph.NewNode(1, 100, 100)
		sVessel.TopLeft = &geo.Point{X: 0, Y: 0}
		sVessel.Graph = g
		sVessel.SetClusterVessel(false)

		step1 := layoutgraph.NewNode(2, 10, 10)
		step1.TopLeft = &geo.Point{X: 0, Y: 0}
		step1.Graph = g
		step1.SetClusterVessel(true)

		m := layoutgraph.NewNode(3, 40, 40)
		m.TopLeft = &geo.Point{X: 0, Y: 0}
		m.Graph = g

		seq := &layoutgraph.Sequence{
			Vessel: sVessel,
			Nodes:  []*layoutgraph.Node{step1},
			Graph:  g,
		}
		g.Sequences[sVessel] = seq

		cluster := &layoutgraph.Cluster{
			Vessel:      step1,
			Nodes:       []*layoutgraph.Node{m},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}
		g.Clusters[step1] = cluster
		g.Nodes = []*layoutgraph.Node{sVessel}

		tracked := []*layoutgraph.Node{sVessel, step1, m}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["cluster_reached_through_sequence_step"] = SyncClusterScenarioResult{
			Name:         "cluster_reached_through_sequence_step",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 10. nil_root_panics_when_clusters_nonempty
	{
		g := layoutgraph.NewGraph()
		v := layoutgraph.NewNode(1, 10, 10)
		g.Clusters[v] = &layoutgraph.Cluster{Vessel: v}
		g.Nodes = []*layoutgraph.Node{nil}
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		out.SyncClusterScenarios["nil_root_panics_when_clusters_nonempty"] = SyncClusterScenarioResult{
			Name:         "nil_root_panics_when_clusters_nonempty",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  nil,
			NodesAfter:   nil,
		}
	}

	// 11. later_root_failure_preserves_earlier_cluster_sync
	{
		g := layoutgraph.NewGraph()
		vessel := layoutgraph.NewNode(1, 10, 10)
		vessel.TopLeft = &geo.Point{X: 0, Y: 0}
		vessel.Graph = g
		vessel.SetClusterVessel(true)
		m := layoutgraph.NewNode(2, 40, 40)
		m.TopLeft = &geo.Point{X: 0, Y: 0}
		m.Graph = g
		c := &layoutgraph.Cluster{
			Vessel:      vessel,
			Nodes:       []*layoutgraph.Node{m},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       g,
		}
		g.Clusters[vessel] = c
		g.Nodes = []*layoutgraph.Node{vessel, nil}

		tracked := []*layoutgraph.Node{vessel, m}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			g.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["later_root_failure_preserves_earlier_cluster_sync"] = SyncClusterScenarioResult{
			Name:         "later_root_failure_preserves_earlier_cluster_sync",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	// 12. outer_graph_cluster_lookup_vs_node_graph_traversal
	{
		outerGraph := layoutgraph.NewGraph()
		traversalGraph := layoutgraph.NewGraph()

		root := layoutgraph.NewNode(1, 10, 10)
		root.TopLeft = &geo.Point{X: 0, Y: 0}
		root.Graph = traversalGraph
		root.SetContainer(true)

		vessel := layoutgraph.NewNode(2, 10, 10)
		vessel.TopLeft = &geo.Point{X: 0, Y: 0}
		vessel.Graph = traversalGraph
		vessel.SetClusterVessel(true)

		m := layoutgraph.NewNode(3, 40, 40)
		m.TopLeft = &geo.Point{X: 0, Y: 0}
		m.Graph = traversalGraph

		traversalGraph.Containers[root] = []*layoutgraph.Node{vessel}

		traversalCluster := &layoutgraph.Cluster{
			Vessel:      vessel,
			Nodes:       []*layoutgraph.Node{m},
			Arrangement: layoutgraph.Row,
			Padding:     10,
			Graph:       traversalGraph,
		}
		traversalGraph.Clusters[vessel] = traversalCluster

		outerCluster := &layoutgraph.Cluster{
			Vessel:      vessel,
			Nodes:       []*layoutgraph.Node{m},
			Arrangement: layoutgraph.Row,
			Padding:     25,
			Graph:       outerGraph,
		}
		outerGraph.Clusters[vessel] = outerCluster
		outerGraph.Nodes = []*layoutgraph.Node{root}

		tracked := []*layoutgraph.Node{root, vessel, m}
		before := captureAllNodesGeometry(tracked)
		panicked, panicMsg := runSafe(func() {
			outerGraph.SyncClusters()
		})
		after := captureAllNodesGeometry(tracked)
		out.SyncClusterScenarios["outer_graph_cluster_lookup_vs_node_graph_traversal"] = SyncClusterScenarioResult{
			Name:         "outer_graph_cluster_lookup_vs_node_graph_traversal",
			Panicked:     panicked,
			PanicMessage: panicMsg,
			NodesBefore:  before,
			NodesAfter:   after,
		}
	}

	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal error: %v\n", err)
		os.Exit(1)
	}

	targetPath := "test/fixtures/go-sync-clusters-reference.json"
	if len(os.Args) > 1 {
		targetPath = os.Args[1]
	} else {
		if _, err := os.Stat("d2layouts/d2talalayout/js"); err == nil {
			targetPath = "d2layouts/d2talalayout/js/test/fixtures/go-sync-clusters-reference.json"
		}
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		fmt.Fprintf(os.Stderr, "mkdir error: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(targetPath, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Generated %d RDFS scenarios and %d SyncClusters scenarios at %s (%d bytes)\n",
		len(out.RDFSScenarios), len(out.SyncClusterScenarios), targetPath, len(bytes))
}
