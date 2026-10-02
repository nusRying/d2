//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/proximity"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

type PointResult struct {
	X any `json:"x"`
	Y any `json:"y"`
}

func encodeCoord(c float64) any {
	if math.IsInf(c, 1) {
		return "Infinity"
	}
	if math.IsInf(c, -1) {
		return "-Infinity"
	}
	if math.IsNaN(c) {
		return "NaN"
	}
	return c
}

func pointToResult(p *geo.Point) *PointResult {
	if p == nil {
		return nil
	}
	return &PointResult{X: encodeCoord(p.X), Y: encodeCoord(p.Y)}
}

type NodeState struct {
	ID                    int64        `json:"id"`
	HasAssignment         bool         `json:"hasAssignment"`
	Orientation           string       `json:"orientation"`
	OrientationInt        int          `json:"orientationInt"`
	Val                   float64      `json:"val"`
	SameSidePairCount     int          `json:"sameSidePairCount"`
	OppositeSidePairCount int          `json:"oppositeSidePairCount"`
	HasFixedTopLeft       bool         `json:"hasFixedTopLeft"`
	TopLeft               *PointResult `json:"topLeft,omitempty"`
}

type SyncHerdFencesResult struct {
	Success    bool                 `json:"success"`
	Panic      string               `json:"panic,omitempty"`
	GraphTL    *PointResult         `json:"graphTL,omitempty"`
	GraphBR    *PointResult         `json:"graphBR,omitempty"`
	NodeStates map[string]NodeState `json:"nodeStates,omitempty"`
}

type Output struct {
	Scenarios map[string]SyncHerdFencesResult `json:"scenarios"`
}

func captureNodeState(node *layoutgraph.Node) NodeState {
	if node == nil {
		return NodeState{ID: -1}
	}
	ns := NodeState{
		ID:              node.ID,
		HasFixedTopLeft: node.FixedTopLeft != nil,
		TopLeft:         pointToResult(node.TopLeft),
	}
	if node.HerdAssignment != nil {
		ns.HasAssignment = true
		ns.Orientation = node.HerdAssignment.Orientation.ToString()
		ns.OrientationInt = int(node.HerdAssignment.Orientation)
		ns.Val = node.HerdAssignment.Val
		ns.SameSidePairCount = node.HerdAssignment.SameSidePairCount()
		ns.OppositeSidePairCount = node.HerdAssignment.OppositeSidePairCount()
	}
	return ns
}

func safeBoundingBox(graph *layoutgraph.Graph) (*geo.Point, *geo.Point) {
	if graph == nil {
		return nil, nil
	}
	defer func() {
		_ = recover()
	}()
	return graph.BoundingBox()
}

func runScenario(setup func() (*layoutgraph.Graph, map[string]*layoutgraph.Node)) (res SyncHerdFencesResult) {
	var namedNodes map[string]*layoutgraph.Node
	defer func() {
		if r := recover(); r != nil {
			res.Success = false
			res.Panic = fmt.Sprintf("%v", r)
			if namedNodes != nil {
				res.NodeStates = make(map[string]NodeState)
				for name, node := range namedNodes {
					res.NodeStates[name] = captureNodeState(node)
				}
			}
		}
	}()

	var graph *layoutgraph.Graph
	graph, namedNodes = setup()
	if graph != nil {
		tl, br := safeBoundingBox(graph)
		res.GraphTL = pointToResult(tl)
		res.GraphBR = pointToResult(br)
	}

	proximity.SyncHerdFences(graph)
	res.Success = true

	res.NodeStates = make(map[string]NodeState)
	for name, node := range namedNodes {
		res.NodeStates[name] = captureNodeState(node)
	}
	return res
}

