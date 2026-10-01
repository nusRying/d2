package main

import (
	"encoding/json"
	"os"
	"runtime"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
	"github.com/d2lang/d2/lib/label"
	"github.com/d2lang/d2/lib/shape"
)

type PointDTO struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type NodeStateDTO struct {
	ID           string    `json:"id"`
	TopLeft      *PointDTO `json:"topLeft"`
	FixedTopLeft *PointDTO `json:"fixedTopLeft,omitempty"`
	Width        float64   `json:"width"`
	Height       float64   `json:"height"`
}

type ScenarioResult struct {
	Name         string                  `json:"name"`
	WithPadding  bool                    `json:"withPadding"`
	Panicked     bool                    `json:"panicked"`
	Container    NodeStateDTO            `json:"container"`
	DirectOrder  []string                `json:"directOrder"`
	BeforeStates map[string]NodeStateDTO `json:"beforeStates"`
	AfterStates  map[string]NodeStateDTO `json:"afterStates"`
}

type OracleOutput struct {
	Metadata  map[string]string         `json:"metadata"`
	Scenarios map[string]ScenarioResult `json:"scenarios"`
}

func pointToDTO(pt *geo.Point) *PointDTO {
	if pt == nil {
		return nil
	}
	return &PointDTO{X: pt.X, Y: pt.Y}
}

