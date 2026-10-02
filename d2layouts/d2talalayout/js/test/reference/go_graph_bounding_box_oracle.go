//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
)

type PointResult struct {
	X any `json:"x"`
	Y any `json:"y"`
}

type BoundsResult struct {
	Success bool         `json:"success"`
	Panic   string       `json:"panic,omitempty"`
	TL      *PointResult `json:"tl"`
	BR      *PointResult `json:"br"`
}

type Output struct {
	GraphScenarios map[string]BoundsResult `json:"graphScenarios"`
	EdgeScenarios  map[string]BoundsResult `json:"edgeScenarios"`
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

func runGraphScenario(fn func() (*geo.Point, *geo.Point)) (res BoundsResult) {
	defer func() {
		if r := recover(); r != nil {
			res = BoundsResult{
				Success: false,
				Panic:   fmt.Sprintf("%v", r),
			}
		}
	}()

	tl, br := fn()
	res = BoundsResult{
		Success: true,
		TL:      pointToResult(tl),
		BR:      pointToResult(br),
	}
	return res
}

func runEdgeScenario(fn func() (*geo.Point, *geo.Point)) (res BoundsResult) {
	defer func() {
		if r := recover(); r != nil {
			res = BoundsResult{
				Success: false,
				Panic:   fmt.Sprintf("%v", r),
			}
		}
	}()

	tl, br := fn()
	res = BoundsResult{
		Success: true,
		TL:      pointToResult(tl),
		BR:      pointToResult(br),
	}
	return res
}

func main() {
	out := Output{
		GraphScenarios: make(map[string]BoundsResult),
		EdgeScenarios:  make(map[string]BoundsResult),
	}

	// ==========================================
	// 42. REQUIRED GRAPH ORACLE CASES
	// ==========================================

	// A. empty graph -> infinities
	out.GraphScenarios["A_empty_graph"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		return g.BoundingBox()
	})

	// B. one placed node
	out.GraphScenarios["B_one_placed_node"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(10, 20)
		g.Nodes = append(g.Nodes, n)
		return g.BoundingBox()
	})

	// C. multiple placed nodes
	out.GraphScenarios["C_multiple_placed_nodes"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 100, 50)
		n1.TopLeft = geo.NewPoint(10, 20)
		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(200, 150)
		g.Nodes = append(g.Nodes, n1, n2)
		return g.BoundingBox()
	})

	// D. fractional node dimensions / Go rounding
	out.GraphScenarios["D_fractional_node_dimensions"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100.4, 50.6)
		n.TopLeft = geo.NewPoint(10.2, 20.7)
		g.Nodes = append(g.Nodes, n)
		return g.BoundingBox()
	})

	// E. negative coordinates
	out.GraphScenarios["E_negative_coordinates"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 50, 50)
		n1.TopLeft = geo.NewPoint(-100, -80)
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		g.Nodes = append(g.Nodes, n1, n2)
		return g.BoundingBox()
	})

	// F. fixed-origin adjustment
	out.GraphScenarios["F_fixed_origin_adjustment"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		root := layoutgraph.NewNode(0, 500, 500)
		root.TopLeft = geo.NewPoint(0, 0)
		n1 := layoutgraph.NewNode(1, 100, 100)
		n1.TopLeft = geo.NewPoint(50, 50)
		n1.FixedTopLeft = geo.NewPoint(25, 30) // fixedOrigin = (50-25, 50-30) = (25, 20)
		n1.Container = root
		g.Containers[root] = []*layoutgraph.Node{n1}
		g.Nodes = append(g.Nodes, n1)
		return g.BoundingBox()
	})

	// G. one unplaced node -> null/null
	out.GraphScenarios["G_one_unplaced_node"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		// n.TopLeft == nil
		g.Nodes = append(g.Nodes, n)
		return g.BoundingBox()
	})

	// H. placed + unplaced node -> null/null
	out.GraphScenarios["H_placed_plus_unplaced_node"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 100, 50)
		n1.TopLeft = geo.NewPoint(10, 20)
		n2 := layoutgraph.NewNode(2, 60, 40)
		// n2.TopLeft == nil
		g.Nodes = append(g.Nodes, n1, n2)
		return g.BoundingBox()
	})

	// I. no nodes + finite edge -> infinities
	out.GraphScenarios["I_no_nodes_finite_edge"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 100)}
		g.Edges = append(g.Edges, e)
		return g.BoundingBox()
	})

	// J. node + edge with no Points -> node bounds unchanged
	out.GraphScenarios["J_node_edge_no_points"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(10, 20)
		g.Nodes = append(g.Nodes, n)
		e := layoutgraph.NewEdge(n, n)
		// e.Points empty
		g.Edges = append(g.Edges, e)
		return g.BoundingBox()
	})

	// K. edge route extends left/top
	out.GraphScenarios["K_edge_extends_left_top"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(100, 100)
		g.Nodes = append(g.Nodes, n)
		e := layoutgraph.NewEdge(n, n)
		e.Points = []*geo.Point{geo.NewPoint(50, 40), geo.NewPoint(100, 100)}
		g.Edges = append(g.Edges, e)
		return g.BoundingBox()
	})

	// L. edge route extends right/bottom
	out.GraphScenarios["L_edge_extends_right_bottom"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(100, 100)
		g.Nodes = append(g.Nodes, n)
		e := layoutgraph.NewEdge(n, n)
		e.Points = []*geo.Point{geo.NewPoint(100, 100), geo.NewPoint(350, 400)}
		g.Edges = append(g.Edges, e)
		return g.BoundingBox()
	})

	// M. fractional edge points test Go round
	out.GraphScenarios["M_fractional_edge_points_rounding"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(0, 0)
		g.Nodes = append(g.Nodes, n)
		e := layoutgraph.NewEdge(n, n)
		e.Points = []*geo.Point{geo.NewPoint(-10.4, -10.6), geo.NewPoint(150.4, 150.6)}
		g.Edges = append(g.Edges, e)
		return g.BoundingBox()
	})

	// N. negative .5 edge point rounding
	out.GraphScenarios["N_negative_half_edge_point_rounding"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(0, 0)
		g.Nodes = append(g.Nodes, n)
		e := layoutgraph.NewEdge(n, n)
		// -0.5 rounds to -1 in Go
		e.Points = []*geo.Point{geo.NewPoint(-0.5, -1.5), geo.NewPoint(100, 50)}
		g.Edges = append(g.Edges, e)
		return g.BoundingBox()
	})

	// O. multiple edges source order irrelevant to min/max result
	out.GraphScenarios["O_multiple_edges_order_independent"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(0, 0)
		g.Nodes = append(g.Nodes, n)
		e1 := layoutgraph.NewEdge(n, n)
		e1.Points = []*geo.Point{geo.NewPoint(20, 20), geo.NewPoint(150, 80)}
		e2 := layoutgraph.NewEdge(n, n)
		e2.Points = []*geo.Point{geo.NewPoint(-50, -30), geo.NewPoint(200, 300)}
		g.Edges = append(g.Edges, e1, e2)
		return g.BoundingBox()
	})

	// P. null edge natural panic
	out.GraphScenarios["P_null_edge_panic"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		n := layoutgraph.NewNode(1, 100, 50)
		n.TopLeft = geo.NewPoint(0, 0)
		g.Nodes = append(g.Nodes, n)
		g.Edges = append(g.Edges, nil)
		return g.BoundingBox()
	})

	// Q. null node natural panic
	out.GraphScenarios["Q_null_node_panic"] = runGraphScenario(func() (*geo.Point, *geo.Point) {
		g := layoutgraph.NewGraph()
		g.Nodes = append(g.Nodes, nil)
		return g.BoundingBox()
	})

	// ==========================================
	// 43. REQUIRED EDGE ORACLE CASES
	// ==========================================

	// R. zero points: (+Inf,+Inf),(-Inf,-Inf)
	out.EdgeScenarios["R_edge_zero_points"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		return e.BoundingBox()
	})

	// S. one point
	out.EdgeScenarios["S_edge_one_point"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(42, 99)}
		return e.BoundingBox()
	})

	// T. two-point route
	out.EdgeScenarios["T_edge_two_point_route"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(10, 20), geo.NewPoint(100, 200)}
		return e.BoundingBox()
	})

	// U. multi-segment route
	out.EdgeScenarios["U_edge_multi_segment_route"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{
			geo.NewPoint(10, 10),
			geo.NewPoint(50, 10),
			geo.NewPoint(50, 80),
			geo.NewPoint(120, 80),
		}
		return e.BoundingBox()
	})

	// V. raw fractional point rounding
	out.EdgeScenarios["V_raw_fractional_point_rounding"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{
			geo.NewPoint(0.4, 0.6),
			geo.NewPoint(99.5, 99.4),
		}
		return e.BoundingBox()
	})

	// W. main label unset -> ignored
	out.EdgeScenarios["W_main_label_unset"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.Label = &layoutgraph.Label{
			Position: label.Unset,
			Width:    200,
			Height:   100,
		}
		return e.BoundingBox()
	})

	// X. main label InsideMiddleLeft
	out.EdgeScenarios["X_main_label_InsideMiddleLeft"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.Label = &layoutgraph.Label{
			Position: label.InsideMiddleLeft,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// Y. main label InsideMiddleCenter
	out.EdgeScenarios["Y_main_label_InsideMiddleCenter"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.Label = &layoutgraph.Label{
			Position: label.InsideMiddleCenter,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// Z. main label InsideMiddleRight
	out.EdgeScenarios["Z_main_label_InsideMiddleRight"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.Label = &layoutgraph.Label{
			Position: label.InsideMiddleRight,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AA. OutsideTopLeft
	out.EdgeScenarios["AA_main_label_OutsideTopLeft"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.Label = &layoutgraph.Label{
			Position: label.OutsideTopLeft,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AB. OutsideTopCenter
	out.EdgeScenarios["AB_main_label_OutsideTopCenter"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.Label = &layoutgraph.Label{
			Position: label.OutsideTopCenter,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AC. OutsideTopRight
	out.EdgeScenarios["AC_main_label_OutsideTopRight"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.Label = &layoutgraph.Label{
			Position: label.OutsideTopRight,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AD. OutsideBottomLeft
	out.EdgeScenarios["AD_main_label_OutsideBottomLeft"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.Label = &layoutgraph.Label{
			Position: label.OutsideBottomLeft,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AE. OutsideBottomCenter
	out.EdgeScenarios["AE_main_label_OutsideBottomCenter"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.Label = &layoutgraph.Label{
			Position: label.OutsideBottomCenter,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AF. OutsideBottomRight
	out.EdgeScenarios["AF_main_label_OutsideBottomRight"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.Label = &layoutgraph.Label{
			Position: label.OutsideBottomRight,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AG. UnlockedTop
	out.EdgeScenarios["AG_main_label_UnlockedTop"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.LabelPercentage = 0.3
		e.Label = &layoutgraph.Label{
			Position: label.UnlockedTop,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AH. UnlockedMiddle
	out.EdgeScenarios["AH_main_label_UnlockedMiddle"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.LabelPercentage = 0.3
		e.Label = &layoutgraph.Label{
			Position: label.UnlockedMiddle,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AI. UnlockedBottom
	out.EdgeScenarios["AI_main_label_UnlockedBottom"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.LabelPercentage = 0.3
		e.Label = &layoutgraph.Label{
			Position: label.UnlockedBottom,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AJ. non-edge label position -> nil point, ignored
	out.EdgeScenarios["AJ_non_edge_label_position"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.Label = &layoutgraph.Label{
			Position: label.InsideTopLeft, // Node-only position
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AK. LabelPercentage = 0
	out.EdgeScenarios["AK_label_percentage_zero"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.LabelPercentage = 0.0
		e.Label = &layoutgraph.Label{
			Position: label.UnlockedMiddle,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AL. LabelPercentage = .5
	out.EdgeScenarios["AL_label_percentage_half"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.LabelPercentage = 0.5
		e.Label = &layoutgraph.Label{
			Position: label.UnlockedMiddle,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AM. LabelPercentage > 1 extrapolation
	out.EdgeScenarios["AM_label_percentage_extrapolation_positive"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.LabelPercentage = 1.5
		e.Label = &layoutgraph.Label{
			Position: label.UnlockedMiddle,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AN. LabelPercentage < 0 extrapolation
	out.EdgeScenarios["AN_label_percentage_extrapolation_negative"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 100), geo.NewPoint(100, 100)}
		e.LabelPercentage = -0.5
		e.Label = &layoutgraph.Label{
			Position: label.UnlockedMiddle,
			Width:    40,
			Height:   20,
		}
		return e.BoundingBox()
	})

	// AO. duplicate/zero-length route segment
	out.EdgeScenarios["AO_duplicate_zero_length_route_segment"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{
			geo.NewPoint(10, 10),
			geo.NewPoint(10, 10),
			geo.NewPoint(100, 10),
		}
		e.Label = &layoutgraph.Label{
			Position: label.InsideMiddleCenter,
			Width:    20,
			Height:   10,
		}
		return e.BoundingBox()
	})

	// ==========================================
	// 44. REQUIRED ARROWHEAD LABEL CASES
	// ==========================================

	// AP. source label, no arrowheads
	out.EdgeScenarios["AP_source_label_no_arrowheads"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// AQ. target label, no arrowheads
	out.EdgeScenarios["AQ_target_label_no_arrowheads"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.TargetArrowheadLabel = &layoutgraph.Label{Text: "dst", Width: 40, Height: 14}
		return e.BoundingBox()
	})

	// AR. source triangle arrow
	out.EdgeScenarios["AR_source_triangle_arrow"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowhead = layoutgraph.TriangleArrowhead
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// AS. target triangle arrow
	out.EdgeScenarios["AS_target_triangle_arrow"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.TargetArrowhead = layoutgraph.TriangleArrowhead
		e.TargetArrowheadLabel = &layoutgraph.Label{Text: "dst", Width: 40, Height: 14}
		return e.BoundingBox()
	})

	// AT. target label with no target arrow but source arrow present -> source-arrow fallback
	out.EdgeScenarios["AT_target_label_source_arrow_fallback"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowhead = layoutgraph.TriangleArrowhead
		e.TargetArrowhead = layoutgraph.NoArrowhead
		e.TargetArrowheadLabel = &layoutgraph.Label{Text: "dst", Width: 40, Height: 14}
		return e.BoundingBox()
	})

	// AU. fractional label dimensions: 30.9 x 12.9 -> integer truncation before geometry
	out.EdgeScenarios["AU_fractional_label_dimensions_truncation"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowhead = layoutgraph.TriangleArrowhead
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30.9, Height: 12.9}
		return e.BoundingBox()
	})

	// AV. horizontal route
	out.EdgeScenarios["AV_horizontal_route_arrowhead_label"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(50, 50), geo.NewPoint(200, 50)}
		e.SourceArrowhead = layoutgraph.TriangleArrowhead
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// AW. vertical route
	out.EdgeScenarios["AW_vertical_route_arrowhead_label"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(50, 50), geo.NewPoint(50, 250)}
		e.SourceArrowhead = layoutgraph.TriangleArrowhead
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// AX. diagonal route
	out.EdgeScenarios["AX_diagonal_route_arrowhead_label"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(50, 50), geo.NewPoint(200, 200)}
		e.SourceArrowhead = layoutgraph.TriangleArrowhead
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// AY. multi-segment source endpoint
	out.EdgeScenarios["AY_multisegment_source_endpoint"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{
			geo.NewPoint(0, 0),
			geo.NewPoint(0, 50),
			geo.NewPoint(100, 50),
		}
		e.SourceArrowhead = layoutgraph.TriangleArrowhead
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// AZ. multi-segment target endpoint
	out.EdgeScenarios["AZ_multisegment_target_endpoint"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{
			geo.NewPoint(0, 0),
			geo.NewPoint(0, 50),
			geo.NewPoint(100, 50),
		}
		e.TargetArrowhead = layoutgraph.TriangleArrowhead
		e.TargetArrowheadLabel = &layoutgraph.Label{Text: "dst", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// BA. line arrowhead
	out.EdgeScenarios["BA_line_arrowhead"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowhead = layoutgraph.Arrowhead("line")
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// BB. diamond
	out.EdgeScenarios["BB_diamond_arrowhead"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowhead = layoutgraph.Arrowhead("diamond")
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// BC. filled-circle
	out.EdgeScenarios["BC_filled_circle_arrowhead"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowhead = layoutgraph.Arrowhead("filled-circle")
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// BD. crow-foot type
	out.EdgeScenarios["BD_crowfoot_arrowhead"] = runEdgeScenario(func() (*geo.Point, *geo.Point) {
		e := layoutgraph.NewEdge(nil, nil)
		e.Points = []*geo.Point{geo.NewPoint(0, 0), geo.NewPoint(100, 0)}
		e.SourceArrowhead = layoutgraph.Arrowhead("cf-many")
		e.SourceArrowheadLabel = &layoutgraph.Label{Text: "src", Width: 30, Height: 12}
		return e.BoundingBox()
	})

	// Serialize and write
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal error: %v\n", err)
		os.Exit(1)
	}

	outPath := filepath.Join(".", "go-graph-bounding-box-reference.json")
	if len(os.Args) > 1 {
		outPath = os.Args[1]
	}
	if err := os.WriteFile(outPath, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Wrote %s\n", outPath)
}
