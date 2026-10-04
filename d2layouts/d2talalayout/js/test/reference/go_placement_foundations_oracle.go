//go:build ignore

package placement

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/d2lang/d2/d2layouts/d2talalayout/internal/layoutgraph"
	"github.com/d2lang/d2/lib/geo"
)

type PointJSON struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type AxisResult struct {
	Valid        bool `json:"valid"`
	IsHorizontal bool `json:"isHorizontal"`
	Opposite     int  `json:"opposite"`
}

type DirectionResult struct {
	Valid     bool `json:"valid"`
	IsForward bool `json:"isForward"`
	Opposite  int  `json:"opposite"`
}

type FixedNodesResult struct {
	Success  bool     `json:"success"`
	Panic    string   `json:"panic,omitempty"`
	HasFixed bool     `json:"hasFixed"`
	Fixed    []string `json:"fixed"`
}

type ValidationResult struct {
	Success bool   `json:"success"`
	Panic   string `json:"panic,omitempty"`
	Error   string `json:"error,omitempty"`
}

type GraphDistanceResult struct {
	Success   bool                  `json:"success"`
	Applied   bool                  `json:"applied"`
	Panic     string                `json:"panic,omitempty"`
	Error     string                `json:"error,omitempty"`
	Checks    int                   `json:"checks"`
	Positions map[string]*PointJSON `json:"positions,omitempty"`
}

type NormalizeResult struct {
	Success    bool                  `json:"success"`
	Panic      string                `json:"panic,omitempty"`
	Error      string                `json:"error,omitempty"`
	Nodes      map[string]*PointJSON `json:"nodes,omitempty"`
	EdgePoints [][]PointJSON         `json:"edgePoints,omitempty"`
}

type PadResult struct {
	Success    bool                  `json:"success"`
	Panic      string                `json:"panic,omitempty"`
	Error      string                `json:"error,omitempty"`
	Nodes      map[string]*PointJSON `json:"nodes,omitempty"`
	EdgePoints [][]PointJSON         `json:"edgePoints,omitempty"`
}

type ClusterConnResult struct {
	Success  bool     `json:"success"`
	Panic    string   `json:"panic,omitempty"`
	Error    string   `json:"error,omitempty"`
	External []string `json:"external"`
}

type OracleFixtures struct {
	Axis                      map[string]AxisResult          `json:"axis"`
	AxisArrangement           map[string]int                 `json:"axisArrangement"`
	Direction                 map[string]DirectionResult     `json:"direction"`
	FixedNodes                map[string]FixedNodesResult    `json:"fixedNodes"`
	ValidateCellSize          map[string]ValidationResult    `json:"validateCellSize"`
	ValidateGridAlignment     map[string]ValidationResult    `json:"validateGridAlignment"`
	ValidatePlacedNodes       map[string]ValidationResult    `json:"validatePlacedNodes"`
	GraphDistance             map[string]GraphDistanceResult `json:"graphDistance"`
	Normalize                 map[string]NormalizeResult     `json:"normalize"`
	Pad                       map[string]PadResult           `json:"pad"`
	ClusterExternalConnection map[string]ClusterConnResult   `json:"clusterExternalConnection"`
}

type countingContext struct {
	context.Context
	cancelAt int
	checks   int
}

func (c *countingContext) Err() error {
	c.checks++
	if c.cancelAt > 0 && c.checks >= c.cancelAt {
		return context.Canceled
	}
	return nil
}