func captureNodeState(n *layoutgraph.Node) NodeStateDTO {
	if n == nil {
		return NodeStateDTO{}
	}
	dto := NodeStateDTO{
		ID:      string(n.ID),
		TopLeft: pointToDTO(n.TopLeft),
		Width:   n.Width,
		Height:  n.Height,
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
			"slice":            "Slice 20 — Container Child Positioning",
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
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{"1": captureNodeState(c)}

		out.Scenarios["non_container_noop"] = ScenarioResult{
			Name:         "non_container_noop",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
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
		// Graph is nil

		before := map[string]NodeStateDTO{"1": captureNodeState(c)}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{"1": captureNodeState(c)}

		out.Scenarios["true_container_nil_graph_panics"] = ScenarioResult{
			Name:         "true_container_nil_graph_panics",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 3. square_no_padding
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 300, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		c.SetShape(shape.SQUARE_TYPE)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 50, 50)
		ch2.TopLeft = geo.NewPoint(80, 80)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["square_no_padding"] = ScenarioResult{
			Name:         "square_no_padding",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 4. square_with_padding
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 300, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		c.SetShape(shape.SQUARE_TYPE)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 50, 50)
		ch2.TopLeft = geo.NewPoint(80, 80)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["square_with_padding"] = ScenarioResult{
			Name:         "square_with_padding",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 5. circle_no_padding
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 400)
		c.TopLeft = geo.NewPoint(0, 0)
		c.SetShape(shape.CIRCLE_TYPE)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 60, 60)
		ch1.TopLeft = geo.NewPoint(20, 20)
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 60, 60)
		ch2.TopLeft = geo.NewPoint(100, 100)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["circle_no_padding"] = ScenarioResult{
			Name:         "circle_no_padding",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 6. circle_with_padding
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 400)
		c.TopLeft = geo.NewPoint(0, 0)
		c.SetShape(shape.CIRCLE_TYPE)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 60, 60)
		ch1.TopLeft = geo.NewPoint(20, 20)
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 60, 60)
		ch2.TopLeft = geo.NewPoint(100, 100)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["circle_with_padding"] = ScenarioResult{
			Name:         "circle_with_padding",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 7. oval_or_cloud
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		c.SetShape(shape.OVAL_TYPE)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 50, 50)
		ch2.TopLeft = geo.NewPoint(100, 100)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["oval_or_cloud"] = ScenarioResult{
			Name:         "oval_or_cloud",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 8. nested_descendants
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 500, 500)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)

		child := layoutgraph.NewNode(2, 100, 100)
		child.TopLeft = geo.NewPoint(20, 20)
		g.AddNewNodeToContainer(c, child)

		grandchild := layoutgraph.NewNode(3, 40, 40)
		grandchild.TopLeft = geo.NewPoint(30, 30)
		g.AddNewNodeToContainer(child, grandchild)

		greatGrandchild := layoutgraph.NewNode(4, 20, 20)
		greatGrandchild.TopLeft = geo.NewPoint(35, 35)
		g.AddNewNodeToContainer(grandchild, greatGrandchild)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(child),
			"3": captureNodeState(grandchild),
			"4": captureNodeState(greatGrandchild),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(child),
			"3": captureNodeState(grandchild),
			"4": captureNodeState(greatGrandchild),
		}

		out.Scenarios["nested_descendants"] = ScenarioResult{
			Name:         "nested_descendants",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 9. boundary_long_label
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 400)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 20, 20)
		ch1.TopLeft = geo.NewPoint(100, 100)
		ch1.Label = &layoutgraph.Label{Width: 80, Height: 15, Position: label.InsideTopLeft}
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 20, 20)
		ch2.TopLeft = geo.NewPoint(200, 100)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["boundary_long_label"] = ScenarioResult{
			Name:         "boundary_long_label",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 10. interior_long_label_ignored
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 500, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)

		left := layoutgraph.NewNode(2, 40, 40)
		left.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(c, left)

		mid := layoutgraph.NewNode(3, 40, 40)
		mid.TopLeft = geo.NewPoint(150, 50)
		mid.Label = &layoutgraph.Label{Width: 200, Height: 20, Position: label.InsideTopLeft}
		g.AddNewNodeToContainer(c, mid)

		right := layoutgraph.NewNode(4, 40, 40)
		right.TopLeft = geo.NewPoint(250, 50)
		g.AddNewNodeToContainer(c, right)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(left),
			"3": captureNodeState(mid),
			"4": captureNodeState(right),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(left),
			"3": captureNodeState(mid),
			"4": captureNodeState(right),
		}

		out.Scenarios["interior_long_label_ignored"] = ScenarioResult{
			Name:         "interior_long_label_ignored",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3", "4"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 11. label_height_irrelevant
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 400)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 20, 20)
		ch1.TopLeft = geo.NewPoint(100, 100)
		ch1.Label = &layoutgraph.Label{Width: 80, Height: 500, Position: label.InsideTopLeft}
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 20, 20)
		ch2.TopLeft = geo.NewPoint(200, 100)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["label_height_irrelevant"] = ScenarioResult{
			Name:         "label_height_irrelevant",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 12. fixed_origin
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 400)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(100, 100)
		ch1.FixedTopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 50, 50)
		ch2.TopLeft = geo.NewPoint(200, 200)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["fixed_origin"] = ScenarioResult{
			Name:         "fixed_origin",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 13. empty_container_missing_key
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 300, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)
		c.SetContainer(true)
		// Missing key in g.Containers

		before := map[string]NodeStateDTO{"1": captureNodeState(c)}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{"1": captureNodeState(c)}

		out.Scenarios["empty_container_missing_key"] = ScenarioResult{
			Name:         "empty_container_missing_key",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 14. empty_container_empty_slice
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 300, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)
		c.SetContainer(true)
		g.Containers[c] = []*layoutgraph.Node{}

		before := map[string]NodeStateDTO{"1": captureNodeState(c)}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{"1": captureNodeState(c)}

		out.Scenarios["empty_container_empty_slice"] = ScenarioResult{
			Name:         "empty_container_empty_slice",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 15. duplicate_child_occurrence
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 300, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)
		c.SetContainer(true)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(10, 10)
		ch.Graph = g
		g.Nodes = append(g.Nodes, ch)
		ch.Container = c
		g.Containers[c] = []*layoutgraph.Node{ch, ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["duplicate_child_occurrence"] = ScenarioResult{
			Name:         "duplicate_child_occurrence",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 16. nil_child_panics_before_movement
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 300, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)
		c.SetContainer(true)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(10, 10)
		ch1.Graph = g
		g.Nodes = append(g.Nodes, ch1)
		ch1.Container = c
		g.Containers[c] = []*layoutgraph.Node{ch1, nil}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
		}

		out.Scenarios["nil_child_panics_before_movement"] = ScenarioResult{
			Name:         "nil_child_panics_before_movement",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 17. null_top_left_panics_before_movement
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 300, 300)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)
		c.SetContainer(true)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(10, 10)
		ch1.Graph = g
		g.Nodes = append(g.Nodes, ch1)
		ch1.Container = c

		chNoTL := layoutgraph.NewNode(3, 50, 50)
		chNoTL.TopLeft = nil
		chNoTL.Graph = g
		g.Nodes = append(g.Nodes, chNoTL)
		chNoTL.Container = c

		g.Containers[c] = []*layoutgraph.Node{ch1, chNoTL}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(chNoTL),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(chNoTL),
		}

		out.Scenarios["null_top_left_panics_before_movement"] = ScenarioResult{
			Name:         "null_top_left_panics_before_movement",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 18. detached_second_child_partial_mutation
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 400)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(10, 10)
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 50, 50)
		ch2.TopLeft = geo.NewPoint(80, 80)
		// ch2 is in Containers, but has Graph = nil!
		g.Containers[c] = append(g.Containers[c], ch2)
		ch2.Container = c
		ch2.Graph = nil

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["detached_second_child_partial_mutation"] = ScenarioResult{
			Name:         "detached_second_child_partial_mutation",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 19. detached_child_zero_delta_no_panic
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 200, 200)
		c.TopLeft = geo.NewPoint(100, 100)
		g.AddNodeUnchecked(c)
		c.SetContainer(true)

		ch := layoutgraph.NewNode(2, 50, 50)
		ch.TopLeft = geo.NewPoint(100, 100)
		ch.Container = c
		ch.Graph = nil // Graph is nil!
		g.Containers[c] = []*layoutgraph.Node{ch}

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["detached_child_zero_delta_no_panic"] = ScenarioResult{
			Name:         "detached_child_zero_delta_no_panic",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 20. container_label_padding
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 400, 400)
		c.TopLeft = geo.NewPoint(0, 0)
		c.Label = &layoutgraph.Label{Width: 100, Height: 30, Position: label.InsideTopCenter}
		g.AddNodeUnchecked(c)

		ch := layoutgraph.NewNode(2, 60, 60)
		ch.TopLeft = geo.NewPoint(50, 50)
		g.AddNewNodeToContainer(c, ch)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(true)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch),
		}

		out.Scenarios["container_label_padding"] = ScenarioResult{
			Name:         "container_label_padding",
			WithPadding:  true,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	// 21. outside_label_fixed_bounds_ordering
	{
		g := layoutgraph.NewGraph()
		c := layoutgraph.NewNode(1, 500, 500)
		c.TopLeft = geo.NewPoint(0, 0)
		g.AddNodeUnchecked(c)

		ch1 := layoutgraph.NewNode(2, 50, 50)
		ch1.TopLeft = geo.NewPoint(100, 100)
		ch1.Label = &layoutgraph.Label{Width: 40, Height: 20, Position: label.OutsideLeftMiddle}
		g.AddNewNodeToContainer(c, ch1)

		ch2 := layoutgraph.NewNode(3, 50, 50)
		ch2.TopLeft = geo.NewPoint(200, 100)
		g.AddNewNodeToContainer(c, ch2)

		before := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}
		panicked := runSafe(func() {
			c.PositionContainerChildren(false)
		})
		after := map[string]NodeStateDTO{
			"1": captureNodeState(c),
			"2": captureNodeState(ch1),
			"3": captureNodeState(ch2),
		}

		out.Scenarios["outside_label_fixed_bounds_ordering"] = ScenarioResult{
			Name:         "outside_label_fixed_bounds_ordering",
			WithPadding:  false,
			Panicked:     panicked,
			Container:    captureNodeState(c),
			DirectOrder:  []string{"2", "3"},
			BeforeStates: before,
			AfterStates:  after,
		}
	}

	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}

	outFile := "test/fixtures/go-position-container-children-reference.json"
	if len(os.Args) > 1 {
		outFile = os.Args[1]
	}

	if err := os.WriteFile(outFile, b, 0644); err != nil {
		panic(err)
	}
}
