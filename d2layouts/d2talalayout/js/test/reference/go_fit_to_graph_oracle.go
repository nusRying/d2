//go:build tala_inside_geometry_oracle

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"runtime"
	"strconv"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
	"github.com/d2lang/d2/lib/shape"
)

type PointDTO struct {
	X string `json:"x"`
	Y string `json:"y"`
}

type SpacingDTO struct {
	Top    float64 `json:"top"`
	Bottom float64 `json:"bottom"`
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
}

type NodeStateDTO struct {
	ID           string    `json:"id"`
	TopLeft      *PointDTO `json:"topLeft"`
	FixedTopLeft *PointDTO `json:"fixedTopLeft,omitempty"`
	Width        string    `json:"width"`
	Height       string    `json:"height"`
}

type ScenarioResult struct {
	Name         string                  `json:"name"`
	Panicked     bool                    `json:"panicked"`
	TargetID     string                  `json:"targetId"`
	Padding      SpacingDTO              `json:"padding"`
	BeforeStates map[string]NodeStateDTO `json:"beforeStates"`
	AfterStates  map[string]NodeStateDTO `json:"afterStates"`
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

func captureNodeState(n *layoutgraph.Node) NodeStateDTO {
	if n == nil {
		return NodeStateDTO{}
	}
	dto := NodeStateDTO{
		ID:      fmt.Sprintf("%v", n.ID),
		TopLeft: pointToDTO(n.TopLeft),
		Width:   numberClass(n.Width),
		Height:  numberClass(n.Height),
	}
	if n.FixedTopLeft != nil {
		dto.FixedTopLeft = pointToDTO(n.FixedTopLeft)
	}
	return dto
}

func runSafe(fn func()) (panicked bool) {
	defer func() {
		if r := recover(); r != nil {
			panicked = true
		}
	}()
	fn()
	return false
}

func main() {
	out := OracleOutput{
		Metadata: map[string]string{
			"runtimeGoVersion": runtime.Version(),
			"d2BaseCommit":     "01bc7ecdbdd04c13d6fe5df1967d2d9aa14ae579",
			"slice":            "Slice 23 — FitToGraph",
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// 1. ordinary_non_container_succeeds
	{
		ownerG := layoutgraph.NewGraph()
		argG := layoutgraph.NewGraph()

		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.SetContainer(false) // non-container
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["ordinary_non_container_succeeds"] = ScenarioResult{
			Name:         "ordinary_non_container_succeeds",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 2. square_basic
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(10, 20)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["square_basic"] = ScenarioResult{
			Name:         "square_basic",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 3. circle_basic
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.CIRCLE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(10, 20)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["circle_basic"] = ScenarioResult{
			Name:         "circle_basic",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 4. oval_basic
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.OVAL_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(10, 20)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["oval_basic"] = ScenarioResult{
			Name:         "oval_basic",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 5. cloud_basic
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.CLOUD_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(10, 20)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["cloud_basic"] = ScenarioResult{
			Name:         "cloud_basic",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 6. real_square_basic
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.REAL_SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(10, 20)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["real_square_basic"] = ScenarioResult{
			Name:         "real_square_basic",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 7. different_argument_and_owner_graph
	{
		boundsG := layoutgraph.NewGraph()
		ownerG := layoutgraph.NewGraph()

		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.SetContainer(true)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		// boundsG node establishes tl=(50, 50), br=(150, 100)
		n2 := layoutgraph.NewNode(2, 100, 50)
		n2.TopLeft = geo.NewPoint(50, 50)
		n2.Graph = boundsG
		boundsG.AddNodeUnchecked(n2)

		// ownerG boundary child on left boundary (x=50) with width 300 label
		ch := layoutgraph.NewNode(3, 50, 50)
		ch.TopLeft = geo.NewPoint(50, 50)
		ch.Graph = ownerG
		ch.Label = &layoutgraph.Label{Width: 300, Height: 30, Position: label.InsideTopLeft}
		ownerG.AddNodeUnchecked(ch)
		ownerG.Containers[target] = []*layoutgraph.Node{ch}

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			target.FitToGraph(boundsG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(ch),
		}

		out.Scenarios["different_argument_and_owner_graph"] = ScenarioResult{
			Name:         "different_argument_and_owner_graph",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 8. argument_graph_nodes_ignore_owner_graph_nodes
	{
		argG := layoutgraph.NewGraph()
		ownerG := layoutgraph.NewGraph()

		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		extreme := layoutgraph.NewNode(2, 500, 500)
		extreme.TopLeft = geo.NewPoint(10000, 10000)
		extreme.Graph = ownerG
		ownerG.AddNodeUnchecked(extreme)

		argNode := layoutgraph.NewNode(3, 100, 80)
		argNode.TopLeft = geo.NewPoint(10, 10)
		argNode.Graph = argG
		argG.AddNodeUnchecked(argNode)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(extreme),
			"3": captureNodeState(argNode),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(extreme),
			"3": captureNodeState(argNode),
		}

		out.Scenarios["argument_graph_nodes_ignore_owner_graph_nodes"] = ScenarioResult{
			Name:         "argument_graph_nodes_ignore_owner_graph_nodes",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 9. nil_argument_graph_panics_before_mutation
	{
		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
		}
		panicked := runSafe(func() {
			target.FitToGraph(nil, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
		}

		out.Scenarios["nil_argument_graph_panics_before_mutation"] = ScenarioResult{
			Name:         "nil_argument_graph_panics_before_mutation",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 10. nil_owner_graph_panics_after_bounds_before_resize
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = nil // nil owner graph

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["nil_owner_graph_panics_after_bounds_before_resize"] = ScenarioResult{
			Name:         "nil_owner_graph_panics_after_bounds_before_resize",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 11. empty_argument_graph
	{
		argG := layoutgraph.NewGraph()
		ownerG := layoutgraph.NewGraph()

		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(10, 10)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
		}

		out.Scenarios["empty_argument_graph"] = ScenarioResult{
			Name:         "empty_argument_graph",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 12. nil_argument_node_panics_before_mutation
	{
		argG := layoutgraph.NewGraph()
		argG.Nodes = []*layoutgraph.Node{nil}

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
		}

		out.Scenarios["nil_argument_node_panics_before_mutation"] = ScenarioResult{
			Name:         "nil_argument_node_panics_before_mutation",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 13. argument_node_null_top_left_panics_before_mutation
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = nil
		argG.Nodes = []*layoutgraph.Node{n2}

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["argument_node_null_top_left_panics_before_mutation"] = ScenarioResult{
			Name:         "argument_node_null_top_left_panics_before_mutation",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 14. argument_graph_fixed_origin
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(50, 50)
		n2.FixedTopLeft = geo.NewPoint(20, 15)
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["argument_graph_fixed_origin"] = ScenarioResult{
			Name:         "argument_graph_fixed_origin",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 15. argument_graph_outside_label
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(50, 50)
		n2.Label = &layoutgraph.Label{Width: 80, Height: 30, Position: label.OutsideTopLeft}
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["argument_graph_outside_label"] = ScenarioResult{
			Name:         "argument_graph_outside_label",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 16. owner_boundary_long_label
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.SetContainer(true)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		ch := layoutgraph.NewNode(3, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10) // boundary match
		ch.Label = &layoutgraph.Label{Width: 200, Height: 30, Position: label.InsideTopLeft}
		ch.Graph = ownerG
		ownerG.AddNodeUnchecked(ch)
		ownerG.Containers[target] = []*layoutgraph.Node{ch}

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(ch),
		}

		out.Scenarios["owner_boundary_long_label"] = ScenarioResult{
			Name:         "owner_boundary_long_label",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 17. owner_interior_long_label_ignored
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n3 := layoutgraph.NewNode(3, 50, 50)
		n3.TopLeft = geo.NewPoint(80, 10)
		n4 := layoutgraph.NewNode(4, 50, 50)
		n4.TopLeft = geo.NewPoint(150, 10)
		n2.Graph = argG
		n3.Graph = argG
		n4.Graph = argG
		argG.AddNodeUnchecked(n2)
		argG.AddNodeUnchecked(n3)
		argG.AddNodeUnchecked(n4)

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.SetContainer(true)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		chInterior := layoutgraph.NewNode(5, 50, 50)
		chInterior.TopLeft = geo.NewPoint(80, 10) // interior
		chInterior.Label = &layoutgraph.Label{Width: 500, Height: 40, Position: label.InsideTopCenter}
		chInterior.Graph = ownerG
		ownerG.AddNodeUnchecked(chInterior)
		ownerG.Containers[target] = []*layoutgraph.Node{chInterior}

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(n3),
			"4": captureNodeState(n4),
			"5": captureNodeState(chInterior),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(n3),
			"4": captureNodeState(n4),
			"5": captureNodeState(chInterior),
		}

		out.Scenarios["owner_interior_long_label_ignored"] = ScenarioResult{
			Name:         "owner_interior_long_label_ignored",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 18. owner_child_null_top_left_with_label_panics
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.SetContainer(true)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		chNullTL := layoutgraph.NewNode(3, 50, 50)
		chNullTL.TopLeft = nil // null TopLeft
		chNullTL.Label = &layoutgraph.Label{Width: 200, Height: 30, Position: label.InsideTopLeft}
		chNullTL.Graph = ownerG
		ownerG.Containers[target] = []*layoutgraph.Node{chNullTL}

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(chNullTL),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
			"3": captureNodeState(chNullTL),
		}

		out.Scenarios["owner_child_null_top_left_with_label_panics"] = ScenarioResult{
			Name:         "owner_child_null_top_left_with_label_panics",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 19. nil_owner_child_panics_before_resize
	{
		argG := layoutgraph.NewGraph()
		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		ownerG := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.SetContainer(true)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)
		ownerG.Containers[target] = []*layoutgraph.Node{nil}

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["nil_owner_child_panics_before_resize"] = ScenarioResult{
			Name:         "nil_owner_child_panics_before_resize",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 20. argument_graph_contains_target
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(100, 100)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["argument_graph_contains_target"] = ScenarioResult{
			Name:         "argument_graph_contains_target",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 21. asymmetric_padding
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(3.25, 7.75, 11.5, 4.5)
		padDTO := SpacingDTO{Top: 3.25, Bottom: 7.75, Left: 11.5, Right: 4.5}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["asymmetric_padding"] = ScenarioResult{
			Name:         "asymmetric_padding",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 22. desired_width_larger
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		dw := 500.0
		target.DesiredWidth = &dw
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["desired_width_larger"] = ScenarioResult{
			Name:         "desired_width_larger",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 23. desired_height_larger
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		dh := 500.0
		target.DesiredHeight = &dh
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["desired_height_larger"] = ScenarioResult{
			Name:         "desired_height_larger",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 24. desired_width_zero
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		dw := 0.0
		target.DesiredWidth = &dw
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["desired_width_zero"] = ScenarioResult{
			Name:         "desired_width_zero",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 25. target_inside_label
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		target.Label = &layoutgraph.Label{Width: 200, Height: 100, Position: label.InsideTopLeft}
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["target_inside_label"] = ScenarioResult{
			Name:         "target_inside_label",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 26. target_outside_label
	{
		g := layoutgraph.NewGraph()
		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = geo.NewPoint(0, 0)
		target.Graph = g
		target.Label = &layoutgraph.Label{Width: 200, Height: 100, Position: label.OutsideTopLeft}
		g.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 50, 50)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = g
		g.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(g, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["target_outside_label"] = ScenarioResult{
			Name:         "target_outside_label",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 27. target_null_top_left_not_in_argument_graph
	{
		argG := layoutgraph.NewGraph()
		ownerG := layoutgraph.NewGraph()

		target := layoutgraph.NewNode(1, 40, 30)
		target.SetShape(shape.SQUARE_TYPE)
		target.TopLeft = nil // null TopLeft
		target.Graph = ownerG
		ownerG.AddNodeUnchecked(target)

		n2 := layoutgraph.NewNode(2, 60, 40)
		n2.TopLeft = geo.NewPoint(10, 10)
		n2.Graph = argG
		argG.AddNodeUnchecked(n2)

		pad := layoutgraph.OracleSpacing(10, 10, 10, 10)
		padDTO := SpacingDTO{Top: 10, Bottom: 10, Left: 10, Right: 10}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}
		panicked := runSafe(func() {
			target.FitToGraph(argG, pad)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(target),
			"2": captureNodeState(n2),
		}

		out.Scenarios["target_null_top_left_not_in_argument_graph"] = ScenarioResult{
			Name:         "target_null_top_left_not_in_argument_graph",
			Panicked:     panicked,
			TargetID:     "1",
			Padding:      padDTO,
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// Deterministic JSON serialization
	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal error: %v\n", err)
		os.Exit(1)
	}

	targetPath := "test/fixtures/go-fit-to-graph-reference.json"
	if err := os.WriteFile(targetPath, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(bytes))
}