func TestGeneratePlacementFoundationsOracle(t *testing.T) {
	out := OracleFixtures{
		Axis:                      make(map[string]AxisResult),
		AxisArrangement:           make(map[string]int),
		Direction:                 make(map[string]DirectionResult),
		FixedNodes:                make(map[string]FixedNodesResult),
		ValidateCellSize:          make(map[string]ValidationResult),
		ValidateGridAlignment:     make(map[string]ValidationResult),
		ValidatePlacedNodes:       make(map[string]ValidationResult),
		GraphDistance:             make(map[string]GraphDistanceResult),
		Normalize:                 make(map[string]NormalizeResult),
		Pad:                       make(map[string]PadResult),
		ClusterExternalConnection: make(map[string]ClusterConnResult),
	}

	// 1. AXIS
	for _, val := range []int{0, 1, 2, 3, 99} {
		ax := layoutAxis(val)
		name := fmt.Sprintf("axis_%d", val)
		out.Axis[name] = AxisResult{
			Valid:        ax.valid(),
			IsHorizontal: ax.isHorizontal(),
			Opposite:     int(ax.opposite()),
		}
	}

	for _, arr := range []layoutgraph.ClusterArrangement{
		layoutgraph.ClusterArrangement(""),
		layoutgraph.Row,
		layoutgraph.Column,
		layoutgraph.ClusterArrangement("column"),
		layoutgraph.ClusterArrangement("unknown"),
	} {
		name := string(arr)
		if name == "" {
			name = "<empty>"
		}
		out.AxisArrangement[name] = int(axisForArrangement(arr))
	}

	// 2. DIRECTION
	for _, val := range []int{0, 1, 2, 3, 99} {
		dir := traversalDirection(val)
		name := fmt.Sprintf("dir_%d", val)
		out.Direction[name] = DirectionResult{
			Valid:     dir.valid(),
			IsForward: dir.isForward(),
			Opposite:  int(dir.opposite()),
		}
	}

	// 3. FIXED NODES
	runFixed := func(name string, setup func() *layoutgraph.Graph) {
		defer func() {
			if r := recover(); r != nil {
				out.FixedNodes[name] = FixedNodesResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		g := setup()
		has := g.HasFixedNode()
		fixed := g.FixedNodes()
		var ids []string
		for _, n := range fixed {
			ids = append(ids, fmt.Sprintf("%d", n.ID))
		}
		out.FixedNodes[name] = FixedNodesResult{
			Success:  true,
			HasFixed: has,
			Fixed:    ids,
		}
	}

	runFixed("empty_graph", func() *layoutgraph.Graph {
		return layoutgraph.NewGraph()
	})
	runFixed("none_fixed", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.AddNode(layoutgraph.NewNode(1, 10, 10))
		g.AddNode(layoutgraph.NewNode(2, 10, 10))
		return g
	})
	runFixed("mixed_fixed", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n3 := layoutgraph.NewNode(3, 10, 10)
		n2.FixedTopLeft = geo.NewPoint(50, 50)
		g.AddNode(n1)
		g.AddNode(n2)
		g.AddNode(n3)
		return g
	})
	runFixed("all_fixed_order", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n3 := layoutgraph.NewNode(3, 10, 10)
		n3.FixedTopLeft = geo.NewPoint(10, 10)
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.FixedTopLeft = geo.NewPoint(20, 20)
		g.AddNode(n3)
		g.AddNode(n1)
		return g
	})
	runFixed("distinct_same_id", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(5, 10, 10)
		n2 := layoutgraph.NewNode(5, 10, 10)
		n1.FixedTopLeft = geo.NewPoint(10, 10)
		n2.FixedTopLeft = geo.NewPoint(20, 20)
		g.AddNode(n1)
		g.AddNode(n2)
		return g
	})
	runFixed("null_node", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.Nodes = append(g.Nodes, nil)
		return g
	})

	// 4. VALIDATE CELL SIZE
	runCellSize := func(name string, cs float64) {
		defer func() {
			if r := recover(); r != nil {
				out.ValidateCellSize[name] = ValidationResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		g := layoutgraph.NewGraph()
		g.CellSize = cs
		err := validateCellSize(g)
		if err != nil {
			out.ValidateCellSize[name] = ValidationResult{
				Success: false,
				Error:   err.Error(),
			}
		} else {
			out.ValidateCellSize[name] = ValidationResult{Success: true}
		}
	}

	runCellSize("valid_1", 1)
	runCellSize("valid_2", 2)
	runCellSize("valid_10", 10)
	runCellSize("valid_1000", 1000)
	runCellSize("invalid_0", 0)
	runCellSize("invalid_neg1", -1)
	runCellSize("invalid_half", 0.5)
	runCellSize("invalid_10_5", 10.5)
	runCellSize("invalid_nan", math.NaN())
	runCellSize("invalid_pos_inf", math.Inf(1))
	runCellSize("invalid_neg_inf", math.Inf(-1))

	// 5. VALIDATE GRID ALIGNMENT
	runGrid := func(name string, setup func() *layoutgraph.Graph) {
		defer func() {
			if r := recover(); r != nil {
				out.ValidateGridAlignment[name] = ValidationResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		g := setup()
		err := validateGridAlignment(g)
		if err != nil {
			out.ValidateGridAlignment[name] = ValidationResult{
				Success: false,
				Error:   err.Error(),
			}
		} else {
			out.ValidateGridAlignment[name] = ValidationResult{Success: true}
		}
	}

	runGrid("invalid_cell_size_wins", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 0
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		g.AddNode(n)
		return g
	})
	runGrid("valid_positive_aligned", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 30)
		g.AddNode(n)
		return g
	})
	runGrid("valid_negative_aligned", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(-20, -30)
		g.AddNode(n)
		return g
	})
	runGrid("misaligned_x", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(21, 30)
		g.AddNode(n)
		return g
	})
	runGrid("misaligned_y", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20, 35)
		g.AddNode(n)
		return g
	})
	runGrid("misaligned_fractional", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(1, 10, 10)
		n.TopLeft = geo.NewPoint(20.5, 30)
		g.AddNode(n)
		return g
	})
	runGrid("fixed_node_exempt_unpositioned", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(1, 10, 10)
		n.FixedTopLeft = geo.NewPoint(23, 37)
		g.AddNode(n)
		return g
	})
	runGrid("fixed_node_exempt_misaligned", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(1, 10, 10)
		n.FixedTopLeft = geo.NewPoint(23, 37)
		n.TopLeft = geo.NewPoint(23, 37)
		g.AddNode(n)
		return g
	})
	runGrid("nonfixed_unpositioned", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		g.CellSize = 10
		n := layoutgraph.NewNode(42, 10, 10)
		g.AddNode(n)
		return g
	})

	// 6. VALIDATE PLACED NODES
	runPlaced := func(name string, setup func() (*layoutgraph.Node, []*layoutgraph.Node)) {
		defer func() {
			if r := recover(); r != nil {
				out.ValidatePlacedNodes[name] = ValidationResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		root, nodes := setup()
		err := validatePlacedNodes(root, nodes)
		if err != nil {
			out.ValidatePlacedNodes[name] = ValidationResult{
				Success: false,
				Error:   err.Error(),
			}
		} else {
			out.ValidatePlacedNodes[name] = ValidationResult{Success: true}
		}
	}

	runPlaced("empty_nodes", func() (*layoutgraph.Node, []*layoutgraph.Node) {
		return nil, []*layoutgraph.Node{}
	})
	runPlaced("all_placed", func() (*layoutgraph.Node, []*layoutgraph.Node) {
		root := layoutgraph.NewNode(100, 10, 10)
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(0, 0)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n2.TopLeft = geo.NewPoint(10, 10)
		return root, []*layoutgraph.Node{n1, n2}
	})
	runPlaced("unplaced_with_root", func() (*layoutgraph.Node, []*layoutgraph.Node) {
		root := layoutgraph.NewNode(100, 10, 10)
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(0, 0)
		n2 := layoutgraph.NewNode(2, 10, 10)
		return root, []*layoutgraph.Node{n1, n2}
	})
	runPlaced("unplaced_with_nil_root", func() (*layoutgraph.Node, []*layoutgraph.Node) {
		n1 := layoutgraph.NewNode(7, 10, 10)
		return nil, []*layoutgraph.Node{n1}
	})
	runPlaced("first_unplaced_wins", func() (*layoutgraph.Node, []*layoutgraph.Node) {
		root := layoutgraph.NewNode(10, 10, 10)
		n1 := layoutgraph.NewNode(1, 10, 10)
		n2 := layoutgraph.NewNode(2, 10, 10)
		return root, []*layoutgraph.Node{n1, n2}
	})
	runPlaced("nil_node_in_slice", func() (*layoutgraph.Node, []*layoutgraph.Node) {
		root := layoutgraph.NewNode(10, 10, 10)
		return root, []*layoutgraph.Node{nil}
	})

	// 7. GRAPH DISTANCE INITIALIZATION
	runGD := func(name string, cancelAt int, setup func() *layoutgraph.Graph) {
		defer func() {
			if r := recover(); r != nil {
				out.GraphDistance[name] = GraphDistanceResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		g := setup()
		ctx := &countingContext{
			Context:  context.Background(),
			cancelAt: cancelAt,
		}
		applied, err := initializeByGraphDistance(ctx, g)
		res := GraphDistanceResult{
			Success: err == nil,
			Applied: applied,
			Checks:  ctx.checks,
		}
		if err != nil {
			res.Error = err.Error()
		}
		if applied {
			res.Positions = make(map[string]*PointJSON)
			for _, n := range g.Nodes {
				if n.TopLeft != nil {
					res.Positions[fmt.Sprintf("%d", n.ID)] = &PointJSON{X: n.TopLeft.X, Y: n.TopLeft.Y}
				}
			}
		}
		out.GraphDistance[name] = res
	}

	runGD("boundary_3_nodes", 0, func() *layoutgraph.Graph {
		return stressTestGraph(3, true)
	})
	runGD("boundary_4_nodes", 0, func() *layoutgraph.Graph {
		return stressTestGraph(4, true)
	})
	runGD("boundary_64_nodes", 0, func() *layoutgraph.Graph {
		return stressTestGraph(64, true)
	})
	runGD("boundary_65_nodes", 0, func() *layoutgraph.Graph {
		return stressTestGraph(65, true)
	})
	runGD("fixed_node_fallback", 0, func() *layoutgraph.Graph {
		g := stressTestGraph(8, true)
		g.Nodes[2].FixedTopLeft = geo.NewPoint(20, 30)
		return g
	})
	runGD("disconnected_fallback", 0, func() *layoutgraph.Graph {
		return stressTestGraph(8, false)
	})
	runGD("12_node_path", 0, func() *layoutgraph.Graph {
		return stressTestGraph(12, true)
	})
	runGD("5_node_star", 0, func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		for i := 0; i < 5; i++ {
			g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(i), 100, 50))
		}
		for i := 1; i < 5; i++ {
			g.Connect(g.Nodes[0], g.Nodes[i])
		}
		return g
	})
	runGD("6_node_cycle", 0, func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		for i := 0; i < 6; i++ {
			g.AddNode(layoutgraph.NewNode(layoutgraph.EntityID(i), 100, 50))
		}
		for i := 0; i < 6; i++ {
			g.Connect(g.Nodes[i], g.Nodes[(i+1)%6])
		}
		return g
	})
	runGD("cancellation_at_floyd", 2, func() *layoutgraph.Graph {
		return stressTestGraph(6, true)
	})
	runGD("cancellation_at_relaxation", 8, func() *layoutgraph.Graph {
		return stressTestGraph(6, true)
	})
	runGD("cancellation_at_assignment", 56, func() *layoutgraph.Graph {
		return stressTestGraph(6, true)
	})
	runGD("cancellation_at_final", 62, func() *layoutgraph.Graph {
		return stressTestGraph(6, true)
	})

	// 8. NORMALIZE
	runNorm := func(name string, setup func() *layoutgraph.Graph) {
		defer func() {
			if r := recover(); r != nil {
				out.Normalize[name] = NormalizeResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		g := setup()
		Normalize(g)
		res := NormalizeResult{
			Success: true,
			Nodes:   make(map[string]*PointJSON),
		}
		for _, n := range g.Nodes {
			if n.TopLeft != nil {
				res.Nodes[fmt.Sprintf("%d", n.ID)] = &PointJSON{X: n.TopLeft.X, Y: n.TopLeft.Y}
			}
		}
		for _, e := range g.Edges {
			var pts []PointJSON
			for _, p := range e.Points {
				pts = append(pts, PointJSON{X: p.X, Y: p.Y})
			}
			res.EdgePoints = append(res.EdgePoints, pts)
		}
		out.Normalize[name] = res
	}

	runNorm("node_minima", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(20, 50)
		n2 := layoutgraph.NewNode(2, 10, 10)
		n2.TopLeft = geo.NewPoint(40, 30)
		g.AddNode(n1)
		g.AddNode(n2)
		return g
	})
	runNorm("edge_minima_dominates", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(20, 50)
		g.AddNode(n1)
		e := layoutgraph.NewEdge(n1, n1)
		e.Points = []*geo.Point{geo.NewPoint(5.2, 8.9), geo.NewPoint(25, 60)}
		g.AddEdge(e)
		return g
	})
	runNorm("fixed_node_forced_1000", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(1500, 1200)
		n1.FixedTopLeft = geo.NewPoint(1500, 1200)
		g.AddNode(n1)
		e := layoutgraph.NewEdge(n1, n1)
		e.Points = []*geo.Point{geo.NewPoint(1500, 1200)}
		g.AddEdge(e)
		return g
	})
	runNorm("empty_graph", func() *layoutgraph.Graph {
		return layoutgraph.NewGraph()
	})

	// 9. PAD
	runPad := func(name string, setup func() *layoutgraph.Graph) {
		defer func() {
			if r := recover(); r != nil {
				out.Pad[name] = PadResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		g := setup()
		Pad(g)
		res := PadResult{
			Success: true,
			Nodes:   make(map[string]*PointJSON),
		}
		for _, n := range g.Nodes {
			if n.TopLeft != nil {
				res.Nodes[fmt.Sprintf("%d", n.ID)] = &PointJSON{X: n.TopLeft.X, Y: n.TopLeft.Y}
			}
		}
		for _, e := range g.Edges {
			var pts []PointJSON
			for _, p := range e.Points {
				pts = append(pts, PointJSON{X: p.X, Y: p.Y})
			}
			res.EdgePoints = append(res.EdgePoints, pts)
		}
		out.Pad[name] = res
	}

	runPad("pad_nodes_only", func() *layoutgraph.Graph {
		g := layoutgraph.NewGraph()
		n1 := layoutgraph.NewNode(1, 10, 10)
		n1.TopLeft = geo.NewPoint(20, 50)
		g.AddNode(n1)
		e := layoutgraph.NewEdge(n1, n1)
		e.Points = []*geo.Point{geo.NewPoint(100, 200)}
		g.AddEdge(e)
		return g
	})
	runPad("pad_empty", func() *layoutgraph.Graph {
		return layoutgraph.NewGraph()
	})

	// 10. CLUSTER EXTERNAL CONNECTED NODES
	runClusterConn := func(name string, setup func() *layoutgraph.Cluster) {
		defer func() {
			if r := recover(); r != nil {
				out.ClusterExternalConnection[name] = ClusterConnResult{
					Success: false,
					Panic:   fmt.Sprintf("%v", r),
				}
			}
		}()
		c := setup()
		nodes := clusterExternalConnectedNodes(c)
		var ids []string
		for _, n := range nodes {
			ids = append(ids, fmt.Sprintf("%d", n.ID))
		}
		out.ClusterExternalConnection[name] = ClusterConnResult{
			Success:  true,
			External: ids,
		}
	}

	runClusterConn("basic_both_cases", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{cNode}}

		ext1 := layoutgraph.NewNode(101, 10, 10)
		ext1.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(ext1)

		ext2 := layoutgraph.NewNode(102, 10, 10)
		ext2.TopLeft = geo.NewPoint(10, 10)
		g.AddNode(ext2)

		dummy := layoutgraph.NewNode(999, 10, 10)

		// Case A: OriginallyFrom == nil, OriginallyTo != nil -> CurrentFrom
		ab1 := &layoutgraph.EdgeAbduction{
			OriginallyFrom: nil,
			OriginallyTo:   dummy,
			CurrentFrom:    ext1,
		}
		// Case B: OriginallyTo == nil, OriginallyFrom != nil -> CurrentTo
		ab2 := &layoutgraph.EdgeAbduction{
			OriginallyFrom: dummy,
			OriginallyTo:   nil,
			CurrentTo:      ext2,
		}
		cluster.EdgeAbductions = []*layoutgraph.EdgeAbduction{ab1, ab2}
		return cluster
	})

	runClusterConn("deduplication_first_seen_order", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{cNode}}

		ext1 := layoutgraph.NewNode(101, 10, 10)
		ext1.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(ext1)

		ext2 := layoutgraph.NewNode(102, 10, 10)
		ext2.TopLeft = geo.NewPoint(10, 10)
		g.AddNode(ext2)

		dummy := layoutgraph.NewNode(999, 10, 10)

		ab1 := &layoutgraph.EdgeAbduction{OriginallyFrom: nil, OriginallyTo: dummy, CurrentFrom: ext2}
		ab2 := &layoutgraph.EdgeAbduction{OriginallyFrom: nil, OriginallyTo: dummy, CurrentFrom: ext1}
		ab3 := &layoutgraph.EdgeAbduction{OriginallyFrom: dummy, OriginallyTo: nil, CurrentTo: ext2} // duplicate

		cluster.EdgeAbductions = []*layoutgraph.EdgeAbduction{ab1, ab2, ab3}
		return cluster
	})

	runClusterConn("wrong_graph_ignored", func() *layoutgraph.Cluster {
		g1 := layoutgraph.NewGraph()
		g2 := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g1.AddNode(cNode)
		cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{cNode}}

		extWrong := layoutgraph.NewNode(101, 10, 10)
		extWrong.TopLeft = geo.NewPoint(0, 0)
		g2.AddNode(extWrong)

		dummy := layoutgraph.NewNode(999, 10, 10)
		ab := &layoutgraph.EdgeAbduction{OriginallyFrom: nil, OriginallyTo: dummy, CurrentFrom: extWrong}
		cluster.EdgeAbductions = []*layoutgraph.EdgeAbduction{ab}
		return cluster
	})

	runClusterConn("unpositioned_ignored", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		cluster := &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{cNode}}

		extUnpos := layoutgraph.NewNode(101, 10, 10)
		g.AddNode(extUnpos) // no TopLeft

		dummy := layoutgraph.NewNode(999, 10, 10)
		ab := &layoutgraph.EdgeAbduction{OriginallyFrom: nil, OriginallyTo: dummy, CurrentFrom: extUnpos}
		cluster.EdgeAbductions = []*layoutgraph.EdgeAbduction{ab}
		return cluster
	})

	runClusterConn("null_cluster", func() *layoutgraph.Cluster {
		return nil
	})

	runClusterConn("empty_cluster_nodes", func() *layoutgraph.Cluster {
		return &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{}}
	})

	runClusterConn("nil_first_cluster_node", func() *layoutgraph.Cluster {
		return &layoutgraph.Cluster{Nodes: []*layoutgraph.Node{nil}}
	})

	runClusterConn("nil_edge_abduction", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		return &layoutgraph.Cluster{
			Nodes:          []*layoutgraph.Node{cNode},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{nil},
		}
	})

	runClusterConn("case_a_nil_current_from", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		dummy := layoutgraph.NewNode(999, 10, 10)
		ab := &layoutgraph.EdgeAbduction{
			OriginallyFrom: nil,
			OriginallyTo:   dummy,
			CurrentFrom:    nil,
		}
		return &layoutgraph.Cluster{
			Nodes:          []*layoutgraph.Node{cNode},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{ab},
		}
	})

	runClusterConn("case_b_nil_current_to", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		dummy := layoutgraph.NewNode(999, 10, 10)
		ab := &layoutgraph.EdgeAbduction{
			OriginallyFrom: dummy,
			OriginallyTo:   nil,
			CurrentTo:      nil,
		}
		return &layoutgraph.Cluster{
			Nodes:          []*layoutgraph.Node{cNode},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{ab},
		}
	})

	runClusterConn("nil_edge_abductions_slice", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		return &layoutgraph.Cluster{
			Nodes:          []*layoutgraph.Node{cNode},
			EdgeAbductions: nil,
		}
	})

	runClusterConn("both_originals_nil_ignored", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		ext := layoutgraph.NewNode(101, 10, 10)
		ext.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(ext)
		ab := &layoutgraph.EdgeAbduction{
			OriginallyFrom: nil,
			OriginallyTo:   nil,
			CurrentFrom:    ext,
			CurrentTo:      ext,
		}
		return &layoutgraph.Cluster{
			Nodes:          []*layoutgraph.Node{cNode},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{ab},
		}
	})

	runClusterConn("both_originals_nonnil_ignored", func() *layoutgraph.Cluster {
		g := layoutgraph.NewGraph()
		cNode := layoutgraph.NewNode(1, 10, 10)
		g.AddNode(cNode)
		ext := layoutgraph.NewNode(101, 10, 10)
		ext.TopLeft = geo.NewPoint(0, 0)
		g.AddNode(ext)
		dummy := layoutgraph.NewNode(999, 10, 10)
		ab := &layoutgraph.EdgeAbduction{
			OriginallyFrom: dummy,
			OriginallyTo:   dummy,
			CurrentFrom:    ext,
			CurrentTo:      ext,
		}
		return &layoutgraph.Cluster{
			Nodes:          []*layoutgraph.Node{cNode},
			EdgeAbductions: []*layoutgraph.EdgeAbduction{ab},
		}
	})

	// WRITE OUTPUT TO FIXTURE
	bytes, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		t.Fatal(err)
	}

	fixturePath := filepath.Join("..", "..", "js", "test", "fixtures", "go-placement-foundations-reference.json")
	if err := os.WriteFile(fixturePath, bytes, 0644); err != nil {
		t.Fatalf("failed to write fixture: %v", err)
	}
	t.Logf("Wrote %d bytes to %s", len(bytes), fixturePath)
}