func main() {
	out := Output{
		Scenarios: make(map[string]SyncHerdFencesResult),
	}

	// A. empty graph
	out.Scenarios["A_empty_graph"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		return g, map[string]*layoutgraph.Node{}
	})

	// B. nil graph -> panic
	out.Scenarios["B_nil_graph"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		return nil, map[string]*layoutgraph.Node{}
	})

	// C. one placed node, no HerdAssignment
	out.Scenarios["C_one_placed_node_no_assignment"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// D. one Top assignment
	out.Scenarios["D_one_top_assignment"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Top
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// E. one Bottom assignment
	out.Scenarios["E_one_bottom_assignment"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Bottom
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// F. one Left assignment
	out.Scenarios["F_one_left_assignment"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Left
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// G. one Right assignment
	out.Scenarios["G_one_right_assignment"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Right
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// H. mixed Top/Bottom/Left/Right nodes
	out.Scenarios["H_mixed_cardinal_nodes"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		topNode := layoutgraph.NewNode(1, 10, 10)
		topNode.TopLeft = geo.NewPoint(50, 20)
		topNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		topNode.HerdAssignment.Orientation = geo.Top

		bottomNode := layoutgraph.NewNode(2, 10, 10)
		bottomNode.TopLeft = geo.NewPoint(50, 100)
		bottomNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		bottomNode.HerdAssignment.Orientation = geo.Bottom

		leftNode := layoutgraph.NewNode(3, 10, 10)
		leftNode.TopLeft = geo.NewPoint(10, 50)
		leftNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		leftNode.HerdAssignment.Orientation = geo.Left

		rightNode := layoutgraph.NewNode(4, 10, 10)
		rightNode.TopLeft = geo.NewPoint(120, 50)
		rightNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		rightNode.HerdAssignment.Orientation = geo.Right

		g.AddNode(topNode)
		g.AddNode(bottomNode)
		g.AddNode(leftNode)
		g.AddNode(rightNode)

		return g, map[string]*layoutgraph.Node{
			"top":    topNode,
			"bottom": bottomNode,
			"left":   leftNode,
			"right":  rightNode,
		}
	})

	// I. multiple Right-assigned nodes share same Val
	out.Scenarios["I_multiple_right_assigned_nodes"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		r1 := layoutgraph.NewNode(1, 10, 10)
		r1.TopLeft = geo.NewPoint(20, 30)
		r1.HerdAssignment = layoutgraph.NewHerdAssignment()
		r1.HerdAssignment.Orientation = geo.Right

		r2 := layoutgraph.NewNode(2, 20, 20)
		r2.TopLeft = geo.NewPoint(50, 40)
		r2.HerdAssignment = layoutgraph.NewHerdAssignment()
		r2.HerdAssignment.Orientation = geo.Right

		g.AddNode(r1)
		g.AddNode(r2)
		return g, map[string]*layoutgraph.Node{"r1": r1, "r2": r2}
	})

	// J. existing nonzero Val overwritten
	out.Scenarios["J_existing_nonzero_val_overwritten"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Right
		n.HerdAssignment.Val = 9999.9
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// K. assigned fixed Top node skipped
	out.Scenarios["K_assigned_fixed_top_node_skipped"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.FixedTopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Top
		n.HerdAssignment.Val = 777.0
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// L. assigned fixed Right node skipped
	out.Scenarios["L_assigned_fixed_right_node_skipped"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.FixedTopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Right
		n.HerdAssignment.Val = -888.0
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// M. fixed assigned node still contributes to graph bounds used by another non-fixed node
	out.Scenarios["M_fixed_node_influences_other_fence"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		fixedNode := layoutgraph.NewNode(1, 10, 10)
		fixedNode.TopLeft = geo.NewPoint(10, 10)
		fixedNode.FixedTopLeft = geo.NewPoint(10, 10)
		fixedNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		fixedNode.HerdAssignment.Orientation = geo.Top
		fixedNode.HerdAssignment.Val = 111.0

		nonFixedNode := layoutgraph.NewNode(2, 10, 10)
		nonFixedNode.TopLeft = geo.NewPoint(50, 50)
		nonFixedNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		nonFixedNode.HerdAssignment.Orientation = geo.Top
		nonFixedNode.HerdAssignment.Val = 222.0

		g.AddNode(fixedNode)
		g.AddNode(nonFixedNode)
		return g, map[string]*layoutgraph.Node{"fixed": fixedNode, "nonFixed": nonFixedNode}
	})

	// N. unassigned far-away node affects graph bounds used by assigned node
	out.Scenarios["N_unassigned_faraway_node_affects_bounds"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unassigned := layoutgraph.NewNode(1, 10, 10)
		unassigned.TopLeft = geo.NewPoint(0, 0)

		assigned := layoutgraph.NewNode(2, 10, 10)
		assigned.TopLeft = geo.NewPoint(100, 100)
		assigned.HerdAssignment = layoutgraph.NewHerdAssignment()
		assigned.HerdAssignment.Orientation = geo.Left

		g.AddNode(unassigned)
		g.AddNode(assigned)
		return g, map[string]*layoutgraph.Node{"unassigned": unassigned, "assigned": assigned}
	})

	// O. routed edge extends Left bound
	out.Scenarios["O_routed_edge_extends_left"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(50, 50)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Left
		g.AddNode(n)

		e := layoutgraph.NewEdge(n, n)
		e.Points = []*geo.Point{geo.NewPoint(10, 55), geo.NewPoint(50, 55)}
		g.AddEdge(e)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// P. routed edge extends Right bound
	out.Scenarios["P_routed_edge_extends_right"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(50, 50)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Right
		g.AddNode(n)

		e := layoutgraph.NewEdge(n, n)
		e.Points = []*geo.Point{geo.NewPoint(60, 55), geo.NewPoint(200, 55)}
		g.AddEdge(e)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// Q. routed edge extends Top/Bottom bound
	out.Scenarios["Q_routed_edge_extends_top_bottom"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		topNode := layoutgraph.NewNode(1, 10, 10)
		topNode.TopLeft = geo.NewPoint(50, 50)
		topNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		topNode.HerdAssignment.Orientation = geo.Top

		bottomNode := layoutgraph.NewNode(2, 10, 10)
		bottomNode.TopLeft = geo.NewPoint(50, 60)
		bottomNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		bottomNode.HerdAssignment.Orientation = geo.Bottom

		g.AddNode(topNode)
		g.AddNode(bottomNode)

		e := layoutgraph.NewEdge(topNode, bottomNode)
		e.Points = []*geo.Point{geo.NewPoint(55, 10), geo.NewPoint(55, 150)}
		g.AddEdge(e)
		return g, map[string]*layoutgraph.Node{"top": topNode, "bottom": bottomNode}
	})

	// R. edge label expands bound
	out.Scenarios["R_edge_label_expands_bound"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 20, 20)
		n.TopLeft = geo.NewPoint(50, 50)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Right
		g.AddNode(n)

		e := layoutgraph.NewEdge(n, n)
		e.Points = []*geo.Point{geo.NewPoint(50, 60), geo.NewPoint(70, 60)}
		e.Label = &layoutgraph.Label{
			Text:     "long-label",
			Width:    80,
			Height:   30,
			Position: label.InsideMiddleRight,
		}
		g.AddEdge(e)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// S. fractional geometry uses rounded Graph.BoundingBox value
	out.Scenarios["S_fractional_geometry_rounded"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 15.3, 25.7)
		n.TopLeft = geo.NewPoint(10.4, 20.6)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Top

		r := layoutgraph.NewNode(2, 10, 10)
		r.TopLeft = geo.NewPoint(50.3, 50)
		r.HerdAssignment = layoutgraph.NewHerdAssignment()
		r.HerdAssignment.Orientation = geo.Right

		g.AddNode(n)
		g.AddNode(r)
		return g, map[string]*layoutgraph.Node{"n": n, "r": r}
	})

	// T. TopLeft orientation leaves Val unchanged
	out.Scenarios["T_top_left_orientation_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.TopLeft
		n.HerdAssignment.Val = 123.4
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// U. TopRight unchanged
	out.Scenarios["U_top_right_orientation_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.TopRight
		n.HerdAssignment.Val = 234.5
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// V. BottomLeft unchanged
	out.Scenarios["V_bottom_left_orientation_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.BottomLeft
		n.HerdAssignment.Val = 345.6
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// W. BottomRight unchanged
	out.Scenarios["W_bottom_right_orientation_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.BottomRight
		n.HerdAssignment.Val = 456.7
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// X. NONE unchanged
	out.Scenarios["X_none_orientation_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.NONE
		n.HerdAssignment.Val = 567.8
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// Y. unknown orientation unchanged
	out.Scenarios["Y_unknown_orientation_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Orientation(999)
		n.HerdAssignment.Val = 678.9
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// Z. fresh NewHerdAssignment default TopLeft leaves Val unchanged
	out.Scenarios["Z_fresh_herd_assignment_top_left_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Val = 99.0
		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// AA. assignment pair counts unchanged
	out.Scenarios["AA_assignment_pair_counts_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Top

		uncle1 := layoutgraph.NewNode(10, 5, 5)
		uncle2 := layoutgraph.NewNode(20, 5, 5)
		n.HerdAssignment.PairSameSide(uncle1)
		n.HerdAssignment.PairSameSide(uncle2)
		n.HerdAssignment.PairOppositeSide(uncle1)

		g.AddNode(n)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// AB. repeated invocation after geometry change refreshes Val
	out.Scenarios["AB_repeated_invocation_after_geometry_change"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Right
		g.AddNode(n)

		// First sync
		proximity.SyncHerdFences(g)

		// Move node
		n.TopLeft = geo.NewPoint(100, 30)

		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// AC. unplaced node -> BoundingBox nil; all nodes unassigned -> success
	out.Scenarios["AC_unplaced_node_all_unassigned"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)
		placed := layoutgraph.NewNode(2, 10, 10)
		placed.TopLeft = geo.NewPoint(20, 30)
		g.AddNode(unplaced)
		g.AddNode(placed)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "placed": placed}
	})

	// AD. unplaced node -> bounds nil; fixed cardinal assignment -> success, Val unchanged
	out.Scenarios["AD_unplaced_node_fixed_cardinal"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)

		fixed := layoutgraph.NewNode(2, 10, 10)
		fixed.TopLeft = geo.NewPoint(20, 30)
		fixed.FixedTopLeft = geo.NewPoint(20, 30)
		fixed.HerdAssignment = layoutgraph.NewHerdAssignment()
		fixed.HerdAssignment.Orientation = geo.Top
		fixed.HerdAssignment.Val = 333.0

		g.AddNode(unplaced)
		g.AddNode(fixed)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "fixed": fixed}
	})

	// AE. unplaced node -> bounds nil; diagonal assignment -> success, Val unchanged
	out.Scenarios["AE_unplaced_node_diagonal_assignment"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)

		diag := layoutgraph.NewNode(2, 10, 10)
		diag.TopLeft = geo.NewPoint(20, 30)
		diag.HerdAssignment = layoutgraph.NewHerdAssignment()
		diag.HerdAssignment.Orientation = geo.TopLeft
		diag.HerdAssignment.Val = 444.0

		g.AddNode(unplaced)
		g.AddNode(diag)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "diag": diag}
	})

	// AF. unplaced node -> bounds nil; NONE assignment -> success, Val unchanged
	out.Scenarios["AF_unplaced_node_none_assignment"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)

		noneNode := layoutgraph.NewNode(2, 10, 10)
		noneNode.TopLeft = geo.NewPoint(20, 30)
		noneNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		noneNode.HerdAssignment.Orientation = geo.NONE
		noneNode.HerdAssignment.Val = 777.0

		g.AddNode(unplaced)
		g.AddNode(noneNode)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "noneNode": noneNode}
	})

	// AG. unplaced graph + eligible Top assignment -> panic, old Val unchanged
	out.Scenarios["AG_unplaced_graph_eligible_top_panic"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)

		top := layoutgraph.NewNode(2, 10, 10)
		top.TopLeft = geo.NewPoint(20, 30)
		top.HerdAssignment = layoutgraph.NewHerdAssignment()
		top.HerdAssignment.Orientation = geo.Top
		top.HerdAssignment.Val = 555.0

		g.AddNode(unplaced)
		g.AddNode(top)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "top": top}
	})

	// AH. unplaced graph + eligible Bottom assignment -> panic
	out.Scenarios["AH_unplaced_graph_eligible_bottom_panic"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)

		bottom := layoutgraph.NewNode(2, 10, 10)
		bottom.TopLeft = geo.NewPoint(20, 30)
		bottom.HerdAssignment = layoutgraph.NewHerdAssignment()
		bottom.HerdAssignment.Orientation = geo.Bottom
		bottom.HerdAssignment.Val = 666.0

		g.AddNode(unplaced)
		g.AddNode(bottom)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "bottom": bottom}
	})

	// AI. unplaced graph + eligible Left assignment -> panic
	out.Scenarios["AI_unplaced_graph_eligible_left_panic"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)

		left := layoutgraph.NewNode(2, 10, 10)
		left.TopLeft = geo.NewPoint(20, 30)
		left.HerdAssignment = layoutgraph.NewHerdAssignment()
		left.HerdAssignment.Orientation = geo.Left
		left.HerdAssignment.Val = 777.0

		g.AddNode(unplaced)
		g.AddNode(left)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "left": left}
	})

	// AJ. unplaced graph + eligible Right assignment -> panic
	out.Scenarios["AJ_unplaced_graph_eligible_right_panic"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		unplaced := layoutgraph.NewNode(1, 10, 10)

		right := layoutgraph.NewNode(2, 10, 10)
		right.TopLeft = geo.NewPoint(20, 30)
		right.HerdAssignment = layoutgraph.NewHerdAssignment()
		right.HerdAssignment.Orientation = geo.Right
		right.HerdAssignment.Val = 888.0

		g.AddNode(unplaced)
		g.AddNode(right)
		return g, map[string]*layoutgraph.Node{"unplaced": unplaced, "right": right}
	})

	// AK. graph.Nodes contains nil -> BoundingBox panic before fence mutation
	out.Scenarios["AK_graph_nodes_contains_nil"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Top
		n.HerdAssignment.Val = 999.0

		g.Nodes = append(g.Nodes, n, nil)
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// AL. multiple assigned nodes verify object identity behavior indirectly via unchanged orientation/pairs and changed Val
	out.Scenarios["AL_multiple_assigned_nodes_identity_and_pairs"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(20, 30)
		n1.HerdAssignment = layoutgraph.NewHerdAssignment()
		n1.HerdAssignment.Orientation = geo.Top

		n2 := layoutgraph.NewNode(2, 10, 10)
		n2.TopLeft = geo.NewPoint(50, 60)
		n2.HerdAssignment = layoutgraph.NewHerdAssignment()
		n2.HerdAssignment.Orientation = geo.Bottom

		u := layoutgraph.NewNode(3, 5, 5)
		n1.HerdAssignment.PairSameSide(u)
		n2.HerdAssignment.PairOppositeSide(u)

		g.AddNode(n1)
		g.AddNode(n2)
		return g, map[string]*layoutgraph.Node{"n1": n1, "n2": n2}
	})

	// AM. edge-label graph bound plus opposite orientation
	out.Scenarios["AM_edge_label_graph_bound_plus_opposite_orientation"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		leftNode := layoutgraph.NewNode(1, 20, 20)
		leftNode.TopLeft = geo.NewPoint(20, 50)
		leftNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		leftNode.HerdAssignment.Orientation = geo.Left

		rightNode := layoutgraph.NewNode(2, 20, 20)
		rightNode.TopLeft = geo.NewPoint(80, 50)
		rightNode.HerdAssignment = layoutgraph.NewHerdAssignment()
		rightNode.HerdAssignment.Orientation = geo.Right

		g.AddNode(leftNode)
		g.AddNode(rightNode)

		e := layoutgraph.NewEdge(leftNode, rightNode)
		e.Points = []*geo.Point{geo.NewPoint(40, 60), geo.NewPoint(80, 60)}
		e.Label = &layoutgraph.Label{
			Text:     "huge-label",
			Width:    100,
			Height:   40,
			Position: label.InsideMiddleRight,
		}
		g.AddEdge(e)

		return g, map[string]*layoutgraph.Node{"left": leftNode, "right": rightNode}
	})

	// AN. repeated call stable when geometry unchanged
	out.Scenarios["AN_repeated_call_stable_when_geometry_unchanged"] = runScenario(func() (*layoutgraph.Graph, map[string]*layoutgraph.Node) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		n.HerdAssignment = layoutgraph.NewHerdAssignment()
		n.HerdAssignment.Orientation = geo.Right
		g.AddNode(n)

		// First sync
		proximity.SyncHerdFences(g)

		// Second sync immediately without geometry change
		return g, map[string]*layoutgraph.Node{"n": n}
	})

	// Serialize and write
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal error: %v\n", err)
		os.Exit(1)
	}

	outPath := filepath.Join(".", "go-sync-herd-fences-reference.json")
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Wrote %s\n", outPath)
}
