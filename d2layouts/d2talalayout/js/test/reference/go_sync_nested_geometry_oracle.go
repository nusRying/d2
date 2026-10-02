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

type ScenarioResult struct {
	Name         string                     `json:"name"`
	Panicked     bool                       `json:"panicked"`
	PanicMessage string                     `json:"panicMessage,omitempty"`
	NodesBefore  map[string]NodeGeometryDTO `json:"nodesBefore,omitempty"`
	NodesAfter   map[string]NodeGeometryDTO `json:"nodesAfter,omitempty"`
	NodesAfter2  map[string]NodeGeometryDTO `json:"nodesAfter2,omitempty"`
}

type OracleOutput struct {
	Metadata  map[string]string         `json:"metadata"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
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

func addScenario(out *OracleOutput, name string, g *layoutgraph.Graph, allNodes []*layoutgraph.Node, doubleCall bool) {
	captureAll := func() map[string]NodeGeometryDTO {
		res := make(map[string]NodeGeometryDTO)
		for _, n := range allNodes {
			if n != nil {
				res[fmt.Sprintf("%v", n.ID)] = captureNodeGeometry(n)
			}
		}
		return res
	}

	before := captureAll()
	panicked, panicMsg := runSafe(func() {
		g.SyncNestedGeometry()
	})
	after := captureAll()

	res := ScenarioResult{
		Name:         name,
		Panicked:     panicked,
		PanicMessage: panicMsg,
		NodesBefore:  before,
		NodesAfter:   after,
	}

	if doubleCall && !panicked {
		panicked2, panicMsg2 := runSafe(func() {
			g.SyncNestedGeometry()
		})
		res.Panicked = panicked2
		res.PanicMessage = panicMsg2
		res.NodesAfter2 = captureAll()
	}

	out.Scenarios[name] = res
}

func main() {
	out := &OracleOutput{
		Metadata: map[string]string{
			"d2BaseCommit":    "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"runtimeGoVersion": runtime.Version(),
			"slice":           "Slice 26 — Nested Geometry Synchronization",
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// A. Empty graph
	g := layoutgraph.NewGraph()
	addScenario(out, "empty_graph", g, []*layoutgraph.Node{}, false)

	// B. Ordinary node
	g = layoutgraph.NewGraph()
	n := layoutgraph.NewNode(1, 10, 10)
	n.Graph = g
	n.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{n}
	addScenario(out, "ordinary_node", g, []*layoutgraph.Node{n}, false)

	// C. Container-only node
	g = layoutgraph.NewGraph()
	root := layoutgraph.NewNode(1, 10, 10)
	root.Graph = g
	root.TopLeft = &geo.Point{X: 0, Y: 0} // REQUIRED for positionContainerChildren
	g.Nodes = []*layoutgraph.Node{root}
	root.SetContainer(true)
	child := layoutgraph.NewNode(2, 20, 20)
	child.Graph = g
	child.TopLeft = &geo.Point{X: 10, Y: 10}
	g.Containers[root] = []*layoutgraph.Node{child}
	addScenario(out, "container_only_node", g, []*layoutgraph.Node{root, child}, false)

	// D. Cluster-vessel-only node
	g = layoutgraph.NewGraph()
	vessel := layoutgraph.NewNode(1, 10, 10)
	vessel.Graph = g
	vessel.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{vessel}
	vessel.SetClusterVessel(true)
	member := layoutgraph.NewNode(2, 20, 20)
	member.Graph = g
	member.TopLeft = &geo.Point{X: 0, Y: 0}
	c := &layoutgraph.Cluster{Vessel: vessel, Nodes: []*layoutgraph.Node{member}, Graph: g, Arrangement: layoutgraph.ClusterArrangement(1)} // ArrangeLeftRight = 1
	g.Clusters[vessel] = c
	addScenario(out, "cluster_vessel_only_node", g, []*layoutgraph.Node{vessel, member}, false)

	// E. Sequence-only node
	g = layoutgraph.NewGraph()
	sVessel := layoutgraph.NewNode(1, 10, 10)
	sVessel.Graph = g
	sVessel.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{sVessel}
	sStep := layoutgraph.NewNode(2, 30, 30)
	sStep.Graph = g
	sStep.TopLeft = &geo.Point{X: 0, Y: 0}
	seq := &layoutgraph.Sequence{Vessel: sVessel, Nodes: []*layoutgraph.Node{sStep}, Graph: g}
	g.Sequences[sVessel] = seq
	addScenario(out, "sequence_only_node", g, []*layoutgraph.Node{sVessel, sStep}, false)

	// F. Cluster containing a container member
	g = layoutgraph.NewGraph()
	vessel2 := layoutgraph.NewNode(1, 10, 10)
	vessel2.Graph = g
	vessel2.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{vessel2}
	vessel2.SetClusterVessel(true)
	containerMember := layoutgraph.NewNode(2, 50, 50)
	containerMember.Graph = g
	containerMember.TopLeft = &geo.Point{X: 0, Y: 0}
	containerMember.SetContainer(true)
	c2 := &layoutgraph.Cluster{Vessel: vessel2, Nodes: []*layoutgraph.Node{containerMember}, Graph: g}
	g.Clusters[vessel2] = c2
	grandchild := layoutgraph.NewNode(3, 10, 10)
	grandchild.Graph = g
	grandchild.TopLeft = &geo.Point{X: 5, Y: 5}
	greatGrandchild := layoutgraph.NewNode(4, 10, 10)
	greatGrandchild.Graph = g
	greatGrandchild.TopLeft = &geo.Point{X: 5, Y: 5}
	grandchild.SetContainer(true)
	g.Containers[containerMember] = []*layoutgraph.Node{grandchild}
	g.Containers[grandchild] = []*layoutgraph.Node{greatGrandchild}
	addScenario(out, "cluster_containing_container_member", g, []*layoutgraph.Node{vessel2, containerMember, grandchild, greatGrandchild}, false)

	// G. Multiple cluster container members
	g = layoutgraph.NewGraph()
	vessel3 := layoutgraph.NewNode(1, 10, 10)
	vessel3.Graph = g
	vessel3.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{vessel3}
	vessel3.SetClusterVessel(true)
	cm1 := layoutgraph.NewNode(2, 10, 10)
	cm1.Graph = g
	cm1.TopLeft = &geo.Point{X: 0, Y: 0}
	cm1.SetContainer(true)
	gc1 := layoutgraph.NewNode(3, 10, 10)
	gc1.Graph = g
	gc1.TopLeft = &geo.Point{X: 1, Y: 1}
	g.Containers[cm1] = []*layoutgraph.Node{gc1}
	cm2 := layoutgraph.NewNode(4, 20, 20)
	cm2.Graph = g
	cm2.TopLeft = &geo.Point{X: 0, Y: 0}
	cm2.SetContainer(true)
	gc2 := layoutgraph.NewNode(5, 10, 10)
	gc2.Graph = g
	gc2.TopLeft = &geo.Point{X: 1, Y: 1}
	g.Containers[cm2] = []*layoutgraph.Node{gc2}
	c3 := &layoutgraph.Cluster{Vessel: vessel3, Nodes: []*layoutgraph.Node{cm1, cm2}, Graph: g, Arrangement: layoutgraph.ClusterArrangement(1)}
	g.Clusters[vessel3] = c3
	addScenario(out, "multiple_cluster_container_members", g, []*layoutgraph.Node{vessel3, cm1, gc1, cm2, gc2}, false)

	// H. Multiple graph nodes
	g = layoutgraph.NewGraph()
	n1 := layoutgraph.NewNode(1, 20, 20)
	n1.Graph = g
	n1.TopLeft = &geo.Point{X: 0, Y: 0}
	n1.SetContainer(true)
	ch1 := layoutgraph.NewNode(11, 10, 10)
	ch1.Graph = g
	ch1.TopLeft = &geo.Point{X: 10, Y: 10}
	g.Containers[n1] = []*layoutgraph.Node{ch1}
	n2 := layoutgraph.NewNode(2, 20, 20)
	n2.Graph = g
	n2.TopLeft = &geo.Point{X: 0, Y: 0}
	n2.SetClusterVessel(true)
	ch2 := layoutgraph.NewNode(12, 10, 10)
	ch2.Graph = g
	ch2.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Clusters[n2] = &layoutgraph.Cluster{Vessel: n2, Nodes: []*layoutgraph.Node{ch2}, Graph: g}
	g.Nodes = []*layoutgraph.Node{n2, n1} // source order: n2 then n1
	addScenario(out, "multiple_graph_nodes_source_order", g, []*layoutgraph.Node{n1, ch1, n2, ch2}, false)

	// I. Multi-role node
	g = layoutgraph.NewGraph()
	mr := layoutgraph.NewNode(1, 10, 10)
	mr.Graph = g
	mr.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{mr}
	mr.SetContainer(true)
	mr.SetClusterVessel(true)
	ch3 := layoutgraph.NewNode(2, 20, 20)
	ch3.Graph = g
	ch3.TopLeft = &geo.Point{X: 10, Y: 10}
	g.Containers[mr] = []*layoutgraph.Node{ch3}
	cm3 := layoutgraph.NewNode(3, 20, 20)
	cm3.Graph = g
	cm3.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Clusters[mr] = &layoutgraph.Cluster{Vessel: mr, Nodes: []*layoutgraph.Node{cm3}, Graph: g}
	st := layoutgraph.NewNode(4, 30, 30)
	st.Graph = g
	st.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Sequences[mr] = &layoutgraph.Sequence{Vessel: mr, Nodes: []*layoutgraph.Node{st}, Graph: g}
	addScenario(out, "multi_role_node", g, []*layoutgraph.Node{mr, ch3, cm3, st}, false)

	// J. Missing sequence key
	g = layoutgraph.NewGraph()
	noSeq := layoutgraph.NewNode(1, 10, 10)
	noSeq.Graph = g
	g.Nodes = []*layoutgraph.Node{noSeq}
	// g.Sequences has no key for noSeq
	addScenario(out, "missing_sequence_key", g, []*layoutgraph.Node{noSeq}, false)

	// K1. Present sequence key with nil value
	g = layoutgraph.NewGraph()
	nilSeqVessel := layoutgraph.NewNode(1, 10, 10)
	nilSeqVessel.Graph = g
	g.Nodes = []*layoutgraph.Node{nilSeqVessel}
	g.Sequences[nilSeqVessel] = nil
	addScenario(out, "present_sequence_key_nil_value", g, []*layoutgraph.Node{nilSeqVessel}, false)

	// L. Cluster-vessel missing cluster entry
	g = layoutgraph.NewGraph()
	misVessel := layoutgraph.NewNode(1, 10, 10)
	misVessel.Graph = g
	g.Nodes = []*layoutgraph.Node{misVessel}
	misVessel.SetClusterVessel(true)
	// g.Clusters has no key
	addScenario(out, "cluster_vessel_missing_cluster_entry", g, []*layoutgraph.Node{misVessel}, false)

	// M. Container missing child-list key
	g = layoutgraph.NewGraph()
	misCont := layoutgraph.NewNode(1, 10, 10)
	misCont.Graph = g
	misCont.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{misCont}
	misCont.SetContainer(true)
	// g.Containers has no key
	addScenario(out, "container_missing_child_list_key", g, []*layoutgraph.Node{misCont}, false)

	// N1. Nil node in graph nodes
	g = layoutgraph.NewGraph()
	g.Nodes = []*layoutgraph.Node{nil}
	addScenario(out, "nil_node_in_graph_nodes", g, []*layoutgraph.Node{nil}, false)

	// O. Repeated call behavior
	g = layoutgraph.NewGraph()
	repVes := layoutgraph.NewNode(1, 10, 10)
	repVes.Graph = g
	repVes.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{repVes}
	repVes.SetClusterVessel(true)
	repCont := layoutgraph.NewNode(2, 50, 50)
	repCont.Graph = g
	repCont.TopLeft = &geo.Point{X: 0, Y: 0}
	repCont.SetContainer(true)
	cRep := &layoutgraph.Cluster{Vessel: repVes, Nodes: []*layoutgraph.Node{repCont}, Graph: g}
	g.Clusters[repVes] = cRep
	repChild := layoutgraph.NewNode(3, 10, 10)
	repChild.Graph = g
	repChild.TopLeft = &geo.Point{X: 5, Y: 5}
	g.Containers[repCont] = []*layoutgraph.Node{repChild}
	addScenario(out, "repeated_call_behavior", g, []*layoutgraph.Node{repVes, repCont, repChild}, true)

	// P. Nil cluster nodes (parity for `c.Nodes ?? []`)
	g = layoutgraph.NewGraph()
	nilVessel := layoutgraph.NewNode(1, 10, 10)
	nilVessel.Graph = g
	nilVessel.TopLeft = &geo.Point{X: 0, Y: 0}
	g.Nodes = []*layoutgraph.Node{nilVessel}
	nilVessel.SetClusterVessel(true)
	cNil := &layoutgraph.Cluster{Vessel: nilVessel, Nodes: nil, Graph: g}
	g.Clusters[nilVessel] = cNil
	addScenario(out, "cluster_vessel_nil_nodes", g, []*layoutgraph.Node{nilVessel}, false)

	// Generate JSON
	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	targetPath := filepath.Join("..", "fixtures", "go-sync-nested-geometry-reference.json")
	if err := os.WriteFile(targetPath, bytes, 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(bytes))
}
