//go:build ignore

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
	ContainerID  string                  `json:"containerId"`
	DirectOrder  []string                `json:"directOrder"`
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
			"slice":            "Slice 22 — WrapChildren Composition",
		},
		Scenarios: make(map[string]ScenarioResult),
	}

	// 1. non_container_noop
	{
		c := layoutgraph.NewNode(1, 200, 200)
		c.TopLeft = geo.NewPoint(10, 20)
		// isContainer is false, Graph is nil

		before := map[string]NodeStateDTO{"1": captureNodeState(c)}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{"1": captureNodeState(c)}

		out.Scenarios["non_container_noop"] = ScenarioResult{
			Name:         "non_container_noop",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 2. true_container_nil_graph_panics
	{
		c := layoutgraph.NewNode(1, 200, 200)
		c.TopLeft = geo.NewPoint(10, 20)
		c.SetContainer(true)
		c.Graph = nil

		before := map[string]NodeStateDTO{"1": captureNodeState(c)}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{"1": captureNodeState(c)}

		out.Scenarios["true_container_nil_graph_panics"] = ScenarioResult{
			Name:         "true_container_nil_graph_panics",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 3. square_basic
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["square_basic"] = ScenarioResult{
			Name:         "square_basic",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 4. circle_basic
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.CIRCLE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 60, 40)
		ch.TopLeft = geo.NewPoint(20, 20)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["circle_basic"] = ScenarioResult{
			Name:         "circle_basic",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 5. oval_basic
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.OVAL_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 80, 50)
		ch.TopLeft = geo.NewPoint(15, 25)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["oval_basic"] = ScenarioResult{
			Name:         "oval_basic",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 6. cloud_basic
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.CLOUD_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 100, 60)
		ch.TopLeft = geo.NewPoint(30, 40)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["cloud_basic"] = ScenarioResult{
			Name:         "cloud_basic",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 7. nested_descendants_unchanged
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 60, 60)
		ch.SetContainer(true)
		ch.TopLeft = geo.NewPoint(10, 15)
		ch.Graph = g
		g.AddNodeUnchecked(ch)

		gc := layoutgraph.NewNode(3, 20, 20)
		gc.TopLeft = geo.NewPoint(15, 20)
		gc.Graph = g
		g.AddNodeUnchecked(gc)

		g.Containers[c] = []*layoutgraph.Node{ch}
		g.Containers[ch] = []*layoutgraph.Node{gc}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
			"3": captureNodeState(gc),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
			"3": captureNodeState(gc),
		}

		out.Scenarios["nested_descendants_unchanged"] = ScenarioResult{
			Name:         "nested_descendants_unchanged",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 8. boundary_long_label
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		chLeft := layoutgraph.NewNode(2, 50, 40)
		chLeft.TopLeft = geo.NewPoint(10, 10)
		chLeft.Graph = g
		chLeft.Label = &layoutgraph.Label{
			Width:    200,
			Height:   30,
			Position: label.InsideTopLeft,
		}
		g.AddNodeUnchecked(chLeft)

		chRight := layoutgraph.NewNode(3, 50, 40)
		chRight.TopLeft = geo.NewPoint(150, 10)
		chRight.Graph = g
		g.AddNodeUnchecked(chRight)

		g.Containers[c] = []*layoutgraph.Node{chLeft, chRight}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(chLeft),
			"3": captureNodeState(chRight),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(chLeft),
			"3": captureNodeState(chRight),
		}

		out.Scenarios["boundary_long_label"] = ScenarioResult{
			Name:         "boundary_long_label",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 9. interior_long_label_ignored
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		chLeft := layoutgraph.NewNode(2, 50, 40)
		chLeft.TopLeft = geo.NewPoint(10, 10)
		chLeft.Graph = g
		g.AddNodeUnchecked(chLeft)

		chMid := layoutgraph.NewNode(3, 50, 40)
		chMid.TopLeft = geo.NewPoint(80, 10)
		chMid.Graph = g
		chMid.Label = &layoutgraph.Label{
			Width:    500,
			Height:   40,
			Position: label.InsideTopCenter,
		}
		g.AddNodeUnchecked(chMid)

		chRight := layoutgraph.NewNode(4, 50, 40)
		chRight.TopLeft = geo.NewPoint(150, 10)
		chRight.Graph = g
		g.AddNodeUnchecked(chRight)

		g.Containers[c] = []*layoutgraph.Node{chLeft, chMid, chRight}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(chLeft),
			"3": captureNodeState(chMid),
			"4": captureNodeState(chRight),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(chLeft),
			"3": captureNodeState(chMid),
			"4": captureNodeState(chRight),
		}

		out.Scenarios["interior_long_label_ignored"] = ScenarioResult{
			Name:         "interior_long_label_ignored",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2", "3", "4"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 10. child_outside_label_or_icon
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 60, 40)
		ch.TopLeft = geo.NewPoint(20, 20)
		ch.Graph = g
		ch.Label = &layoutgraph.Label{
			Width:    80,
			Height:   30,
			Position: label.OutsideTopLeft, // Outside position
		}
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["child_outside_label_or_icon"] = ScenarioResult{
			Name:         "child_outside_label_or_icon",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 11. container_label_padding
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		c.Label = &layoutgraph.Label{
			Width:    120,
			Height:   40,
			Position: label.InsideTopLeft,
		}
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["container_label_padding"] = ScenarioResult{
			Name:         "container_label_padding",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 12. child_fixed_origin
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(50, 50)
		ch.FixedTopLeft = geo.NewPoint(20, 15)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["child_fixed_origin"] = ScenarioResult{
			Name:         "child_fixed_origin",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 13. desired_width_larger
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		dw := 500.0
		c.DesiredWidth = &dw
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["desired_width_larger"] = ScenarioResult{
			Name:         "desired_width_larger",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 13b. desired_height_larger
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		dh := 500.0
		c.DesiredHeight = &dh
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["desired_height_larger"] = ScenarioResult{
			Name:         "desired_height_larger",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 13c. desired_width_zero
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		dw := 0.0
		c.DesiredWidth = &dw
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["desired_width_zero"] = ScenarioResult{
			Name:         "desired_width_zero",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 14. empty_container_missing_key
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(10, 10)
		c.Graph = g
		g.AddNodeUnchecked(c)
		// Missing key in g.Containers

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
		}

		out.Scenarios["empty_container_missing_key"] = ScenarioResult{
			Name:         "empty_container_missing_key",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 15. empty_container_empty_slice
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(10, 10)
		c.Graph = g
		g.AddNodeUnchecked(c)
		g.Containers[c] = []*layoutgraph.Node{}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
		}

		out.Scenarios["empty_container_empty_slice"] = ScenarioResult{
			Name:         "empty_container_empty_slice",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 16. nil_child_panics_before_mutation
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(10, 10)
		c.Graph = g
		g.AddNodeUnchecked(c)
		g.Containers[c] = []*layoutgraph.Node{nil}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
		}

		out.Scenarios["nil_child_panics_before_mutation"] = ScenarioResult{
			Name:         "nil_child_panics_before_mutation",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 17. null_child_top_left_panics_before_mutation
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(10, 10)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = nil
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["null_child_top_left_panics_before_mutation"] = ScenarioResult{
			Name:         "null_child_top_left_panics_before_mutation",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 18. null_container_top_left_partial_resize
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = nil
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["null_container_top_left_partial_resize"] = ScenarioResult{
			Name:         "null_container_top_left_partial_resize",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 19. detached_child_graph_still_succeeds
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = nil // detached from Graph
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["detached_child_graph_still_succeeds"] = ScenarioResult{
			Name:         "detached_child_graph_still_succeeds",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 20. duplicate_child_occurrence
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 40, 30)
		c.SetShape(shape.SQUARE_TYPE)
		c.SetContainer(true)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Graph = g
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.AddNodeUnchecked(ch)
		// Duplicate in container slice
		g.Containers[c] = []*layoutgraph.Node{ch, ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.WrapChildren()
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["duplicate_child_occurrence"] = ScenarioResult{
			Name:         "duplicate_child_occurrence",
			Panicked:     panicked,
			ContainerID:  "1",
			DirectOrder:  []string{"2", "2"},
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

	targetPath := "test/fixtures/go-wrap-children-reference.json"
	if err := os.WriteFile(targetPath, bytes, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Generated %d scenarios at %s (%d bytes)\n", len(out.Scenarios), targetPath, len(bytes))
}
